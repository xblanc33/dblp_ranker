const fs = require('fs');
const winston = require('winston');
const { Parser } = require('json2csv');

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


module.exports.exportCSV = function (entryList, filename) {
    const fields = ['kind', 'member', 'coautors', 'title', 'in', 'year', 'rank', 'rankYear'];
    const opts = { fields };

    try {
        const parser = new Parser(opts);
        const csv = parser.parse(entryList);

        fs.writeFileSync(filename, csv);
        logger.info(`${filename} is exported`);
    } catch (err) {
        logger.error(err);
    }
}

module.exports.exportJSON = function(entryList, filename) {
    try {
        let data = JSON.stringify(entryList);
        fs.writeFileSync(filename, data);
        logger.info(`${filename} is exported`);
    } catch (err) {
        logger.error(err);
    }
}


