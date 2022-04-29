// these are actions used specifically for game calls
"use strict";
const {
    successfullResponse,
    sendMessageToOne,
    sendMessageToAllInSession,
    createGameState,
    getGameState,
    updateGameState,
    startGame,
    updateConnectionWithSession,
    chooseTeam,
    vote,
    conductMission,
} = require("./helpers");

require("aws-sdk/clients/apigatewaymanagementapi");

module.exports.getGameStateHandler = async (event) => {
    try {
        const body = JSON.parse(event.body);
        const sessionId = body.sessionId;
        let gameState = await getGameState(sessionId);

        // tells the app to rerender when you get the game state
        gameState.rerender = true;
        const message = JSON.stringify(gameState, "", 2);

        // send gameState to every client connected
        await sendMessageToAllInSession(
            sessionId,
            message,
            event.requestContext
        );
        return successfullResponse;
    } catch (error) {
        console.log(error);
        return {
            statusCode: 500,
            error: error.message,
        };
    }
};

// is a LAMBDA called by the console and adds its connection ID
module.exports.createGameStateHandler = async (event) => {
    try {
        const body = JSON.parse(event.body);
        const sessionId = body.sessionId;
        const playerName = body.playerName;
        const connectionId = event.requestContext.connectionId;

        let gameState = await createGameState(
            sessionId,
            connectionId,
            playerName
        );

        // add the consoles connection id as console ID
        gameState.consoleId = connectionId;

        // tells the app to rerender when you get the game state
        gameState.rerender = true;

        const message = JSON.stringify(gameState, "", 2);

        // send created game state back to the console client connected
        await sendMessageToOne(message, event.requestContext, connectionId);
        return successfullResponse;
    } catch (error) {
        console.log(error);
        return {
            statusCode: 500,
            error: error.message,
        };
    }
};

module.exports.addPlayerHandler = async (event) => {
    try {
        const body = JSON.parse(event.body);
        const sessionId = body.sessionId;
        const connectionId = event.requestContext.connectionId;
        let playerName = body.playerName.toUpperCase();
        let forceAdd = false;

        // dont allow white space usernames
        if (playerName.trim().length === 0) {
            throw {
                statusCode: 401,
                body: "Player already in game.",
            };
        }

        if (playerName.startsWith("*")) {
            playerName = playerName.substring(1);
            forceAdd = true;
        }

        // update chatID table to include sessionID
        await updateConnectionWithSession(connectionId, sessionId);

        let gameState = await getGameState(sessionId);
        let { players } = gameState;
        let playerExists = false;

        // iterate through list of existing players
        for (let p of players) {
            // playerNames.push(p.name);
            // if player already exists
            if (p.name.toUpperCase() == playerName) {
                playerExists = true;

                if (p.connectionId != null && !forceAdd) {
                    // if player is already connected, dont let player connect to it
                    return {
                        statusCode: 401,
                        body: "Player already in game.",
                    };
                }
                p.connectionId = connectionId;
            }
        }

        // if player doesnt already exist, add to list
        if (!playerExists) {
            if (gameState.allPlayersJoined) {
                return {
                    statusCode: 401,
                    body: "Game has already started",
                };
            }

            if (players.length < 10) {
                // add player to list
                let player = {
                    name: playerName,
                    connectionId,
                };

                gameState.players.push(player);
            }
        }

        // update table in db
        await updateGameState(gameState);

        // tells the app to rerender when you get the game state
        gameState.rerender = true;
        const message = JSON.stringify(gameState, "", 2);

        // send gameState to every client connected
        await sendMessageToAllInSession(
            sessionId,
            message,
            event.requestContext
        );
        return successfullResponse;
    } catch (error) {
        console.log(error);
        return {
            statusCode: 500,
            error: error.message,
        };
    }
};

module.exports.startGameHandler = async (event) => {
    try {
        const body = JSON.parse(event.body);
        const sessionId = body.sessionId;

        let gameState = await getGameState(sessionId);

        // can only start game if > 5 players
        if (gameState.players.length < 5) {
            return {
                statusCode: 400,
                body: "Needs at least 5 players to play",
            };
        }

        gameState = await startGame(gameState, event);

        // update table in db
        await updateGameState(gameState);

        // tells the app to rerender when you get the game state
        gameState.rerender = true;
        const message = JSON.stringify(gameState, "", 2);

        // send gameState to every client connected
        await sendMessageToAllInSession(
            sessionId,
            message,
            event.requestContext
        );
        return successfullResponse;
    } catch (error) {
        console.log(error);
        return {
            statusCode: 500,
            error: error.message,
        };
    }
};

module.exports.chooseTeamHandler = async (event) => {
    try {
        const body = JSON.parse(event.body);
        const { sessionId, team } = body;

        let gameState = await getGameState(sessionId);

        gameState = await chooseTeam(gameState, team);

        // update table in db
        await updateGameState(gameState);

        // tells the app to rerender when you get the game state
        gameState.rerender = true;
        const message = JSON.stringify(gameState, "", 2);

        // send gameState to every client connected
        await sendMessageToAllInSession(
            sessionId,
            message,
            event.requestContext
        );
        return successfullResponse;
    } catch (error) {
        console.log(error);
        return {
            statusCode: 500,
            error: error.message,
        };
    }
};

module.exports.voteHandler = async (event) => {
    try {
        const body = JSON.parse(event.body);
        const { sessionId, playerName, approve } = body;

        let gameState = await getGameState(sessionId);

        gameState = await vote(gameState, approve, playerName, event);

        // update table in db
        await updateGameState(gameState);

        // tells the app to rerender when you get the game state
        gameState.rerender = true;
        const message = JSON.stringify(gameState, "", 2);

        // send gameState to every client connected
        await sendMessageToAllInSession(
            sessionId,
            message,
            event.requestContext
        );
        return successfullResponse;
    } catch (error) {
        console.log(error);
        return {
            statusCode: 500,
            error: error.message,
        };
    }
};

module.exports.conductMissionHandler = async (event) => {
    try {
        const body = JSON.parse(event.body);
        const { sessionId, playerName, success } = body;

        let gameState = await getGameState(sessionId);

        gameState = await conductMission(gameState, success, playerName, event);

        // update table in db
        await updateGameState(gameState);

        // tells the app to rerender when you get the game state
        gameState.rerender = true;
        const message = JSON.stringify(gameState, "", 2);

        // send gameState to every client connected
        await sendMessageToAllInSession(
            sessionId,
            message,
            event.requestContext
        );
        return successfullResponse;
    } catch (error) {
        console.log(error);
        return {
            statusCode: 500,
            error: error.message,
        };
    }
};
