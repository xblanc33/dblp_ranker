const puppeteer = require('puppeteer');
const { Parser } = require('json2csv');
const fs = require('fs');

const HEADLESS = true;


async function extractEntryList(url) {
    let browser = await puppeteer.launch({headless:HEADLESS});
    let page = await browser.newPage();
    await page.goto(url, {waitUntil:"domcontentloaded"});

    console.log('OPEN DBLP');

    
    let entryList =  await page.evaluate(() => {

        const ENTRY_SELECTOR = '#publ-section li.entry';
        const CONF_JOURN_IMG_SELECTOR = 'div.box img';
        const NUMBER_SELECTOR = 'div.nr';
        const ENTRY_LINK_SELECTOR = 'cite > a';
        const ENTRY_NAME_SELECTOR = 'cite > a > span > span';

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
                default: extractedEntry.kind = 'unknown';
            } 

            extractedEntry.number = entry.querySelector(NUMBER_SELECTOR).id;

            extractedEntry.link = entry.querySelector(ENTRY_LINK_SELECTOR).href;

            extractedEntry.title = entry.querySelector(ENTRY_NAME_SELECTOR).innerText.split('(')[0];

            extractedEntryList.push(extractedEntry);
        });
        return extractedEntryList;
    });

    console.log('GET DBLP ENTRIES');

    for (let index = 0; index < entryList.length; index++) {
        if (entryList[index].kind === 'journal') {
            await page.goto(entryList[index].link, {waitUntil:"domcontentloaded"});
            let fullTitle =  await page.evaluate(() => {
                return document.querySelector('h1').innerHTML;
            });
            entryList[index].fullTitle = fullTitle;
            console.log('GET FULL TITLE (For Journal):', fullTitle);
        }
    }

    await page.close();

    await browser.close();

    return entryList;
}

async function setCoreRank(entryList) {
    const CORE_URL = 'http://portal.core.edu.au/conf-ranks/';

    let browser = await puppeteer.launch({headless:HEADLESS});
    let page = await browser.newPage();

    console.log('OPEN CORE RANK');

    for (let index = 0; index < entryList.length; index++) {
        const entry = entryList[index];
        
        await page.goto(CORE_URL, {waitUntil:"domcontentloaded"});

        console.log('Try to rank: ',entry.title);
        const input = await page.$('#searchform > input');
        await input.type(entry.title);
        await input.press('Enter');
        try {
            await page.waitFor('table',{timeout:2000});

            let rank = await page.evaluate( title => {
                let trList = document.querySelectorAll('tbody tr');
                if (trList.length > 0) {
                    for (let trIndex = 1; trIndex < trList.length; trIndex++) {
                        let acronym = trList[trIndex].querySelectorAll('td')[1].innerText;
                        let name = trList[trIndex].querySelectorAll('td')[0].innerText;
                        let rank = trList[trIndex].querySelectorAll('td')[3].innerText;
                        
                        let lowerTitle = title.toLowerCase();
                        if ( lowerTitle === acronym.toLowerCase() || lowerTitle === name.toLowerCase()) {
                            return rank;
                        }
                    }
                } else {
                    return 'unknown';
                }
            }, entry.title);
            entry.rank = rank;

            console.log('found rank:',rank);

        } catch(e) {
            entry.rank = 'unknown';
            console.log('error no rank found');
            //console.log(e);
        }
        
        
    }
    await page.close();
    await browser.close();
}


async function setScimagoRank(entryList) {
    const SCIMAGO_URL = 'https://www.scimagojr.com/';

    console.log('OPEN SCIMAGO');

    let browser = await puppeteer.launch({headless:HEADLESS});
    let page = await browser.newPage();

    for (let index = 0; index < entryList.length; index++) {
        const entry = entryList[index];
        
        await page.goto(SCIMAGO_URL, {waitUntil:"domcontentloaded"});

        const input = await page.$('#searchbox > input');
        let query = cleanJournalFullTitle(entry.fullTitle);
        console.log('Try to rank: ',query);
        await input.type(query);

        const [res] = await Promise.all([
            page.waitForNavigation({waitUntil:"domcontentloaded"}),
            page.click('#searchbutton'),
        ]);

        try {
            await page.waitFor('div.search_results > a',{timeout:1000});

            const [response] = await Promise.all([
                page.waitForNavigation({waitUntil:"domcontentloaded"}),
                page.click('div.search_results > a'),
            ]);

            let rank = await page.evaluate(() => {
                let cellslideList = document.querySelectorAll('div.cellslide');
                if (cellslideList && cellslideList.length && cellslideList.length > 0) {
                    let cellslide = cellslideList[1];
                    let tdList = cellslide.querySelectorAll('td');
                    if (tdList && tdList.length && tdList.length > 0) {
                        return tdList[tdList.length - 1].innerText;
                    }
                    else {
                        return 'unknown';
                    }
                } else {
                    return 'unknown';
                }
            });
            entry.rank = rank;

            console.log('rank:',rank);

        } catch(e) {
            console.log('error no rank found');
            entry.rank = 'unknown';
            //console.log(e);
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

        console.log(csv);

        fs.writeFile(filename, csv);
    } catch (err) {
        console.error(err);
    }
}

function cleanJournalFullTitle(fullTitle) {
    let res;
    res = fullTitle.toLowerCase();
    res = res.split('\n')[0];
    res = res.split(',')[0];
    res = res.split('(')[0];
    res = res.replace(':','');
    res = res.replace(/&amp;/g, ' ');
    return res;
}


//https://dblp.uni-trier.de/pers/z/Zeitoun:Marc.html
//'https://dblp.org/pers/d/Domenger:Jean=Philippe.html'
//'https://dblp.uni-trier.de/pers/b/Blanc_0001:Xavier.html'
(async function run() {

    var myArgs = process.argv.slice(2);

    if (myArgs.length !== 2) {
        console.log('two arguments are needed');
        console.log('first argument must be the target DBPL url');
        console.log('second argument must be the output file');
    } else {
        let url = myArgs[0];
        let out = myArgs[1];

        let entryList = await extractEntryList(url);

        let conferenceList = entryList.filter(entry => entry.kind == 'conference');
        await setCoreRank(conferenceList);

        let journalList = entryList.filter(entry => entry.kind == 'journal');
        await setScimagoRank(journalList);

        exportCSV(entryList, out);
    }
    
})();




