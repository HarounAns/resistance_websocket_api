
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
            try {
                await send(message, requestContext, connection.connectionId);
            } catch (error) {
                console.error('CAUGHT: ', error)
            }
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
            try {
                await send(message, requestContext, connectionId);
            } catch (error) {
                console.error('CAUGHT: ', error);
            }
        })
    );
}

// goes to game state table and gets all connection ids from player and consoles connection id
const getConnectionIdsInSession = async sessionId => {
    let connections = [];
    let gameState = await getGameState(sessionId);

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

const nextPlayer = gameState => {
    gameState.currentPlayerIndex++;
    if (gameState.currentPlayerIndex > gameState.numPlayers - 1) {
        gameState.currentPlayerIndex = 0;
    }
    return gameState;
}

const createGameState = async (sessionId, connectionId, name) => {
    const gameState = {
        sessionId,
        currentPlayerIndex: 0, // determines who the captain is
        failedVoteCounter: 0,
        players: [{ name, connectionId }],
        spies: [],
        resistance: [],
        missions: [null, null, null, null, null], // stores the outcome of the missions
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

const getPlayerNamesList = gameState => {
    const { players } = gameState;

    let list = [];
    for (let player of players) {
        list.push(player.name);
    }
    return list;
}

const startGame = async (gameState, event) => {
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

    // turns will be 0 to 4
    gameState.turn = 0;

    // put in reveal state for five seconds
    const showRevealGameState = await showRevealState(gameState);

    // send a response
    await sendMessageToAllInSession(gameState.sessionId, showRevealGameState, event.requestContext);
    await sleep(5000);


    // game starts off in buildTeamState
    gameState.stateMachine.buildTeamState.currentState = true;
    gameState.stateMachine.currentState = 'buildTeamState';

    return gameState
}

const showRevealState = async gameState => {
    const stateMachine = {
        currentState: 'revealState',
        buildTeamState: {},
        voteState: {},
        conductMissionState: {},
        showVoteResultsState: {},
        gameOverState: {}
    }
    const copy = { ...gameState };
    copy.stateMachine = stateMachine;

    // update table in db
    await updateGameState(copy);

    // tells the app to rerender when you get the game state
    copy.rerender = true;
    const message = JSON.stringify(copy, '', 2);
    return message;
}

const chooseTeam = (gameState, team) => {
    // check between length of team and expected numPlayers on team
    const { numPlayers, turn } = gameState;
    const numPlayersOnTeam = missionMapping[numPlayers][turn];

    if (numPlayersOnTeam !== team.length) {
        console.log('Invalid team: ', team);
        throw `Invalid Team. Team should have ${numPlayersOnTeam} players. It has ${team.length} players.`;
    }

    const playersList = getPlayerNamesList(gameState);

    let votes = {};
    for (let name of playersList) {
        votes[name] = null;
    }

    const stateMachine = {
        currentState: 'voteState',
        buildTeamState: {},
        voteState: {
            currentState: true,
            team,
            votes
        },
        conductMissionState: {},
        gameOverState: {}
    }

    gameState.stateMachine = stateMachine;
    return gameState;
}

/**
 * resets failed vote counter
 * clears vote state
 * sets conductMission state to true
 * sets mission based on team for conduct mission object
 * @param {Object} gameState 
 */
const approveTeam = gameState => {
    // resets failed vote counter
    gameState.failedVoteCounter = 0;

    // create copy of team and add to conduct mission state to store the mission results
    const cpTeam = [...gameState.stateMachine.voteState.team];

    let mission = {};
    for (let name of cpTeam) {
        mission[name] = null;
    }

    const stateMachine = {
        currentState: 'conductMissionState',
        buildTeamState: {},
        voteState: {}, // clears vote state
        conductMissionState: {
            currentState: true,
            mission // sets mission based on team for conduct mission object
        },
        gameOverState: {}
    }

    gameState.stateMachine = stateMachine;
    console.log('approveTeam', gameState);
    return gameState;
}

/**
 * increments failed vote counter
 * increments currentPlayerIndex to get new Captain
 * clears vote state
 * sets buildTeam state to true
 * @param {Object} gameState 
 */
const rejectTeam = gameState => {
    // increments failed vote counter
    gameState.failedVoteCounter++;

    // next captain
    gameState = nextPlayer(gameState);

    const stateMachine = {
        currentState: 'buildTeamState',
        buildTeamState: { currentState: true },
        voteState: {}, // clears vote state
        conductMissionState: {},
        gameOverState: {}
    }

    gameState.stateMachine = stateMachine;
    console.log('rejectTeam', gameState);
    return gameState;
}

/**
 * update the players vote in the votes section
 * if all players have voted determine if it was a success or not
 * if it is call approveTeam
 * other wise call reject team
 * @param {Object} gameState 
 * @param {Boolean} approve 
 * @param {String} playerName 
 */
const vote = async (gameState, approve, playerName, event) => {
    const vote = approve ? 'A' : 'R';
    let { votes } = gameState.stateMachine.voteState;
    votes[playerName] = vote;

    let allPlayersVoted = true;
    let numApproves = 0;
    let numRejects = 0;
    for (let player in votes) {
        if (!votes[player]) {
            allPlayersVoted = false;
            break;
        }
        if (votes[player] == 'A') {
            numApproves++;
        }
        else if (votes[player] == 'R') {
            numRejects++;
        }
    }

    gameState.stateMachine.voteState.allPlayersVoted = allPlayersVoted;
    if (!allPlayersVoted) {
        return gameState;
    }

    const showVoteGameState = await showVoteState(gameState, votes);

    // send a response
    await sendMessageToAllInSession(gameState.sessionId, showVoteGameState, event.requestContext);
    await sleep(5000);

    // all players have voted, check if successful or not
    const successfulTeam = numApproves > numRejects;

    if (successfulTeam) {
        return approveTeam(gameState);
    }

    return rejectTeam(gameState);
}

const showVoteState = async (gameState, votes) => {
    const stateMachine = {
        currentState: 'showVoteResultsState',
        buildTeamState: {},
        voteState: {}, // clears vote state
        conductMissionState: {},
        showVoteResultsState: {
            votes
        },
        gameOverState: {}
    }
    const copy = { ...gameState };
    copy.stateMachine = stateMachine;

    // update table in db
    await updateGameState(copy);

    // tells the app to rerender when you get the game state
    copy.rerender = true;
    const message = JSON.stringify(copy, '', 2);
    return message;
}

const isMissionSuccessful = (gameState, numFails) => {
    // if turn = 4 and numPlayers >= 7, you need 2 fails
    const { turn, numPlayers } = gameState;
    if (turn == 4 && numPlayers >= 7) {
        return numFails < 2;
    }
    return numFails == 0;
}

const hasResistanceWon = missions => {
    let numSuccess = 0;

    for (let player in missions) {
        if (missions[player] == 'S') {
            numSuccess++;
        }
    }

    return numSuccess >= 3;
}

const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const haveSpiesWon = missions => {
    let numFails = 0;

    for (let player in missions) {
        if (missions[player] == 'F') {
            numFails++;
        }
    }

    return numFails >= 3;
}

const resistanceWins = gameState => {
    gameState.winner = 'RESISTANCE';

    const stateMachine = {
        currentState: 'gameOverState',
        buildTeamState: {},
        voteState: {},
        conductMissionState: {},
        gameOverState: {
            currentState: true,
        }
    }

    gameState.stateMachine = stateMachine;
    return gameState;
}

const spiesWin = gameState => {
    gameState.winner = 'SPIES';

    const stateMachine = {
        currentState: 'gameOverState',
        buildTeamState: {},
        voteState: {},
        conductMissionState: {},
        gameOverState: {
            currentState: true,
        }
    }

    gameState.stateMachine = stateMachine;
    return gameState;
}

/**
 * Increment turn counter
 * Increment currentPlayerIndex
 * Send to build team state
 * @param {Object} gameState 
 */
const nextTurn = gameState => {
    // next turn 
    gameState.turn++;

    // next captain
    gameState = nextPlayer(gameState);

    // send to build team state
    const stateMachine = {
        currentState: 'buildTeamState',
        buildTeamState: { currentState: true },
        voteState: {}, // clears vote state
        conductMissionState: {},
        gameOverState: {}
    }

    gameState.stateMachine = stateMachine;
    return gameState;
}

/**
 * update the players vote in the votes section
 * if all players have voted determine if it was a success or not
 * if it is call approveTeam
 * other wise call reject team
 * @param {Object} gameState 
 * @param {Boolean} approve 
 * @param {String} playerName 
 */
const conductMission = async (gameState, success, playerName, event) => {
    const code = success ? 'S' : 'F';
    let { mission } = gameState.stateMachine.conductMissionState;
    mission[playerName] = code;

    let allPlayersDone = true;
    let numFails = 0;
    for (let player in mission) {
        if (!mission[player]) {
            allPlayersDone = false;
            break;
        }

        if (mission[player] == 'F') {
            numFails++;
        }
    }

    gameState.stateMachine.voteState.allPlayersDone = allPlayersDone;
    if (!allPlayersDone) {
        return gameState;
    }

    // all players have voted, check if successful or not
    const successfulMission = isMissionSuccessful(gameState, numFails);
    let { missions, turn } = gameState;

    // show vote conduct result mission state
    const showMissionResultGameState = await showMissionResults(gameState, mission, successfulMission);

    // send a response
    await sendMessageToAllInSession(gameState.sessionId, showMissionResultGameState, event.requestContext);
    await sleep(5000);

    if (successfulMission) {
        // set mission to sucess
        missions[turn] = 'S';

        // check if resistance won
        if (hasResistanceWon(missions)) {
            return resistanceWins(gameState);
        }
    } else {
        // set mission to failure
        missions[turn] = 'F';

        // check if spys won
        if (haveSpiesWon(missions)) {
            return spiesWin(gameState);
        }
    }

    // if neither team has won go to next turn
    gameState.missions = missions;
    return nextTurn(gameState);
}

const showMissionResults = async (gameState, mission, isSuccessful) => {
    const stateMachine = {
        currentState: 'showMissionResultsState',
        buildTeamState: {},
        voteState: {}, // clears vote state
        conductMissionState: {},
        showVoteResultsState: {},
        showMissionResultsState: {
            mission,
            isSuccessful
        },
        gameOverState: {}
    }
    const copy = { ...gameState };
    copy.stateMachine = stateMachine;

    // update table in db
    await updateGameState(copy);

    // tells the app to rerender when you get the game state
    copy.rerender = true;
    const message = JSON.stringify(copy, '', 2);
    return message;
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
    updateConnectionWithSession,
    chooseTeam,
    vote,
    conductMission
}

module.exports = helpers;