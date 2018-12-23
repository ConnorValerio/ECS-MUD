const db = require('../models');
const controller = require('./Controller');
const predicates = require('./Predicates');
const strings = require('./Strings');
const CommandHandler = require('./CommandHandler');
const ch = require('./CommandHelper');
const PropertyHandler = require('./PropertyHandler');
const bfs = require('async-bfs');

/**
 * The commands object is like a map of control strings to command handlers (objects extending from the 
 * CommandHandler object) which perform the actions of the required command.
 * 
 * The controller (see Controller.js) parses the statements entered by the user,
 * and passes the information to the matching property in the commands object.
 */
const commands = {

    //handle user creation
    create: CommandHandler.extend({
        nargs: 2,
        preLogin: true,
        postLogin: false,
        validate: function (conn, argsArr, cb) {
            
            // check for valid username
            if (!predicates.isUsernameValid(argsArr[0])) {
                controller.sendMessage(conn, strings.badUsername);
                return;
            }

            // check for valid password
            if (!predicates.isPasswordValid(argsArr[1])) {
                controller.sendMessage(conn, strings.badPassword);
                return;
            }

            let where = {
                [db.Sequelize.Op.and]: [{ name: argsArr[0] }, { type: 'PLAYER' }]
            };

            // check a player with the given username does not already exist
            controller.loadMUDObject(conn, where, function (player) {
                if (!player) {
                    cb(conn, argsArr);
                } else {
                    controller.sendMessage(conn, strings.usernameInUse);
                }
            });
        },

        perform: function (conn, argsArr) {
            //create a new player
            controller.createMUDObject(conn,
                {
                    name: argsArr[0],
                    password: argsArr[1],
                    type: 'PLAYER',
                    locationId: controller.defaultRoom.id,
                    targetId: controller.defaultRoom.id
                }, player => {

                    // initialise a player
                    if (player) {
                        player.setOwner(player).then(() => {
                            controller.activatePlayer(conn, player);
                            controller.broadcastExcept(conn, strings.hasConnected, player);
                            controller.clearScreen(conn);
                            commands.look.perform(conn, []);
                        });
                    }
                });
        }
    }),

    //handle connection of an existing user
    connect: CommandHandler.extend({
        nargs: 2,
        preLogin: true,
        postLogin: false,
        validate: function (conn, argsArr, cb) {

            const where = {
               [db.Sequelize.Op.and]: [{ name: argsArr[0] }, { type: 'PLAYER' }]
            };

            // attempt to find and load in the player
            controller.loadMUDObject(conn, where, function (player) {
                if (!player) {
                    controller.sendMessage(conn, strings.playerNotFound);
                    return;
                }

                // check correct password has been given
                if (player.password !== argsArr[1]) {
                    controller.sendMessage(conn, strings.incorrectPassword);
                    return;
                }

                cb(conn, argsArr);
            });
        },

        perform: function (conn, argsArr) {

            const where = {
               [db.Sequelize.Op.and]: [{ name: argsArr[0] }, { password: argsArr[1] }, { type: 'PLAYER' }]
            };

            //load player if possible:
            controller.loadMUDObject(conn, where, function (player) {
                if (player) {
                    controller.applyToActivePlayers(function (apconn, ap) {
                        if (ap.name === argsArr[0]) {
                            //player is already connected... kick them off then rejoin them
                            controller.deactivatePlayer(apconn);
                            return false;
                        }
                    });

                    /* initialise the environemnt: add player to list of players currently online,
                     * tell everyone that a player has joined the game, clear the players screen
                     * and show them the description and contents of the room they are currently in
                     */
                    controller.activatePlayer(conn, player);
                    controller.broadcastExcept(conn, strings.hasConnected, player);
                    controller.clearScreen(conn);
                    commands.look.perform(conn, []);
                }
            });
        }
    }),

    //Speak to other players
    say: CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            cb(conn, argsArr);
        },
        perform: function (conn, argsArr) {
            let message = argsArr.length === 0 ? "" : argsArr[0];
            let player = controller.findActivePlayerByConnection(conn);
            controller.sendMessage(conn, strings.youSay, { message: message });
            controller.sendMessageRoomExcept(conn, strings.says, { name: player.name, message: message });
        }
    }),

    //move the player somewhere through an exit or to their home
    go: CommandHandler.extend({

        nargs: 1,
        validate: function (conn, argsArr, cb) {
            if (argsArr.length === 1) {
                cb(conn, argsArr);
            } else {
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, argsArr, errMsg) {
            const player = controller.findActivePlayerByConnection(conn);
            const exitName = argsArr[0];

            // if 'go home', tell players in the current room that a player is going to their home
            if (exitName === 'home') {
                player.getTarget().then(loc => {
                    controller.applyToActivePlayers(function (otherconn, other) {
                        if (other.locationId === loc.id && player !== other) {
                            controller.sendMessage(otherconn, strings.goesHome, { name: player.name });
                        }
                    });

                    // drop all of the player's inventory contents and send each item back to its target
                    player.getContents().then(contents => {
                        if (contents) {
                            for (let i = 0; i < contents.length; i++) {
                                let thing = contents[i];
                                thing.locationId = thing.targetId;
                                thing.save();
                            }
                        }

                        // send message 3 times
                        for (let i = 0; i < 3; i++) {
                            controller.sendMessage(conn, strings.noPlaceLikeHome)
                        }

                        // set players new location
                        player.setLocation(loc).then(() => {
                            controller.sendMessage(conn, strings.goneHome);
                            commands.look.lookRoom(conn, loc);
                        });

                    });
                });

            // go <exit name>
            } else {
                controller.findPotentialMUDObject(conn, exitName, function (exit) {
                    //found a matching exit... can we use it?
                    predicates.canDoIt(controller, player, exit, function (canDoIt) {
                        // check if the exit leads to somewhere
                        if (canDoIt && exit.targetId) {
                            exit.getTarget().then(loc => {
                                // only go if they're not already in the taregt room
                                if (loc.id !== player.locationId) {
                                    //only inform everyone else if its a different room
                                    controller.applyToActivePlayers(function (otherconn, other) {
                                        if (other.locationId === player.locationId && player !== other) {
                                            controller.sendMessage(otherconn, strings.leaves, { name: player.name });
                                        }
                                        if (other.locationId === loc.id && player !== other) {
                                            controller.sendMessage(otherconn, strings.enters, { name: player.name });
                                        }
                                    });

                                    player.setLocation(loc).then(() => {
                                        commands.look.lookRoom(conn, loc);
                                    });
                                } else {
                                    commands.look.lookRoom(conn, loc);
                                }
                            });
                        }
                    }, strings.noGo);
                }, false, false, 'EXIT', strings.ambigGo, (errMsg ? errMsg : strings.noGo), false);
            }
        }
    }),

    //look at something
    look: CommandHandler.extend({

        validate: function (conn, argsArr, cb) {
            if (argsArr.length <= 1)
                cb(conn, argsArr);
            else
                controller.sendMessage(conn, strings.unknownCommand);
        },

        perform: function (conn, argsArr) {
            const player = controller.findActivePlayerByConnection(conn);

            // look <no args>
            if (argsArr.length === 0 || argsArr[0].length === 0) {
                player.getLocation().then(room => {
                    commands.look.look(conn, room);
                });
            
            // look <object|here|me>
            } else {
                controller.findPotentialMUDObject(conn, argsArr[0], function (obj) {
                    commands.look.look(conn, obj);
                }, true, true, undefined, undefined, undefined, true);
            }
        },

        // find out what object we are looking at
        look: function (conn, obj) {
            switch (obj.type) {
                case 'ROOM':
                    commands.look.lookRoom(conn, obj);
                    break;
                case 'PLAYER':
                    commands.look.lookSimple(conn, obj);
                    commands.look.lookContents(conn, obj, strings.carrying);
                    break;
                default:
                    commands.look.lookSimple(conn, obj);
            }
        },

        // look at a room
        lookRoom: function (conn, room) {
            const player = controller.findActivePlayerByConnection(conn);

            if (predicates.isLinkable(room, player)) {
                controller.sendMessage(conn, strings.roomNameOwner, room);
            } else {
                controller.sendMessage(conn, strings.roomName, room);
            }
            if (room.description) controller.sendMessage(conn, room.description+"\n");

            predicates.canDoIt(controller, player, room, function () {
                commands.look.lookContents(conn, room, strings.contents);
            });
        },

        // look at an object
        lookSimple: function (conn, obj) {
            controller.sendMessage(conn, obj.description ? obj.description : strings.nothingSpecial);
        },

        // look at a player
        lookContents: function (conn, obj, name, fail) {
            obj.getContents().then(contents => {
                if (contents) {
                    const player = controller.findActivePlayerByConnection(conn);

                    // find the player's contents
                    contents = contents.filter(function (o) {
                        return predicates.canSee(player, o);
                    });

                    // if they have contents, display them
                    if (contents.length > 0) {
                        controller.sendMessage(conn, name);
                        for (let i = 0; i < contents.length; i++) {
                            controller.sendMessage(conn, contents[i].name);
                        }

                    } else {
                        if (fail)
                            controller.sendMessage(conn, fail);
                    }
                }
            });
        }
    }),

    // drop/throw command
    drop: CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            if (argsArr.length === 1) {
                cb(conn, argsArr);
            } else {
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, argsArr) {
            const player = controller.findActivePlayerByConnection(conn);

            let whereObj = {
               [db.Sequelize.Op.and]: [{ name: argsArr[0] }, { type: 'THING' }, { locationId: player.id }]
            };

            // load in thing(s) the player is trying to drop
            controller.loadMUDObjects(conn, whereObj, function (thingArr) {
                if (thingArr.length > 0) {
                    // load in the room the player is in so its flags can be checked
                    let whereRoom = {
                        [db.Sequelize.Op.and]: [{ type: 'ROOM' }, { id: player.locationId }]
                    };

                    controller.loadMUDObject(conn, whereRoom, function (currentRoom) {
                        for (let i = 0; i < thingArr.length; i++) {
                            // 'THING' being dropped
                            const thingToDrop = thingArr[i];
                            // check where the 'THING' is going to be dropped

                            /*if the current room is a temple, check whether it has a target id,
                            * if it does have a target, the dropped item should go to that target
                            * if it does NOT, the dropped item should go to it's own target
                            * else if the room is not a temple, the thing should be dropped in the
                            * current room
                            */
                            if (currentRoom.isTemple()) {
                                if (currentRoom.targetId !== null) {
                                    thingToDrop.locationId = currentRoom.targetId; /* thing goes home */
                                    thingToDrop.save();
                                    controller.sendMessage(conn, strings.dropped);
                                } else {
                                    // temple, but has no target, send thing to it's target
                                    thingToDrop.locationId = thingToDrop.targetId;
                                    thingToDrop.save();
                                    controller.sendMessage(conn, strings.dropped);
                                }
                            } else {
                                // room is not a temple, drop the object in the current room
                                thingToDrop.locationId = currentRoom.id;
                                thingToDrop.save();
                                controller.sendMessage(conn, strings.dropped);
                            }
                        }
                    });
                } else {
                    // don't have THING
                    controller.sendMessage(conn, strings.dontHave);
                }
            });
        }
    }),

    // examine command
    examine: CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            if (argsArr.length === 1) {
                if (predicates.isNameValid(argsArr[0])) {
                    cb(conn, argsArr);
                } else {
                    // name is invalid
                    controller.sendMessage(conn, strings.invalidName);
                }
            } else {
                // unknown command
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, argsArr) {
            const player = controller.findActivePlayerByConnection(conn);
            const objectName = argsArr[0];
            let exactMatches = [];

            controller.findPotentialMUDObjects(conn, objectName, function (objectArr) {
                // if the player called 'examine me' or 'examine here'
                if (objectName === "me" || objectName === "here") {
                    controller.sendMessage(conn, strings.examine, objectArr[0]);
                    commands.examine.getContents(conn, objectArr[0]);

                } else {
                    /* loop through objectArr and push exact matches
                        into new array for further testing*/
                    for (let i = 0; i < objectArr.length; i++) {
                        /* name matches & object is in players possession or in the same room as player
						or the object IS the room the player is in*/
                        if (objectArr[i].name === objectName &&
                            (objectArr[i].locationId === player.id ||
                                objectArr[i].locationId === player.locationId ||
                                objectArr[i].id === player.locationId)) {
                            exactMatches.push(objectArr[i]);
                        }
                    }
                    // checks matches were actually found
                    if (exactMatches.length !== 0) {
                        if (exactMatches.length === 1) {
                            // allow examine if player is owner, or player is in object's location (same as examine 'here')
                            if (exactMatches[0].ownerId === player.id || exactMatches[0].id === player.locationId) {
                                // examine object and call helper function to display the object's contents
                                controller.sendMessage(conn, strings.examine, exactMatches[0]);
                                commands.examine.getContents(conn, exactMatches[0]);
                            } else {
                                // player is not owner or in the location of the object
                                controller.sendMessage(conn, strings.permissionDenied);
                            }
                        } else {
                            // more than one object was found
                            controller.sendMessage(conn, strings.ambigSet);
                        }
                    } else {
                        // no matches
                        controller.sendMessage(conn, strings.examineUnknown);
                    }
                }
            }, true, true, null);
        },

        // helper method used to print an object's contents
        getContents: function (conn, obj) {
            /* find & print all objects that have location ID equal to the object's id 
			   i.e. the object's contents*/
            let where = {
                locationId: obj.id
            };

            controller.loadMUDObjects(conn, where, contents => {
                if (contents.length > 0) {
                    controller.sendMessage(conn, strings.contents);
                    for (let i = 0; i < contents.length; i++) {
                        controller.sendMessage(conn, strings.examineContentsName, contents[i]);
                    }
                }
            });
        }
    }),

    // get/take command
    get: CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            if (argsArr.length === 1) {
                cb(conn, argsArr);
            } else {
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, argsArr) {
            const player = controller.findActivePlayerByConnection(conn);
            const objectName = argsArr[0];
            // object must be a THING in the same room as the
            // player, or in the player's possession.
            let where = {
               [db.Sequelize.Op.and]: [
                   { name: objectName },
                   { type: 'THING' },
                   {[db.Sequelize.Op.or]: [
                       { locationId: player.locationId },
                       { locationId: player.id }
]
                   }
               ]
            };

            controller.loadMUDObjects(conn, where, function (objectArr) {

                if (objectArr.length === 1) {
                    const objectToTake = objectArr[0];
                    // check if user is able to take object
                    predicates.canDoIt(controller, player, objectToTake, function (isAble) {
                        if (!isAble) {
                            // not able to take it
                            controller.sendMessage(conn, strings.cantTakeThat);
                        } else if (objectToTake.locationId === player.id) {
                            // player is already holding item they are trying to take
                            controller.sendMessage(conn, strings.alreadyHaveThat);
                        } else {
                            // player can take object
                            objectToTake.locationId = player.id;
                            objectToTake.save();
                            controller.sendMessage(conn, strings.taken);
                        }
                    }, strings.cantTakeThat);
                } else if (objectArr.length > 1) {
                    // deals with ambiguity
                    controller.sendMessage(conn, strings.ambigSet);
                } else {
                    // can't find THING player is trying to take
                    controller.sendMessage(conn, strings.takeUnknown);
                }
            });
        }
    }),

    // prints the THINGs a player is holding
    inventory: CommandHandler.extend({
        nargs: 0,
        // makes sure no arguments are passed
        validate: function (conn, argsArr, cb) {
            if (argsArr.length === 0) {
                cb(conn);
            } else {
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn) {
            const player = controller.findActivePlayerByConnection(conn);

            let where = {
               [db.Sequelize.Op.and]: [{ type: 'THING' }, { locationId: player.id }]
            };

            controller.loadMUDObjects(conn, where, function (inventArr) {
                // if player is carrying THINGs, print them to screen
                if (inventArr.length > 0) {
                    controller.sendMessage(conn, strings.youAreCarrying);
                    for (let i = 0; i < inventArr.length; i++) {
                        controller.sendMessage(conn, inventArr[i].name);
                    }
                } else {
                    // player is not carrying anything
                    controller.sendMessage(conn, strings.carryingNothing);
                }
            });
        }
    }),

    // Lets another player you are looking for them, and in which location.
    page: CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            // checks username is valid
            if (argsArr.length === 1 && predicates.isUsernameValid(argsArr[0])) {
                cb(conn, argsArr);
            } else {
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, argsArr) {
            // sender & receiver
            const player = controller.findActivePlayerByConnection(conn);
            const targetPlayer = controller.findActivePlayerByName(argsArr[0]);
            // details for paging
            player.getLocation().then(playerLocation => {

                const senderDetails = {
                    name: player.name,
                    location: playerLocation.name
                };

                // checks the target player is online
                if (targetPlayer !== undefined) {
                    // finds target's connection and sends page to them using senderDetails
                    const targetPlayerConn = controller.findActiveConnectionByPlayer(targetPlayer);
                    controller.sendMessage(targetPlayerConn, strings.page, senderDetails);
                    // prints to sender's screen that page was sent
                    controller.sendMessage(conn, strings.pageOK);
                } else {
                    // player does not exist or is offline
                    controller.sendMessage(conn, strings.isNotAvailable);
                }
            });
        }
    }),

    // messages one person, as opposed to everyone in the room
    whisper: CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            if (argsArr.length === 1) {
                // splits string argument based on '=' sign
                const argsSplit = argsArr[0].split("=");
                if (argsSplit[0] !== undefined && argsSplit[1] !== undefined) {
                    const username = argsSplit[0].trim();
                    const message = argsSplit[1];
                    // checks a valid username and a message were provided
                    if ((predicates.isUsernameValid(username)) && (message !== undefined)) {
                        cb(conn, username, message);
                    } else {
                        // unknown command
                        controller.sendMessage(conn, strings.unknownCommand);
                    }
                } else {
                    // argument was not split properly
                    controller.sendMessage(conn, strings.unknownCommand);
                }
            } else {
                // unknown command
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, targetPlayerName, messageArg) {
            const player = controller.findActivePlayerByConnection(conn);

            let where = {
               [db.Sequelize.Op.and]: [{ name: targetPlayerName }, { type: 'PLAYER' }, { locationId: player.locationId }]
            };

            controller.loadMUDObject(conn, where,
                function (targetPlayer) {
                    // checks target player exists
                    if (targetPlayer) {
                        // checks target is online
                        const targetConn = controller.findActiveConnectionByPlayer(targetPlayer);
                        if (targetConn !== undefined) {
                            // create whisper confirm message
                            const whisperSend = {
                                message: messageArg,
                                name: targetPlayerName
                            };
                            // used to message target player
                            const whisperReceive = {
                                name: player.name,
                                message: messageArg
                            };
                            // messages for sender and receiver
                            controller.sendMessage(conn, strings.youWhisper, whisperSend);
                            controller.sendMessage(targetConn, strings.toWhisper, whisperReceive);
                            // used if player is successful in whispering
                            const othersSuccessWhisper = {
                                fromName: player.name,
                                toName: targetPlayer.name
                            };
                            // used if player is unsuccessful in whispering
                            const othersFailWhisper = {
                                fromName: player.name,
                                message: messageArg,
                                toName: targetPlayer.name
                            };
                            // apply success/fail message to other players
                            controller.applyToActivePlayers(function (otherConn, otherPlayer) {
                                if (otherPlayer.name !== player.name && otherPlayer.name !== targetPlayer.name) {

                                    // Deal with chance of overhearing - random number between 0 and 99.999
                                    const threshold = 10;
                                    const randomNumber = Math.random() * 100;

                                    // checks threshold to determine successful or failed whisper
                                    if (randomNumber > threshold) {
                                        // success - 9/10 chance
                                        controller.sendMessage(otherConn, strings.whisper, othersSuccessWhisper);
                                    } else {
                                        // fail - 1/10 chance
                                        controller.sendMessage(otherConn, strings.overheard, othersFailWhisper);
                                    }
                                }
                            });


                        } else {
                            // player is not online
                            const offlinePlayer = {
                                name: targetPlayer.name
                            };
                            //player not connected message
                            controller.sendMessage(conn, strings.notConnected, offlinePlayer);
                        }
                    } else {
                        // target player was not found in room / may not exist
                        controller.sendMessage(conn, strings.notInRoom);
                    }
                });
        }
    }),

    //Disconnect the player
    QUIT: CommandHandler.extend({
        preLogin: true,
        perform: function (conn, argsArr) {
            conn.terminate();
        }
    }),

    // List active players
    WHO: CommandHandler.extend({
        preLogin: true,
        perform: function (conn, argsArr) {
            controller.applyToActivePlayers(function (otherconn, other) {
                if (otherconn !== conn) {
                    controller.sendMessage(conn, other.name);
                }
            });
        }
    }),

    // Show commands with their usages
    HELP: CommandHandler.extend({
        // nargs can be 0 || 1, so don't provide
        preLogin: true,

        /* Because nargs is not defined, argument will be treated as one */
        validate: function (conn, argsArr, cb) {

            // no args
            if (argsArr.length === 0) {
                cb(conn, argsArr);
                return;
            }

            // split the array into the args
            const argsLen = argsArr[0].split(' ').length;
            if (argsLen > 1) {
                controller.sendMessage(conn, strings.incorrectArgs, { command: 'help' });
            } else {
                cb(conn, argsArr);
            }
        },

        perform: function (conn, argsArr) {

            // if no arguments, show all commands and properties
            if (argsArr.length === 0) {
                controller.sendMessage(conn, strings.help, { command: commands.HELP.getAllCommandsOrProperties('both') });
                return;
            }

            // if 1 argument, check the flag the user provided
            if (argsArr.length === 1) {

                const arg = argsArr[0];

                switch (arg) {
                    // command flag
                    case '-c':
                        controller.sendMessage(conn, strings.help, { command: commands.HELP.getAllCommandsOrProperties('commands') });
                        break;
                        // property flag
                    case '-p':
                        controller.sendMessage(conn, strings.help, { command: commands.HELP.getAllCommandsOrProperties('properties') });
                        break;
                        // no flag, check if arg is a command.
                    default:
                        // see if the command exists in the command or property list
                        let arg = commands.HELP.getCommand(arg);
                        // if undefined, set to 'help', else set to arg
                        commandObj = (!!arg) ? arg : 'help';
                        strObj = (commandObj === 'help') ? strings.incorrectArgs : strings.help;
                        controller.sendMessage(conn, strObj, { command: commandObj });
                }
            }
        },

        /* Helper Functions */
        // Returns string containing all commands with names|description
        getAllCommandsOrProperties: function (commandsOrProps) {
            let lc = 0;
            let str = "";
            let arr = [];

            if (commandsOrProps === 'commands') {
                // loop through commands
                Object.keys(ch.commands).forEach(command => {
                    arr.push(ch.commands[command]);
                });
            } else if (commandsOrProps === 'properties') {
                // loop through properties
                Object.keys(ch.properties).forEach(prop => {
                    arr.push(ch.properties[prop]);
                });
            } else if (commandsOrProps === 'both') {
                // loop through commands
                Object.keys(ch.commands).forEach(command => {
                    arr.push(ch.commands[command]);
                });
                // loop through properties
                Object.keys(ch.properties).forEach(prop => {
                    arr.push(ch.properties[prop]);
                });
            }

            // find longest
            for (let i = 0; i < arr.length; i++) {
                len = arr[i].name.length;
                lc = (len > lc) ? len : lc;
            }

            return commands.HELP.getPrettyString(arr, lc);
        },

        // returns formatted string
        getPrettyString: function (arr, lc) {
            let str = "";

            // pretty print them
            for (let i = 0; i < arr.length; i++) {
                let command = arr[i];
                let commandStr = command.name;

                if (command.name.length < lc) {
                    // add spaces
                    let spaces = lc - commandStr.length;
                    for (let j = 0; j < spaces; j++) {
                        commandStr += ' ';
                    }
                }
                commandStr += "\t" + command.description + "\n";
                str += commandStr;
            }

            return str;
        },

        getCommand: function (arg) {

            // holds object
            let obj;

            // if its a property command
            if (arg[0] === '@') {
                // check property list
                let propList = Object.keys(ch.properties);
                for (let i = 0; i < propList.length; i++) {
                    if (propList[i] === arg.split("@")[1]) {
                        // retrieve object with correct name
                        obj = ch.properties[propList[i]];
                        break;
                    }
                }

            } else {

                // either a command, or jibberish
                // check command list
                let commList = Object.keys(ch.commands);
                for (let i = 0; i < commList.length; i++) {
                    if (commList[i] === arg) {
                        // retrieve object with correct name
                        obj = ch.commands[commList[i]];
                        break;
                    }
                }
            }

            // if obj is found, return the string, else return undefined
            return (obj) ? obj.name + ":\n\t\tDescription | " + obj.description + "\n\n\t\t\t  Usage | " + obj.usage + "\n" : obj;

        }
    }),

    "@create": CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            // checks the right number of arguments were given
            if (argsArr.length === 1) {
                // checks name of the 'THING' being created is valid
                if (predicates.isNameValid(argsArr[0])) {
                    // is valid, continue...
                    cb(conn, argsArr);
                } else {
                    // not valid, error message...
                    controller.sendMessage(conn, strings.invalidName);
                }
            } else {
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, argsArr) {
            const player = controller.findActivePlayerByConnection(conn);
            // creates a new 'THING'
            controller.createMUDObject(conn,
                {
                    name: argsArr[0],
                    type: 'THING',
                    locationId: player.id,
                    targetId: player.targetId,
                    ownerId: player.id

                }, function (thing) {
                    // once thing is created, print message
                    controller.sendMessage(conn, strings.created);
                });
        }
    }),

    "@password": CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            // checks the right number of arguments were given
            if (argsArr.length === 1) {
                // splits string argument based on '=' sign
                // won't trim in the case a password contains preceding/succeeding space(s)
                const argsSplit = argsArr[0].split("=");
                const oldPassword = argsSplit[0];
                const newPassword = argsSplit[1];
                cb(conn, oldPassword, newPassword);
            } else {
                // incorrect number of args given
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, oldPassword, newPassword) {
            const player = controller.findActivePlayerByConnection(conn);
            // checks the old password is correct and that the new password is valid
            if (player.password === oldPassword && predicates.isPasswordValid(newPassword)) {
                // changes password...
                player.password = newPassword;
                player.save();
                controller.sendMessage(conn, strings.changePasswordSuccess);
            } else {
                // failed to change password
                controller.sendMessage(conn, strings.changePasswordFail);
            }
        }
    }),

    //set the description of something
    "@describe": PropertyHandler.extend({
        prop: 'description'
    }),

    // set the name of an object
    "@name": PropertyHandler.extend({
        prop: 'name'
    }),

    //set the success message of an object
    "@success": PropertyHandler.extend({
        prop: 'successMessage'
    }),

    //set the others' success message of an object
    "@osuccess": PropertyHandler.extend({
        prop: 'othersSuccessMessage'
    }),

    //set the failure message of an object
    "@failure": PropertyHandler.extend({
        prop: 'failureMessage'
    }),

    //set the others' failure message of an object
    "@ofailure": PropertyHandler.extend({
        prop: 'othersFailureMessage'
    }),

    "@find": CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            // checks the right number of arguments were given
            if (argsArr.length === 1) {
                // checks the name provided
                if (predicates.isNameValid(argsArr[0])) {
                    // is valid, continue...
                    cb(conn, argsArr);
                } else {
                    // not valid, error message...
                    controller.sendMessage(conn, strings.invalidName);
                }
            } else {
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, argsArr) {
            const player = controller.findActivePlayerByConnection(conn);
            const name = argsArr[0];

            // finds all objects that the player controls
            let where = {
               [db.Sequelize.Op.and]: [
                   { name: { [db.Sequelize.Op.like]: '%' + name + '%' } },
                   { ownerId: player.id },
                   { type: { [db.Sequelize.Op.ne]: 'PLAYER' } }
               ]
            };

            controller.loadMUDObjects(conn, where, function (objects) {
                if (objects.length !== 0) {
                    for (let i = 0; i < objects.length; i++) {
                        controller.sendMessage(conn, strings.roomNameOwner, objects[i]);
                    }
                } else {
                    // no objects were found
                    controller.sendMessage(conn, strings.notFound);
                }
            });
        }
    }),


    "@set": CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            // checks the right number of arguments were given
            if (argsArr.length === 1) {
                // splits string argument based on '=' sign
                const argsSplit = argsArr[0].split("=");
                if (argsSplit[0] !== undefined && argsSplit[1] !== undefined) {
                    const objectName = argsSplit[0].trim();
                    const flagName = argsSplit[1].trim();

                    // checks a valid flag was provided
                    if (flagName === "link_ok" || flagName === "anti_lock" || flagName === "temple" ||
                        flagName === "!link_ok" || flagName === "!anti_lock" || flagName === "!temple") {
                        //call perform
                        cb(conn, objectName, flagName);
                    } else {
                        // invalid flag
                        controller.sendMessage(conn, strings.unknownCommand);
                    }

                } else {
                    // argument was not split by "=" properly
                    controller.sendMessage(conn, strings.unknownCommand);
                }
            } else {
                // incorrect number of args given
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, objectName, flagName) {
            const player = controller.findActivePlayerByConnection(conn);

            let where = {
                name: objectName
            };

            // load object
            controller.loadMUDObjects(conn, where, function (objectArr) {
                // check only 1 object was found
                if (objectArr.length === 1) {
                    const object = objectArr[0];
                    // check player is the owner of the object
                    if (object.ownerId === player.id) {
                        // used to remove '!' from reset flags 
                        let rawFlagName = flagName.replace('!', '');
                        // get correct flagbit
                        let flagbit = db.MUDObject.FLAGS[rawFlagName];
                        // set/reset flag
                        if (flagName.indexOf("!") > -1) {
                            object.resetFlag(flagbit).then(() => {
                                controller.sendMessage(conn, strings.reset, { property: rawFlagName });
                            });
                        } else {
                            object.setFlag(flagbit).then(() => {
                                controller.sendMessage(conn, strings.set, { property: rawFlagName });
                            });
                        }
                    } else {
                        // not the owner of the object
                        controller.sendMessage(conn, strings.permissionDenied);
                    }
                } else if (objectArr.length > 1) {
                    // deals with ambiguity
                    controller.sendMessage(conn, strings.ambigSet);
                    // no object was found
                } else {
                    controller.sendMessage(conn, strings.setUnknown);
                }
            });
        }

    }),

    "@path": CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            // checks the right number of arguments were given
            if (argsArr.length === 1) {
                cb(conn, argsArr);
            } else {
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, argsArr) {
            const player = controller.findActivePlayerByConnection(conn);
            const destinationName = argsArr[0];

            let where = {
                [db.Sequelize.Op.and]: [
                    { name: destinationName },
                    { type: 'ROOM' }
                ]
            };

            controller.loadMUDObject(conn, where, (destinationObj) => {
                if (!destinationObj) {
                    controller.sendMessage(conn, strings.notFound);
                } else {
                    // find player location to use as the start node in bfs
                    player.getLocation().then(location => {
                        // begin bfs
                        bfs(location.id, (depth, node, callback) => {
                            // move function - can ignore depth, not restricting bfs to max depth
                            // query to find all exits in the current location
                            let where = {
                                    [db.Sequelize.Op.and]: [
                                        { locationId: node },
                                        { type: 'EXIT' }
                                    ]
                            };

                            // load the existing exists
                            controller.loadMUDObjects(conn, where, (exitArr) => {
                                exitArr.forEach(obj => {
                                    console.log(obj.name);
                                });
                                let possNodes = [];
                                if (exitArr && exitArr.length > 0) {
                                    // loop through connected exists
                                    for (let i = 0; i < exitArr.length; i++) {
                                        // if the exit has a non-null target, push the room id into the array
                                        if (exitArr[i].targetId !== null) {
                                            possNodes.push(exitArr[i].targetId);
                                        }
                                    }
                                }

                                // call the cb with the new rooms to check
                                callback(null, possNodes);
                            });

                        }, (node, callback) => {
                            // goal function
                            if (node === destinationObj.id) {
                                callback(null, true) /* goal found */
                            } else {
                                callback(null, false) /* not found */
                            }

                        }, (err, path) => {
                            // success/failure function
                            if (path === null) {
                                controller.sendMessage(conn, strings.notFound);
                            } else {
                                commands["@path"].printPath(conn, path, location.id, destinationObj.id);
                            }
                        });

                    }, err => {
                        console.log("Error inside @path");
                    })
                }
            });
        },

        printPath: function (conn, path, startId, endId) {

            // check if the player is already in their destination
            if (path.length === 1 && path[0] === startId) {
                controller.sendMessage(conn, strings.alreadyThere);
                return;
            }

            // load start location
            controller.loadMUDObject(conn, { id: startId }, startLoc => {
                // load end location
                controller.loadMUDObject(conn, { id: endId }, endLoc => {
                   let str = "\nPath from " + startLoc.name + " to " + endLoc.name + ":\n";
                   controller.sendMessage(conn, str);

                   // hack to deal with async forEach loop
                   let promise = Promise.resolve();
                   let timeout = 100;

                   path.forEach((room, i) => {
                       promise = promise.then(function () {
                           // load in room
                           controller.loadMUDObject(conn, { id: path[i] }, room => {

                               // prevents OutOfBounds
                               let nextRoomId = (i + 1 < path.length) ? path[i + 1] : -1;

                               let whereExit = {
                                       [db.Sequelize.Op.and]: [
                                           { locationId: room.id },
                                           { targetId: nextRoomId },
                                           { type: 'EXIT' }
                                       ]
                               };

                               controller.loadMUDObject(conn, whereExit, exit => {
                                   if (!!exit) {
                                       controller.sendMessage(conn, room.name);
                                       controller.sendMessage(conn, strings.via, { name: exit.name });
                                   } else {
                                       controller.sendMessage(conn, room.name);
                                   }

                               });
                           })

                           return new Promise(function (resolve) {
                               setTimeout(resolve, timeout);
                           });
                       });
                   })

                });
            });
        }
    }),

    "@link": CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            // checks the right number of arguments were given
            if (argsArr.length === 1) {
                const argsSplit = argsArr[0].split("=");
                if (argsSplit[0] !== undefined && argsSplit[1] !== undefined) {
                    const objectName = argsSplit[0].trim();
                    const roomNumber = argsSplit[1].trim();
                    cb(conn, objectName, roomNumber);
                } else {
                    // argument was not split properly
                    controller.sendMessage(conn, strings.unknownCommand);
                }
            } else {
                // unknown command
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, objectName, roomID) {
            const player = controller.findActivePlayerByConnection(conn);
            let roomObject;
                
            // find the room to be linked to
            let where = {
                [db.Sequelize.Op.and]: [
                    { id: roomID },
                    { type: 'ROOM' }
                ]
            };

            // check to see if the room exists, or a special keyword has been used
            controller.loadMUDObject(conn, where, function (foundRoom) {
                if (!foundRoom && roomID !== "here" && roomID !== "home") {
                    controller.sendMessage(conn, strings.notARoom);
                } else {
                    controller.findPotentialMUDObjects(conn, objectName, function (objectArr) {
                        if (objectArr.length === 1) {
                            const object = objectArr[0];
                            // check object type (and special cases "me" & "here")
                            if (object.type === "EXIT") {
                                commands["@link"].linkDirection(conn, object, roomID);
                            } else if (object.type === "THING" || objectName === "me") {
                                commands["@link"].linkThing(conn, object, roomID);
                            } else if (object.type === "ROOM" || objectName === "here") {
                                commands["@link"].linkRoom(conn, object, roomID);
                            } else {
                                controller.sendMessage(conn, strings.unknownCommand);
                            }
                        } else if (objectArr.length > 1) {
                            // multiple objects found
                            controller.sendMessage(conn, strings.ambigSet);
                        } else {
                            // didn't find the object
                            controller.sendMessage(conn, strings.unknownCommand);
                        }
                    }, true, true, false);
                }
            });
        },

        linkDirection: function (conn, passedObject, passedRoomID) {
            const player = controller.findActivePlayerByConnection(conn);
            let roomID;

            // assign value to roomID based on passedRoomID
            if (passedRoomID === "home") {
                roomID = player.targetId;
            } else if (passedRoomID === "here") {
                /*pointless: links exit to the room it is already in
				but it is needed to prevent errors*/
                roomID = player.locationId;
            } else {
                roomID = passedRoomID;
            }

            // load the room to be linked to
            let where = {
                id: roomID
            };

            controller.loadMUDObject(conn, where, function (room) {
                // checks exit is not linked and that the room is linkable
                if (passedObject.targetId === null && predicates.isLinkable(room, player)) {
                    // links & changes ownership of exit
                    passedObject.targetId = room.id;
                    passedObject.ownerId = player.id;
                    passedObject.save();
                    controller.sendMessage(conn, strings.linked);
                } else {
                    // player is not owner, or room is not linkable
                    controller.sendMessage(conn, strings.permissionDenied);
                }
            });

        },

        linkThing: function (conn, passedObject, passedRoomID) {
            const player = controller.findActivePlayerByConnection(conn);
            let roomID;

            // assign value to roomID based on passedRoomID
            if (passedRoomID === "home") {
                roomID = player.targetId;
            } else if (passedRoomID === "here") {
                roomID = player.locationId;
            } else {
                roomID = passedRoomID;
            }

            let where = {
                id: roomID
            };

            controller.loadMUDObject(conn, where, function (room) {

                // checks ownership of 'thing' (or me) and whether room is linkable
                if (passedObject.ownerId === player.id && predicates.isLinkable(room, player)) {
                    passedObject.targetId = room.id;
                    passedObject.save();
                    controller.sendMessage(conn, strings.homeSet);
                } else {
                    // not owner or target room is not linkable
                    controller.sendMessage(conn, strings.permissionDenied);
                }
            });
        },

        linkRoom: function (conn, passedObject, passedRoomID) {
            const player = controller.findActivePlayerByConnection(conn);
            let roomID;

            /* checks ownership of passedObject to save running
			unecessary lines of code */
            if (passedObject.ownerId !== player.id) {
                controller.sendMessage(conn, strings.permissionDenied);
                return;
            }

            // check if "here" keyword was used
            if (passedRoomID === "here") {
                roomID = player.locationId;
            } else {
                roomID = passedRoomID;
            }

            // deals with "home" cases (setting temples)
            if (roomID === "home") {
                player.getLocation().then(playerLocation => {
                    // @link here = home
                    if (passedObject.id === playerLocation.id) {
                        let str = playerLocation.name + "=temple";
                        commands["@set"].validate(conn, [str], commands["@set"].perform);
                        // @link <roomName> = home
                    } else {
                        let str = passedObject.name + "=temple";
                        commands["@set"].validate(conn, [str], commands["@set"].perform);
                    }
                });

                // deals with non-home cases (setting drop-to)
            } else {

                let where = {
                    id: roomID
                };

                controller.loadMUDObject(conn, where, function (room) {
                    if (predicates.isLinkable(room, player)) {
                        passedObject.targetId = room.id;
                        passedObject.save();
                        controller.sendMessage(conn, strings.linked);
                    } else {
                        // target room is not linkable
                        controller.sendMessage(conn, strings.permissionDenied);
                    }
                });
            }
        }
    }),

    "@unlink": CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            // checks the right number of arguments were given
            if (argsArr.length === 1) {
                cb(conn, argsArr[0]);
            } else {
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, objectName, cb) {
            const player = controller.findActivePlayerByConnection(conn);
            let exactObjects = [];

            // try and find the 'EXIT' or 'here'
            controller.findPotentialMUDObjects(conn, objectName, function (objArr) {

                for (let i = 0; i < objArr.length; i++) {
                    // Allows Exits and "here" (ROOM)
                    if ((objArr[i].type === 'EXIT' && objArr[i].name === objectName) ||
                        objArr[i].type === 'ROOM') {
                        exactObjects.push(objArr[i]);
                    }
                }

                if (exactObjects.length === 1) {
                    const object = exactObjects[0];
                    /* if 'EXIT' is found (or "here"), clear it's targetId (unlink it)
					   only if player is the owner*/
                    if (object.ownerId === player.id) {
                        object.targetId = null;
                        object.save();
                        controller.sendMessage(conn, strings.unlinked);
                    } else {
                        // not owner of the exit
                        controller.sendMessage(conn, strings.permissionDenied);
                    }
                } else if (exactObjects.length > 1) {
                    // ambiguous request...
                    controller.sendMessage(conn, strings.ambigSet);
                } else {
                    // exit not found
                    controller.sendMessage(conn, strings.unlinkUnknown);
                }

                // don't allow 'me', but allow 'here'
            }, false, true);
        }
    }),

    "@lock": CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            // checks the right number of arguments were given
            if (argsArr.length === 1) {
                // splits string argument based on '=' sign
                const argsSplit = argsArr[0].split("=");
                if (argsSplit[0] !== undefined && argsSplit[1] !== undefined) {
                    const lockName = argsSplit[0].trim();
                    const keyName = argsSplit[1].trim();
                    cb(conn, lockName, keyName);
                } else {
                    // incorrect format
                    controller.sendMessage(conn, strings.unknownCommand);
                }
            } else {
                // incorrect number of args given
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, lockName, keyName) {
            const player = controller.findActivePlayerByConnection(conn);
            let exactLockMatches = [];
            let exactKeyMatches = [];

            controller.findPotentialMUDObjects(conn, lockName, function (lockArr) {
                // filter the lock array
                for (let i = 0; i < lockArr.length; i++) {
                    if ((lockArr[i].name === lockName ||
                        lockName === "me" || lockName === "here") &&
                        (lockArr[i].locationId === player.id ||
                            lockArr[i].locationId === player.locationId ||
                            lockArr[i].id === player.locationId)) {
                        exactLockMatches.push(lockArr[i]);
                    }
                }

                // just one lock was found
                if (exactLockMatches.length === 1) {
                    const lock = exactLockMatches[0];
                    // check ownership of the lock object
                    if (lock.ownerId === player.id) {
                        // load the key based on the name provided
                        controller.findPotentialMUDObjects(conn, keyName, function (keyArr) {
                            // filter the key array
                            for (let j = 0; j < keyArr.length; j++) {
                                if ((keyArr[j].name === keyName ||
                                    keyName === "me" || keyName === "here") &&
                                    (keyArr[j].locationId === player.id ||
                                        keyArr[j].locationId === player.locationId ||
                                        keyArr[j].id === player.locationId)) {
                                    exactKeyMatches.push(keyArr[j]);
                                }
                            }
                            // just one key was found
                            if (exactKeyMatches.length === 1) {
                                const key = exactKeyMatches[0];
                                // lock object using the key
                                lock.keyId = key.id;
                                lock.save();
                                controller.sendMessage(conn, strings.locked);
                            } else if (exactKeyMatches.length > 1) {
                                // deals with key ambiguity
                                controller.sendMessage(conn, strings.ambigSet);
                            } else {
                                // no matching keys were found
                                controller.sendMessage(conn, strings.keyUnknown);
                            }
                        }, true, true);
                    } else {
                        // player is not owner of the object
                        controller.sendMessage(conn, strings.permissionDenied);
                    }
                } else if (exactLockMatches.length > 1) {
                    // deals with lock ambiguity
                    controller.sendMessage(conn, strings.ambigSet);
                } else {
                    // no matching locks were found
                    controller.sendMessage(conn, strings.lockUnknown);
                }
            }, true, true);
        }
    }),

    "@unlock": CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            // checks the right number of arguments were given
            if (argsArr.length === 1) {
                cb(conn, argsArr[0]);
            } else {
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, objectName) {
            const player = controller.findActivePlayerByConnection(conn);
            /* find objects with the given name in the players current
			   room or inventory*/
            let where = {
                    [db.Sequelize.Op.and]: [
                        { name: objectName },
                        { [db.Sequelize.Op.or]: [{ locationId: player.locationId }, { locationId: player.id }] }
                    ]
            };

            controller.loadMUDObjects(conn, where, function (objectArr) {

                if (objectArr.length === 1) {
                    const object = objectArr[0];
                    // if object is found, remove it's lock
                    if (object.ownerId === player.id) {
                        object.keyId = null;
                        object.save();
                        controller.sendMessage(conn, strings.unlocked);
                    } else {
                        // not owner of the object
                        controller.sendMessage(conn, strings.permissionDenied);
                    }
                } else if (objectArr.length > 1) {
                    // ambiguous request...
                    controller.sendMessage(conn, strings.ambigSet);
                } else {
                    // object not found
                    controller.sendMessage(conn, strings.unlockUnknown);
                }
            });
        }
    }),

    "@dig": CommandHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            // checks the right number of arguments were given
            if (argsArr.length === 1) {
                // checks name of 'ROOM' being created is valid
                if (predicates.isNameValid(argsArr[0])) {
                    // is valid, continue...
                    cb(conn, argsArr);
                } else {
                    // not valid, error message...
                    controller.sendMessage(conn, strings.invalidName);
                }
            } else {
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, argsArr) {
            const player = controller.findActivePlayerByConnection(conn);
            // creates a new 'ROOM'
            controller.createMUDObject(conn,
                {
                    name: argsArr[0],
                    type: 'ROOM',
                    ownerId: player.id

                }, function (room) {
                    // once room is created, print message
                    controller.sendMessage(conn, strings.roomCreated, room);
                });
        }
    }),


    "@open": PropertyHandler.extend({
        nargs: 1,
        validate: function (conn, argsArr, cb) {
            if (argsArr.length === 1) {
                // checks to see if the 'EXIT' name is valid
                if (predicates.isNameValid(argsArr[0])) {
                    cb(conn, argsArr);
                } else {
                    // invalid name
                    controller.sendMessage(conn, strings.invalidName);
                }
            } else {
                // unknown command
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function (conn, argsArr) {
            const player = controller.findActivePlayerByConnection(conn);

            // find player's location
            player.getLocation().then(playerLocation => {
                if (playerLocation.ownerId === player.id) {
                    //create exit
                    controller.createMUDObject(conn,
                        {
                            name: argsArr[0],
                            type: 'EXIT',
                            locationId: playerLocation.id,
                            ownerId: player.id

                        }, function (exit) {
                            // inform user that the exit has been opened 
                            controller.sendMessage(conn, strings.opened);
                        });
                } else {
                    // not owner of the room, can't open an exit
                    controller.sendMessage(conn, strings.permissionDenied);
                }
            });
        }
    })
};

//command aliases
commands.login = commands.connect
commands.who = commands.WHO;
commands.help = commands.HELP,
commands.goto = commands.go;
commands.move = commands.go;
commands.cr = commands.create;
commands.co = commands.connect;
commands.throw = commands.drop;
commands.take = commands.get;
commands.read = commands.look;
commands["@fail"] = commands["@failure"];
commands["@ofail"] = commands["@ofailure"];

//The commands object is exported publicly by the module
module.exports = commands;