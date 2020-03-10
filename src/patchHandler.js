const winston = require('winston');
const fs = require('fs');
const cleanTitle = require('./utilities').cleanTitle;

module.exports = loadPatch;

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

function loadPatch(filename) {
    let dblp2QueryPatch = new Map();
    try {
        let rawdata = fs.readFileSync(filename);
        let patchList = JSON.parse(rawdata);
        patchList.forEach(patch => {
            dblp2QueryPatch.set(cleanTitle(patch.dblp), cleanTitle(patch.query));
        })
    } catch (e) {
        logger.error(e);
    }
    return dblp2QueryPatch;
}
