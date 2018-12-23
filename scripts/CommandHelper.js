// Help commands

const commands = {
    create: {
        name: 'create',
        description: 'creates a new user',
        usage: '[create|cr] <username> <password>',
    },

    connect: {
        name: 'connect',
        description: 'login as a user',
        usage: '[connect|co|login] <username> <password>',
    },

    QUIT: {
        name: 'QUIT',
        description: 'logout',
        usage: 'QUIT|quit',
    },

    WHO: {
        name: 'WHO',
        description: 'see who is currently online',
        usage: 'WHO|who',
    },

    HELP: {
        name: 'HELP',
        description: 'shows a list of commands',
        usage: 'HELP|help [-p|-c]',
    },

    say: {
        name: 'say',
        description: 'speak to players in the room',
        usage: 'say <phrase>',
    },

    go: {
        name: 'go',
        description: 'used to leave through an exit, or to go home!',
        usage: '[go | goto | move] <exit name> [exit, home]',
    },

    look: {
        name: 'look',
        description: 'used to look at game objects, yourself, or the room you\'re in',
        usage: '[look | read] <Anything in the room> [object, me, here]' ,
    },

    drop: {
        name: 'drop',
        description: 'drop an object in your inventory',
        usage: '[drop | throw] <object name>',
    },

    examine: {
        name: 'examine',
        description: 'examine an object, yourself, or the room you\'re in.',
        usage: 'examine <Anything you own | the room you\'re in> [object, room, me, here]',
    },

    get: {
        name: 'get',
        description: 'take an object in the room',
        usage: '[get | take] <object name> ',
    },

    inventory: {
        name: 'inventory',
        description: 'show contents of your inventory',
        usage: 'inventory',
    },

    page: {
        name: 'page',
        description: 'tell friend you are looking for them',
        usage: 'page <username>',
    },

    whisper: {
        name: 'whisper',
        description: 'say something, but to one person, quietly...',
        usage: 'whisper <username>=<message>',
    }
};

/* Help property commands */
const properties = {

    create: {
        name: '@create',
        description: 'create a new object',
        usage: '@create <object name>',
    },

    set: {
        name: '@set',
        description: 'set the flag of an object',
        usage: '@set <object>=<flag name> [link_ok, anti_lock, temple]',
    },

    password: {
        name: '@password',
        description: 'change your password',
        usage: '@password <old>=<new>',
    },

    dig: {
        name: '@dig',
        description: 'create a new room',
        usage: '@dig <room name>',
    },

    open: {
        name: '@open',
        description: 'open a new  exit in a room',
        usage: '@open <exit name>',
    },

    link: {
        name: '@link',
        description: 'link two objects together',
        usage: '@link <object>=<object>',
    },

    unlink: {
        name: '@unlink',
        description: 'unlink two objects',
        usage: '@unlink <object>',
    },

    lock: {
        name: '@lock',
        description: 'create lock for an object',
        usage: '@lock <object>=<key>',
    },

    unlock: {
        name: '@unlock',
        description: 'removes lock from an object',
        usage: '@unlock <object>',
    },

    name: {
        name: '@name',
        description: 'set name of an object',
        usage: '@name <object>=<name>',
    },

    describe: {
        name: '@describe',
        description: 'Set an objects description.',
        usage: '@describe <object>=<description>',
    },

    success: {
        name: '@success',
        description: 'Set an objects success msg.',
        usage: '@success <object>=<msg>',
    },

    osuccess: {
        name: '@osuccess',
        description: 'Set an objects osuccess msg.',
        usage: '@osuccess <object>=<msg>',
    },


    failure: {
        name: '@failure',
        description: 'Set an objects failure msg.',
        usage: '[@failure | @fail] <object>=<msg>',
    },

    ofailure: {
        name: '@ofailure',
        description: 'Set an objects ofailure msg.',
        usage: '[@ofailure | @ofail] <object>=<msg>',
    },

    find: {
        name: '@find',
        description: 'Find all the objects you are the owner of',
        usage: '@find <partialobjectname>',
    },

    path: {
        name: '@path',
        description: 'find the path to a room',
        usage: '@path <username>',
    },


};

module.exports.commands = commands;
module.exports.properties = properties;