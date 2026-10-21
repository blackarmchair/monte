// Types shared by main, preload and renderer. The engine result shapes mirror
// sleeperStandings' BBResult / PWOPRResult; only the fields the UI reads are listed.

export type Theme = 'light' | 'dark' | 'system'

/** A player the user has marked out, overriding Sleeper tags and ESPN's return estimate. */
export type ManualInjury = {
  id: string
  name: string
  pos: string
  team: string
  /** first NFL week he plays again; null = out for the season */
  returnWeek: number | null
  note?: string
  addedAt: string
}

export type PlayerHit = { id: string; name: string; pos: string; team: string; injury: string }

export type Settings = {
  /** light is the designed default; system follows the OS */
  theme?: Theme
  username?: string
  userId?: string
  displayName?: string
  lastLeagueId?: string
  /** absolute path of the user's downloaded rankings workbook */
  ranksFile?: string
  sims: number
  strengthCV: number
  /** per league: how much its managers trade like the market (0–1); 1 = fully */
  marketBeta?: Record<string, number>
  /** manual injury overrides, applied in Pick Odds, PWOPR and Start/Sit */
  injuries?: ManualInjury[]
  /** replace usernames and team names with "Team #n" everywhere */
  hideNames?: boolean
  /** trade gaps: 'relative' = within position (default), 'raw' = Tyler vs market as-is */
  tradeDelta?: 'relative' | 'raw'
  /** phone app: when the rankings workbook in `ranksFile` was picked (it has no watcher) */
  ranksPickedAt?: string
  /** phone app: the picked workbook's own file name (the stored copy has a fixed name) */
  ranksName?: string
  /** phone app: Sleeper connected for sending trade offers (the token itself is in secure
   *  storage, never here) */
  sleeperLink?: { name: string; expiresAt: number | null; connectedAt: string }
}

export type LeagueSummary = {
  league_id: string
  name: string
  season: string
  status: string
  total_rosters: number
  superflex: boolean
  tePremium: number
  avatar: string | null
}

export type RosterInfo = {
  roster_id: number
  owner_id: string | null
  display_name: string
  /** the team's league avatar, else the manager's Sleeper avatar; null when hidden or unset */
  avatar: string | null
  players: string[]
  wins: number
  losses: number
}

export type OwnedPick = {
  season: string
  round: number
  /** roster whose record decides the slot */
  originalRosterId: number
  originalName: string
}

export type LeagueContext = {
  league: LeagueSummary
  rosters: RosterInfo[]
  myRosterId: number | null
  draftSeason: string
  draftRounds: number
  myPicks: OwnedPick[]
  /** original roster id -> roster id that currently owns its next-draft 1st */
  firstOwner: Record<number, number>
  /** NFL week Sleeper is displaying */
  week: number
  fetchedAt: string
}

export type BBTeam = {
  roster_id: number
  team: string
  wins: number
  losses: number
  actualPF: number
  ytdMaxPF: number
  rosMaxPF: number
  totalMaxPF: number
  totalSd: number
  totalP10: number
  totalP90: number
  projWins: number
  playoffPct: number
  meanDraftSlot: number
  topPickPct: number
  slotDist: number[]
}

export type BBResult = {
  season: number
  weeks: number[]
  currentWeek: number
  lastScoredWeek: number
  inProgressWeek: number | null
  simulations: number
  playoffTeams: number
  scheduleLive: boolean
  zeroed: Array<{ team: string; player: string; status: string; weeks: string }>
  teams: BBTeam[]
  /** added by Monte: the strength CV the run used */
  strengthCV: number
  /** added by Monte: the what-if results the run assumed (week -> forced winners) */
  forced: Record<number, number[]>
  /** added by Monte: the next unfinished week's head-to-head pairs, for what-if toggles */
  whatIf: { week: number; pairs: Array<[number, number]> } | null
  ranAt: string
}

export type PickOddsOpts = { sims: number; strengthCV: number; forced?: Record<number, number[]> }

export type Signal = 'Over (Strong)' | 'Over' | 'Neutral' | 'Under' | 'Under (Strong)'

export type PWOPRRow = {
  player_id: string
  name: string
  team: string
  pos: string
  games: number
  tgtPerGame: number
  tgtShare: number
  airShare: number
  wopr: number
  expTargets: number
  usagePPG: number | null
  sleeperPPG: number | null
  priorPPG: number | null
  actualPPG: number | null
  proj: number
  tier: string
  signal: Signal
  delta: number | null
  actualSignal: Signal
  actualDelta: number | null
  status: string
}

export type PWOPRResult = {
  season: number
  targetWeek: number
  usageWeeks: number[]
  rows: PWOPRRow[]
  ranAt: string
}

export type RanksFileInfo = {
  path: string
  name: string
  /** file modification time (when the user last downloaded it) */
  modifiedAt: string
  /** when Monte last read it */
  syncedAt: string
  tabs: string[]
}

export type OvPlayer = {
  id: string
  name: string
  pos: 'QB' | 'RB' | 'WR' | 'TE'
  team: string
  age: number | null
  /** Tyler overall rank on the TE-prem board; null = unranked */
  rank: number | null
  value: number
  starter: boolean
  taxi: boolean
  ir: boolean
  /** Sleeper injury tag, '' when healthy */
  injury: string
}

export type OvTeam = {
  roster_id: number
  display_name: string
  team_name: string
  avatar: string | null
  wins: number
  losses: number
  ties: number
  pf: number
  players: OvPlayer[]
}

export type OvPick = { season: string; round: number; originalRosterId: number; ownerRosterId: number }

export type OverviewData = {
  sheet: { name: string; tab: string; column: string; modifiedAt: string; ranked: number; unmatched: string[] }
  /** the next rookie draft's season */
  season: string
  teams: OvTeam[]
  picks: OvPick[]
  /** undiscounted value at overall rookie pick index (round−1)·teams + slot−1 */
  pickCurve: number[]
  /** pick discount per draft: index 0 = the next draft (`season`), 1 = the one after, … */
  discount: number[]
  freeAgents: Record<'QB' | 'RB' | 'WR' | 'TE', OvPlayer[]>
  builtAt: string
}

export type SSPlayer = {
  id: string
  name: string
  pos: string
  team: string
  /** opponent text from Tyler's board, e.g. "at LV" */
  matchup: string
  /** positional rank on this week's board; null = not on the board */
  rank: number | null
  /** "WR24", or "WR—" when unranked */
  rankLabel: string
  /** rank on Tyler's Flex board, when he has filled it */
  flexRank: number | null
  /** rank mapped to last season's PPG at that positional rank, in this league's scoring */
  proj: number
  startable: boolean
  /** why he is or isn't startable, in Tyler's words where Tyler gave them */
  flag: string
  /** Tyler and Sleeper disagree about him */
  conflict: string | null
  /** his game has kicked off: Sleeper will not let him move */
  locked: boolean
}

export type SSSlot = { slot: string; label: string; current: SSPlayer | null; best: SSPlayer | null; locked: boolean; supported: boolean }
/** One player in, one out. `label` is the slot the incoming player ends up in. */
export type SSChange = { slot: string; label: string; inPlayer: SSPlayer; outPlayer: SSPlayer | null; gain: number; marginal: boolean }
/** A starter who stays in the lineup but changes slot so the incoming player fits. */
export type SSMove = { player: SSPlayer; from: string; to: string }

export type StartSitData = {
  week: number
  /** week number in Tyler's tab names */
  boardWeek: number | null
  sheet: { name: string; modifiedAt: string }
  /** which scoring column was read per position, and why */
  columns: Record<string, string>
  slots: SSSlot[]
  bench: SSPlayer[]
  changes: SSChange[]
  moves: SSMove[]
  totals: { current: number; best: number }
  /** best − current; under MIN_GAIN is "nothing to do" */
  gain: number
  minGain: number
  opponent: { name: string; total: number; rosterId?: number } | null
  warnings: string[]
  leagueUrl: string
  builtAt: string
}

export type TradeTeam = { roster_id: number; name: string; owner: string; wins: number; losses: number; full: boolean }

export type TradeData = {
  /** every rostered player; picks are priced in the renderer from `picks` + `pickInputs` */
  assets: import('./tradeMath').Asset[]
  ranks: Record<string, { sheetRank: number | null; marketRank: number | null }>
  picks: Array<{ season: string; round: number; originalOwner: number; owner: number }>
  pickInputs: import('./tradeMath').PickInputs
  teams: TradeTeam[]
  myRosterId: number | null
  gamma: number
  spotCost: number
  shape: import('./tradeMath').LeagueShape
  beta: number
  sheet: { name: string; modifiedAt: string }
  market: { source: string; asOf: string | null; stale: boolean; matched: number }
  builtAt: string
}

export type DraftStatus = 'pre_draft' | 'drafting' | 'paused' | 'complete'

export type DraftSummary = {
  draft_id: string
  season: string
  status: DraftStatus
  type: 'snake' | 'linear' | 'auction'
  rounds: number
  teams: number
  startTime: number | null
  /** null for a mock draft */
  leagueId: string | null
}

/** One pick in the draft order, made or not. */
export type DraftSlot = {
  pickNo: number
  round: number
  /** "2.04": round and position within the round */
  label: string
  slot: number
  /** roster whose slot this is; null when Sleeper has not set the order yet */
  originalRosterId: number | null
  /** roster that owns it now, after traded picks */
  rosterId: number | null
}

export type DraftPickRow = {
  pickNo: number
  round: number
  label: string
  slot: number | null
  /** roster that made the pick (Sleeper's own roster_id, so traded picks are already right) */
  rosterId: number | null
  playerId: string
  name: string
  pos: string
  team: string
}

export type DraftPoll = { status: DraftStatus; picks: DraftPickRow[]; polledAt: string }

export type DraftPlayer = {
  id: string
  name: string
  pos: 'QB' | 'RB' | 'WR' | 'TE'
  team: string
  age: number | null
  /** Tyler overall rank, TE-prem board */
  rank: number
  value: number
  /** in his first season as of this draft */
  rookie: boolean
  /** roster he is on now, if any */
  rosteredBy: number | null
  injury: string
}

export type DraftPool = 'rookies' | 'all'

export type DraftData = {
  draft: DraftSummary
  /** every draft in the league, newest season first */
  drafts: DraftSummary[]
  leagueName: string | null
  order: DraftSlot[]
  teams: Array<{ roster_id: number; name: string; owner: string; avatar: string | null }>
  myRosterId: number | null
  /** ranked players only, best first */
  players: DraftPlayer[]
  /** starters per position, for comparing rooms */
  starterDepth: Record<string, number>
  defaultPool: DraftPool
  sheet: { name: string; modifiedAt: string; unmatched: number }
  initial: DraftPoll
  builtAt: string
}

/** One row of a superflex board, as Tyler ranks it, matched to Sleeper where possible. */
export type RankRow = {
  rank: number
  name: string
  pos: string
  /** rank within his position on this board, e.g. 3 for WR3 */
  posRank: number
  /** Sleeper id; null when the sheet name matched no Sleeper skill player */
  id: string | null
  team: string
  age: number | null
  /** roster that has him in this league; null = free agent (or unmatched) */
  owner: number | null
  injury: string
}

export type RanksData = {
  sheet: { name: string; tab: string; modifiedAt: string }
  /** the overall board's blocks, left to right: no-TE-prem SF, then .75 TE-prem SF */
  boards: Array<{ label: string; tep: boolean; rows: RankRow[] }>
  teams: Array<{ roster_id: number; name: string; avatar: string | null }>
  myRosterId: number | null
  /** league TE premium, so the view can open on the board that matches the league */
  tePremium: number
  builtAt: string
}

/** One run slot per league per engine: result, in-flight flag and last error. `base` is the
 *  latest pick-odds run without what-if results, which what-if runs are compared against. */
export type Run<T> = { result?: T; busy?: boolean; error?: string; base?: T }

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** The surface preload exposes on window.monte. */
export type MonteApi = {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  findUser(username: string): Promise<Result<{ user_id: string; display_name: string }>>
  listLeagues(userId: string): Promise<Result<LeagueSummary[]>>
  leagueContext(leagueId: string, userId: string): Promise<Result<LeagueContext>>
  runPickOdds(leagueId: string, opts: PickOddsOpts): Promise<Result<BBResult>>
  runPwopr(leagueId: string): Promise<Result<PWOPRResult>>
  leagueOverview(leagueId: string): Promise<Result<OverviewData>>
  startSit(leagueId: string, userId: string): Promise<Result<StartSitData>>
  trades(leagueId: string, userId: string): Promise<Result<TradeData>>
  /** draftId omitted = the league's most relevant draft; a draft id from another league works (mocks) */
  draft(leagueId: string, userId: string, draftId?: string): Promise<Result<DraftData>>
  draftPicks(draftId: string): Promise<Result<DraftPoll>>
  /** Tyler's superflex boards, matched to this league's rosters */
  ranks(leagueId: string, userId: string): Promise<Result<RanksData>>
  searchPlayers(query: string): Promise<Result<PlayerHit[]>>
  /** the return weeks / season-enders hard-coded in sleeperStandings' config, resolved to players */
  bundledInjuries(): Promise<Result<ManualInjury[]>>
  chooseRanksFile(): Promise<Result<RanksFileInfo | null>>
  ranksFileInfo(): Promise<Result<RanksFileInfo | null>>
  /** fires when the watched rankings file changes on disk */
  onRanksFileChanged(cb: (info: RanksFileInfo | null) => void): () => void
}
