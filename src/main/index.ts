import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, safeStorage, session, shell, Tray } from 'electron'
import { unzipSync } from 'fflate'
import { join } from 'node:path'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import createEngine from './engine.worker?nodeWorker'
// Windows wants the multi-size .ico (crisp at 16–256px in the title bar and taskbar).
import iconIco from '../../resources/icon.ico?asset'
import iconPng from '../../resources/icon.png?asset'
import { ENGINE_DEADLINE_MS, ENGINE_TIMEOUT_MESSAGE, withDeadline } from '@monte/core/deadline'
import type { EngineJob } from '@monte/core/engine'
import { diffOffers, offerMessage } from '@monte/core/offerWatch'
import { fetchSheet, sameWorkbook, SHEET_CHECK_MS } from '@monte/core/sheetLink'
import { isSleeperPage, LOGIN_URL, loginMayVisit, READ_TOKEN_JS, TOKEN_POLL_MS, tokenFromStorage } from '@monte/core/sleeperLogin'
import { readWorkbook } from '@monte/core/xlsx'
import { createMonteService, DEFAULT_SETTINGS, toResult } from '@monte/core/service'
import { checkToken, proposeTrade, readToken, SleeperAuthError, type TradeProposal } from '@monte/core/sleeperTrade'
import { setStarters, type LineupWrite } from '@monte/core/sleeperLineup'
import { answerOffer, type OfferAnswer } from '@monte/core/sleeperOffers'
import type { ClaimRef, IrMove, WaiverClaim } from '@monte/core/sleeperWaivers'
import { readRanksFile, watchRanksFile } from './ranksFile'
import { createSettingsStore } from './settingsStore'
import { loadWorkbook } from './workbook'
import { createUpdater } from './updater'
import type { RanksFileInfo, Result, Settings } from '@monte/core/types'

const dataDir = () => app.getPath('userData')
const settingsFile = () => join(dataDir(), 'settings.json')

function wrap<A extends unknown[], T>(fn: (...a: A) => Promise<T>) {
  return async (_e: unknown, ...a: A): Promise<Result<T>> => toResult(() => fn(...a))
}

// ---- settings --------------------------------------------------------------------------
// Made on first use: userData isn't final until the app has started (the smoke script moves it).
let settingsStore: ReturnType<typeof createSettingsStore<Settings>> | null = null
const settingsDisk = () => (settingsStore ??= createSettingsStore<Settings>(settingsFile(), DEFAULT_SETTINGS))
const loadSettings = () => settingsDisk().load()

async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = await settingsDisk().save(patch)
  if (patch.theme) applyTheme(next.theme)
  if ('keepRunning' in patch) syncTray(!!next.keepRunning)
  return next
}

/**
 * nativeTheme.themeSource drives the renderer's prefers-color-scheme, which is the only switch
 * the CSS reads, and it also themes the native title bar so the frame matches the page.
 */
function applyTheme(theme: Settings['theme']) {
  nativeTheme.themeSource = theme ?? 'dark'
  const bg = nativeTheme.shouldUseDarkColors ? '#141210' : '#F3EFE7'
  for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(bg)
}

// ---- Sleeper session (trade offers, lineups) -------------------------------------------
// The token can act as the user on Sleeper, so it never goes in settings.json: it is kept
// encrypted by the OS (DPAPI / Keychain / libsecret) in its own file, and never reaches the
// renderer: every write to Sleeper is sent from this process.
const tokenFile = () => join(dataDir(), 'sleeper-token.bin')

async function readSleeperToken(): Promise<string | null> {
  try {
    return safeStorage.decryptString(await readFile(tokenFile()))
  } catch {
    return null
  }
}

async function writeSleeperToken(token: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("This computer has no secure storage for the Sleeper token, so Monte can't keep it.")
  await mkdir(dataDir(), { recursive: true })
  await writeFile(tokenFile(), safeStorage.encryptString(token))
}

const clearSleeperToken = () => rm(tokenFile(), { force: true })

async function connectSleeper(token: string): Promise<Settings> {
  const s = await loadSettings()
  if (!s.userId) throw new Error('Sign in with your Sleeper username first.')
  const t = token.trim().replace(/^"|"$/g, '')
  if (!t) throw new Error('Paste the token first.')
  const name = await checkToken(t, s.userId)
  await writeSleeperToken(t)
  const info = readToken(t)
  return saveSettings({ sleeperLink: { name: name || s.displayName || '', expiresAt: info?.expiresAt ?? null, connectedAt: new Date().toISOString() } })
}

// Sign in on Sleeper's own page, in a window with its own throwaway session and no access to Monte.
// Monte never sees the password: once the page has saved its token, Monte reads that, checks it and
// stores it as a pasted one would be. Resolves null if the user just closes the window.
let loginWindow: BrowserWindow | null = null
let loginRun: Promise<Settings | null> | null = null

function signInSleeper(): Promise<Settings | null> {
  if (loginRun) {
    loginWindow?.focus()
    return loginRun
  }
  loginRun = runLogin().finally(() => {
    loginRun = null
  })
  return loginRun
}

async function runLogin(): Promise<Settings | null> {
  const ses = session.fromPartition('sleeper-login')
  await ses.clearStorageData()
  const win = new BrowserWindow({
    width: 520,
    height: 780,
    title: 'Sign in to Sleeper',
    icon: process.platform === 'win32' ? iconIco : iconPng,
    autoHideMenuBar: true,
    webPreferences: { session: ses, contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  loginWindow = win
  // Some login pages turn away anything announcing itself as Electron.
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/\s(Electron|monte)\/\S+/gi, ''))
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (!loginMayVisit(url)) e.preventDefault()
  })
  try {
    return await new Promise<Settings | null>((resolve, reject) => {
      let reading = false
      const timer = setInterval(() => {
        if (reading || win.isDestroyed() || !isSleeperPage(win.webContents.getURL())) return
        reading = true
        win.webContents
          .executeJavaScript(READ_TOKEN_JS)
          .then((raw: unknown) => {
            const token = tokenFromStorage(raw)
            if (!token) return
            clearInterval(timer)
            return connectSleeper(token).then(resolve, reject)
          })
          .catch(() => undefined) // mid-navigation: the next tick tries again
          .finally(() => {
            reading = false
          })
      }, TOKEN_POLL_MS)
      win.once('closed', () => {
        clearInterval(timer)
        resolve(null)
      })
      void win.loadURL(LOGIN_URL).catch(e => {
        clearInterval(timer)
        reject(new Error(`Couldn't open Sleeper's sign-in page: ${e instanceof Error ? e.message : e}`))
      })
    })
  } finally {
    loginWindow = null
    if (!win.isDestroyed()) win.destroy()
    await ses.clearStorageData().catch(() => undefined)
  }
}

async function disconnectSleeper(): Promise<Settings> {
  await clearSleeperToken()
  return saveSettings({ sleeperLink: undefined })
}

/** Run a write with the stored token; a refused token disconnects, and `needsConnect` says so. */
async function withSleeper<T>(run: (token: string) => Promise<T>): Promise<Result<T> & { needsConnect?: boolean }> {
  const token = await readSleeperToken()
  if (!token) return { ok: false, error: 'Connect Sleeper first.', needsConnect: true }
  try {
    return { ok: true, value: await run(token) }
  } catch (e) {
    const auth = e instanceof SleeperAuthError
    if (auth) await disconnectSleeper()
    return { ok: false, error: e instanceof Error ? e.message : String(e), needsConnect: auth }
  }
}

const sendTrade = (p: TradeProposal) =>
  withSleeper(async token => {
    const r = await proposeTrade(p, token)
    return { transactionId: r.transactionId, mismatch: r.mismatch }
  })

const sendAnswer = (a: OfferAnswer) => withSleeper(token => answerOffer(a, token))

const sendLineup = (w: LineupWrite) => withSleeper(token => setStarters(w, token))

// ---- engine ----------------------------------------------------------------------------
function runWorker(job: EngineJob): Promise<unknown> {
  const w = createEngine({ workerData: job })
  const done = new Promise<unknown>((resolve, reject) => {
    w.once('message', (m: Result<unknown>) => (m.ok ? resolve(m.value) : reject(new Error(m.error))))
    w.once('error', reject)
    // Ignored after a result; otherwise the worker died without giving one.
    w.once('exit', () => reject(new Error('The simulation stopped unexpectedly. Try again.')))
  })
  return withDeadline(done, ENGINE_DEADLINE_MS, ENGINE_TIMEOUT_MESSAGE).finally(() => void w.terminate())
}

// Every baseline pick-odds run (no what-ifs) also saves what the engine knew and what it
// forecast, one file per league per day, so later backtests can score the live model with the
// injury information that can't be rebuilt from Sleeper's history. Saving never fails a run.
async function runEngine(job: EngineJob): Promise<unknown> {
  const baseline = job.kind === 'bb' && !Object.values(job.forced).some(w => w.length)
  if (!baseline) return runWorker(job)
  const { snapshot, ...res } = (await runWorker({ ...job, archive: true })) as Record<string, any>
  if (snapshot) {
    const dir = join(dataDir(), 'archive', job.leagueId)
    const file = join(dir, `${res.season}-wk${res.currentWeek}-${String(res.ranAt).slice(0, 10)}.json`)
    void mkdir(dir, { recursive: true })
      .then(() => writeFile(file, JSON.stringify({ leagueId: job.leagueId, ...res, snapshot }), 'utf8'))
      .catch(e => console.warn('archive write failed:', e))
  }
  return res
}

// Sleeper, FantasyCalc and the screen builders live in @monte/core (shared with the phone app);
// this process supplies the desktop's settings file, a cache in userData, the watched workbook
// and a worker thread per engine job.
const monte = createMonteService({
  settings: loadSettings,
  cacheRead: key => readFile(join(dataDir(), key), 'utf8').catch(() => null),
  cacheWrite: async (key, data) => {
    await mkdir(dataDir(), { recursive: true })
    await writeFile(join(dataDir(), key), data, 'utf8')
  },
  loadBook: async () => loadWorkbook((await loadSettings()).ranksFile),
  runEngine,
})

// ---- new-offer notifications -----------------------------------------------------------
// While Monte is open, look for new offers across every league. Monte quits when its window closes,
// so nothing arrives after that. A refused token is left for the next real write to deal with:
// a background check must not disconnect anyone.
const OFFER_CHECK_MS = 5 * 60 * 1000
const OFFER_FIRST_CHECK_MS = 30 * 1000
/** Electron drops a notification's click handler if the object is collected. */
const liveNotifications = new Set<Notification>()

async function checkOffers() {
  const s = await loadSettings()
  if (s.notifyOffers === false || !s.userId || !s.sleeperLink || !Notification.isSupported()) return
  const token = await readSleeperToken()
  if (!token) return
  const { fresh, seen } = diffOffers(await monte.receivedOffers(s.userId, token), s.seenOffers ?? [])
  if (!fresh.length) return
  await saveSettings({ seenOffers: seen })
  for (const o of fresh) {
    const n = new Notification({ ...offerMessage(o, !!s.hideNames), icon: process.platform === 'win32' ? iconIco : iconPng })
    liveNotifications.add(n)
    n.once('close', () => liveNotifications.delete(n))
    n.once('click', () => {
      liveNotifications.delete(n)
      showWindow()
      broadcast('offers:open', o.leagueId)
    })
    n.show()
  }
}

function startOfferChecks() {
  const run = () => void checkOffers().catch(e => console.warn('offer check failed:', e instanceof Error ? e.message : e))
  setTimeout(run, OFFER_FIRST_CHECK_MS)
  setInterval(run, OFFER_CHECK_MS)
}

// ---- rankings file --------------------------------------------------------------------
let stopWatch: (() => void) | null = null

function broadcast(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

/** Read the configured file (if any) and (re)start watching it. */
async function loadRanksFile(path: string | undefined): Promise<RanksFileInfo | null> {
  stopWatch?.()
  stopWatch = null
  if (!path) return null
  const info = await readRanksFile(path)
  stopWatch = watchRanksFile(path, () => {
    readRanksFile(path).then(
      i => broadcast('ranks:changed', i),
      () => broadcast('ranks:changed', null),
    )
  })
  return info
}

async function chooseRanksFile(): Promise<RanksFileInfo | null> {
  const r = await dialog.showOpenDialog({
    title: 'Choose your rankings workbook',
    properties: ['openFile'],
    filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
  })
  if (r.canceled || !r.filePaths[0]) return null
  const info = await loadRanksFile(r.filePaths[0]) // validates before saving the path
  // Choosing a file by hand takes over from a linked sheet.
  await saveSettings({ ranksFile: r.filePaths[0], sheetLink: undefined })
  return info
}

// A linked sheet is downloaded here and then treated like any chosen file. The copy is only replaced
// when its data changed, so its age stays honest and screens don't reload for nothing.
const linkedSheetFile = () => join(dataDir(), 'rankings-from-link.xlsx')

async function refreshLinkedSheet(link: string): Promise<RanksFileInfo | null> {
  const bytes = await fetchSheet(link)
  try {
    readWorkbook(bytes)
  } catch {
    throw new Error("Google sent something that isn't a workbook Monte can read.")
  }
  const dest = linkedSheetFile()
  const existing = await readFile(dest).catch(() => null)
  if (existing && (await loadSettings()).ranksFile === dest && sameWorkbook(new Uint8Array(existing), bytes, unzipSync)) return null
  await writeFile(`${dest}.tmp`, bytes)
  await rename(`${dest}.tmp`, dest)
  const info = await loadRanksFile(dest)
  await saveSettings({ ranksFile: dest })
  broadcast('ranks:changed', info)
  return info
}

async function setSheetLink(link: string | null): Promise<RanksFileInfo | null> {
  if (!link) {
    await saveSettings({ sheetLink: undefined })
    return loadRanksFile((await loadSettings()).ranksFile)
  }
  // Downloads first: a link that doesn't work must not replace a sheet that does.
  const changed = await refreshLinkedSheet(link)
  await saveSettings({ sheetLink: link })
  return changed ?? loadRanksFile((await loadSettings()).ranksFile)
}

function startSheetChecks() {
  const run = () => {
    void loadSettings()
      .then(s => (s.sheetLink ? refreshLinkedSheet(s.sheetLink) : null))
      .catch(e => console.warn('sheet check failed:', e instanceof Error ? e.message : e))
  }
  setTimeout(run, OFFER_FIRST_CHECK_MS)
  setInterval(run, SHEET_CHECK_MS)
}

// ---- window ----------------------------------------------------------------------------
function showWindow() {
  const win = BrowserWindow.getAllWindows().find(w => w !== loginWindow)
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// Optional: closing the window hides it to the tray, so offer notifications keep coming. Quitting is
// then done from the tray menu. A real quit (tray, update install, shutdown) sets `quitting`.
let tray: Tray | null = null
let quitting = false

function syncTray(on: boolean) {
  if (!on) {
    tray?.destroy()
    tray = null
    return
  }
  if (tray) return
  tray = new Tray(process.platform === 'win32' ? iconIco : iconPng)
  tray.setToolTip('Monte')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Monte', click: showWindow },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
  tray.on('click', showWindow)
}

function createWindow() {
  const win = new BrowserWindow({
    // Wide enough by default for the draft-order heatmap's 1200px minimum plus the sidebar.
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 600,
    title: 'Monte',
    icon: process.platform === 'win32' ? iconIco : iconPng,
    // Matches the active theme's paper so there is no flash before the page paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141210' : '#F3EFE7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  win.on('close', e => {
    if (tray && !quitting) {
      e.preventDefault()
      win.hide()
    }
  })
  // External links open in the browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

// With the window hidden in the tray, opening Monte again must show it rather than start a second copy.
// Packaged only: a dev run alongside an installed copy is normal.
if (app.isPackaged && !app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', showWindow)
app.on('before-quit', () => {
  quitting = true
})

app.whenReady().then(async () => {
  applyTheme((await loadSettings().catch(() => DEFAULT_SETTINGS)).theme)
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => saveSettings(patch))
  ipcMain.handle('sleeper:findUser', wrap(monte.findUser))
  ipcMain.handle('sleeper:leagues', wrap(monte.listLeagues))
  ipcMain.handle('league:context', wrap(monte.leagueContext))
  ipcMain.handle('engine:bb', wrap(monte.runPickOdds))
  ipcMain.handle('engine:pwopr', wrap(monte.runPwopr))
  ipcMain.handle('league:overview', wrap(monte.leagueOverview))
  ipcMain.handle('league:ranks', wrap(monte.ranks))
  ipcMain.handle('league:startSit', wrap(monte.startSit))
  ipcMain.handle('league:trades', wrap(monte.trades))
  ipcMain.handle('league:draft', wrap(monte.draft))
  ipcMain.handle('league:week', wrap(monte.leagueWeek))
  ipcMain.handle('league:leagueTrades', wrap(async (leagueId: string) => monte.leagueTrades(leagueId, await readSleeperToken())))
  ipcMain.handle('draft:picks', wrap(monte.draftPicks))
  ipcMain.handle('players:search', wrap(monte.searchPlayers))
  ipcMain.handle('players:info', wrap(monte.playerInfo))
  ipcMain.handle('injuries:bundled', wrap(monte.bundledInjuries))
  ipcMain.handle('ranks:choose', wrap(chooseRanksFile))
  ipcMain.handle('ranks:link', wrap(setSheetLink))
  ipcMain.handle('league:trackRecord', wrap(monte.trackRecord))
  ipcMain.handle('league:waivers', wrap(async (leagueId: string, userId: string) => monte.waiverDesk(leagueId, userId, await readSleeperToken())))
  ipcMain.handle('ranks:info', wrap(async () => loadRanksFile((await loadSettings()).ranksFile)))
  ipcMain.handle('sleeper:connect', wrap(connectSleeper))
  ipcMain.handle('sleeper:signIn', wrap(signInSleeper))
  ipcMain.handle('sleeper:disconnect', () => disconnectSleeper())
  ipcMain.handle('sleeper:propose', (_e, p: TradeProposal) => sendTrade(p))
  ipcMain.handle('sleeper:lineup', (_e, w: LineupWrite) => sendLineup(w))
  ipcMain.handle('sleeper:answer', (_e, a: OfferAnswer) => sendAnswer(a))
  ipcMain.handle('sleeper:claim', (_e, c: WaiverClaim) => withSleeper(token => monte.sendWaiverClaim(c, token)))
  ipcMain.handle('sleeper:cancelClaim', (_e, r: ClaimRef) => withSleeper(token => monte.cancelWaiverClaim(r, token)))
  ipcMain.handle('sleeper:claimBid', (_e, r: ClaimRef, bid: number) => withSleeper(token => monte.updateWaiverBid(r, bid, token)))
  ipcMain.handle('sleeper:ir', (_e, m: IrMove) => withSleeper(token => monte.moveIr(m, token)))
  const updater = createUpdater(state => broadcast('update:changed', state))
  ipcMain.handle('update:state', () => updater.state())
  ipcMain.handle('update:check', () => updater.check())
  ipcMain.handle('update:download', () => updater.download())
  ipcMain.handle('update:install', () => updater.install())

  // Windows ties notifications to this id; it matches the installer's.
  if (process.platform === 'win32') app.setAppUserModelId('com.blackarmchair.monte')
  createWindow()
  syncTray(!!(await loadSettings().catch(() => DEFAULT_SETTINGS)).keepRunning)
  startOfferChecks()
  startSheetChecks()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
