module.exports = function (sequelize, DataTypes) {

    const MUDObject = sequelize.define('MUDObject', {

        /* Name of the object */
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },

        /* Description text */
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },

        /* what player sees if operation fails */
        failureMessage: {
            type: DataTypes.TEXT,
            allowNull: true
        },

        /* what player sees if operation succeeds */
        successMessage: {
            type: DataTypes.TEXT,
            allowNull: true
        },

        /* what others see if operation fails */
        othersFailureMessage: {
            type: DataTypes.TEXT,
            allowNull: true
        },

        /* what others see if operation succeeds */
        othersSuccessMessage: {
            type: DataTypes.TEXT,
            allowNull: true
        },

        /* type of MUDObject */
        type: {
            type: DataTypes.ENUM,
            values: ['ROOM', 'THING', 'EXIT', 'PLAYER'],
            allowNull: false
        },

        /* bit flags defining the attributes of the object */
        flags: DataTypes.INTEGER,

        /* Password (for players) */
        password: {
            type: DataTypes.STRING,
            allowNull: true
        }

        /* DATABASE HACK: Uncomment and delete foreign keys below when re-initialising the db, foreign key
        constraints are applied as the file is loaded in, this causes errors. */
        /*
        , targetId: DataTypes.INTEGER,
        locationId: DataTypes.INTEGER,
        ownerId: DataTypes.INTEGER,
        keyId: DataTypes.INTEGER
        */

    });

    /* Class Level Methods */
    MUDObject.associate = function (models) {

        /* the target of this object (where exits lead and where things drop to) */
        MUDObject.belongsTo(MUDObject, {
            foreignKey: 'targetId',
            as: 'target'
        });

        /*the location of this object */
        MUDObject.belongsTo(MUDObject, {
            foreignKey: 'locationId',
            as: 'location'
        });

        /* owner who controls this object */
        MUDObject.belongsTo(MUDObject, {
            foreignKey: 'ownerId',
            as: 'owner'
        });

        /* key required to use this object */
        MUDObject.belongsTo(MUDObject, {
            foreignKey: 'keyId',
            as: 'key'
        });
    };

    /* MUDObject Attribute flags, defined as bits */
    MUDObject.FLAGS = {
        link_ok: 1 << 0, /* Any one can link to this room*/
        anti_lock: 1 << 1, /* Reverse the meaning of the lock */
        temple: 1 << 2 /* room flag -> sends dropped objs home */
    };

    /* Instance Methods */

    // return flag (corresponding to property name in FLAGS)
    MUDObject.prototype.getFlag = function (flag) {
        return this.flags & global.db.MUDObject.FLAGS[flag];
    };

    // checks  if the object has the link_ok flag set
    MUDObject.prototype.canLink = function () {
        return this.flags & global.db.MUDObject.FLAGS.link_ok;
    };

    // checks  if the object has the anti_lock flag set
    MUDObject.prototype.hasAntiLock = function () {
        return this.flags & global.db.MUDObject.FLAGS.anti_lock;
    };

    // checks  if the object has the temple flag set
    MUDObject.prototype.isTemple = function () {
        return this.flags & global.db.MUDObject.FLAGS.temple;
    };

    // called by room objects: gets the things contained within it.
    // Returns a promise (from sequelize) that can call .success(callback) on
    MUDObject.prototype.getContents = function () {
        return global.db.MUDObject.findAll({
            where: { locationId: this.id }
        });
    };

    // sets a flag by bit value / Returns .success(callback) promise
    MUDObject.prototype.setFlag = function (flagbit) {
        this.flags |= flagbit; /* Bitwise OR: flags = flags | flagbit */
        return this.save();
    };

    // resets a flag by bit value / Returns .success(callback) promise
    MUDObject.prototype.resetFlag = function (flagbit) {
        this.flags &= ~flagbit; /* Bitwise AND: flags = flags & NOT flagbit */
        return this.save();
    };

    return MUDObject;

}