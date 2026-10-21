// Draft tab smoke test: seeds a throwaway profile, opens Draft, and screenshots the board, the
// Teams view and a position filter, light and dark. Run after `npm run build`:
//   SMOKE_OUT=<dir> SMOKE_USER_ID=<id> SMOKE_LEAGUE=<league id> SMOKE_RANKS=<xlsx> [SMOKE_HIDE=1] [SMOKE_THEME=dark]
//   npx electron scripts/draft-smoke.cjs
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const out = process.env.SMOKE_OUT
const userData = path.join(out, 'userData')
fs.mkdirSync(userData, { recursive: true })
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({
    sims: 1000,
    strengthCV: 0.08,
    userId: process.env.SMOKE_USER_ID,
    displayName: 'smoke',
    lastLeagueId: process.env.SMOKE_LEAGUE,
    ranksFile: process.env.SMOKE_RANKS,
    theme: process.env.SMOKE_THEME || undefined,
    hideNames: !!process.env.SMOKE_HIDE,
  }),
)
app.setPath('userData', userData)

const log = []
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, ...args) => log.push(args.map(String).join(' ')))
  win.webContents.once('did-finish-load', async () => {
    const wc = win.webContents
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const js = code => wc.executeJavaScript(code)
    const click = label =>
      js(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)})); if (b) b.click(); return !!b })()`)
    const waitFor = async (code, ms = 120000) => {
      const t = Date.now()
      while (Date.now() - t < ms) {
        if (await js(code)) return true
        await sleep(400)
      }
      return false
    }
    const shot = async name => fs.writeFileSync(path.join(out, name), (await wc.capturePage()).toPNG())
    const report = {}
    try {
      report.loaded = await waitFor(`[...document.querySelectorAll('.tab')].some(b => b.textContent === 'Draft')`, 30000)
      await click('Draft')
      report.board = await waitFor(`document.querySelectorAll('.dr-row').length > 0 || !!document.querySelector('.error-inline')`, 120000)
      await sleep(600)
      report.title = await js(`document.querySelector('.ss-title')?.innerText`)
      report.rows = await js(`document.querySelectorAll('.dr-row').length`)
      report.tiers = await js(`[...document.querySelectorAll('.dr-tier')].map(t => t.innerText.split(String.fromCharCode(10)).join(' '))`)
      report.timeline = await js(`document.querySelectorAll('.dr-pick').length`)
      report.side = await js(`[...document.querySelectorAll('.ss-side .panel')].map(p => p.innerText.split(String.fromCharCode(10)).join(' | '))`)
      await shot('draft_1_board.png')
      await click('Show taken')
      await sleep(400)
      report.rowsWithTaken = await js(`document.querySelectorAll('.dr-row').length`)
      report.firstTaken = await js(`document.querySelector('.dr-row.taken')?.innerText.split(String.fromCharCode(10)).join(' | ')`)
      await shot('draft_2_taken.png')
      await click('WR')
      await sleep(300)
      await shot('draft_3_wr.png')
      await click('Teams')
      await sleep(400)
      report.teams = await js(`[...document.querySelectorAll('.dr-team-head')].map(t => t.innerText.split(String.fromCharCode(10)).join(' '))`)
      await shot('draft_4_teams.png')
      if (process.env.SMOKE_HIDE) {
        const users = await (await fetch(`https://api.sleeper.app/v1/league/${process.env.SMOKE_LEAGUE}/users`)).json()
        const names = [...new Set(users.flatMap(u => [u.display_name, u.metadata && u.metadata.team_name]).filter(n => n && n.trim().length > 3).map(n => n.trim()))]
        const leak = []
        for (const v of ['Teams', 'Board']) {
          await click(v)
          await sleep(400)
          const text = await js(`document.body.innerText`)
          leak.push(...names.filter(n => text.includes(n)).map(n => `${v}: ${n}`))
        }
        report.leaks = leak
        report.namesChecked = names.length
      }
      report.errors = await js(`[...document.querySelectorAll('.error-inline, .ss-warning')].map(e => e.textContent)`)
    } catch (e) {
      report.exception = String(e)
    }
    report.console = log.filter(l => /error|warn/i.test(l))
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
    app.quit()
  })
})

require('../out/main/index.js')
