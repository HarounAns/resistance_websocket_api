
const AWS = require('aws-sdk');
let dynamo = new AWS.DynamoDB.DocumentClient();

require('aws-sdk/clients/apigatewaymanagementapi');
const CHATCONNECTION_TABLE = 'ResistanceChatIdTable';
const GAME_STATE_TABLE = 'ResistanceGameStateTable';

// this function will send the event post body back to every connected device 
const sendMessageToAllConnected = async (message, requestContext) => {
    const connections = await getConnectionIds();

    return Promise.all(
        connections.map(async connection => {
            await send(message, requestContext, connection.connectionId);
        })
    );
}

const getConnectionIds = async () => {
    const params = {
        TableName: CHATCONNECTION_TABLE,
        ProjectionExpression: 'connectionId'
    };

    const res = await dynamo.scan(params).promise();

    return res.Items;
}

// this function will send the event post body back to every connected device 
const sendMessageToAllInSession = async (sessionId, message, requestContext) => {
    // TEMPORARY FIX, SWITCH BACK
    const connectionIds = await getConnectionIdsInSession(sessionId);

    return Promise.all(
        connectionIds.map(async connectionId => {
            await send(message, requestContext, connectionId);
        })
    );

    // await sendMessageToAllConnected(message, requestContext);
}

// goes to game state table and gets all connection ids from player and consoles connection id
const getConnectionIdsInSession = async sessionId => {
    let connections = [];
    let gameState = await getGameState(sessionId);

    // add the console Id if it exists
    if (gameState.consoleId) {
        connections.push(gameState.consoleId);
    }

    for (let player of gameState.players) {
        if (player.connectionId) {
            connections.push(player.connectionId);
        }
    }

    return connections;
}

// same as send function but encapsualted for ease of use
const sendMessageToOne = async (message, requestContext, connectionId) => {
    await send(message, requestContext, connectionId);
};

const send = (message, requestContext, connectionId) => {
    const endpoint = requestContext.domainName + "/" + requestContext.stage;

    const apigwManagementApi = new AWS.ApiGatewayManagementApi({
        apiVersion: "2018-11-29",
        endpoint: endpoint
    });

    const params = {
        ConnectionId: connectionId,
        Data: message
    };

    return apigwManagementApi.postToConnection(params).promise();
};


const addConnection = connectionId => {
    console.log('addConnection connectionId', connectionId)
    const params = {
        TableName: CHATCONNECTION_TABLE,
        Item: {
            connectionId: connectionId
        }
    };

    return dynamo.put(params).promise();
};

const deleteConnection = async (requestContext) => {
    console.log('requestContext', requestContext);
    const { connectionId } = requestContext;

    // get sessionId by connectionId
    let params = {
        TableName: CHATCONNECTION_TABLE,
        Key: {
            connectionId
        }
    };

    const res = await dynamo.get(params).promise();
    console.log(res.Item);

    const { sessionId } = res.Item;

    // get game state from the sessionId
    if (sessionId) {
        let gameState = await getGameState(sessionId);

        // try to remove the connectionId from the game state
        // and set connection id to null if it disconnects
        if (gameState.consoleId == connectionId) {
            gameState.consoleId = null;
        }

        // remove it if its a phone connection as well
        for (let player of gameState.players) {
            if (player.connectionId == connectionId) {
                player.connectionId = null;
            }
        }

        gameState.rerender = true;

        // update the gamestate
        await updateGameState(gameState);

        // send a message to every client still connected with the new message
        const message = JSON.stringify(gameState, '', 2);
        await sendMessageToAllInSession(sessionId, message, requestContext);
    }

    // disconnect by deleting from the chat connection table
    console.log('disconnecting ' + connectionId);
    return dynamo.delete(params).promise();
};

const updateConnectionWithSession = async (connectionId, sessionId) => {
    // send a message to every client still connected with the new message
    const params = {
        TableName: CHATCONNECTION_TABLE,
        Key: {
            connectionId: connectionId
        },
        Item: {
            connectionId,
            sessionId
        }
    };
    await dynamo.put(params).promise();
}

// GameState

// buildTeamState: is when the discussion occurs and the captain choooses who is on the team. Once he clicks the vote button we enter the voteState 
// voteState: all players choose whether or not the proposed team goes on the mission. If rejected go back to buildTeam state with a new Captain and increment failedVote counter
//              if approved go to conductMissionState
// conductMissionState: the players chosen for the mission select if the mission succeeds or fails. If the game is over it transitions you to the gameOverState. Otherwise it
//              sends you back to the buildTeamState with a new Captain
// gameOverState: tells which team won. If user clicks new game it restarts the game with a new sessionId putting you back to buildTeamState
const emptyStateMachine = {
    buildTeamState: {},
    voteState: {},
    conductMissionState: {},
    gameOverState: {}
}

const createGameState = async (sessionId, connectionId, name) => {
    const gameState = {
        sessionId,
        currentPlayerIndex: 0, // determines who the captain is
        players: [{ name, connectionId }],
        spies: [],
        resistance: [],
        allPlayersJoined: false,
        stateMachine: emptyStateMachine
    };
    const params = {
        TableName: GAME_STATE_TABLE,
        Item: gameState
    };

    await dynamo.put(params).promise();
    return gameState;
};

const getGameState = async (sessionId) => {
    // get game state
    const params = {
        TableName: GAME_STATE_TABLE,
        Key: {
            'sessionId': sessionId
        }
    };

    const res = await dynamo.get(params).promise();
    return res.Item;
}

const updateGameState = async gameState => {
    // update table in db
    const params = {
        TableName: GAME_STATE_TABLE,
        Item: gameState
    };

    await dynamo.put(params).promise();
}

// this mapping determines number of resistance and spies based on players playing
// { numPlayers: [numResistance, numSpies] }
const playerMapping = {
    5: [3, 2],
    6: [4, 2],
    7: [4, 3],
    8: [5, 3],
    9: [6, 3],
    10: [6, 4]
}

// this mapping determines how many people are required to go on a mission based on the number of players in the game
// { numPlayers: [numPlayers in Mission 1, numPlayers in Mission 2, etc] }
const missionMapping = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5]
}

const startGame = gameState => {
    const numPlayers = gameState.players.length;

    // all players joined is true to start the game
    gameState.allPlayersJoined = true;
    gameState.numPlayers = numPlayers;

    // make the player who starts the game as captain to be random
    gameState.currentPlayerIndex = Math.floor(Math.random() * numPlayers);

    // randomly pick resistance and spies
    let cardList = [];
    let [numResistance, numSpies] = playerMapping[numPlayers];
    while (numSpies) {
        cardList.push('s');
        numSpies--;
    }
    while (numResistance) {
        cardList.push('r');
        numResistance--;
    }
    shuffle(cardList);

    let resistance = [];
    let spies = [];
    for (let i in gameState.players) {
        if (cardList[i] === 'r') {
            gameState.players[i].isSpy = false;
            resistance.push(gameState.players[i].name);
        }
        else if (cardList[i] === 's') {
            gameState.players[i].isSpy = true;
            spies.push(gameState.players[i].name);
        }
    }
    gameState.resistance = resistance;
    gameState.spies = spies;

    // set board 
    gameState.board = missionMapping[numPlayers];

    return gameState
}

const successfullResponse = {
    statusCode: 200,
    body: 'everything is alright'
};

const shuffle = array => {
    array.sort(() => Math.random() - 0.5);
}

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': true,
}

const helpers = {
    addConnection,
    createGameState,
    startGame,
    deleteConnection,
    emptyStateMachine,
    getConnectionIds,
    getGameState,
    headers,
    send,
    sendMessageToAllConnected,
    sendMessageToAllInSession,
    sendMessageToOne,
    shuffle,
    successfullResponse,
    updateGameState,
    updateConnectionWithSession
}

module.exports = helpers;