// Shareable screenshots of every screen, light and dark, names hidden. Run after `npm run build`:
//   SHOTS_OUT=<dir> SHOTS_USER_ID=<sleeper user id> SHOTS_LEAGUE=<league id> SHOTS_RANKS=<xlsx>
//   npx electron scripts/screenshots.cjs
// SHOTS_SHOW_NAMES=1 keeps real names and avatars (a private set) and skips the leak check.
// Uses a throwaway profile, so the real Monte settings (and the Sleeper token) are never touched.
const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const out = process.env.SHOTS_OUT
const showNames = !!process.env.SHOTS_SHOW_NAMES
fs.mkdirSync(out, { recursive: true })
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'monte-shots-'))
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({
    sims: 3000,
    strengthCV: 0.08,
    userId: process.env.SHOTS_USER_ID,
    displayName: 'You',
    lastLeagueId: process.env.SHOTS_LEAGUE,
    ranksFile: process.env.SHOTS_RANKS,
    theme: 'light',
    hideNames: !showNames,
  }),
)
app.setPath('userData', userData)

const SECTIONS = ['League', 'Lineup', 'Trade', 'Players', 'Picks', 'Draft']

const done = []
app.on('browser-window-created', (_e, win) => {
  win.setSize(1600, 1000)
  win.webContents.once('did-finish-load', async () => {
    const wc = win.webContents
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const js = code => wc.executeJavaScript(code)
    const clickIn = (sel, label) =>
      js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)})); if (b) b.click(); return !!b })()`)
    const nav = label => clickIn('.nav-item', label)
    const tab = label => clickIn('.seg button', label)
    const waitFor = async (code, ms = 180000) => {
      const t = Date.now()
      while (Date.now() - t < ms) {
        if (await js(code)) return true
        await sleep(400)
      }
      return false
    }
    // Settled: no spinner and no sim running, twice in a row.
    const settle = async (ms = 180000) => {
      const idle = `!document.querySelector('.spinner') && !/simulating/i.test(document.querySelector('.scroll')?.innerText ?? '')`
      await sleep(500)
      await waitFor(idle, ms)
      await sleep(700)
      await waitFor(idle, ms)
    }
    // Let the compositor produce a real frame before capturing (capturePage can return a stale one).
    const shot = async name => {
      await sleep(900)
      wc.invalidate()
      await sleep(400)
      // Once it lags it stays a frame behind, so the first capture can be the previous screen:
      // take one, repaint, and keep the second.
      await wc.capturePage()
      wc.invalidate()
      await sleep(500)
      fs.writeFileSync(path.join(out, `${name}.png`), (await wc.capturePage()).toPNG())
      done.push(name)
    }
    const top = () => js(`document.querySelector('.scroll').scrollTo(0, 0)`)
    const scrollToText = text =>
      js(`[...document.querySelectorAll('.title-l')].find(e => e.textContent.trim() === ${JSON.stringify(text)})?.scrollIntoView({ block: 'start' })`)
    const go = async (section, sub) => {
      await nav(section)
      await sleep(300)
      if (sub) await tab(sub)
      await settle()
      await top()
    }

    try {
      await waitFor(`!!document.querySelector('.nav-item')`, 60000)
      for (const theme of ['light', 'dark']) {
        const t = theme === 'light' ? '' : '-dark'
        if (theme === 'dark') {
          await clickIn('.nav-item', 'Settings')
          await sleep(300)
          await tab('Dark')
          await sleep(600)
        }

        await go('League', 'Standings')
        await shot(`01-league-standings${t}`)
        await go('League', 'Matchups')
        await shot(`02-league-matchups${t}`)
        await go('League', 'Trades')
        await shot(`03-league-trades${t}`)
        await go('League', 'Standings')
        // a team other than yours: the second card in the standings
        await js(`document.querySelectorAll('.scroll button.gcard')[1]?.click()`)
        await settle()
        await shot(`04-team${t}`)

        await go('Lineup')
        await shot(`05-lineup${t}`)

        await go('Trade', 'Build')
        await shot(`06-trade-build${t}`)
        await go('Trade', 'Ideas')
        await shot(`07-trade-ideas${t}`)
        await go('Trade', 'Vacuum')
        await shot(`08-trade-vacuum${t}`)
        await tab('Build')

        await go('Players', 'Value')
        await shot(`09-players-value${t}`)
        await go('Players', 'Usage')
        await shot(`10-players-usage${t}`)
        await tab('Value')
        await sleep(300)
        await js(`document.querySelector('.scroll .gcard.click, .scroll button.gcard')?.click()`)
        await settle()
        await shot(`11-player${t}`)

        await go('Picks')
        await shot(`12-pick-odds${t}`)
        await scrollToText('Projected order')
        await shot(`13-pick-odds-order${t}`)

        await go('Draft', 'Board')
        await shot(`14-draft-board${t}`)
        await go('Draft', 'Teams')
        await shot(`15-draft-teams${t}`)
        await tab('Board')
        if (theme === 'light') {
          await tab('All players')
          await settle()
          await shot('16-draft-all-players')
          await tab('Rookies')
        }

        await clickIn('.nav-item', 'Settings')
        await settle()
        await top()
        await shot(`17-settings${t}`)
      }

      if (showNames) throw new Error('SHOW_NAMES_DONE')
      // Leak check: no real username, team name or league name may appear on any screen of any
      // league. A hit here means a screen bypassed the Hide names helpers.
      const sleeper = p => fetch(`https://api.sleeper.app/v1${p}`).then(r => r.json())
      const state = await sleeper('/state/nfl')
      const leagues = await sleeper(`/user/${process.env.SHOTS_USER_ID}/leagues/nfl/${state.league_season || state.season}`)
      const names = new Set(leagues.map(l => l.name.trim()))
      for (const l of leagues)
        for (const u of await sleeper(`/league/${l.league_id}/users`))
          for (const n of [u.display_name, u.metadata && u.metadata.team_name]) if (n && n.trim().length > 3) names.add(n.trim())
      const leaks = {}
      const check = async where => {
        const text = await js(`document.body.innerText`)
        const hit = [...names].filter(n => text.includes(n))
        // a manager's or league's photo identifies them as well as a name (player headshots are /content/)
        const photos = await js(`document.querySelectorAll('img[src*="/avatars/"], img[src*="/uploads/"]').length`)
        if (photos) hit.push(`${photos} manager/league photo(s)`)
        if (hit.length) leaks[where] = hit
      }
      const screens = [['League', 'Standings'], ['League', 'Matchups'], ['League', 'Trades'], ['Lineup'], ['Trade', 'Build'], ['Trade', 'Ideas'], ['Trade', 'Vacuum'], ['Players'], ['Picks'], ['Draft', 'Board'], ['Draft', 'Teams']]
      await js(`document.querySelector('.lg-switch').click()`)
      await sleep(400)
      const count = await js(`document.querySelectorAll('.modal .gcard').length`)
      await check('leagues modal')
      await js(`document.querySelector('.scrim')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
      for (let i = 0; i < count; i++) {
        await js(`document.querySelector('.lg-switch').click()`)
        await sleep(400)
        await js(`document.querySelectorAll('.modal .gcard')[${i}].click()`)
        await sleep(1500)
        for (const [section, sub] of screens) {
          await go(section, sub)
          await check(`league ${i + 1} / ${section}${sub ? ` / ${sub}` : ''}`)
        }
      }
      fs.writeFileSync(path.join(out, 'leak-check.json'), JSON.stringify({ namesChecked: names.size, leaks }, null, 2))
    } catch (e) {
      if (String(e).indexOf('SHOW_NAMES_DONE') < 0) fs.writeFileSync(path.join(out, 'error.txt'), String(e && e.stack ? e.stack : e))
    }
    fs.writeFileSync(path.join(out, 'shots.json'), JSON.stringify(done, null, 2))
    fs.rmSync(userData, { recursive: true, force: true })
    app.quit()
  })
})

require('../out/main/index.js')
