// End-to-end smoke test: seeds a throwaway profile with no Sleeper token (so it can only read), walks
// every screen of the built app, screenshots each one, and fails on a crashed screen or a renderer
// error. Run after `npm run build`:
//   SMOKE_OUT=<dir> SMOKE_USER_ID=<sleeper user id> SMOKE_LEAGUE=<league id> SMOKE_RANKS=<sheet.xlsx> npx electron scripts/smoke.cjs
// SMOKE_THEME=light and SMOKE_HIDE=1 are optional.
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const out = process.env.SMOKE_OUT
if (!out || !process.env.SMOKE_USER_ID) {
  console.error('Set SMOKE_OUT and SMOKE_USER_ID.')
  process.exit(2)
}
const userData = path.join(out, 'userData')
fs.rmSync(userData, { recursive: true, force: true })
fs.mkdirSync(userData, { recursive: true })
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({
    sims: 300,
    strengthCV: 0.04,
    seed: 1,
    model: 'B',
    userId: process.env.SMOKE_USER_ID,
    displayName: 'smoke',
    lastLeagueId: process.env.SMOKE_LEAGUE,
    ranksFile: process.env.SMOKE_RANKS || undefined,
    theme: process.env.SMOKE_THEME || undefined,
    hideNames: !!process.env.SMOKE_HIDE,
  }),
)
app.setPath('userData', userData)

/** Sidebar section, then the tabs inside it. */
const WALK = [
  ['League', ['This week', 'Standings', 'Matchups', 'Trades']],
  ['Lineup', []],
  ['Trade', ['Build', 'Ideas', 'Vacuum']],
  ['Players', []],
  ['Picks', []],
  ['Draft', []],
  ['Settings', []],
]
const SETTLE_MS = 2500
const LOAD_LIMIT_MS = 90000
const problems = []

setTimeout(() => {
  console.error('FAIL: the walk took more than 5 minutes.')
  app.exit(2)
}, 5 * 60 * 1000)

app.on('browser-window-created', (_e, win) => {
  const wc = win.webContents
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const js = code => wc.executeJavaScript(code)
  wc.on('console-message', e => {
    if (e.level === 'error') problems.push(`console: ${String(e.message).slice(0, 200)}`)
  })
  const click = label => js(`(() => { const b = [...document.querySelectorAll('button')].filter(b => b.offsetParent).find(b => b.textContent.trim().replace(/\\s*\\(\\d+\\)$/, '') === ${JSON.stringify(label)}); if (b) b.click(); return !!b })()`)
  const settle = async () => {
    const start = Date.now()
    while (Date.now() - start < LOAD_LIMIT_MS) {
      const busy = await js(`/(Reading|Loading|Checking|Simulating|Refreshing)[^\\n]*…/.test(document.body.innerText)`)
      if (!busy) break
      await sleep(500)
    }
    await sleep(SETTLE_MS)
  }
  const visit = async name => {
    await settle()
    fs.writeFileSync(path.join(out, `${name.replace(/\W+/g, '-')}.png`), (await wc.capturePage()).toPNG())
    if (await js(`document.body.innerText.includes('This screen hit a problem')`)) problems.push(`${name}: crashed`)
    console.log(`ok   ${name}`)
  }
  wc.once('did-finish-load', async () => {
    try {
      await sleep(2000)
      for (const [section, tabs] of WALK) {
        if (!(await click(section))) problems.push(`${section}: no such button`)
        if (!tabs.length) await visit(section)
        for (const tab of tabs) {
          if (!(await click(tab))) problems.push(`${section}/${tab}: no such tab`)
          await visit(`${section} ${tab}`)
        }
      }
    } catch (e) {
      problems.push(String(e))
    }
    for (const p of problems) console.error(`FAIL ${p}`)
    console.log(problems.length ? `${problems.length} problem(s)` : 'smoke passed')
    app.exit(problems.length ? 1 : 0)
  })
})

require(path.join(__dirname, '..', 'out', 'main', 'index.js'))
