let Sequelize, sequelize;

if (!global.hasOwnProperty('db')) {
    Sequelize = require('sequelize');
    sequelize = (process.env.DATABASE_URL) ? getHeroku(process.env.DATABASE_URL) : getSQL();
}

// production db
function getHeroku(db_url) {
    var match = db_url.match(/postgres:\/\/([^:]+):([^@]*)@([^:]+):(\d+)\/(.+)/);
    return new Sequelize(match[5], match[1], match[2], {
        dialect: 'postgres',
        protocol: 'postgres',
        port: match[4],
        host: match[3],
        logging: console.log
    });
}

// testing db
function getSQL() {
    return new Sequelize('database', 'username', 'password', {
        dialect: 'sqlite',
        storage: './dev-db.sqlite'
    });
}

// define db globally if not already defined
global.db = (global.db) ? global.db : {
    Sequelize: Sequelize,
    sequelize: sequelize,
    MUDObject: sequelize.import(__dirname + '/MUDObject'),
};

// add assocations by calling associate method defined in the model
/* Object.keys returns an array of an objects property names. global.db will return Sequelize,
 * sequelize, MUDObject as defined above */

Object.keys(global.db).forEach(modelName => {
    if (global.db[modelName].associate) {
        global.db[modelName].associate(global.db);
    }
});

module.exports = global.db;