// Shareable screenshots of every screen, light and dark, names hidden. Run after `npm run build`:
//   SHOTS_OUT=<dir> SHOTS_USER_ID=<sleeper user id> SHOTS_LEAGUE=<league id> SHOTS_RANKS=<xlsx>
//   [SHOTS_ALT_LEAGUE=<second league, for an extra Start/Sit>] npx electron scripts/screenshots.cjs
// SHOTS_SHOW_NAMES=1 keeps real names and avatars (a private set) and skips the leak check.
// Uses a throwaway profile, so the real Monte settings are never touched.
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

const done = []
app.on('browser-window-created', (_e, win) => {
  win.setSize(1600, 1000)
  win.webContents.once('did-finish-load', async () => {
    const wc = win.webContents
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const js = code => wc.executeJavaScript(code)
    const click = label =>
      js(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)})); if (b) b.click(); return !!b })()`)
    const waitFor = async (code, ms = 180000) => {
      const t = Date.now()
      while (Date.now() - t < ms) {
        if (await js(code)) return true
        await sleep(400)
      }
      return false
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
    const top = () => js(`document.querySelector('.body').scrollTo(0, 0)`)
    const scrollTo = sel => js(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'start' })`)

    const tradeDeal = async () => {
      await click('Trades')
      await waitFor(`document.querySelectorAll('.tr-asset').length > 5`)
      await js(`(() => { const b = [...document.querySelectorAll('.tr-cols > .tr-panel:first-child .tr-asset')].find(e => e.innerText.includes('projected 1.01')); b && !b.classList.contains('on') && b.click() })()`)
      await click('Find a deal')
      await sleep(300)
      await click('Find the other side')
      await waitFor(`!!document.querySelector('.tr-deal')`, 20000)
      await js(`document.querySelector('.tr-deal')?.click()`)
    }

    try {
      for (const theme of ['light', 'dark']) {
        const t = theme === 'light' ? '' : '-dark'
        if (theme === 'dark') {
          await click('Dark')
          await sleep(600)
        }
        await click('Overview')
        await waitFor(`[...document.querySelectorAll('.tier-text')].some(e => /[a-z]/i.test(e.textContent))`)
        await top()
        await shot(`01-overview${t}`)
        if (theme === 'light') {
          await js(`document.querySelectorAll('.ov-row')[1]?.click()`)
          await shot(`02-overview-other-team`)
          await js(`document.querySelectorAll('.ov-row')[0]?.click()`)
        }

        await click('Pick Odds')
        await waitFor(`!!document.querySelector('.pick-card .slot')`)
        await top()
        await shot(`03-pick-odds${t}`)
        await scrollTo('.gtable.order')
        await shot(`04-draft-order${t}`)

        await click('PWOPR')
        await waitFor(`!!document.querySelector('.pw .row')`)
        await click('Table')
        await top()
        await shot(`05-pwopr-table${t}`)
        await click('Chart')
        await shot(`06-pwopr-chart${t}`)
        await click('Table')

        await click('Start/Sit')
        await waitFor(`!!document.querySelector('.ss-row')`)
        await top()
        await shot(`07-start-sit${t}`)

        await tradeDeal()
        await top()
        await shot(`08-trades${t}`)
        if (theme === 'light') {
          // the tab is labelled with the partner's name ("<team>'s roster")
          await js(`[...document.querySelectorAll('button')].find(b => /roster$/.test(b.textContent.trim()))?.click()`)
          await shot('08b-trades-partner-roster')
        }
        await click('Clear')

        await click('Draft')
        await waitFor(`document.querySelectorAll('.dr-row').length > 0 || !!document.querySelector('.error-inline')`)
        await click('Board')
        await top()
        await shot(`10-draft-board${t}`)
        await click('Teams')
        await top()
        await shot(`11-draft-teams${t}`)
        await click('Board')
        if (theme === 'light') {
          await click('All players')
          await shot('12-draft-all-players')
          await click('Rookies')
        }
      }

      // Second league's Start/Sit (light) — the more interesting lineup fix this week.
      if (process.env.SHOTS_ALT_LEAGUE) {
        await click('Light')
        await sleep(400)
        const altIndex = Number(process.env.SHOTS_ALT_INDEX ?? 1)
        await js(`document.querySelectorAll('.league-item')[${altIndex}]?.click()`)
        await waitFor(`!!document.querySelector('.toolbar')`, 60000)
        await click('Start/Sit')
        await sleep(500)
        await waitFor(`!!document.querySelector('.ss-row')`)
        await top()
        await shot('09-start-sit-tyler-l3')
      }
      if (showNames) throw new Error('SHOW_NAMES_DONE')
      // Leak check: no real username, team name or league name may appear on any tab of any
      // league. A hit here means a screen bypassed the Hide names helpers.
      const sleeper = p => fetch(`https://api.sleeper.app/v1${p}`).then(r => r.json())
      const state = await sleeper('/state/nfl')
      const leagues = await sleeper(`/user/${process.env.SHOTS_USER_ID}/leagues/nfl/${state.league_season || state.season}`)
      const names = new Set(leagues.map(l => l.name.trim()))
      for (const l of leagues)
        for (const u of await sleeper(`/league/${l.league_id}/users`))
          for (const n of [u.display_name, u.metadata && u.metadata.team_name]) if (n && n.trim().length > 3) names.add(n.trim())
      const leaks = {}
      const count = await js(`document.querySelectorAll('.league-item').length`)
      for (let i = 0; i < count; i++) {
        await js(`document.querySelectorAll('.league-item')[${i}].click()`)
        await sleep(1500)
        for (const tab of ['Overview', 'Pick Odds', 'PWOPR', 'Start/Sit', 'Trades', 'Draft']) {
          await click(tab)
          await sleep(tab === 'Overview' ? 2500 : 3500)
          const text = await js(`document.body.innerText`)
          const hit = [...names].filter(n => text.includes(n))
          // a manager's or league's photo identifies them as well as a name (player headshots are /content/)
          const photos = await js(`document.querySelectorAll('img[src*="/avatars/"], img[src*="/uploads/"]').length`)
          if (photos) hit.push(`${photos} manager/league photo(s)`)
          if (hit.length) leaks[`league ${i + 1} / ${tab}`] = hit
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
