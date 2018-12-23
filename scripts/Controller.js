// @ts-check

/* Main game controller / handles messages between players and server */

const Str = require('string');
const strings = require('./Strings');
const db = require('../models');
const sequelize_fixtures = require('sequelize-fixtures');

let commands; / *initialised upon initialising controller */
let activePlayers = []; /* private list of players */

const controller = {

    defaultRoom: undefined,

    /* initialise the controller, if data/default.json has been loaded before,
    load the object with the id of 1 (Zepler room), else load the objects in the file */
    init: function () {
        controller.loadMUDObject(undefined, { id: 1 }, function (room) {
            if (room) {
                // set the default room if found in db
                controller.defaultRoom = room;
            } else {
                // load in the default objs from the .json file
                sequelize_fixtures.loadFile('data/default.json', { MUDObject: db.MUDObject }).then(() =>{
                    if (db.sequelize.options.dialect === 'postgres') {
                        // postgres quick fix
                        postgresFix();
                    } else {
                        controller.init();
                    }
                }, err => {
                    fatalError(err);
                });
                
            }
        });

        // init commands handler
        commands = require('./Commands');
    },

    /**
	 * Handle a message from a user at a given connection. Looks for a valid
	 * matching command in the commands object (which contains keyed CommandHandler instances) 
	 * and calls the CommandHandler#validate method on that (which should then call the 
	 * perform method if validation is successful). 
	 *
	 * Additionally this deals with validation of pre and post login commands (see 
	 * CommandHandler#preLogin and CommandHandler#postLogin), and also the fallback 
	 * of unknown commands to the `go` command.
	 *
	 * @param conn [ws.WebSocket] the connection
	 * @param message [string] the message typed by the user
	 */
    handleMessage: function (conn, message) {

        // module to prevent complete crashing of the server when an error occurs
        const dom = require('domain').create();

        dom.on('error', function (err) {
            console.log(err.name + ": " + err.message);
        });

        dom.run(function () {

            let firstSpace = message.indexOf(' ');
            let commandStr = (firstSpace === -1) ? message.trim() : message.substring(0, firstSpace).trim();
            let argsStr = (firstSpace === -1) ? "" : message.substring(firstSpace + 1).trim();

            // lookup command in Commands.js
            let command = commands[commandStr];

            // get the player's logged in status
            let isLoggedIn = controller.findActivePlayerByConnection(conn) !== undefined;

            // no command given
            if (commandStr.length === 0) return;

            // if the command lookup was successful
            if (command) {
                const argsArr = getArgs(argsStr, command.nargs);

                // only enforce nargs if it has been set
                if (command.nargs) {
                    if (argsArr.length !== command.nargs) {
                        controller.sendMessage(conn, strings.incorrectArgs, { command: commandStr });
                        return;
                    }
                }

                // not logged in, is a post-login command and not a pre-login command
                if (!isLoggedIn && command.postLogin && !command.preLogin) {
                    controller.displaySplashScreen(conn);
                    // logged in, is a pre-login command and not a post-login command
                } else if (isLoggedIn && command.preLogin && !command.postLogin) {
                    controller.sendMessage(conn, strings.alreadyLoggedIn);
                } else {
                    // check if command has a validate method
                    if (command.validate) {
                        // validate it the command, call the perform method
                         command.validate(conn, argsArr, command.perform);
                    } else {
                         // perform the command without validating
                        command.perform(conn, argsArr);
                    }
                }
            } else {
                // command lookup unsucessful...
                if (isLoggedIn) {
                    controller.sendMessage(conn, strings.unknownCommand)
                } else {
                    controller.displaySplashScreen(conn);
                }
            }
        });
    },

    // add active player and their connection to the array
    activatePlayer: function (conn, player) {
        activePlayers.push({player: player, conn: conn});
    },

    // deactivate a player
    deactivatePlayer: function (conn) {
        const player = controller.findActivePlayerByConnection(conn);
        controller.broadcastExcept(conn, strings.hasDisconnected, player);

        // remove the player from the list of active players
        for (let i=0; i<activePlayers.length; i++) {
            if (activePlayers[i].conn === conn) {
                activePlayers.splice(i, 1);
                break;
            }
        }

        // terminate the connection
        conn.terminate();
    },

    // Apply the passed function (@param operation) to all active players
    // operation must only take two params, first will always be a connection
    applyToActivePlayers: function (operation) {
        for (let i = 0; i < activePlayers.length; i++) {
            if (operation(activePlayers[i].conn, activePlayers[i].player) === false) {
                break;
            }
        }
    },

    // send message to everyone, everywhere, including the current player
    broadcast: function (message, values) {
        controller.applyToActivePlayers((conn) =>{
            controller.sendMessage(conn, message, values);
        });
    },

    // Send message to all connection but the current user
    broadcastExcept: function (conn, message, values) {
        controller.applyToActivePlayers(appconn => {
            if (appconn !== conn) controller.sendMessage(appconn, message, values);
        });
    },

    // send message to everyone in the room exception the current player
    sendMessageRoomExcept: function (conn, message, values) {
        controller.applyToActivePlayers((otherConn, otherPlayer) => {
            let currPlayer = controller.findActivePlayerByConnection(conn);
            if (otherPlayer.locationId === currPlayer.locationId && currPlayer !== otherPlayer) {
                controller.sendMessage(otherConn, message, values);
            }
        });
    },

    // server -> client - message
    sendMessage: function (conn, message, values) {
        message = (message === undefined) ? '' : message
        complete_message = (values === undefined) ? message : Str(message).template(values).s;
        conn.send(complete_message);
    },

    // clear screen
    clearScreen: function (conn) {
        for (let x = 0; x < 24; x++) controller.sendMessage(conn);
    },

    // login prompt screen
    displaySplashScreen: function (conn) {
        controller.sendMessage(conn, strings.loginPrompt);
    },

    // find an active player by their username
    findActivePlayerByName: function (name) {
        for (let i = 0; i < activePlayers.length; i++) {
            if (activePlayers[i].player.name === name) return activePlayers[i].player;
        }        
        // player not found
        return undefined;
    },

    // find an active player by a connection
    findActivePlayerByConnection: function (conn) {
        for (let i = 0; i < activePlayers.length; i++) {
            if (activePlayers[i].conn === conn) return activePlayers[i].player;
        }
        // player not found
        return undefined;
    },

    // find an active connection by the player's model
    findActiveConnectionByPlayer: function (player) {
        for (let i = 0; i < activePlayers.length; i++) {
            if (activePlayers[i].player.id === player.id) return activePlayers[i].conn;
        }
        // connection not found
        return undefined;
    },

    // creates a MUDObject and saves it to the database
    createMUDObject: function (conn, obj, cb) {
        db.MUDObject.build(obj).save().then(newObj => {
            cb(newObj);
        }, err => {
            fatalError(err, conn);
        });
    },

    // search db for obj
    loadMUDObject: function (conn, whereObj, cb) {
        db.MUDObject.findOne({ where: whereObj }).then(dbo => {
            cb(dbo);
        }, err => {
            fatalError(err);
        });
    },

    // search db for multiple objs
    loadMUDObjects: function (conn, whereObj, cb) {

        db.MUDObject.findAll({where: whereObj}).then(dbos => {
            cb(dbos);
        }, err => {
            fatalError(err);
        });
    },

    // find multiple potential MUD Objects
    findPotentialMUDObjects: function (conn, name, cb, allowMe, allowHere, type) {

        const player = controller.findActivePlayerByConnection(conn);
        
        /* if the name being searched for is 'me' and the results
        can include me as a player, return me. */
        if (allowMe && name === 'me') return cb([player]);

        /* if the name being searched for is 'here' and the results
       can include here as in my location, return my location. */
        if (allowHere && name === 'here') {
            player.getLocation().then(locObj => {
                cb([locObj]);
            });
            return;
        }

        // if a type was provided...
        if (type) {
            let where = {
                [db.Sequelize.Op.and]: [
                    { type: type },
                    { name: { [db.Sequelize.Op.like]: '%'+name+'%'}},
                    { [db.Sequelize.Op.or]: [
                        { locationId: player.locationId },
                        { locationId: player.id },
                        { id: player.locationId }
                    ]}
                ]
            }

            // load the objects
            controller.loadMUDObjects(conn, where, objs => {
                cb(filterPossible(objs, name));
            });

        } else {
            
            let where = {
                [db.Sequelize.Op.and] : [
                    { [db.Sequelize.Op.or]: [{locationId: player.locationId}, {locationId: player.id}, {id: player.locationId}] }
                ]
            }

            // load the objects
            controller.loadMUDObjects(conn, where,
                objs => {
                    cb(filterPossible(objs, name));
            });
        }

    },

    /**
	 * Find a database object from the given name that is likely to be relevant 
	 * to the player (specified by the connection). Handles errors automatically.
	 *
	 * Specifically looks for partial matches of the given name in objects that the player
	 * is carrying or that are in the room the player is in. The name can optionally be "me" 
	 * or "here" to refer to the player or their location. Additionally, the type of object
	 * being searched can be restricted.
	 *
	 * If more than one object matches the name after filtering for exact matches, then the 
	 * player can be alerted that the query was ambiguous and the callback will not be called.
	 *
	 * If more than zero objects match the name, then the player can be alerted that the query 
	 * failed and the callback will not be called.
	 * 
	 * @param conn (ws.WebSocket) the player's connection.
	 * @param name (string) the (partial) name of the object(s) in question
	 * @param cb (function) Callback function to call on completion of the database read. 
	 *				Takes a single parameter of the array of [db.MUDObject]s that was found.
	 * @param allowMe (boolean) whether to handle "me" as a name
	 * @param allowHere (boolean) whether to handle "here" as a name
	 * @param type (db.MUDObject.type) type of objects to find (can be `undefined`)
	 * @param ambigMsg message to show to the player if the query was ambiguous
	 * @param failMsg message to show to the player if the query fails to find anything
	 * @param requireDescription if more than one object is found, but only one has 
 	 *	 		a non-null description then call the callback with that object
	 */
    findPotentialMUDObject: function (conn, name, cb, allowMe, allowHere, type, ambigMsg, failMsg, requireDescription) {

        // if undefined, default msgs
        if (!ambigMsg) ambigMsg = strings.ambigSet;
        if (!failMsg) failMsg = strings.dontSeeThat;

        controller.findPotentialMUDObjects(conn, name, function (objArr) {
            // if objects were actually found
            if (objArr && objArr.length > 0) {
                // if a description is required, and there are more than one objects
                if (requireDescription === true && objArr.length > 1) {
                    // filter the objects to find only ones with descriptions
                    let nObj = objArr.filter(function (obj) {
                        return obj.description != null;
                    });
                    // if only one has a description, which is required, set it to the return array
                    if (nObj.length === 1) {
                        objArr = nObj;
                    }
                }

                /* only one object was returned by findPotentialMUDObjects...*/
                if (objArr.length === 1) {
                    // return it
                    cb(objArr[0]);
                } else {
                    /* more than one object was found, and a description was not required
                    - search for a name that matches exactly to the @param name */

                    let count = 0;
                    let index = -1;

                    for (let i = 0; i < objArr.length; i++) {
                        if (objArr[i].name.toLowerCase().trim() === name.toLowerCase().trim()) {
                            count++;
                            index = i;
                        }
                    }

                    // only one match, return it
                    if (count === 1) {
                        cb(objArr[index]);
                    } else {

                        // ambiguous search, exact name matches were found
                        controller.sendMessage(conn, ambigMsg);
                    }
                }

            } else {
                // findPotentialMUDObjects returned 0 objects
                controller.sendMessage(conn, failMsg);
            }

        }, allowMe, allowHere, type);
    }
};

/* Private helper functions */
// used to retrieve an array of arguments from a string
function getArgs(argsStr, nargs) {

    // return array for arguments
    let argsArr = [];

    argsStr = argsStr.trim();

    // no args
    if (argsStr.length == 0) return argsArr;

    // number of args is 1 or less
    if (nargs <= 1) {
        argsArr.push(argsStr);
        return argsArr;
    }

    let argsToCheck = argsStr;
    let arg, index;

    for (let i = 0; i < nargs; i++) {
        // find end of first argument
        index = argsToCheck.indexOf(' ');
        // only one or no arguments, so break
        if (index === -1) break;

        arg = argsToCheck.substring(0, index);
        argsToCheck = argsToCheck.substring(index + 1).trim();
        argsArr.push(arg);
    }

    // push only arg into arr and return
    argsArr.push(argsToCheck)
    return argsArr
}

// called when db obj is not found
function fatalError(err, conn) {
    // if the user is still connected
    if (conn) {
        conn.send("Uh Oh! A Fatal error has occurred... " + err + "\n");
        conn.send("You will now be disconnected, bye! :(");
        conn.terminate();
    }

    console.log("\n\nFATAL ERROR()\n\n")
    throw err;
}

/**
 * Helper function for filtering objects matching a name beyond what is
 * (easily) accomplishable with Sequelize queries. Specifically requires
 * whole word matches, rather than just sub-sequences of characters.
 */
function filterPossible(objs, name) {

    // if there are objects to filter
    if (objs && objs.length > 0) {
        let filteredObjs = objs.filter(obj => {
            // if exact matches
            if (obj.name.toLowerCase() === name.toLowerCase()) return true;
            
            /* Split by the ReGeX: match one or more of either the space or ';' character - global 
             * do not stop after the first find 
             * 
             * specifically used by EXIT objects, which are semi-colon separated
             */
            
            let strs = obj.name.toLowerCase().split(/[ ;]+/g);
            let nstrs = name.toLowerCase().split(/[ ;]+/g);
            let index = 0;

            for (let i = 0; i < nstrs.length; i++) {

                /* if the partial string inside nstr is inside the obj.name str
                 * index param stops a term being counted twice,
                 * i.e. out;Mountbatten;out, on the second 'out' would still keep matching
                 * out;Mountbatten;seminarroom if the index was not checked...
                 */

                let newIndex = strs.indexOf(nstrs[i], index);
                // if index is -1, return false as not found
                if (newIndex < index) return false;
                index = newIndex;
            }
            return true;
        });

        // return the filtered objs
        return filteredObjs;
    }

    // no objs were provided
    return objs;
}

function postgresFix() {
    //postgres seems to get itself in a mess with sequelize_fixtures and lose track of the auto-incrementing object ids, so we reset it manually here:
    db.sequelize.query('SELECT setval(pg_get_serial_sequence(\'"MUDObjects"\', \'id\'), (SELECT MAX(id) FROM "MUDObjects")+1);').then(
        () => { controller.init();}
    );
}

// Export the controller obj
module.exports = controller;



