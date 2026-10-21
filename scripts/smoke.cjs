// End-to-end smoke test: seeds a throwaway profile, drives the real app through Pick Odds and
// PWOPR, and screenshots each step. Run after `npm run build`:
//   SMOKE_OUT=<dir> SMOKE_USER_ID=<sleeper user id> SMOKE_LEAGUE=<league id> npx electron scripts/smoke.cjs
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
    ranksFile: process.env.SMOKE_RANKS || undefined,
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
    const waitFor = async (code, ms = 300000) => {
      const t = Date.now()
      while (Date.now() - t < ms) {
        if (await js(code)) return true
        await sleep(500)
      }
      return false
    }
    const shot = async name => fs.writeFileSync(path.join(out, name), (await wc.capturePage()).toPNG())
    const t0 = Date.now()
    const report = {}
    try {
      report.loaded = await waitFor(`!!document.querySelector('.toolbar')`, 30000)
      if (process.env.SMOKE_INJ) {
        // Injury overrides: import the bundled list, add one by search, then check the effect.
        const cardBtn = () =>
          js(`(() => { const c = [...document.querySelectorAll('.sheet-card')].find(e => e.innerText.includes('INJURY')); const b = c && c.querySelector('button'); b && b.click(); return !!b })()`)
        report.injOpened = await cardBtn()
        await sleep(400)
        await click('Import from sleeperStandings config')
        await waitFor(`document.querySelectorAll('.inj-row').length > 0`, 30000)
        report.injImported = await js(`document.querySelectorAll('.inj-row').length`)
        report.injExpiredNote = await js(`document.querySelector('.modal .ss-warning')?.innerText.split(String.fromCharCode(10)).join(' ')`)
        await shot('inj_1_imported.png')
        await js(`(() => { const i = document.querySelector('.inj-search input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Jayden Dan'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
        await waitFor(`document.querySelectorAll('.inj-hits button').length > 0`, 20000)
        await js(`[...document.querySelectorAll('.inj-hits button')].find(b => b.innerText.startsWith('Jayden Daniels'))?.click()`)
        await sleep(200)
        await js(`(() => { const i = [...document.querySelectorAll('.inj-controls input[type=number]')][0]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '8'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
        await click('Add')
        await sleep(300)
        report.injDaniels = await js(`[...document.querySelectorAll('.inj-row')].find(r => r.innerText.includes('Jayden Daniels'))?.innerText.split(String.fromCharCode(10)).join(' | ')`)
        await shot('inj_2_added.png')
        await click('Done')
        await sleep(300)
        await click('Start/Sit')
        await waitFor(`!!document.querySelector('.ss-row')`, 120000)
        await sleep(500)
        report.injStartSitQB = await js(`[...document.querySelectorAll('.ss-row')][0]?.innerText.split(String.fromCharCode(10)).join(' | ')`)
        report.injPlan = await js(`document.querySelector('.ss-plan')?.innerText.split(String.fromCharCode(10)).join(' | ')`)
        await shot('inj_3_startsit.png')
        await click('Pick Odds')
        await waitFor(`!!document.querySelector('.pick-card .slot')`, 180000)
        report.injZeroed = await js(`(() => { const d = document.querySelector('.footnote details'); if (!d) return null; d.open = true; return [...d.querySelectorAll('div')].map(x => x.innerText).filter(t => t.includes('Daniels')) })()`)
        report.errors = await js(`[...document.querySelectorAll('.error-inline')].map(e => e.textContent)`)
        throw new Error('INJ_DONE')
      }
      // Overview is the landing tab; its starter ranks and tiers wait on the sim.
      report.overview = await waitFor(
        `[...document.querySelectorAll('.tier-text')].some(e => /[a-z]/i.test(e.textContent)) || !!document.querySelector('.error-inline')`,
      )
      await sleep(300)
      await shot('0_overview.png')
      report.overviewRows = await js(
        `[...document.querySelectorAll('.ov-row')].map(r => r.innerText.split(String.fromCharCode(10)).join(' | '))`,
      )
      report.myPanel = await js(`document.querySelector('.ovp-head')?.innerText`)
      await js(`document.querySelectorAll('.ov-row')[1]?.click()`)
      await sleep(300)
      report.otherPanel = await js(`document.querySelector('.ovp-head')?.innerText`)
      await shot('0b_overview_other.png')
      // Responsive layouts: narrow (panel stacks under the table, full width) and wide (zoomed out
      // to a ~2700px CSS viewport, since a window can't be sized past the monitor).
      const [w0, h0] = win.getSize()
      win.setSize(1150, h0)
      await sleep(600)
      report.narrow = await js(`(() => { const t = document.querySelector('.ov-table').getBoundingClientRect(), p = document.querySelector('.ov-panel').getBoundingClientRect(); return { tableW: Math.round(t.width), panelW: Math.round(p.width), panelBelow: p.top >= t.bottom - 1, panelPos: getComputedStyle(document.querySelector('.ov-panel')).position } })()`)
      await shot('0d_narrow.png')
      await js(`document.querySelector('.body').scrollTo(0, 1e6)`)
      await sleep(300)
      await shot('0e_narrow_scrolled.png')
      await js(`document.querySelector('.body').scrollTo(0, 0)`)
      win.setSize(w0, h0)
      wc.setZoomFactor(0.6)
      await sleep(700)
      report.wide = await js(`(() => { const b = document.querySelector('.body').getBoundingClientRect(), i = document.querySelector('.body-inner').getBoundingClientRect(), h = document.querySelector('.header-inner').getBoundingClientRect(); return { viewport: innerWidth, bodyW: Math.round(b.width), innerW: Math.round(i.width), leftGap: Math.round(i.left - b.left), rightGap: Math.round(b.right - i.right), headerLeft: Math.round(h.left), innerLeft: Math.round(i.left) } })()`)
      await shot('0f_wide.png')
      wc.setZoomFactor(1)
      await sleep(400)
      await click('Dark')
      await sleep(500)
      await shot('0c_overview_dark.png')
      await click('Light')
      await sleep(300)
      await click('Pick Odds')
      // Pick Odds reuses the sim the overview started.
      report.picks = await waitFor(`!!document.querySelector('.pick-card .slot, .error-inline')`)
      report.picksSeconds = (Date.now() - t0) / 1000
      await shot('1_picks.png')
      report.cards = await js(`[...document.querySelectorAll('.pick-card')].map(c => c.innerText.split(String.fromCharCode(10)).join(' | '))`)
      report.sheetCard = await js(`document.querySelector('.sheet-card')?.innerText`)
      report.header = await js(`document.querySelector('.header .meta')?.innerText`)
      await js(`document.querySelector('.pick-card:nth-child(2)')?.click(); document.querySelector('.body').scrollTo(0, 1e6)`)
      await sleep(400)
      await shot('2_order.png')
      await click('PWOPR')
      report.pwopr = await waitFor(`!!document.querySelector('.pw .row, .error-inline')`)
      await shot('3_pwopr_proj.png')
      report.pwoprRows = await js(`document.querySelectorAll('.pw .row').length`)
      await click('Actual')
      await sleep(300)
      await shot('4_pwopr_actual.png')
      await click('Chart')
      await sleep(400)
      await shot('5_chart_actual.png')
      await click('Projection')
      await sleep(400)
      await shot('6_chart_proj.png')
      await click('Start/Sit')
      report.startSit = await waitFor(`!!document.querySelector('.ss-row, .error-inline')`, 120000)
      await sleep(400)
      await shot('8_startsit.png')
      report.ssPlan = await js(`document.querySelector('.ss-plan, .ss-panel:nth-child(2)')?.innerText`)
      report.ssButton = await js(`document.querySelector('.ss-page .btn-primary')?.innerText`)
      report.ssWarnings = await js(`[...document.querySelectorAll('.ss-warning')].map(e => e.textContent)`)
      // Trades, entered the way a user would: Overview's own-team CTA ("Find TE targets").
      await click('Overview')
      await waitFor(`!!document.querySelector('.ovp-head .btn-primary')`, 60000)
      report.cta = await js(`document.querySelector('.ovp-head .btn-primary').innerText`)
      await js(`document.querySelector('.ovp-head .btn-primary').click()`)
      report.trades = await waitFor(`document.querySelectorAll('.tr-asset').length > 5 || !!document.querySelector('.error-inline')`, 120000)
      await sleep(800)
      report.targetFilter = await js(`document.querySelector('.tr-sub .seg .on')?.innerText`)
      report.targets = await js(`[...document.querySelectorAll('.tr-cols > .tr-panel:last-child .tr-asset')].slice(0, 6).map(e => e.innerText.split(String.fromCharCode(10)).join(' | '))`)
      report.myAssets = await js(`[...document.querySelectorAll('.tr-cols > .tr-panel:first-child .tr-asset')].slice(0, 12).map(e => e.innerText.split(String.fromCharCode(10)).join(' | '))`)
      await shot('9_trades.png')
      // Give: the first of your assets tagged "Sell high"; then find the other side.
      report.gave = await js(`(() => { const b = [...document.querySelectorAll('.tr-cols > .tr-panel:first-child .tr-asset')].find(e => e.innerText.includes('Sell high')); if (b) { b.click(); return b.innerText.split(String.fromCharCode(10))[0] } return null })()`)
      await sleep(300)
      await click('Find a deal')
      await sleep(300)
      await click('Find the other side')
      await sleep(1500)
      report.deals = await js(`[...document.querySelectorAll('.tr-deal')].slice(0, 5).map(e => e.innerText.split(String.fromCharCode(10)).join(' | '))`)
      await js(`document.querySelector('.tr-deal')?.click()`)
      // Give the compositor a real frame: capturePage can return the previous one otherwise.
      await sleep(1500)
      wc.invalidate()
      await sleep(300)
      report.verdict = await js(`document.querySelector('.tr-verdict')?.innerText.split(String.fromCharCode(10)).join(' | ')`)
      await shot('9b_trade_deal.png')
      // Live theme switch, not just the startup path.
      await click(process.env.SMOKE_THEME === 'dark' ? 'Light' : 'Dark')
      await sleep(500)
      await shot('7_theme_switched.png')
      // Hide-names check: every tab's visible text must contain no real username or team name.
      if (process.env.SMOKE_HIDE) {
        const users = await (await fetch(`https://api.sleeper.app/v1/league/${process.env.SMOKE_LEAGUE}/users`)).json()
        const names = [...new Set(users.flatMap(u => [u.display_name, u.metadata && u.metadata.team_name]).filter(n => n && n.trim().length > 3).map(n => n.trim()))]
        report.leaks = {}
        for (const t of ['Overview', 'Pick Odds', 'PWOPR', 'Start/Sit', 'Trades', 'Draft']) {
          await click(t)
          await sleep(t === 'Start/Sit' || t === 'Trades' || t === 'Draft' ? 4000 : 1500)
          const text = await js(`document.body.innerText`)
          const hit = names.filter(n => text.includes(n))
          // a manager's photo identifies them as well as their name (headshots are /content/, not these)
          const photos = await js(`document.querySelectorAll('img[src*="/avatars/"], img[src*="/uploads/"]').length`)
          if (photos) hit.push(`${photos} manager/league photo(s)`)
          if (hit.length) report.leaks[t] = hit
        }
        report.namesChecked = names.length
        await click('Overview')
        await sleep(800)
        await shot('10_hidden_overview.png')
      }
      report.errors = await js(`[...document.querySelectorAll('.error-inline')].map(e => e.textContent)`)
    } catch (e) {
      if (String(e).indexOf('INJ_DONE') < 0) report.exception = String(e)
    }
    report.console = log
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
    app.quit()
  })
})

require('../out/main/index.js')
