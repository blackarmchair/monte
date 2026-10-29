import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import createEngine from './engine.worker?nodeWorker'
// Windows wants the multi-size .ico (crisp at 16–256px in the title bar and taskbar).
import iconIco from '../../resources/icon.ico?asset'
import iconPng from '../../resources/icon.png?asset'
import type { EngineJob } from '@monte/core/engine'
import { createMonteService, DEFAULT_SETTINGS, toResult } from '@monte/core/service'
import { checkToken, proposeTrade, readToken, SleeperAuthError, type TradeProposal } from '@monte/core/sleeperTrade'
import { setStarters, type LineupWrite } from '@monte/core/sleeperLineup'
import { readRanksFile, watchRanksFile } from './ranksFile'
import { loadWorkbook } from './workbook'
import type { RanksFileInfo, Result, Settings } from '@monte/core/types'

const dataDir = () => app.getPath('userData')
const settingsFile = () => join(dataDir(), 'settings.json')

function wrap<A extends unknown[], T>(fn: (...a: A) => Promise<T>) {
  return async (_e: unknown, ...a: A): Promise<Result<T>> => toResult(() => fn(...a))
}

// ---- settings --------------------------------------------------------------------------
async function loadSettings(): Promise<Settings> {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(await readFile(settingsFile(), 'utf8')) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch }
  if (patch.theme) applyTheme(next.theme)
  await mkdir(dataDir(), { recursive: true })
  await writeFile(settingsFile(), JSON.stringify(next, null, 2), 'utf8')
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

const sendLineup = (w: LineupWrite) => withSleeper(token => setStarters(w, token))

// ---- engine ----------------------------------------------------------------------------
function runWorker(job: EngineJob): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const w = createEngine({ workerData: job })
    w.once('message', (m: Result<unknown>) => {
      void w.terminate()
      m.ok ? resolve(m.value) : reject(new Error(m.error))
    })
    w.once('error', reject)
  })
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
  applyTheme((await loadSettings()).theme)
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

  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
