const winston = require('winston');

const fetch = require('node-fetch');
const puppeteer = require('puppeteer');
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
            let fetchedDocList = fetchedList.response.docs;
            for (let indexEntry = 0; indexEntry < fetchedDocList.length; indexEntry++) {
                const entryURL = fetchedDocList[indexEntry].uri_s;
                let entry = await fetchEntry(entryURL);
                if (entry) {
                    entryList.push(entry);
                }
            }
            
        } else {
            throw new Error("HAL return nothing !!!");
        }
    } catch (e) {
        logger.error(e);
    }
    return entryList;
}

async function fetchHALAPI(idhal) {
    const API_URL = `https://api.archives-ouvertes.fr/search/?q=authIdHal_s:${idhal}&wt=json`;
    return node.fetch(API_URL)
        .then(res => {
            if (res.ok) {
                return res.json();
            } else {
                throw new Error('cannot fetch');
            }
        })
}

async function fetchEntry(url) {
    const DETAIL_SELECTOR = "#document > div.col-md-8 > div.metadatas-complete > span.btn-view.text-center > button";
    const CONTENT_SELECTOR = "#document > div.col-md-8 > div.metadatas-complete > div";
    const TITLE_SELECTOR = "#document > div.col-md-8 > h1";
    const ROW_LIST_SELECTOR = ".content tr";
    const BIB_BUTTON_SELECTOR = "#document > div.col-md-4 > div.widget.widget-export > div > a:nth-child(1)";

    let entry;

    try {
        let browser = await puppeteer.launch({ headless: HEADLESS });
        let page = await browser.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded" });

        await page.click(DETAIL_SELECTOR);
        await page.waitFor(CONTENT_SELECTOR);

        
        entry = await pages.$$eval(ROW_LIST_SELECTOR, trList => {
            let halEntry = {};
            trList.forEach(tr => {
                if (clean(tr.children[0].innerText) == 'type de document') {
                    halEntry.kind = entryKind(clean(tr.children[1].innerText));
                }
                if (clean(tr.children[0].innerText) == 'titre du volume') {
                    halEntry.in = tr.children[1].innerText;
                }
                if (clean(tr.children[0].innerText) == 'titre du congrès') {
                    halEntry.inFull = tr.children[1].innerText;
                }
            });
            return halEntry;

            function clean(str) {
                let res = str;
                res.trim();
                res = res.toLowerCase();
                res = res.replace(/\s+/g, ' ').trim();
                res = res.trim();
                return res;
            }

            function entryKind(text) {
                const CONF = 'conference';
                const JOUR = 'journal';
                switch (text) {
                    case 'communication dans un congrès' : return CONF;
                    case 'article dans une revue' : return JOUR;
                }
                return JOUR;
            }
        })

        entry.title = await pages.$eval(TITLE_SELECTOR, h1 => h1.innerText);

        const [res] = await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded" }),
            page.click(BIB_BUTTON_SELECTOR),
        ]);

        entry.bibtex = await page.$eval('body > pre', pre => pre.innerText);

        await page.close();

        await browser.close();


    } catch(e) {
        logger.error(e);
    }
    
    return entry;
}



