// The slice of Node's `path` sleeperStandings uses (join / dirname / resolve / basename) for
// the cache paths that shims/fs keeps in memory. POSIX separators only.
function normalize(p) {
  const abs = p.startsWith('/')
  const out = []
  for (const s of p.split('/')) {
    if (!s || s === '.') continue
    if (s === '..') out.pop()
    else out.push(s)
  }
  return (abs ? '/' : '') + out.join('/')
}
const join = (...parts) => normalize(parts.filter(Boolean).join('/'))
const resolve = (...parts) => normalize(parts.filter(Boolean).join('/').replace(/^(?!\/)/, '/'))
const dirname = p => {
  const n = normalize(p)
  const i = n.lastIndexOf('/')
  return i <= 0 ? (n.startsWith('/') ? '/' : '.') : n.slice(0, i)
}
const basename = (p, ext) => {
  const b = normalize(p).split('/').pop() || ''
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b
}
const extname = p => {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i) : ''
}

module.exports = { join, resolve, dirname, basename, extname, normalize, sep: '/' }
