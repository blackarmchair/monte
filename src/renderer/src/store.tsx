// App-wide state: settings, leagues, the selected league's context, cached engine runs, the
// rankings file, the trade being built, the filters other screens can set, Pick odds' what-if
// results, and navigation (five sections plus pushed pages: Player, Settings). The same shape as
// the phone's store, so screens port across.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BBResult, LeagueContext, LeagueSummary, PickOddsOpts, PWOPRResult, RanksFileInfo, Run, Settings } from '@shared/types'
import { anonBB, anonContext, leagueLabel } from './names'

export type TradeState = { give: string[]; get: string[]; partner: number | null }
export const EMPTY_TRADE: TradeState = { give: [], get: [], partner: null }
export type PlayersUi = { mode: 'value' | 'usage'; pos: string; q: string }
export const PLAYERS_UI: PlayersUi = { mode: 'value', pos: 'All', q: '' }
export type PicksSeg = 'odds' | 'draft'
/** Pick odds what-if: NFL week -> roster ids the user picked to win that week. */
export type Forced = Record<number, number[]>

export type Section = 'league' | 'lineup' | 'trade' | 'players' | 'picks'
export type Page = { kind: 'player'; id: string; name: string } | { kind: 'team'; rid: number; name: string } | { kind: 'settings' }
type Toast = { msg: string; action?: { label: string; onClick: () => void } }

type Runs<T> = Record<string, Run<T>>
const TOAST_MS = 2800

type App = {
  settings: Settings
  setSettings: (patch: Partial<Settings>) => Promise<void>
  /** settings main already saved (Sleeper connected or dropped) */
  settingsSaved: (s: Settings) => void
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
  bb: Run<BBResult>
  /** the latest baseline (no what-ifs), for pricing picks */
  bbBase: Run<BBResult>
  runBB: (opts?: PickOddsOpts) => void
  pw: Run<PWOPRResult>
  runPW: () => void
  sheet: RanksFileInfo | null
  sheetError: string | null
  chooseSheet: () => Promise<void>
  resync: () => Promise<void>
  /** changes whenever the workbook or injury overrides change: screens reload on it */
  dataVersion: string
  trade: TradeState
  setTrade: (f: (t: TradeState) => TradeState) => void
  playersUi: PlayersUi
  setPlayersUi: (f: (u: PlayersUi) => PlayersUi) => void
  picksSeg: PicksSeg
  setPicksSeg: (s: PicksSeg) => void
  forced: Forced
  setForced: (f: Forced) => void
  section: Section
  page: Page | null
  go: (s: Section) => void
  openPlayer: (id: string, name: string) => void
  openTeam: (rid: number, name: string) => void
  openSettings: () => void
  back: () => void
  /** the scroll container, so navigation can start a page at the top */
  scrollRef: React.RefObject<HTMLDivElement | null>
  toast: Toast | null
  showToast: (msg: string, action?: Toast['action']) => void
  hideToast: () => void
  /** Your asset goes to Give; anyone else's goes to Get with their team as partner. */
  addToTrade: (assetId: string, owner: number) => void
  findTargets: (pos: string) => void
  tradeWith: (owner: number) => void
  switchUser: () => Promise<void>
}

const Ctx = createContext<App | null>(null)

export function useApp(): App {
  const a = useContext(Ctx)
  if (!a) throw new Error('useApp outside AppProvider')
  return a
}

export function AppProvider({ settings, setSettingsState, children }: { settings: Settings; setSettingsState: (s: Settings) => void; children: ReactNode }) {
  const [leagues, setLeagues] = useState<LeagueSummary[]>([])
  const [leagueError, setLeagueError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [rawContext, setContext] = useState<LeagueContext | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const [bbRuns, setBB] = useState<Runs<BBResult>>({})
  const [pwRuns, setPW] = useState<Runs<PWOPRResult>>({})
  const [sheet, setSheet] = useState<RanksFileInfo | null>(null)
  const [sheetError, setSheetError] = useState<string | null>(null)
  const [trade, setTradeState] = useState<TradeState>(EMPTY_TRADE)
  const [playersUi, setPlayersUiState] = useState<PlayersUi>(PLAYERS_UI)
  const [picksSeg, setPicksSeg] = useState<PicksSeg>('odds')
  const [forced, setForced] = useState<Forced>({})
  const [section, setSection] = useState<Section>('league')
  const [stack, setStack] = useState<Page[]>([])
  const [toast, setToast] = useState<Toast | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /** latest pick-odds request per league: a slow run must not overwrite a newer one */
  const bbSeq = useRef<Record<string, number>>({})

  useEffect(() => {
    void window.monte.ranksFileInfo().then(r => (r.ok ? setSheet(r.value) : setSheetError(r.error)))
    return window.monte.onRanksFileChanged(info => {
      setSheet(info)
      setSheetError(info ? null : 'The file moved or could not be read.')
    })
  }, [])

  const setSettings = useCallback(async (patch: Partial<Settings>) => setSettingsState(await window.monte.setSettings(patch)), [setSettingsState])

  const loadLeagues = useCallback(() => {
    if (!settings.userId) return
    setLeagueError(null)
    void window.monte.listLeagues(settings.userId).then(r => {
      if (!r.ok) return setLeagueError(r.error)
      setLeagues(r.value)
      const keep = r.value.find(l => l.league_id === settings.lastLeagueId)
      setSelected(s => s ?? (keep ?? r.value[0])?.league_id ?? null)
    })
  }, [settings.userId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(loadLeagues, [loadLeagues])

  const loadContext = useCallback(() => {
    if (!selected || !settings.userId) return
    setContext(null)
    setContextError(null)
    setTradeState(EMPTY_TRADE)
    setForced({})
    // a team page belongs to the league it was opened in
    setStack(s => s.filter(p => p.kind !== 'team'))
    void window.monte.leagueContext(selected, settings.userId).then(r => (r.ok ? setContext(r.value) : setContextError(r.error)))
  }, [selected, settings.userId])
  useEffect(() => {
    if (selected) void window.monte.setSettings({ lastLeagueId: selected })
    loadContext()
  }, [loadContext, selected])

  const runBBFor = useCallback(async (leagueId: string, opts: PickOddsOpts) => {
    const seq = (bbSeq.current[leagueId] ?? 0) + 1
    bbSeq.current[leagueId] = seq
    setBB(m => ({ ...m, [leagueId]: { ...m[leagueId], busy: true, error: undefined } }))
    const r = await window.monte.runPickOdds(leagueId, opts)
    if (bbSeq.current[leagueId] !== seq) return
    // A run with no what-if results is the baseline that what-if runs are compared against.
    const baseline = r.ok && !Object.values(opts.forced ?? {}).some(w => w.length)
    setBB(m => ({ ...m, [leagueId]: r.ok ? { result: r.value, base: baseline ? r.value : m[leagueId]?.base } : { ...m[leagueId], busy: false, error: r.error } }))
  }, [])
  const runPWFor = useCallback(async (leagueId: string) => {
    setPW(m => ({ ...m, [leagueId]: { ...m[leagueId], busy: true, error: undefined } }))
    const r = await window.monte.runPwopr(leagueId)
    setPW(m => ({ ...m, [leagueId]: r.ok ? { result: r.value } : { ...m[leagueId], busy: false, error: r.error } }))
  }, [])

  const hide = !!settings.hideNames
  const id = rawContext?.league.league_id ?? null
  const context = useMemo(() => (rawContext && hide ? anonContext(rawContext) : rawContext), [rawContext, hide])
  // League names identify people too, so Hide names numbers them in the user's Sleeper order.
  const shownLeagues = useMemo(() => (hide ? leagues.map((l, i) => ({ ...l, name: leagueLabel(i), avatar: null })) : leagues), [leagues, hide])
  const bb = useMemo<Run<BBResult>>(() => {
    const r = (id && bbRuns[id]) || {}
    return hide ? { ...anonBB(r), base: r.base && anonBB({ result: r.base }).result } : r
  }, [bbRuns, id, hide])
  // League and Trade price picks off the real odds, not whatever what-if Pick odds last ran.
  const bbBase = useMemo(() => (bb.base ? { ...bb, result: bb.base } : bb), [bb])
  const pw = (id && pwRuns[id]) || {}

  const injSig = (settings.injuries ?? []).map(i => `${i.id}:${i.returnWeek ?? 'S'}`).join(',')
  const dataVersion = `${sheet ? `${sheet.path}|${sheet.modifiedAt}|${sheet.syncedAt}` : ''}|${injSig}`
  // Overrides change who can play, so every cached sim is stale.
  useEffect(() => {
    setBB({})
    setPW({})
  }, [injSig])

  const top = () => scrollRef.current?.scrollTo(0, 0)
  const go = (s: Section) => {
    setSection(s)
    setStack([])
    top()
  }
  const showToast = useCallback((msg: string, action?: Toast['action']) => {
    window.clearTimeout(toastTimer.current)
    setToast({ msg, action })
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])
  const myRid = rawContext?.myRosterId ?? null

  const value: App = {
    settings,
    setSettings,
    settingsSaved: setSettingsState,
    leagues: shownLeagues,
    leagueError,
    loadLeagues,
    selected,
    selectLeague: lid => setSelected(lid),
    context,
    contextError,
    loadContext,
    hide,
    bb,
    bbBase,
    runBB: opts => id && void runBBFor(id, opts ?? { sims: settings.sims, strengthCV: settings.strengthCV, seed: settings.seed, model: settings.model }),
    pw,
    runPW: () => id && void runPWFor(id),
    sheet,
    sheetError,
    async chooseSheet() {
      const r = await window.monte.chooseRanksFile()
      if (!r.ok) return setSheetError(r.error)
      if (r.value) {
        setSheet(r.value)
        setSheetError(null)
      }
    },
    async resync() {
      const r = await window.monte.ranksFileInfo()
      if (r.ok) {
        setSheet(r.value)
        setSheetError(null)
      } else setSheetError(r.error)
    },
    dataVersion,
    trade,
    setTrade: f => setTradeState(f),
    playersUi,
    setPlayersUi: f => setPlayersUiState(f),
    picksSeg,
    setPicksSeg,
    forced,
    setForced,
    section,
    page: stack[stack.length - 1] ?? null,
    go,
    openPlayer(pid, name) {
      setStack(s => [...s.filter(p => !(p.kind === 'player' && p.id === pid)), { kind: 'player', id: pid, name }])
      top()
    },
    openTeam(rid, name) {
      setStack(s => [...s.filter(p => !(p.kind === 'team' && p.rid === rid)), { kind: 'team', rid, name }])
      top()
    },
    openSettings() {
      setStack(s => (s[s.length - 1]?.kind === 'settings' ? s : [...s, { kind: 'settings' }]))
      top()
    },
    back() {
      setStack(s => s.slice(0, -1))
      top()
    },
    scrollRef,
    toast,
    showToast,
    hideToast: () => {
      window.clearTimeout(toastTimer.current)
      setToast(null)
    },
    addToTrade(assetId, owner) {
      if (owner === myRid) setTradeState(t => (t.give.includes(assetId) ? t : { ...t, give: [...t.give, assetId] }))
      else setTradeState(t => (t.partner !== owner ? { ...t, partner: owner, get: [assetId] } : t.get.includes(assetId) ? t : { ...t, get: [...t.get, assetId] }))
    },
    findTargets(pos) {
      setPlayersUiState(u => ({ ...u, mode: 'value', pos, q: '' }))
      go('players')
    },
    tradeWith(owner) {
      setTradeState(t => ({ ...t, partner: owner, get: t.partner === owner ? t.get : [] }))
      go('trade')
    },
    async switchUser() {
      setLeagues([])
      setSelected(null)
      setContext(null)
      setBB({})
      setPW({})
      setStack([])
      // the Sleeper session belongs to the old account
      if (settings.sleeperLink) await window.monte.disconnectSleeper()
      setSettingsState(await window.monte.setSettings({ userId: undefined, username: undefined, displayName: undefined }))
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
