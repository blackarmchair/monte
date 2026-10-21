// sleeperStandings only calls fileURLToPath(import.meta.url), which babel.config.js rewrites to
// a constant file:// URL. Global URL covers anything else.
const fileURLToPath = u => decodeURIComponent(String(u).replace(/^file:\/\//, ''))
const pathToFileURL = p => new URL(`file://${p}`)

module.exports = { fileURLToPath, pathToFileURL, URL: globalThis.URL }
