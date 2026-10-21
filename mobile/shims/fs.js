// Just enough of Node's `fs` for sleeperStandings on a phone: its files are caches (ESPN injury
// estimates, RTM data), so an in-memory store for the life of the app is a faithful stand-in.
// Reads of anything never written behave like a missing file.
const files = new Map()

const enoent = p => Object.assign(new Error(`ENOENT: no such file, open '${p}'`), { code: 'ENOENT' })

function existsSync(p) {
  return files.has(String(p))
}
function readFileSync(p) {
  if (!files.has(String(p))) throw enoent(p)
  return files.get(String(p))
}
function writeFileSync(p, data) {
  files.set(String(p), typeof data === 'string' ? data : String(data))
}
function mkdirSync() {}
function statSync(p) {
  if (!files.has(String(p))) throw enoent(p)
  return { mtimeMs: Date.now(), mtime: new Date(), size: files.get(String(p)).length, isFile: () => true, isDirectory: () => false }
}

const promises = {
  readFile: async p => readFileSync(p),
  writeFile: async (p, d) => writeFileSync(p, d),
  mkdir: async () => {},
}

module.exports = { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, promises }
