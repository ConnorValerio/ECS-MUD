# ECS-MUD	Author: Connor Valerio
--------------------------------------------------------------------------
Info
-----

ECS-MUD is a text-based, multi-user dungeon game created as part of an assignment for a university module.
It is a node.js project, incorporating a number of different modules, see package.json for npm dependencies.
Note: Some code was provided as a skeleton by Jonathon Hare (jsh2@ecs.soton.ac.uk). Some of which has been
refactored and added to, since. This app has been deployed to Heroku:

https://valerio-ecs-mud.herokuapp.com/

--------------------------------------------------------------------------
Files
-----
Data folder:
contains initial .json file to load in default game objects

Models folder:
contains initialising code for Sequelize (index.js) and the MUDObject model used to represent
each and every game object (PLAYER, THING, EXIT, ROOM)

Public folder:
contains css/fonts/js folders, holding jquery files to allow the imitation of a terminal

Scripts folder:
contains majority of server side javascript files
-> CommandHandler: object extended by each command
-> CommandHelper: holds two objecs, 'commands' and 'properties' - both holding game commands, their names, descriptions and usages
-> Commands: Implementation of all game commands that are available to players
-> Controller: Handles all communication between client/server and server/database
-> Predicates: contains functions that return booleans for important decisions when implementing the commands
-> PropertyHandler: Similar to CommandHandler, but only extended by commands that set properties of MUDObjects
-> Strings.js: A list of string templates that are sent by the controller from the server, to the view 

Views folder:
contains a .JADE html template that represents the terminal the client sees

The entry point for the application is server.js, this is where the server is initialised. This includes the express routes,
static files, websockets and their events and the controller.

--------------------------------------------------------------------------


