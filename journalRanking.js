const winston = require('winston');

const puppeteer = require('puppeteer');
const { Parser } = require('json2csv');
const fs = require('fs');
const levenshtein = require('js-levenshtein');

const HEADLESS = true;

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

const dblp2QueryPatch = new Map();

function loadPatch() {
    let rawdata = fs.readFileSync('./patch.json');
    let patchList = JSON.parse(rawdata);
    patchList.forEach(patch => {
        dblp2QueryPatch.set(cleanTitle(patch.dblp), cleanTitle(patch.query));
    })
}

function readJournalRankings() {
    let rawdata = fs.readFileSync('./journalList.json');
    let entryList = JSON.parse(rawdata);
    return entryList;
}

async function setScimagoRank(entryList) {
    const SCIMAGO_URL = 'https://www.scimagojr.com/';
    let foundRank = new Map();

    let browser = await puppeteer.launch({headless:HEADLESS});
    let page = await browser.newPage();

    logger.info('OPEN SCIMAGO');

    for (let index = 0; index < entryList.length; index++) {
        const entry = entryList[index];

        let cleanedFullTitle = cleanTitle(entry.fullTitle);
        let cleanedTitle = cleanTitle(entry.title);
        let query;
        if (dblp2QueryPatch.has(cleanedTitle)) {
            query = dblp2QueryPatch.get(cleanedTitle);
        } else {
            query = cleanedFullTitle;
        }
        logger.info(`Try to rank: ${query}`);
            

        if (foundRank.has(query)) {
            entry.rank = foundRank.get(query);
            logger.info(`Found rank (in cache): ${entry.rank}`);
        } else {
            try {
                await page.goto(SCIMAGO_URL, {waitUntil:"domcontentloaded"});
                const input = await page.$('#searchbox > input');
                await input.type(query);
    
                const [res] = await Promise.all([
                    page.waitForNavigation({waitUntil:"domcontentloaded"}),
                    page.click('#searchbutton'),
                ]);
                await page.waitFor('div.search_results > a',{timeout:1000});
    
                let journalList = await page.$$('div.search_results > a');
                let foundJournal;
                for (let journalIndex = 0; journalIndex < journalList.length; journalIndex++) {
                    let journalName = await journalList[journalIndex].$eval('span.jrnlname', el => el.innerText);
                    journalName = cleanTitle(journalName);
                    if (journalName == query || levenshtein(query, journalName) <= 4) {
                        foundJournal = journalList[journalIndex];
                        break;
                    }
                }
    
                if (foundJournal) {
                    const [response] = await Promise.all([
                        page.waitForNavigation({waitUntil:"domcontentloaded"}),
                        foundJournal.click(),
                    ]);
        
                    let rank = await page.evaluate(() => {
                        let cellslideList = document.querySelectorAll('div.cellslide');
                        if (cellslideList && cellslideList.length && cellslideList.length > 0) {
                            let cellslide = cellslideList[1];
                            let trList = cellslide.querySelectorAll('tbody > tr');
                            let bestRank;
                            let lastYear;
                            if (trList && trList.length && trList.length > 2) {
                                for (let indexTR = 0; indexTR < trList.length; indexTR++) {
                                    const tdList = trList[indexTR].querySelectorAll('td');
                                    const year = parseInt(tdList[1].innerText);
                                    const rank = tdList[2].innerText;
                                    if (lastYear === undefined || year > lastYear) {
                                        lastYear = year;
                                        bestRank = rank;
                                    }
                                    if (year >= lastYear && rank < bestRank) {
                                        bestRank = rank;
                                    }
                                }
                                return bestRank;
                            }
                            /*if (tdList && tdList.length && tdList.length > 0) {
                                return tdList[tdList.length - 1].innerText;
                            }*/
                            else {
                                return 'unknown';
                            }
                        } else {
                            return 'unknown';
                        }
                    });
                    entry.rank = rank;
                    foundRank.set(query, entry.rank);
                    logger.info(`Found rank: ${rank}`);
                } else {
                    entry.rank = 'unknown';
                    foundRank.set(query, entry.rank);
                    logger.warn(`No rank found`);
                }
                
            } catch(e) {
                entry.rank = 'unknown';
                foundRank.set(query, entry.rank);
                logger.warn('No rank found');
                //logger.error(e);
            }
        }
    }
    await page.close();
    await browser.close();
}

function exportCSV(entryList,filename) {
    const fields = ['number', 'title', 'rank'];
    const opts = { fields };

    try {
        const parser = new Parser(opts);
        const csv = parser.parse(entryList);

        logger.info(csv);

        fs.writeFileSync(filename, csv);
    } catch (err) {
        logger.error(err);
    }
}

function cleanTitle(title) {
    let res = title;
    res.trim();
    res = res.toLowerCase();
    //res = res.replace(/\(\d*\)/g, '');
    res = res.split('(')[0];
    res = res.split(',')[0];
    res = res.replace(':','');
    res = res.replace(/&amp;/g, '');
    res = res.trim();
    return res;
}



(async function run() {

    var myArgs = process.argv.slice(1);

    if (myArgs.length !== 2) {
        logger.warn('one argument is needed');
        logger.warn('fisrt argument must be the output file');
    } else {
        let out = myArgs[0];

        loadPatch();

        let entryList = readJournalRankings();

        let journalList = entryList.filter(entry => entry.kind == 'journal');
        await setScimagoRank(journalList);

        exportCSV(entryList, out);
    }
    
})();




