const winston = require('winston');

const fetch = require('node-fetch');
const puppeteer = require('puppeteer');

const Cite = require('citation-js');
//const parseBibFile = require('bibtex').parseBibFile;
//const normalizeFieldValue = require('bibtex').normalizeFieldValue;

module.exports.createAuthorExtraction = createAuthorExtraction;

const dateNow = new Date();
const dateString = dateNow.getFullYear() + '_' + dateNow.getMonth() + '_' + dateNow.getDate() + '_' + dateNow.getHours() + '_' + dateNow.getMinutes();


const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: `error_${dateString}.log`, level: 'error' }),
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

async function createAuthorExtraction(idhal, options) {
    let authorExtraction = {
        entryList : [],
        logList : []
    };

    let headless = true;
    let timeout = 30000;
    if (options) {
        if (options.headless === false) {
            headless = false;
        }
        if (options.timeout) {
            timeout = options.timeout;
        }
    }
    logger.info('OPEN HAL ');
    if (options) {
        logger.info('options: ', options);
    } else {
        logger.info('default options');
    }


    
    let fetchedList;
    try {
        fetchedList = await fetchHALAPI(idhal);
    } catch (e) {
        logger.error(`cannot fetch idHal: ${idhal}`);
        authorExtraction.logList.push({
            level: 'fatal',
            msg:`cannot fetch idHal: ${idhal}`
        });
        return authorExtraction;
    }

    if (fetchedList && fetchedList.response && fetchedList.response.docs && Array.isArray(fetchedList.response.docs)) {
        logger.info('Found '+fetchedList.response.docs.length);
        let fetchedDocList = fetchedList.response.docs;
        let browser;
        let page;
        try {
            browser = await puppeteer.launch({ headless, timeout });
            page = await browser.newPage();
        } catch (e) {
            logger.error('cannot launch browser ', e);
            return authorExtraction;
        }
        
        for (let indexEntry = 0; indexEntry < fetchedDocList.length; indexEntry++) {
            const entryURL = fetchedDocList[indexEntry].uri_s;
            logger.info('Grab '+entryURL);
            try {
                
                let entry = await fetchEntry(page, entryURL);
                if (entry != undefined && entry.kind != undefined) {
                    logger.info('Get '+entry.kind+' : '+entry.title);
                    authorExtraction.entryList.push(entry);
                } else {
                    if (entry == undefined ) {
                        logger.warn(`Unable to fetch (entry was undefined): ${entryURL}`);
                        authorExtraction.logList.push({
                            level: 'warning',
                            msg:`Unable to fetch (entry was undefined): ${entryURL}`
                        })
                    }
                    if (entry.kind == undefined) {
                        logger.warn(`No kind in the entry : ${entryURL}`);
                        authorExtraction.logList.push({
                            level: 'warning',
                            msg:`No kind in the entry : ${entryURL}`
                        });
                    }
                }
            } catch(e) {
                logger.error(`Unable to fetch (entry was undefined): ${entryURL}`)
                authorExtraction.logList.push({
                    level: 'warning',
                    msg:`Unable to fetch (entry was undefined): ${entryURL}`
                });
            }
        }
        await page.close();
        await browser.close();
        await setBibTex(authorExtraction);
    } else {
        logger.error(`HAL return nothing for idHal: ${idhal}`);
        throw new Error("HAL return nothing !!!");
    }
    const cleanEntryList = [];
    authorExtraction.entryList.forEach(entry => {
        if (entry.bibtex && entry.year && entry.title && entry.in && entry.inFull) {
            cleanEntryList.push(entry);
        } else {
            authorExtraction.logList.push({
                level: 'error',
                msg:`Bibtex is discarded, too few data: ${entry.bibHref}`
            });
            logger.error(`Bibtex is discarded, too few data: ${entry.bibHref}`);
        }
    });
    authorExtraction.entryList = cleanEntryList;
    return authorExtraction;
}

function fetchHALAPI(idhal) {
    logger.info('fetch id : '+idhal)
    const API_URL = `https://api.archives-ouvertes.fr/search/?q=authIdHal_s:${idhal}&rows=500&wt=json`;
    return fetch(API_URL)
        .then(res => {
            logger.info('res:'+JSON.stringify(res));
            if (res.ok) {
                return res.json();
            } else {
                logger.error(`Cannot fetch idhal: ${idhal}`);
                throw new Error('cannot fetch');
            }
        })
}

async function fetchEntry(page, url) {
    const DETAIL_SELECTOR = "#document > div.col-md-8 > div.metadatas-complete > span.btn-view.text-center > button";
    const TITLE_SELECTOR = "#document > div.col-md-8 > h1";
    const ROW_LIST_SELECTOR = ".content tr";
    const BIB_BUTTON_SELECTOR = "#document > div.col-md-4 > div.widget.widget-export > div > a:nth-child(1)";

    let entry;

    await page.goto(url, { waitUntil: "domcontentloaded" });

    await page.click(DETAIL_SELECTOR);
    await page.waitFor(ROW_LIST_SELECTOR);
    
    entry = await page.$$eval(ROW_LIST_SELECTOR, trList => {
        let halEntry = {};
        trList.forEach(tr => {
            if (tr.children && tr.children.length > 1) {
                if (clean(tr.children[0].innerText) == 'type de document' || clean(tr.children[0].innerText) == 'document types') {
                    halEntry.kind = entryKind(tr.children[1].innerText);
                }
            }
        });
        return halEntry;

        function clean(str) {
            let res = str;
            res = res.trim();
            res = res.toLowerCase();
            res = res.replace(/\s+/g, ' ').trim();
            res = res.replace(/[{}]+/g, '');
            res = res.trim();
            return res;
        }

        function entryKind(text) {
            text = text.toLowerCase();
            const CONF = 'conference';
            const JOUR = 'journal';
            if (text.includes('communication dans un congrès')){
                return CONF
            }
            if (text.includes('conference papers')){
                return CONF
            }
            if (text.includes('article dans une revue')){
                return JOUR;
            }
            if (text.includes('journal articles')){
                return JOUR;
            }
            return undefined;
        }
    })

    entry.title = await page.$eval(TITLE_SELECTOR, h1 => h1.innerText);
    entry.title = entry.title.replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g,' ').replace(/^\s+|\s+$/,'') 

    entry.bibHref = await page.$eval(BIB_BUTTON_SELECTOR, bibButton => bibButton.href);
    
    return entry;
}

async function setBibTex(authorExtraction) {
    for (let indexEntry = 0; indexEntry < authorExtraction.entryList.length; indexEntry++) {
        const entry = authorExtraction.entryList[indexEntry];
        if (entry.bibHref) {
            await fetch(entry.bibHref)
                    .then(res => {
                        if (res.ok) {
                            return res.text();
                        }
                        throw new Error('cannot fetch entry: ', entry.bibHref);
                    })
                    .then(bibtex => {
                        logger.info('bibtex fetched from '+entry.bibHref);
                        entry.bibtex = bibtex;
                        integrateCitation(entry);
                    })
                    .catch((e) => {
                        authorExtraction.logList.push({
                            level: 'warning',
                            msg:`cannot fetch entry: ${entry.bibHref}`
                        });
                    })
        }
    }
}

function integrateCitation(entry) {
    try {
        let cites = Cite.parse.bibtex.text(entry.bibtex);
        let bibEntry = cites[0];
        entry.year = parseInt((bibEntry.properties["YEAR"]));
        if (entry.kind === "conference") {
            entry.in = bibEntry.properties["BOOKTITLE"];
            entry.inFull = bibEntry.properties["BOOKTITLE"];
        } else if (entry.kind === "journal") {
            entry.in = bibEntry.properties["JOURNAL"];
            entry.inFull = bibEntry.properties["JOURNAL"];
        }
    } catch (e) {
        entry.bibtex = undefined;
    }
}

