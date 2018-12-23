
const db = require('../models');
 
module.exports = {

    // Test if the password is valid
	isPasswordValid: function(str) {
		return /[!-~]+/.test(str);
	},

    // Test if username is valid
	isUsernameValid: function(str) {
		return /[!-~^=]+/.test(str) && str.indexOf('=') === -1;
	},

    // Test if object name is valid
	isNameValid: function(str) {
		return /[ -~]+/.test(str);
	},
	
	// Test if a player can `@link` a specific room
    isLinkable: function (room, player) {
        // if owner of room can link, otherwise check for link_ok flag
        return (room.ownerId === player.id) ? true : (room.canLink()) ? true : false; 
    },

	// Test if a player can see a specific thing (used for `look`)
	canSee: function(player, thing) {
        return (thing.type === 'EXIT' || thing.id === player.id) ? false : true; 
    },

	/**
	 * Test if a player do a specific thing (`go` or `take` something or `look` at a room),
	 * calling a callback function with the result. The relevant success and failure 
	 * messages will be sent to the other players in the same room automatically.
	 * @param player the player
	 * @param room the thing
	 * @param callback the callback function to call; takes a single 
	 *			boolean argument, which is true if the player can do 
	 *			the thing and false otherwise.
	 * @param defaultFailureMessage the message to show on failure to do the thing.
	 */
    canDoIt: function (controller, player, thing, callback, defaultFailureMessage) {
        // find player by connection
		const playerConn = controller.findActiveConnectionByPlayer(player);

        // no connection
		if (!playerConn) {
			if (callback) callback(false);
            return;
		}

        couldDoIt(player, thing, function (doit) {

            // can't do it... call failure messages if set, else defaults
			if (!doit) {
				if (thing.failureMessage) {
					controller.sendMessage(playerConn, thing.failureMessage);
				} else if (defaultFailureMessage) {
					controller.sendMessage(playerConn, defaultFailureMessage);
				}

                // broadcast failure message to others
				if (thing.othersFailureMessage) {
					controller.sendMessageRoomExcept(playerConn, player.name + " " + thing.othersFailureMessage);
                }

            // can do it, call success messages if set
			} else {
				if (thing.successMessage) {
					controller.sendMessage(playerConn, thing.successMessage);
				}

                // broadcast success message
				if (thing.othersSuccessMessage) {
					controller.sendMessageRoomExcept(playerConn, player.name + " " + thing.othersSuccessMessage);
				}
			}

            // if cb was given, call it with boolean from couldDoIt cb
			if (callback)
				callback(doit);
		});
	},

    // Test whether all of the given array of target `MUDObject`s have the same name
	sameName: function(ftargets) {
		if (ftargets.length <= 1) return true;

		const name = ftargets[0].name;

		for (let i=1; i<ftargets.length; i++) {
			if (name !== ftargets[i].name) 
				return false;
		}

		return true;
	}
};


//private functions

// Test whether a player could potentially do something to some thing.
function couldDoIt(player, thing, callback) {
	if(thing.type !== 'ROOM' && !thing.locationId) {
		callback(false);
		return;
	}

	//can't use an unlinked exit
	if(thing.type === 'EXIT' && thing.targetId===null) {
		callback(false);
		return;
	}

	//no key, so can do it
	const keyId = thing.keyId;
    if(!keyId) {
    	callback(true);
    	return;
    }

    //player is the key... can do it
    // only if the thing does not have an anti lock
    if (player.id === keyId) {
		callback(!thing.hasAntiLock());
		return;
    }

    // try to find an object the player is holding that is the key
    // to the thing the player is trying to 'do'
    let where = {
        [db.Sequelize.Op.and]: [
            {locationId: player.id},
            {id: keyId}
        ]
    }

    // if the player is holding the key, the player can do it as long
    // as the thing does not have the anti_lock flag set
    db.MUDObject.findOne({ where: where }).then(obj => {
		if (obj) callback(!thing.hasAntiLock());
		else callback(thing.hasAntiLock());
	});
}
