// The phone's host for @monte/core: the same service the desktop app runs in its main process,
// here in-process. `monte` mirrors the desktop's window.monte (same names, same Result shapes) so
// screens port across without a second data layer.
import { runEngineJob, type EngineJob } from '@monte/core/engine'
import { createMonteService, DEFAULT_SETTINGS, toResult } from '@monte/core/service'
import type { PickOddsOpts, Result, Settings } from '@monte/core/types'
import { readWorkbook, type Book } from '@monte/core/xlsx'
import { fileName } from '@monte/core/paths'
import { checkToken, proposeTrade, readToken, SleeperAuthError, type TradeProposal } from '@monte/core/sleeperTrade'
import { setStarters, type LineupWrite } from '@monte/core/sleeperLineup'
import * as storage from './storage'

/** A phone runs the sim on the UI's JS thread, so it defaults to fewer sims than desktop. */
const PHONE_DEFAULTS: Settings = { ...DEFAULT_SETTINGS, sims: 1000 }

let settings: Settings | null = null
async function loadSettings(): Promise<Settings> {
  if (!settings) {
    let saved: Partial<Settings> = {}
    try {
      saved = JSON.parse((await storage.readSettings()) ?? '{}')
    } catch {
      /* unreadable: start fresh */
    }
    settings = { ...PHONE_DEFAULTS, ...saved }
  }
  return settings
}

async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  settings = { ...(await loadSettings()), ...patch }
  await storage.writeSettings(JSON.stringify(settings))
  return settings
}

// One parsed workbook, re-read only when a new one is picked. Several tabs ask at once on
// launch, so they share one read.
let book: { key: string; book: Promise<Book> } | null = null
async function loadBook(): Promise<Book> {
  const s = await loadSettings()
  if (!s.ranksFile) throw new Error('Pick your rankings workbook in Settings first.')
  const key = `${s.ranksFile}|${s.ranksPickedAt ?? ''}`
  if (book?.key !== key) {
    const file = s.ranksFile
    const read = (async () => ({
      wb: readWorkbook(await storage.readSheet(file)),
      // `path` is only shown (as the sheet's name), so it carries the user's file name.
      path: s.ranksName ?? file,
      modifiedAt: s.ranksPickedAt ?? new Date().toISOString(),
    }))()
    book = { key, book: read }
    // A failed read isn't cached: the next ask tries again.
    read.catch(() => {
      if (book?.book === read) book = null
    })
  }
  return book.book
}

// sleeperStandings keeps one mutable Config per JS context: jobs run strictly one at a time.
let queue: Promise<unknown> = Promise.resolve()
function runEngine(job: EngineJob): Promise<unknown> {
  // Let the UI paint its "running" state before the sim takes the JS thread.
  const next = queue.then(() => new Promise(r => setTimeout(r, 60))).then(() => runEngineJob(job))
  queue = next.catch(() => undefined)
  return next
}

const service = createMonteService({
  settings: loadSettings,
  cacheRead: storage.cacheRead,
  cacheWrite: storage.cacheWrite,
  loadBook,
  runEngine,
})

export type SheetInfo = { name: string; pickedAt: string | null }
const sheetInfo = (s: Settings): SheetInfo | null =>
  s.ranksFile ? { name: s.ranksName ?? fileName(s.ranksFile), pickedAt: s.ranksPickedAt ?? null } : null

/** Run a Sleeper write with the stored token; a refused token disconnects, and `needsConnect` says so. */
async function withSleeper<T>(run: (token: string) => Promise<T>): Promise<Result<T> & { needsConnect?: boolean }> {
  const token = await storage.readToken()
  if (!token) return { ok: false, error: 'Connect Sleeper first.', needsConnect: true }
  try {
    return { ok: true, value: await run(token) }
  } catch (e) {
    const auth = e instanceof SleeperAuthError
    if (auth) {
      await storage.clearToken()
      await saveSettings({ sleeperLink: undefined })
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e), needsConnect: auth }
  }
}

export const monte = {
  getSettings: loadSettings,
  setSettings: saveSettings,
  findUser: (username: string) => toResult(() => service.findUser(username)),
  listLeagues: (userId: string) => toResult(() => service.listLeagues(userId)),
  leagueContext: (leagueId: string, userId: string) => toResult(() => service.leagueContext(leagueId, userId)),
  runPickOdds: (leagueId: string, opts: PickOddsOpts) => toResult(() => service.runPickOdds(leagueId, opts)),
  runPwopr: (leagueId: string) => toResult(() => service.runPwopr(leagueId)),
  leagueOverview: (leagueId: string) => toResult(() => service.leagueOverview(leagueId)),
  ranks: (leagueId: string, userId: string) => toResult(() => service.ranks(leagueId, userId)),
  startSit: (leagueId: string, userId: string) => toResult(() => service.startSit(leagueId, userId)),
  trades: (leagueId: string, userId: string) => toResult(() => service.trades(leagueId, userId)),
  draft: (leagueId: string, userId: string, draftId?: string) => toResult(() => service.draft(leagueId, userId, draftId)),
  draftPicks: (draftId: string) => toResult(() => service.draftPicks(draftId)),
  searchPlayers: (query: string) => toResult(() => service.searchPlayers(query)),
  playerInfo: (id: string) => toResult(() => service.playerInfo(id)),
  bundledInjuries: () => toResult(() => service.bundledInjuries()),

  /** Connect Sleeper for trade offers: the token must work and be this user's. */
  async connectSleeper(token: string): Promise<Result<Settings>> {
    return toResult(async () => {
      const s = await loadSettings()
      if (!s.userId) throw new Error('Sign in with your Sleeper username first.')
      const t = token.trim().replace(/^"|"$/g, '')
      if (!t) throw new Error('Paste the token first.')
      const name = await checkToken(t, s.userId)
      await storage.writeToken(t)
      const info = readToken(t)
      return saveSettings({ sleeperLink: { name: name || s.displayName || '', expiresAt: info?.expiresAt ?? null, connectedAt: new Date().toISOString() } })
    })
  },

  async disconnectSleeper(): Promise<Settings> {
    await storage.clearToken()
    return saveSettings({ sleeperLink: undefined })
  },

  /** Send a trade offer in Sleeper. `needsConnect` means connect (again) and retry. */
  proposeTrade: (p: TradeProposal) =>
    withSleeper(async token => {
      const r = await proposeTrade(p, token)
      return { transactionId: r.transactionId, mismatch: r.mismatch }
    }),

  /** Set this week's starters in Sleeper. `needsConnect` means connect (again) and retry. */
  setLineup: (w: LineupWrite) => withSleeper(token => setStarters(w, token)),

  async sheetInfo(): Promise<SheetInfo | null> {
    return sheetInfo(await loadSettings())
  },

  /** Pick the rankings .xlsx (Files, Drive, Downloads…), check it parses, keep a copy. */
  async pickSheet(): Promise<Result<SheetInfo | null>> {
    return toResult(async () => {
      const picked = await storage.pickSheetFile()
      if (!picked) return null
      // Validate before storing, so a wrong file never replaces a good one.
      try {
        readWorkbook(picked.bytes)
      } catch {
        throw new Error(`${picked.name} isn't an Excel workbook Monte can read. Download Tyler's sheet as .xlsx and pick that.`)
      }
      const uri = await storage.storeSheet(picked.bytes)
      book = null
      return sheetInfo(await saveSettings({ ranksFile: uri, ranksName: picked.name, ranksPickedAt: new Date().toISOString() }))
    })
  },
}

export type Monte = typeof monte
