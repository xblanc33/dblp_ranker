const fs = require('fs');
const winston = require('winston');

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


module.exports.loadPersistentCache = function(filename) {
    let map = new Map();
    try {
        const rawdata = fs.readFileSync(filename);
        logger.info('Load cache from disk : ' + filename);
        const cache = JSON.parse(rawdata);
        for (let k of Object.keys(cache)) {
            map.set(k, cache[k]);
        }
    } catch (e) {
        logger.error(e);
    }
    return map;
}

module.exports.savePersistentCache = function(persistentCache, filename) {
    let obj = Object.create(null);
    for (let [k, v] of persistentCache) {
        obj[k] = v;
    }
    fs.writeFileSync(filename, JSON.stringify(obj));
    logger.info('Save persistent cache on disk : ' + filename);
}
