// @ts-check
/* Entry Point for Node.js application */

const http = require('http');
const express = require('express');
const ws = require('ws');
const controller = require('./scripts/Controller');
const db = require('./models');

//configure ports, automatically choosing between the Heroku port and development port
const port = process.env.PORT || 1337;

/* configure db, without it the app should exit */
db.sequelize.sync().then(function () {
    initApp();
}, function (err) {
    throw err[0];
});

// set up the app
function initApp() {

    // init controller
    controller.init();

    const app = express();

    /* Express routing / only route for the app */
    app.get("/", function (req, res) {
        res.render("index.jade", {})
    });

    /* Express static files */
    app.use('/static', express.static(__dirname + '/public'));

    /* Create http server with express as request listener */
    const server = http.createServer(app)
    server.listen(port);

    /* Set up web sockets */
    const wss = new ws.Server({
        server: server,
        path: "/ws"
    });

    /* Set up web socket server events*/
    /* New connection: */
    wss.on("connection", function (conn) {
        controller.displaySplashScreen(conn);   

        // ping client every 10 seconds - Heroku connection will drop otherwise
        let id = setInterval(function () {
            try {
                conn.ping();
            } catch (e) {
                clearInterval(id); /* connection dead */
            }
        }, 10000);

        /* Set up connection events within the socket */
        /* on receiving a message from a connection */
        conn.on("message", function (message) {
            controller.handleMessage(conn, message);
        });

        /* on a connection being closed */
        conn.on("close", function () {
            controller.deactivatePlayer(conn);
        });
    })
}
