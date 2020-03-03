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

async function extractEntryList(url) {
    let browser = await puppeteer.launch({headless:HEADLESS});
    let page = await browser.newPage();
    await page.goto(url, {waitUntil:"domcontentloaded"});

    logger.info('OPEN DBLP');

    let entryList =  await page.evaluate(() => {

        const ENTRY_SELECTOR = '#publ-section li.entry';
        const CONF_JOURN_IMG_SELECTOR = 'div.box img';
        const NUMBER_SELECTOR = 'div.nr';
        const ENTRY_LINK_SELECTOR = 'cite > a';
        const ENTRY_IN_NAME_SELECTOR = 'cite > a > span > span';
        const ENTRY_TITLE_SELECTOR = 'span.title';

        const CONF_IMG_TITLE = 'Conference and Workshop Papers';
        const JOURNAL_IMG_TITLE = 'Journal Articles';

        let extractedEntryList = [];
        let entryList = document.querySelectorAll(ENTRY_SELECTOR);
        entryList.forEach(entry => {
            let extractedEntry = {};
            
            let img = entry.querySelector(CONF_JOURN_IMG_SELECTOR);
            switch (img.title) {
                case JOURNAL_IMG_TITLE : extractedEntry.kind = 'journal';
                    break;
                case CONF_IMG_TITLE : extractedEntry.kind = 'conference';
                    break;
                default: extractedEntry.kind = undefined;
            } 

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

            if (extractedEntry.kind) {
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

    logger.info('GET DBLP ENTRIES');

    for (let index = 0; index < entryList.length; index++) {
        if (entryList[index].kind === 'journal') {
            await page.goto(entryList[index].link, {waitUntil:"domcontentloaded"});
            let inFull =  await page.evaluate(() => {
                return document.querySelector('h1').innerHTML;
            });
            entryList[index].inFull = inFull;
            logger.info(`GET FULL JOURNAL NAME: ${inFull}`);
        }
    }

    await page.close();

    await browser.close();

    return entryList;
}

async function setCoreRank(entryList) {
    const CORE_URL = 'http://portal.core.edu.au/conf-ranks/';
    let foundRank = new Map();

    let browser = await puppeteer.launch({headless:HEADLESS});
    let page = await browser.newPage();

    logger.info('OPEN CORE RANK');

    for (let index = 0; index < entryList.length; index++) {
        const entry = entryList[index];
        
        let cleanedConfName = cleanTitle(entry.in);
        let query;
        if (dblp2QueryPatch.has(cleanedConfName)) {
            query = dblp2QueryPatch.get(cleanedConfName);
        } else {
            query = cleanedConfName;
        }

        logger.info(`Try to rank: ${query}`);

        if (foundRank.has(query+entry.year)) {
            entry.rank = foundRank.get(query+entry.year);
            logger.info(`Found rank (in cache): ${entry.rank}`);
        } else {
            await page.goto(CORE_URL, {waitUntil:"domcontentloaded"});
            await page.waitForSelector('#searchform > input');
            const input = await page.$('#searchform > input');
            await input.type(query);

            let coreYear = getCoreYear(entry.year);
            entry.rankYear = coreYear;
            await page.select('#searchform > select:nth-child(3)', coreYear);

            const [res] = await Promise.all([
                page.waitForNavigation({waitUntil:"domcontentloaded"}),
                page.click('#searchform > input[type=submit]:nth-child(7)'),
            ]);
            
            try {
                await page.waitFor('table',{timeout:3000});

                let rank = await page.evaluate( query => {
                    let trList = document.querySelectorAll('tbody tr');
                    if (trList.length > 0) {
                        let unmatch = query +" with ";
                        for (let trIndex = 1; trIndex < trList.length; trIndex++) {
                            let acronym = trList[trIndex].querySelectorAll('td')[1].innerText;
                            let name = trList[trIndex].querySelectorAll('td')[0].innerText;
                            let rank = trList[trIndex].querySelectorAll('td')[3].innerText;
                            
                            if ( query == acronym.trim().toLowerCase() || query == name.trim().toLowerCase()) {
                                return rank;
                            } else {
                                unmatch += acronym.trim().toLowerCase()+";";
                            }
                        }
                        return 'no matching result:'+unmatch;
                    } else {
                        return 'unknown';
                    }
                }, query);
                entry.rank = rank;
                foundRank.set(query+entry.year, entry.rank);

                logger.info(`Found rank: ${rank}`);

            } catch(e) {
                entry.rank = 'unknown';
                foundRank.set(query+entry.year, entry.rank);
                logger.warn(`No rank found`);
                //logger.error(e);
            }
        }
    }
    await page.close();
    await browser.close();
}


async function setScimagoRank(entryList) {
    const SCIMAGO_URL = 'https://www.scimagojr.com/';
    let foundRank = new Map();

    let browser = await puppeteer.launch({headless:HEADLESS});
    let page = await browser.newPage();

    logger.info('OPEN SCIMAGO');

    for (let index = 0; index < entryList.length; index++) {
        const entry = entryList[index];

        let cleanedJournalFullName = cleanTitle(entry.inFull);
        let cleanedJournalName = cleanTitle(entry.in);
        let query;
        if (dblp2QueryPatch.has(cleanedJournalName)) {
            query = dblp2QueryPatch.get(cleanedJournalName);
        } else {
            query = cleanedJournalFullName;
        }
        logger.info(`Try to rank: ${query}`);
            

        if (foundRank.has(query+entry.year)) {
            entry.rank = foundRank.get(query+entry.year);
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
        
                    let rank = await page.evaluate((entryYear) => {
                        let cellslideList = document.querySelectorAll('div.cellslide');
                        if (cellslideList && cellslideList.length && cellslideList.length > 0) {
                            let cellslide = cellslideList[1];
                            let trList = cellslide.querySelectorAll('tbody > tr');
                            let lastYear;
                            let bestRank4LastYear;
                            let bestRank4EntryYear;
                            let firstYear;
                            let bestRank4FirstYear;
                            if (trList && trList.length && trList.length > 2) {
                                for (let indexTR = 0; indexTR < trList.length; indexTR++) {
                                    const tdList = trList[indexTR].querySelectorAll('td');
                                    const currentYear = parseInt(tdList[1].innerText);
                                    const currentRank = tdList[2].innerText;
                                    
                                    if (bestRank4FirstYear === undefined) {
                                        bestRank4FirstYear = currentRank;
                                        firstYear = currentYear;
                                    } else {
                                        if (currentYear < firstYear) {
                                            bestRank4FirstYear = currentRank;
                                            firstYear = currentYear;
                                        }
                                        if (currentYear == firstYear && currentRank < bestRank4FirstYear) {
                                            bestRank4FirstYear = currentRank;
                                        }
                                    }

                                    if (currentYear === entryYear) {
                                        if (bestRank4EntryYear === undefined) {
                                            bestRank4EntryYear = currentRank;
                                        } else if (currentRank < bestRank4EntryYear) {
                                            bestRank4EntryYear = currentRank;
                                        }
                                    }

                                    if (bestRank4LastYear === undefined) {
                                        bestRank4LastYear = currentRank;
                                        lastYear = currentYear;
                                    } else {
                                        if (currentYear > lastYear) {
                                            bestRank4LastYear = currentRank;
                                            lastYear = currentYear;
                                        }
                                        if (currentYear == lastYear && currentRank < bestRank4LastYear) {
                                            bestRank4LastYear = currentRank;
                                        }
                                    }
                                }
                                if (bestRank4EntryYear) {
                                    return {rank:bestRank4EntryYear, rankYear:entryYear};
                                }
                                if (entryYear <= firstYear) {
                                    return {rank:bestRank4FirstYear, rankYear:firstYear};
                                }
                                return {rank:bestRank4LastYear, rankYear:lastYear};
                            }
                            else {
                                return {rank:'unknown', rankYear:'unknown'};
                            }
                        } else {
                            return {rank:'unknown', rankYear:'unknown'};
                        }
                    }, entry.year);
                    entry.rank = rank.rank;
                    entry.rankYear = rank.rankYear;
                    foundRank.set(query+entry.year, entry.rank);
                    logger.info(`Found rank: ${rank.rank} in year ${rank.rankYear}`);
                } else {
                    entry.rank = 'unknown';
                    entry.rankYear = 'unknown';
                    foundRank.set(query+entry.year, entry.rank);
                    logger.warn(`No rank found`);
                }
                
            } catch(e) {
                entry.rank = 'unknown';
                entry.rankYear = 'unknown';
                foundRank.set(query+entry.year, entry.rank);
                logger.warn('No rank found');
                //logger.error(e);
            }
        }
    }
    await page.close();
    await browser.close();
}

function exportCSV(entryList,filename) {
    const fields = ['number', 'title', 'in', 'year', 'rank', 'rankYear'];
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
    res = res.replace(/&amp;/g, '');
    res = res.trim();
    return res;
}

function getCoreYear(year) {
    if (year >= 2018) {
        return "CORE2018";
    } 
    if (year >= 2017) {
        return "CORE2017";
    }
    if (year >= 2014) {
        return "CORE2014";
    }
    if (year >= 2013) {
        return "CORE2013";
    }
    if (year >= 2010) {
        return "ERA2010";
    }
    return "CORE2008";
}



(async function run() {

    var myArgs = process.argv.slice(2);

    if (myArgs.length !== 2) {
        logger.warn('two arguments are needed');
        logger.warn('first argument must be the target DBPL url');
        logger.warn('second argument must be the output file');
    } else {
        let url = myArgs[0];
        let out = myArgs[1];

        loadPatch();

        let entryList = await extractEntryList(url);

        let conferenceList = entryList.filter(entry => entry.kind == 'conference');
        await setCoreRank(conferenceList);

        let journalList = entryList.filter(entry => entry.kind == 'journal');
        await setScimagoRank(journalList);

        exportCSV(entryList, out);
    }
    
})();




