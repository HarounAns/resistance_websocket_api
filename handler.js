'use strict';
const { addConnection, deleteConnection, successfullResponse, sendMessageToAllConnected, updateConnectionWithSession } = require('./helpers');

module.exports.connectionHandler = (event, context, callback) => {
  console.log(event);

  if (event.requestContext.eventType === 'CONNECT') {
    // Handle connection
    addConnection(event.requestContext.connectionId)
      .then(() => {
        callback(null, successfullResponse);
      })
      .catch(err => {
        console.log(err);
        callback(null, JSON.stringify(err));
      });
  } else if (event.requestContext.eventType === 'DISCONNECT') {
    // Handle disconnection
    deleteConnection(event.requestContext)
      .then(() => {
        callback(null, successfullResponse);
      })
      .catch(err => {
        console.log(err);
        callback(null, {
          statusCode: 500,
          body: 'Failed to connect: ' + JSON.stringify(err)
        });
      });
  }
};

// THIS ONE DOESNT DO ANYHTING
module.exports.defaultHandler = (event, context, callback) => {
  callback(null, {
    statusCode: 200,
    body: 'defaultHandler'
  });
};

module.exports.sendMessageHandler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const message = body.data;

    // this echos the message to everyone connected
    await sendMessageToAllConnected(message, event.requestContext);
    return successfullResponse;
  } catch (error) {
    console.log(error);
    return JSON.stringify(error);
  }
}

module.exports.updateConnectionWithSession = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const sessionId = body.sessionId;
    const connectionId = event.requestContext.connectionId;

    // this echos the message to everyone connected
    await updateConnectionWithSession(connectionId, sessionId);
    return successfullResponse;
  } catch (error) {
    console.log(error);
    return JSON.stringify(error);
  }
}