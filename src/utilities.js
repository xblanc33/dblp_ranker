module.exports.cleanTitle =  function (title) {
    let res = title;
    res.trim();
    res = res.toLowerCase();
    //res = res.replace(/\(\d*\)/g, '');
    res = res.split('(')[0];
    res = res.split(',')[0];
    res = res.replace(':','');
    //res = res.replace(/[\n\r]/g, '');
    res = res.replace(/\s+/g, ' ').trim();
    res = res.replace(/&amp;/g, '');
    res = res.trim();
    return res;
}