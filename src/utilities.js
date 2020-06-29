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
        errorList : []
    };

    if (dblpAuthorExtraction.entryList) {
        dblpAuthorExtraction.entryList.forEach(entry => {
            authorExtraction.entryList.push(entry);
        });
    }

    if (dblpAuthorExtraction.errorList) {
        dblpAuthorExtraction.errorList.forEach(error => {
            authorExtraction.errorList.push(error);
        });
    }
    
    if (halAuthorExtraction.entryList) {
        halAuthorExtraction.entryList.forEach(halEntry => {
            if (!dblpAuthorExtraction.entryList.find(entry => levenshtein(cleanTitle(entry.title),cleanTitle(halEntry.title)) <= 2)) {
                authorExtraction.entryList.push(halEntry);
            }
        });
    }
    
    if (halAuthorExtraction.errorList) {
        halAuthorExtraction.errorList.forEach(error => {
            authorExtraction.errorList.push(error);
        });
    }
    
    return authorExtraction;
}

