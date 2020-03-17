const winston = require('winston');

const fetch = require('node-fetch');
const puppeteer = require('puppeteer');

const Cite = require('citation-js');
//const parseBibFile = require('bibtex').parseBibFile;
//const normalizeFieldValue = require('bibtex').normalizeFieldValue;

const HEADLESS = true;

module.exports.createEntryList = createEntryList;

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

async function createEntryList(idhal) {
    let entryList = [];
    try {
        let fetchedList = await fetchHALAPI(idhal);
        if (fetchedList && fetchedList.response && fetchedList.response.docs && Array.isArray(fetchedList.response.docs)) {
            logger.info('Found '+fetchedList.response.docs.length);
            let fetchedDocList = fetchedList.response.docs;
            let browser = await puppeteer.launch({ headless: HEADLESS });
            let page = await browser.newPage();
            for (let indexEntry = 0; indexEntry < fetchedDocList.length; indexEntry++) {
                const entryURL = fetchedDocList[indexEntry].uri_s;
                logger.info('Grab '+entryURL);
                let entry = await fetchEntry(page, entryURL);
                if (entry != undefined && entry.kind != undefined) {
                    logger.info('Get '+entry.kind+' : '+entry.title);
                    entryList.push(entry);
                } else {
                    logger.info('Entry not valid !')
                }
            }
            await page.close();
            await browser.close();
            await setBibTex(entryList);
        } else {
            throw new Error("HAL return nothing !!!");
        }
    } catch (e) {
        logger.error(e);
    }
    return entryList.filter(entry => entry.bibtex && entry.year && entry.title && entry.in && entry.inFull);
}

function fetchHALAPI(idhal) {
    logger.info('fetch id : '+idhal)
    const API_URL = `https://api.archives-ouvertes.fr/search/?q=authIdHal_s:${idhal}&rows=100&wt=json`;
    return fetch(API_URL)
        .then(res => {
            logger.info('res:'+JSON.stringify(res));
            if (res.ok) {
                return res.json();
            } else {
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

    try {
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

        entry.bibHref = await page.$eval(BIB_BUTTON_SELECTOR, bibButton => bibButton.href);

    } catch(e) {
        logger.error(e);
    }
    
    return entry;
}

async function setBibTex(entryList) {
    for (let indexEntry = 0; indexEntry < entryList.length; indexEntry++) {
        const entry = entryList[indexEntry];
        if (entry.bibHref) {
            await fetch(entry.bibHref)
                    .then(res => {
                        if (res.ok) {
                            return res.text();
                        }
                    })
                    .then(bibtex => {
                        logger.info('bibtex fetched from '+entry.bibHref);
                        entry.bibtex = bibtex;
                        integrateCitation(entry);
                    });
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
        logger.info('cannot parse bibtex, entry will be discarded');
        entry.bibtex = undefined;
    }
    

}


/*function integrateBibTex(entry) {
    try {
        const bib = parseBibFile(entry.bibtex);
        let bibEntry = bib.entries_raw[0];
        entry.year = parseInt(normalizeFieldValue(bibEntry.getField("year")));
        if (entry.kind === "conference") {
            entry.in = normalizeFieldValue(bibEntry.getField("booktitle"));
            entry.inFull = normalizeFieldValue(bibEntry.getField("booktitle"));
        } else if (entry.kind === "journal") {
            entry.in = normalizeFieldValue(bibEntry.getField("journal"));
            entry.inFull = normalizeFieldValue(bibEntry.getField("journal"));
        }
    } catch (e) {
        logger.info('cannot parse bibtex, entry will be discarded');
        entry.bibtex = undefined;
    }
    
}*/



