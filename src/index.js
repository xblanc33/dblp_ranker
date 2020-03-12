const createEntryListFromDBLP = require('./dblpFetcher').createEntryList;
const createEntryListFromHAL = require('./halFetcher').createEntryList;
const setCoreRank = require('./rankFetcher').setCoreRank;
const setScimagoRank = require('./rankFetcher').setScimagoRank;
const loadPatch = require('./patchHandler');
const loadPersistentCache = require('./persistentCache').loadPersistentCache;
const savePersistentCache = require('./persistentCache').savePersistentCache;
const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');
const exportCSV = require('./file').exportCSV;
const exportJSON = require('./file').exportJSON;
const addHAL2DBLP = require('./utilities').addHAL2DBLP;


(async function run() {

    const optionDefinitions = [
        { name: 'help', alias: 'h', type: Boolean, description: 'Print this usage guide.' },
        { name: 'bib', alias: 'b', type: Boolean, defaultValue: true, description: 'Fetch BibTex.'},
        { name: 'cache', alias: 'c', type: Boolean, defaultValue: false, description: 'Use a local cache for the ranking.' },
        { name: 'out', alias: 'o', type: String, typeLabel: '{underline file}', description: 'The output file to generate.' },
        { name: 'patch', alias: 'p', type: String, typeLabel: '{underline file}', defaultValue: "./src/patch.json", description: 'DBLP and Scimago rewriting rules for ranking queries.\n Default value is {italic patch.json}'},
        { name: 'url', type: String, typeLabel: '{underline url}', defaultOption: true, description: 'URL of the target DBLP page.' },
        { name: 'idhal', type: String, type: String, description: 'idhal' }
    ]
    const sections = [
        {
            header: 'DBLP Ranker',
            content: 'Grabs DBLP or HAL and tries to find rankings ({italic Core Ranks} and {italic Scimago}).'
        },
        {
            header: 'Options',
            optionList: optionDefinitions
        }
    ]
    const usage = commandLineUsage(sections)

    try {
        const options = commandLineArgs(optionDefinitions)
        const valid = options.help || (options.url && options.out) || (options.idhal && options.out)

        console.log(JSON.stringify(options));

        if (valid) {
            if (options.help) {
                console.log(usage);
                return;
            }

            let entryListDBLP = [];
            let entryListHAL = [];
            if (options.url) {
                entryListDBLP = await createEntryListFromDBLP(options.url);
            } 
            if (options.idhal) {
                entryListHAL = await createEntryListFromHAL(options.idhal);
            }

            let entryList = addHAL2DBLP(entryListHAL, entryListDBLP);

            let patchMap =  loadPatch(options.patch);

            let coreCache = new Map();
            if (options.cache) {
                coreCache = loadPersistentCache('core.cache');
            }
            let conferenceList = entryList.filter(entry => entry.kind == 'conference');
            await setCoreRank(conferenceList, coreCache, patchMap);
            if (options.cache) {
                savePersistentCache(coreCache, 'core.cache');
            }

            let scimagoCache = new Map();
            if (options.cache) {
                scimagoCache = loadPersistentCache('scimago.cache');
            } 
            let journalList = entryList.filter(entry => entry.kind == 'journal');
            await setScimagoRank(journalList, scimagoCache, patchMap);
            if (options.cache) {
                savePersistentCache(scimagoCache, 'scimago.cache');
            }

            exportJSON(entryList, options.out+'.json');
            exportCSV(entryList, options.out+'.csv');
        } else {
            console.log(usage);
        }

    } catch (e) {
        console.log(e);
        console.log('Illegal option');
        return
    }

})();

