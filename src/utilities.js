const levenshtein = require('js-levenshtein');
 
module.exports.cleanTitle = cleanTitle;

function cleanTitle(title) {
    let res = title;
    res.trim();
    res = res.toLowerCase();
    res = res.split('(')[0];
    res = res.split(',')[0];
    res = res.replace(':','');
    res = res.replace(/&amp;/g, '');
    res = res.replace(/[{}]+/g, '');
    res = res.replace(/\s+/g, ' ');
    res = res.trim();
    return res;
}

module.exports.addHAL2DBLP = function (halEntryList, dblpEntryList ) {
    let res = [...dblpEntryList];
    halEntryList.forEach(halEntry => {
        if (!dblpEntryList.find(entry => levenshtein(cleanTitle(entry.title),cleanTitle(halEntry.title)) <= 2)) {
            res.push(halEntry);
        }
    });
    return res;
}

