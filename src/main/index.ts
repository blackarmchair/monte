import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Notification, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import createEngine from './engine.worker?nodeWorker'
// Windows wants the multi-size .ico (crisp at 16–256px in the title bar and taskbar).
import iconIco from '../../resources/icon.ico?asset'
import iconPng from '../../resources/icon.png?asset'
import { ENGINE_DEADLINE_MS, ENGINE_TIMEOUT_MESSAGE, withDeadline } from '@monte/core/deadline'
import type { EngineJob } from '@monte/core/engine'
import { diffOffers, offerMessage } from '@monte/core/offerWatch'
import { createMonteService, DEFAULT_SETTINGS, toResult } from '@monte/core/service'
import { checkToken, proposeTrade, readToken, SleeperAuthError, type TradeProposal } from '@monte/core/sleeperTrade'
import { setStarters, type LineupWrite } from '@monte/core/sleeperLineup'
import { answerOffer, type OfferAnswer } from '@monte/core/sleeperOffers'
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
      const win = BrowserWindow.getAllWindows()[0]
      if (win?.isMinimized()) win.restore()
      win?.focus()
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
  await saveSettings({ ranksFile: r.filePaths[0] })
  return info
}

// ---- window ----------------------------------------------------------------------------
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
  // External links open in the browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

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
  ipcMain.handle('ranks:info', wrap(async () => loadRanksFile((await loadSettings()).ranksFile)))
  ipcMain.handle('sleeper:connect', wrap(connectSleeper))
  ipcMain.handle('sleeper:disconnect', () => disconnectSleeper())
  ipcMain.handle('sleeper:propose', (_e, p: TradeProposal) => sendTrade(p))
  ipcMain.handle('sleeper:lineup', (_e, w: LineupWrite) => sendLineup(w))
  ipcMain.handle('sleeper:answer', (_e, a: OfferAnswer) => sendAnswer(a))
  const updater = createUpdater(state => broadcast('update:changed', state))
  ipcMain.handle('update:state', () => updater.state())
  ipcMain.handle('update:check', () => updater.check())
  ipcMain.handle('update:download', () => updater.download())
  ipcMain.handle('update:install', () => updater.install())

  // Windows ties notifications to this id; it matches the installer's.
  if (process.platform === 'win32') app.setAppUserModelId('com.blackarmchair.monte')
  createWindow()
  startOfferChecks()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
