// App-wide state, ported from the desktop App.tsx: settings, leagues, the selected league's
// context, cached engine runs, the trade being built, the filters other tabs can set (Players,
// Picks), Pick odds' what-if results, and the click-throughs between tabs and pages.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { router } from 'expo-router'
import type { BBResult, LeagueContext, LeagueSummary, PickOddsOpts, PWOPRResult, Run, Settings } from '@monte/core/types'
import { anonBB, anonContext, leagueLabel } from '@monte/core/names'
import { monte, type SheetInfo } from './monte'

export type TradeState = { give: string[]; get: string[]; partner: number | null }
export const EMPTY_TRADE: TradeState = { give: [], get: [], partner: null }
/** Players tab filters, settable from other tabs ("Find RB targets"). */
export type PlayersUi = { mode: 'value' | 'usage'; pos: string; q: string }
export const PLAYERS_UI: PlayersUi = { mode: 'value', pos: 'All', q: '' }
export type PicksSeg = 'odds' | 'draft'
/** Pick odds what-if: NFL week -> roster ids the user picked to win that week. */
export type Forced = Record<number, number[]>

type Runs<T> = Record<string, Run<T>>

type App = {
  settings: Settings | null
  setSettings: (patch: Partial<Settings>) => Promise<void>
  leagues: LeagueSummary[]
  leagueError: string | null
  loadLeagues: () => void
  selected: string | null
  selectLeague: (id: string) => void
  /** names already hidden when Hide names is on */
  context: LeagueContext | null
  contextError: string | null
  loadContext: () => void
  hide: boolean
  /** this league's pick-odds run (what-if included) and its baseline-only view for pricing */
  bb: Run<BBResult>
  bbBase: Run<BBResult>
  runBB: (opts?: PickOddsOpts) => void
  pw: Run<PWOPRResult>
  runPW: () => void
  trade: TradeState
  setTrade: (f: (t: TradeState) => TradeState) => void
  playersUi: PlayersUi
  setPlayersUi: (f: (u: PlayersUi) => PlayersUi) => void
  picksSeg: PicksSeg
  setPicksSeg: (s: PicksSeg) => void
  /** the what-if results Pick odds and its sheet are running with */
  forced: Forced
  setForced: (f: Forced) => void
  sheet: SheetInfo | null
  sheetError: string | null
  /** a picked workbook is being read and checked */
  sheetBusy: boolean
  pickSheet: () => Promise<void>
  /** changes whenever the workbook or injury overrides change: screens reload on it */
  dataVersion: string
  /** Your asset goes to Give; anyone else's goes to Get with their team as partner (a different
   *  partner replaces the Get list). Stays on the current tab. */
  addToTrade: (assetId: string, owner: number) => void
  /** Players tab, Values, filtered to a position */
  findTargets: (pos: string) => void
  /** Trade tab with this team as partner */
  tradeWith: (owner: number) => void
  openTrade: () => void
  openPicks: (seg: PicksSeg) => void
  /** push the Team page */
  openTeam: (rid: number) => void
  /** push the Player page (name shows in the header while he loads) */
  openPlayer: (id: string, name: string) => void
  switchUser: () => Promise<void>
  /** connect Sleeper for sending trade offers; resolves to an error message, or null */
  connectSleeper: (token: string) => Promise<string | null>
  disconnectSleeper: () => Promise<void>
}

const Ctx = createContext<App | null>(null)

export function useApp(): App {
  const a = useContext(Ctx)
  if (!a) throw new Error('useApp outside AppProvider')
  return a
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings | null>(null)
  const [leagues, setLeagues] = useState<LeagueSummary[]>([])
  const [leagueError, setLeagueError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [rawContext, setContext] = useState<LeagueContext | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const [bbRuns, setBB] = useState<Runs<BBResult>>({})
  const [pwRuns, setPW] = useState<Runs<PWOPRResult>>({})
  const [trade, setTradeState] = useState<TradeState>(EMPTY_TRADE)
  const [playersUi, setPlayersUiState] = useState<PlayersUi>(PLAYERS_UI)
  const [picksSeg, setPicksSeg] = useState<PicksSeg>('odds')
  const [forced, setForced] = useState<Forced>({})
  const [sheet, setSheet] = useState<SheetInfo | null>(null)
  const [sheetError, setSheetError] = useState<string | null>(null)
  const [sheetBusy, setSheetBusy] = useState(false)
  const bbSeq = useRef<Record<string, number>>({})

  useEffect(() => {
    void monte.getSettings().then(setSettingsState)
    void monte.sheetInfo().then(setSheet)
  }, [])

  const setSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettingsState(await monte.setSettings(patch))
  }, [])

  const loadLeagues = useCallback(() => {
    if (!settings?.userId) return
    setLeagueError(null)
    void monte.listLeagues(settings.userId).then(r => {
      if (!r.ok) return setLeagueError(r.error)
      setLeagues(r.value)
      const keep = r.value.find(l => l.league_id === settings.lastLeagueId)
      setSelected(s => s ?? (keep ?? r.value[0])?.league_id ?? null)
    })
  }, [settings?.userId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(loadLeagues, [loadLeagues])

  const loadContext = useCallback(() => {
    if (!selected || !settings?.userId) return
    setContext(null)
    setContextError(null)
    setTradeState(EMPTY_TRADE)
    setForced({})
    void monte.leagueContext(selected, settings.userId).then(r => (r.ok ? setContext(r.value) : setContextError(r.error)))
  }, [selected, settings?.userId])
  useEffect(() => {
    if (selected) void monte.setSettings({ lastLeagueId: selected })
    loadContext()
  }, [loadContext, selected])

  const runBBFor = useCallback(async (leagueId: string, opts: PickOddsOpts) => {
    const seq = (bbSeq.current[leagueId] ?? 0) + 1
    bbSeq.current[leagueId] = seq
    setBB(m => ({ ...m, [leagueId]: { ...m[leagueId], busy: true, error: undefined } }))
    const r = await monte.runPickOdds(leagueId, opts)
    if (bbSeq.current[leagueId] !== seq) return
    // A run with no what-if results is the baseline that what-if runs are compared against.
    const baseline = r.ok && !Object.values(opts.forced ?? {}).some(w => w.length)
    setBB(m => ({
      ...m,
      [leagueId]: r.ok ? { result: r.value, base: baseline ? r.value : m[leagueId]?.base } : { ...m[leagueId], busy: false, error: r.error },
    }))
  }, [])

  const runPWFor = useCallback(async (leagueId: string) => {
    setPW(m => ({ ...m, [leagueId]: { ...m[leagueId], busy: true, error: undefined } }))
    const r = await monte.runPwopr(leagueId)
    setPW(m => ({ ...m, [leagueId]: r.ok ? { result: r.value } : { ...m[leagueId], busy: false, error: r.error } }))
  }, [])

  const hide = !!settings?.hideNames
  const id = rawContext?.league.league_id ?? null
  const context = useMemo(() => (rawContext && hide ? anonContext(rawContext) : rawContext), [rawContext, hide])
  const shownLeagues = useMemo(() => (hide ? leagues.map((l, i) => ({ ...l, name: leagueLabel(i), avatar: null })) : leagues), [leagues, hide])

  const bb = useMemo<Run<BBResult>>(() => {
    const r = (id && bbRuns[id]) || {}
    return hide ? { ...anonBB(r), base: r.base && anonBB({ result: r.base }).result } : r
  }, [bbRuns, id, hide])
  // Overview and Trades price picks off the real odds, not whatever what-if Pick Odds last ran.
  const bbBase = useMemo(() => (bb.base ? { ...bb, result: bb.base } : bb), [bb])
  const pw = (id && pwRuns[id]) || {}

  const injSig = (settings?.injuries ?? []).map(i => `${i.id}:${i.returnWeek ?? 'S'}`).join(',')
  const dataVersion = `${sheet?.name ?? ''}|${sheet?.pickedAt ?? ''}|${injSig}`

  const myRid = rawContext?.myRosterId ?? null
  const value: App = {
    settings,
    setSettings,
    leagues: shownLeagues,
    leagueError,
    loadLeagues,
    selected,
    selectLeague: (lid: string) => setSelected(lid),
    context,
    contextError,
    loadContext,
    hide,
    bb,
    bbBase,
    runBB: opts => id && settings && void runBBFor(id, opts ?? { sims: settings.sims, strengthCV: settings.strengthCV }),
    pw,
    runPW: () => id && void runPWFor(id),
    trade,
    setTrade: f => setTradeState(f),
    playersUi,
    setPlayersUi: f => setPlayersUiState(f),
    picksSeg,
    setPicksSeg,
    forced,
    setForced,
    sheet,
    sheetError,
    sheetBusy,
    async pickSheet() {
      setSheetError(null)
      setSheetBusy(true)
      const r = await monte.pickSheet().finally(() => setSheetBusy(false))
      if (!r.ok) return setSheetError(r.error)
      if (r.value) {
        setSheet(r.value)
        setSheetError(null)
        setSettingsState(await monte.getSettings())
      }
    },
    dataVersion,
    addToTrade(assetId, owner) {
      if (owner === myRid) setTradeState(t => (t.give.includes(assetId) ? t : { ...t, give: [...t.give, assetId] }))
      else
        setTradeState(t =>
          t.partner !== owner ? { ...t, partner: owner, get: [assetId] } : t.get.includes(assetId) ? t : { ...t, get: [...t.get, assetId] },
        )
    },
    findTargets(pos) {
      setPlayersUiState(u => ({ ...u, mode: 'value', pos, q: '' }))
      router.navigate('/players')
    },
    tradeWith(owner) {
      setTradeState(t => ({ ...t, partner: owner, get: t.partner === owner ? t.get : [] }))
      router.navigate('/trade')
    },
    openTrade() {
      router.navigate('/trade')
    },
    openPicks(seg) {
      setPicksSeg(seg)
      router.navigate('/picks')
    },
    openTeam(rid) {
      router.navigate({ pathname: '/team', params: { rid: String(rid) } })
    },
    openPlayer(id, name) {
      router.navigate({ pathname: '/player', params: { id, name } })
    },
    async connectSleeper(token) {
      const r = await monte.connectSleeper(token)
      if (!r.ok) return r.error
      setSettingsState(r.value)
      return null
    },
    async disconnectSleeper() {
      setSettingsState(await monte.disconnectSleeper())
    },
    async switchUser() {
      await monte.disconnectSleeper()
      setLeagues([])
      setSelected(null)
      setContext(null)
      setBB({})
      setPW({})
      setSettingsState(await monte.setSettings({ userId: undefined, username: undefined, displayName: undefined }))
    },
  }
  // Injury overrides change who can play, so cached sims are stale.
  useEffect(() => {
    setBB({})
    setPW({})
  }, [injSig])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
