// The phone's host for @monte/core: the same service the desktop app runs in its main process,
// here in-process. `monte` mirrors the desktop's window.monte (same names, same Result shapes) so
// screens port across without a second data layer.
import { ENGINE_DEADLINE_MS, ENGINE_TIMEOUT_MESSAGE, withDeadline } from '@monte/core/deadline'
import { runEngineJob, type EngineJob } from '@monte/core/engine'
import { diffOffers, type FoundOffer } from '@monte/core/offerWatch'
import { createMonteService, DEFAULT_SETTINGS, toResult } from '@monte/core/service'
import { fetchSheet, sameWorkbook, SHEET_CHECK_MS } from '@monte/core/sheetLink'
import { unzipSync } from 'fflate'
import type { PickOddsOpts, Result, Settings } from '@monte/core/types'
import { readWorkbook, type Book } from '@monte/core/xlsx'
import { fileName } from '@monte/core/paths'
import { checkToken, proposeTrade, readToken, SleeperAuthError, type TradeProposal } from '@monte/core/sleeperTrade'
import { setStarters, type LineupWrite } from '@monte/core/sleeperLineup'
import { answerOffer, type OfferAnswer } from '@monte/core/sleeperOffers'
import type { ClaimRef, IrMove, WaiverClaim } from '@monte/core/sleeperWaivers'
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

// Saves reach the disk one at a time and in order, so an older save can't land over a newer one.
let settingsWrites: Promise<unknown> = Promise.resolve()
async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch }
  settings = next
  const write = settingsWrites.then(() => storage.writeSettings(JSON.stringify(next)))
  settingsWrites = write.catch(() => undefined)
  await write
  return next
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
  const next = queue.then(() => new Promise(r => setTimeout(r, 60))).then(() => withDeadline(runEngineJob(job), ENGINE_DEADLINE_MS, ENGINE_TIMEOUT_MESSAGE))
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

const LINKED_NAME = 'Your linked Google Sheet'

/** Download the linked sheet and swap it in if its data changed. The new sheet, or null if nothing changed. */
async function pullLinkedSheet(link: string): Promise<SheetInfo | null> {
  const bytes = await fetchSheet(link)
  try {
    readWorkbook(bytes)
  } catch {
    throw new Error("Google sent something that isn't a workbook Monte can read.")
  }
  const s = await loadSettings()
  const checkedAt = new Date().toISOString()
  const held = s.ranksFile && s.ranksName === LINKED_NAME ? await storage.readSheet(s.ranksFile).catch(() => null) : null
  if (held && sameWorkbook(held, bytes, unzipSync)) {
    await saveSettings({ sheetCheckedAt: checkedAt })
    return null
  }
  const uri = await storage.storeSheet(bytes)
  book = null
  return sheetInfo(await saveSettings({ ranksFile: uri, ranksName: LINKED_NAME, ranksPickedAt: checkedAt, sheetCheckedAt: checkedAt }))
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
  leagueWeek: (leagueId: string) => toResult(() => service.leagueWeek(leagueId)),
  leagueTrades: (leagueId: string) => toResult(async () => service.leagueTrades(leagueId, await storage.readToken())),
  draftPicks: (draftId: string) => toResult(() => service.draftPicks(draftId)),
  searchPlayers: (query: string) => toResult(() => service.searchPlayers(query)),
  playerInfo: (id: string) => toResult(() => service.playerInfo(id)),
  bundledInjuries: () => toResult(() => service.bundledInjuries()),
  trackRecord: (userId: string) => toResult(() => service.trackRecord(userId)),
  waiverDesk: (leagueId: string, userId: string) => toResult(async () => service.waiverDesk(leagueId, userId, await storage.readToken())),

  /** Keep the sheet current from a Google Sheets link; null stops. A link that fails changes nothing. */
  async setSheetLink(link: string | null): Promise<Result<SheetInfo | null>> {
    return toResult(async () => {
      if (!link) return sheetInfo(await saveSettings({ sheetLink: undefined, sheetCheckedAt: undefined }))
      await pullLinkedSheet(link)
      return sheetInfo(await saveSettings({ sheetLink: link }))
    })
  },

  /** On launch or returning to the app, at most every few hours. Failing quietly keeps the sheet it has. */
  async checkLinkedSheet(): Promise<SheetInfo | null> {
    const s = await loadSettings()
    if (!s.sheetLink || (s.sheetCheckedAt && Date.now() - Date.parse(s.sheetCheckedAt) < SHEET_CHECK_MS)) return null
    return pullLinkedSheet(s.sheetLink).catch(() => null)
  },

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

  /**
   * Offers Monte hasn't alerted about yet, across every league, marked as seen. Nothing when alerts
   * are off or Sleeper isn't connected. A refused token throws, and is left for the next real write
   * to deal with: a background check must not disconnect anyone.
   */
  async newOffers(): Promise<{ fresh: FoundOffer[]; hideNames: boolean }> {
    const s = await loadSettings()
    const token = s.notifyOffers && s.userId && s.sleeperLink ? await storage.readToken() : null
    if (!token) return { fresh: [], hideNames: !!s.hideNames }
    const { fresh, seen } = diffOffers(await service.receivedOffers(s.userId!, token), s.seenOffers ?? [])
    if (fresh.length) await saveSettings({ seenOffers: seen })
    return { fresh, hideNames: !!s.hideNames }
  },

  /** Accept or reject an offer made to you. `needsConnect` means connect (again) and retry. */
  answerOffer: (a: OfferAnswer) => withSleeper(token => answerOffer(a, token)),

  /** Add a player: at once if he's a free agent, else as a waiver claim. `needsConnect` means connect (again) and retry. */
  sendWaiverClaim: (c: WaiverClaim) => withSleeper(token => service.sendWaiverClaim(c, token)),
  cancelWaiverClaim: (r: ClaimRef) => withSleeper(token => service.cancelWaiverClaim(r, token)),
  updateWaiverBid: (r: ClaimRef, bid: number) => withSleeper(token => service.updateWaiverBid(r, bid, token)),
  moveIr: (m: IrMove) => withSleeper(token => service.moveIr(m, token)),

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
        throw new Error(`${picked.name} isn't an Excel workbook Monte can read. Download the sheet as .xlsx and pick that.`)
      }
      const uri = await storage.storeSheet(picked.bytes)
      book = null
      return sheetInfo(await saveSettings({ ranksFile: uri, ranksName: picked.name, ranksPickedAt: new Date().toISOString(), sheetLink: undefined, sheetCheckedAt: undefined }))
    })
  },
}

export type Monte = typeof monte
