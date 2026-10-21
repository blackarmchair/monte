// sleeperStandings imports readline only for its command-line prompts, which the app never
// shows. Fail loudly if that ever changes rather than hang waiting for stdin.
function createInterface() {
  throw new Error('readline is not available in the Monte app')
}
module.exports = { createInterface }
