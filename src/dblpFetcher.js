const winston = require('winston');

const puppeteer = require('puppeteer');
const HEADLESS = true;

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

async function createAuthorExtraction(authorURL, options) {
    let authorExtraction = await createAuthorEntryList(authorURL, options);
    if (authorExtraction.entryList.length > 0) {
        await setBibTex(authorExtraction, options);
    }
    return authorExtraction;
}

async function createAuthorEntryList(authorURL, options) {
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
    logger.info('OPEN DBLP ');
    if (options) {
        logger.info('options: ', options);
    } else {
        logger.info('default options');
    }

    let browser;
    let page;
    try {
        browser = await puppeteer.launch({ headless, timeout });
        page = await browser.newPage();
        //await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.goto(authorURL, {waitUntil:'domcontentloaded'});
    } catch (e) {
        authorExtraction.logList.push({
            level: 'fatal',
            msg:'cannot open url' + authorURL
        })
        logger.error(`cannot open url`, authorURL);
        return authorExtraction;
    }

    try {
        authorExtraction.entryList = await fetchAllEntries(page);
    } catch (e) {
        authorExtraction.logList.push({
            level: 'fatal',
            msg:'cannot fetch entry list' + authorURL
        })
        logger.error(`cannot open url`, authorURL);
        await page.close();
        await browser.close();
        return authorExtraction;
    }
    
    for (let index = 0; index < authorExtraction.entryList.length; index++) {
        if (authorExtraction.entryList[index].kind === 'journal') {
            try {
                let inFull = await fetchFullJournalName(page, authorExtraction.entryList[index].link);
                authorExtraction.entryList[index].inFull = inFull;
                logger.info(`GET FULL JOURNAL NAME: ${inFull}`);
            } catch( ex) {
                authorExtraction.entryList[index].inFull = authorExtraction.entryList[index].in;
                logger.info(`cannot fetch JOURNAL FULL NAME ${authorExtraction.entryList[index].link}, take simple name`)
            }
        }
    }

    await page.close();

    await browser.close();

    return authorExtraction;
}

async function fetchAllEntries(page) {
    return page.evaluate(() => {
        const ENTRY_SELECTOR = '#publ-section li.entry';
        const CONF_JOURN_IMG_SELECTOR = 'div.box img';
        const NUMBER_SELECTOR = 'div.nr';
        const ENTRY_LINK_SELECTOR = 'cite > a';
        const ENTRY_IN_NAME_SELECTOR = 'cite > a > span > span';
        const ENTRY_TITLE_SELECTOR = 'span.title';
        const BIB_ENTRY = 'nav.publ div.head';

        const CONF_IMG_TITLE = 'Conference and Workshop Papers';
        const JOURNAL_IMG_TITLE = 'Journal Articles';
        const EDITOR_IMG_TITLE = 'Editorship';
        const BOOK_IMG_TITLE = 'Books and Theses';
        const IN_BOOK_TITLE = 'Parts in Books or Collections';

        let extractedEntryList = [];
        let entryList = document.querySelectorAll(ENTRY_SELECTOR);
        entryList.forEach(entry => {
            let extractedEntry = {};

            let img = entry.querySelector(CONF_JOURN_IMG_SELECTOR);
            if (img === null ) {
                img = {
                    title: undefined
                }
            }
            switch (img.title) {
                case JOURNAL_IMG_TITLE: extractedEntry.kind = 'journal';
                    break;
                case CONF_IMG_TITLE: extractedEntry.kind = 'conference';
                    break;
                case EDITOR_IMG_TITLE: extractedEntry.kind = 'editor';
                    break;
                case BOOK_IMG_TITLE: extractedEntry.kind = 'book';
                    break;
                case IN_BOOK_TITLE: extractedEntry.kind = 'inbook';
                default: extractedEntry.kind = undefined;
            }

            if (extractedEntry.kind) {
                if (entry.querySelector(NUMBER_SELECTOR)) {
                    extractedEntry.number = entry.querySelector(NUMBER_SELECTOR).id;
                }
    
                if (entry.querySelector(ENTRY_LINK_SELECTOR)) {
                    extractedEntry.link = entry.querySelector(ENTRY_LINK_SELECTOR).href;
                }
    
                if (entry.querySelector(ENTRY_IN_NAME_SELECTOR)) {
                    extractedEntry.in = entry.querySelector(ENTRY_IN_NAME_SELECTOR).innerText;
                }
    
                if (entry.querySelector(ENTRY_TITLE_SELECTOR)) {
                    extractedEntry.title = entry.querySelector(ENTRY_TITLE_SELECTOR).innerText;
                }
    
                extractedEntry.year = getYear(entry);
    
                extractedEntry.bibHref = entry.querySelectorAll(BIB_ENTRY)[1].children[0].href;
                extractedEntryList.push(extractedEntry);
            }

        });
        return extractedEntryList;

        function getYear(node) {
            let previous = node.previousElementSibling;
            if (previous.className === 'year') {
                return parseInt(previous.innerText);
            } else {
                return getYear(previous);
            }
        }
    });

}

async function fetchFullJournalName(page, link) {
    //await page.goto(entryList[index].link, { waitUntil: "domcontentloaded" });
    await page.goto(link,{waitUntil:'load'});
    //await page.waitFor('h1');
    return page.evaluate(() => {
        return document.querySelector('h1').innerHTML;
    });
}


async function setBibTex(authorExtraction, options) {
    const CROSS_REF_OPTIONS_SELECTOR = '#sorting-selector > div > div.body > ul';

    let headless = true;
    let timeout = 30000;
    if (options) {
        if (options.headless) {
            headless = options.headless;
        }
        if (options.timeout) {
            timeout = options.timeout;
        }
    }
    let browser;
    let page;
    try {
        browser = await puppeteer.launch({ headless: headless, timeout: timeout });
        page = await browser.newPage();
    } catch(e) {
        authorExtraction.logList.push({
            level: 'fatal',
            msg:'cannot open browser for setting the Bibtex'
        })
        logger.error('cannot open browser for setting the Bibtex')
        return authorExtraction;
    }
     

    logger.info('FETCH BIBTex');
    

    for (let indexEntry = 0; indexEntry < authorExtraction.entryList.length; indexEntry++) {
        let entry = authorExtraction.entryList[indexEntry];
        logger.info('get bibHref:'+entry.bibHref);
        try {
            //await page.goto(entry.bibHref, {waitUntil: "domcontentloaded"});
            await page.goto(entry.bibHref,{waitUntil:'domcontentloaded'});
            await page.waitFor(CROSS_REF_OPTIONS_SELECTOR);
            let bibURL = await page.$eval(CROSS_REF_OPTIONS_SELECTOR, option => {
                for (let i = 0; i < option.childElementCount; i++) {
                    const value = option.children[i].children[0].innerText;
                    if (value === "standard") {
                        return option.children[i].children[0].href;
                    }
                }
                return undefined;
            });
            if (bibURL) {
                entry.standardBibURL = bibURL;
            } else {
                entry.standardBibURL = entry.bibHref;
            }
        } catch (e) {
            logger.info(`cannot get bibtex ${entry.bibHref} will use the default one (${e})`);
            entry.standardBibURL = entry.bibHref;
        }
    }

    const BIB_SECTION_SELECTOR = '#bibtex-section > pre';
    for (let indexEntry = 0; indexEntry < authorExtraction.entryList.length; indexEntry++) {
        let entry = authorExtraction.entryList[indexEntry];
        logger.info('get standard bibHref:'+entry.standardBibURL);
        if (entry.standardBibURL) {
            try {
                //await page.goto(entry.standardBibURL,{waitUntil: "domcontentloaded"});
                await page.goto(entry.standardBibURL,{waitUntil:'domcontentloaded'});
                await page.waitFor(BIB_SECTION_SELECTOR);
                let bibtex = await page.$eval(BIB_SECTION_SELECTOR, bib => bib.innerText);
                entry.bibtex = bibtex;
            } catch (e) {
                logger.warn(`cannot get standard bibHref ${entry.standardBibURL}, error: ${e}`);
                authorExtraction.logList.push({
                    level: 'error',
                    msg:`cannot get standard bibHref ${entry.standardBibURL}, error: ${e}`
                });
            }
        }
    }
    await page.close();
    await browser.close();
}

