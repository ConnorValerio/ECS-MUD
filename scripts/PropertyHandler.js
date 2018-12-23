const Str = require('string');
const strings = require('./Strings');
const CommandHandler = require('./CommandHandler');
const controller = require('./Controller');
const predicates = require('./Predicates');

//PropertyHandler extends CommandHandler
const PropertyHandler = CommandHandler.extend({
	//and adds a property called prop
	prop: undefined,
	//always a single argument
	nargs: 1,
	//validate just checks there really is just a single argument
	validate: function(conn, argsArr, cb) {
		if (argsArr.length === 1)
			cb.apply(this, [conn, argsArr]);
		else
			controller.sendMessage(conn, strings.unknownCommand);
	},
	//perform splits the argument by "=" into a target object
	//and value to set (which could be empty), then
	//calls #updateProperty
	perform: function(conn, argsArr) {
		let index = argsArr[0].indexOf("=");
		index = (index === -1) ? argsArr[0].length : index;
		let targetName = argsArr[0].substring(0, index).trim();
		let value = argsArr[0].substring(index + 1).trim()

		updateProperty(conn, targetName, this.prop, value);
	}
});

//export the PropertyHandler
module.exports = PropertyHandler;

//Private methods below
 
 /**
  * (private)
  * Updates a property of a MUDObject, checking for correct ownership
  * and non-ambiguous naming
  */
function updatePropertyInternal(conn, targets, propertyName, value) {
	var me = controller.findActivePlayerByConnection(conn);

	if (!Array.isArray(targets)) 
		targets = [targets];

	var ftargets = targets.filter(function(obj) {
		return obj.ownerId === me.id;
	});

	if (ftargets.length === 0) {
		//nothing that belongs to you
		controller.sendMessage(conn, strings.permissionDenied);
	} else if (ftargets.length>1 && predicates.sameName(ftargets)) {
		controller.sendMessage(conn, strings.ambigSet);
	} else {
		var target = ftargets[0];

		target[propertyName] = value;
		target.save().then(obj => {
			controller.sendMessage(conn, strings.set, {property: Str(strings[propertyName]).capitalize().s});
		});
	}
}

/**
 * (private)
 * Updates a property of a MUDObject, checking for correct ownership
 * and non-ambiguous naming
 */
function updateProperty(conn, targetName, propertyName, value) {
	controller.findPotentialMUDObjects(conn, targetName, function(objs) {
		updatePropertyInternal(conn, objs, propertyName, value);
	}, true, true);
}

