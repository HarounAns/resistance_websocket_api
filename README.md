# resistance_websocket_api
web socket api for resistance quiplash hybrid

# API
### getGameStateHandler:
sessionId

### createGameStateHandler:
sessionId
playerName

### addPlayerHandler:
sessionId
playerName

### startGameHandler:
sessionId

### chooseTeamHandler:
sessionId
team

### voteHandler:
sessionId
playerName
approve

### conductMissionHandler:
sessionId 
playerName 
success

# Params
### sessionId
Type: String
Desc: 4-letter code that maps to the session of the game
Ex: 'XBZF'

### playerName
Type: String
Desc: Players name in game. Client should enforce uppercasing conventions
Ex: 'HAROUN'

### team
Type: Array
Desc: list of players to be placed on team. Number of players on team is determined by mission mapping
Ex: ['HAROUN', 'IBRAHIM']

### approve
Type: Bool
Desc: Boolean representing vote. True if player approves the team to conduct the mission. False if they reject. Majority approval needed for team to conduct the mission.

### success
Type: Bool
Desc: Boolean representing if Mission was successful or sabotaged. Only spies can sabotage. True means success on mission, False means fail.