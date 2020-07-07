const winston = require('winston');
const puppeteer = require('puppeteer');
const levenshtein = require('js-levenshtein');
const cleanTitle = require('./utilities').cleanTitle;

module.exports.setCoreRank = setCoreRank;
module.exports.setScimagoRank = setScimagoRank;

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

async function setCoreRank(entryList, cache, patchMap) {
    const CORE_URL = 'http://portal.core.edu.au/conf-ranks/';
    if (cache === undefined ) {
        cache = new Map();
    }
    if (patchMap === undefined) {
        patchMap = new Map();
    } 

    let browser = await puppeteer.launch({ headless: HEADLESS });
    let page = await browser.newPage();

    logger.info('OPEN CORE RANK');

    for (let index = 0; index < entryList.length; index++) {
        const entry = entryList[index];

        let cleanedConfName = cleanTitle(entry.in);
        let query;
        if (patchMap.has(cleanedConfName)) {
            query = patchMap.get(cleanedConfName);
        } else {
            query = cleanedConfName;
        }

        logger.info(`Try to rank: ${query} in ${entry.year}`);

        if (cache.has(query + entry.year)) {
            let c = cache.get(query + entry.year);
            entry.rank = c.rank;
            entry.rankYear = c.year;
            logger.info(`Found rank (in cache): ${entry.rank} in ${entry.rankYear}`);
        } else {
            await page.goto(CORE_URL, { waitUntil: "domcontentloaded" });
            await page.waitForSelector('#searchform > input');
            const input = await page.$('#searchform > input');
            await input.type(query);

            let coreYear = getCoreYear(entry.year);
            entry.rankYear = coreYear;
            await page.select('#searchform > select:nth-child(3)', coreYear);

            const [res] = await Promise.all([
                page.waitForNavigation({ waitUntil: "domcontentloaded" }),
                page.click('#searchform > input[type=submit]:nth-child(7)'),
            ]);

            try {
                await page.waitFor('table', { timeout: 3000 });

                let rank = await page.evaluate(query => {
                    let trList = document.querySelectorAll('tbody tr');
                    if (trList.length > 0) {
                        let unmatch = query + " with ";
                        for (let trIndex = 1; trIndex < trList.length; trIndex++) {
                            let acronym = trList[trIndex].querySelectorAll('td')[1].innerText;
                            let name = trList[trIndex].querySelectorAll('td')[0].innerText;
                            let rank = trList[trIndex].querySelectorAll('td')[3].innerText;

                            if (query == acronym.trim().toLowerCase() || query == name.trim().toLowerCase()) {
                                return rank;
                            } else {
                                unmatch += acronym.trim().toLowerCase() + ";";
                            }
                        }
                        return 'no matching result:' + unmatch;
                    } else {
                        return 'no matching result:';
                    }
                }, query);
                if (rank.startsWith('no matching')) {
                    entry.rank = 'unknown';
                } else {
                    entry.rank = rank;
                }
                cache.set(query + entry.year, { rank: entry.rank, year: entry.rankYear });

                logger.info(`Found rank: ${rank}`);

            } catch (e) {
                entry.rank = 'unknown';
                cache.set(query + entry.year, { rank: entry.rank, year: entry.rankYear });
                logger.warn(`No rank found`);
                //logger.error(e);
            }
        }
    }
    await page.close();
    await browser.close();
}


async function setScimagoRank(entryList, cache, patchMap) {
    const SCIMAGO_URL = 'https://www.scimagojr.com/';
    const cacheFilename = 'scimagojr.cache';
    if (cache === undefined ) {
        cache = new Map();
    }
    if (patchMap === undefined) {
        patchMap = new Map();
    }

    let browser = await puppeteer.launch({ headless: HEADLESS });
    let page = await browser.newPage();

    logger.info('OPEN SCIMAGO');

    for (let index = 0; index < entryList.length; index++) {
        const entry = entryList[index];

        let cleanedJournalFullName = cleanTitle(entry.inFull);
        let cleanedJournalName = cleanTitle(entry.in);
        let query;
        if (patchMap.has(cleanedJournalName)) {
            query = patchMap.get(cleanedJournalName);
        } else {
            query = cleanedJournalFullName;
        }
        logger.info(`Try to rank: ${query} in ${entry.year}`);


        if (cache.has(query + entry.year)) {
            let c = cache.get(query + entry.year);
            entry.rank = c.rank;
            entry.rankYear = c.year;
            logger.info(`Found rank (in cache): ${entry.rank} in ${entry.rankYear}`);
        } else {
            try {
                await page.goto(SCIMAGO_URL, { waitUntil: "domcontentloaded" });
                const input = await page.$('#searchbox > input');
                await input.type(query);

                const [res] = await Promise.all([
                    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
                    page.click('#searchbutton'),
                ]);
                await page.waitFor('div.search_results > a', { timeout: 1000 });

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
                        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
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
                                    return { rank: bestRank4EntryYear, rankYear: entryYear };
                                }
                                if (entryYear <= firstYear) {
                                    return { rank: bestRank4FirstYear, rankYear: firstYear };
                                }
                                return { rank: bestRank4LastYear, rankYear: lastYear };
                            }
                            else {
                                return { rank: 'unknown', rankYear: 'unknown' };
                            }
                        } else {
                            return { rank: 'unknown', rankYear: 'unknown' };
                        }
                    }, entry.year);
                    entry.rank = rank.rank;
                    entry.rankYear = rank.rankYear;
                    cache.set(query + entry.year, { rank: entry.rank, year: entry.rankYear });
                    logger.info(`Found rank: ${rank.rank} in year ${rank.rankYear}`);
                } else {
                    entry.rank = 'unknown';
                    entry.rankYear = 'unknown';
                    cache.set(query + entry.year, { rank: entry.rank, year: entry.rankYear });
                    logger.warn(`No rank found`);
                }

            } catch (e) {
                entry.rank = 'unknown';
                entry.rankYear = 'unknown';
                cache.set(query + entry.year, { rank: entry.rank, year: entry.rankYear });
                logger.warn('No rank found');
                //logger.error(e);
            }
        }
    }
    await page.close();
    await browser.close();
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



