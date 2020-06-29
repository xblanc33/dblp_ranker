const levenshtein = require('js-levenshtein');
 
module.exports.cleanTitle = cleanTitle;

function cleanTitle(title) {
    let res = title;
    res.trim();
    res = res.toLowerCase();
    res = res.split('(')[0];
    res = res.split(',')[0];
    res = res.replace(':','');
    res = res.replace(/[\n\r]+/g, '');
    res = res.replace(/&amp;/g, '');
    res = res.replace(/[{}]+/g, '');
    res = res.replace(/\s+/g, ' ');
    res = res.trim();
    return res;
}

module.exports.fusionAuthorExtraction = function (halAuthorExtraction, dblpAuthorExtraction ) {
    let authorExtraction = {
        entryList : [],
        logList : []
    };

    if (dblpAuthorExtraction.entryList) {
        dblpAuthorExtraction.entryList.forEach(entry => {
            authorExtraction.entryList.push(entry);
        });
    }

    if (dblpAuthorExtraction.logList) {
        dblpAuthorExtraction.logList.forEach(error => {
            authorExtraction.logList.push(error);
        });
    }
    
    if (halAuthorExtraction.entryList) {
        halAuthorExtraction.entryList.forEach(halEntry => {
            if (!dblpAuthorExtraction.entryList.find(entry => levenshtein(cleanTitle(entry.title),cleanTitle(halEntry.title)) <= 2)) {
                authorExtraction.entryList.push(halEntry);
            }
        });
    }
    
    if (halAuthorExtraction.logList) {
        halAuthorExtraction.logList.forEach(error => {
            authorExtraction.logList.push(error);
        });
    }
    
    return authorExtraction;
}

