// Types shared by main, preload and renderer. The engine result shapes mirror
// sleeperStandings' BBResult / PWOPRResult; only the fields the UI reads are listed.

import type { LineupWrite } from './sleeperLineup'
import type { TradeProposal } from './sleeperTrade'
import type { LeagueTrades, LeagueWeek } from './leagueWeek'

export type Theme = 'light' | 'dark' | 'system'

/** A player the user has marked out, overriding Sleeper tags and ESPN's return estimate. */
export type ManualInjury = {
  id: string
  name: string
  pos: string
  team: string
  /** first NFL week he plays again; null = out for the season */
  returnWeek: number | null
  /** the season this applies to; older entries go by addedAt (see injuries.ts) */
  season?: string
  note?: string
  addedAt: string
}

export type PlayerHit = { id: string; name: string; pos: string; team: string; injury: string }

/** One game from Sleeper's per-player weekly stats (stat keys as Sleeper names them). */
export type GameLog = { week: number; opp: string; away?: boolean; stats: Record<string, number> }

/** A player's Sleeper record and this season's games, for the player page. */
/** A player's place on the sheet's overall board: overall rank and rank within his position. */
export type BoardRank = { rank: number; posRank: number }

/** Which of the sheet's two board blocks to show: the setting, or by default the league's own TE
 *  bonus (the .75 TE-prem block when it has one). */
export const tepBoardFor = (pref: Settings['rankBoard'], tePremium: number) => (pref === 'tep' ? true : pref === 'plain' ? false : tePremium > 0)
export const boardRankFor = (t: { plain: BoardRank | null; tep: BoardRank | null } | null | undefined, tep: boolean) =>
  t ? (tep ? t.tep ?? t.plain : t.plain ?? t.tep) : null
/** "Board #12 · WR4", or null when he isn't on the board. */
export const boardRankLabel = (r: BoardRank | null, pos: string) => (r ? `Board #${r.rank} · ${pos}${r.posRank}` : null)

export type PlayerInfo = {
  id: string
  name: string
  pos: string
  team: string
  age: number | null
  /** inches */
  height: number | null
  /** pounds */
  weight: number | null
  college: string | null
  yearsExp: number | null
  /** Sleeper injury tag, '' when healthy */
  injury: string
  season: string
  games: GameLog[]
  /** The sheet's rank on each board block (no TE prem / TE prem); null when there's no sheet */
  board: { plain: BoardRank | null; tep: BoardRank | null } | null
}

export type Settings = {
  /** dark when unset; system follows the OS */
  theme?: Theme
  username?: string
  userId?: string
  displayName?: string
  lastLeagueId?: string
  /** absolute path of the user's downloaded rankings workbook */
  ranksFile?: string
  sims: number
  strengthCV: number
  /** pick-odds RNG seed: the same inputs and seed give the same odds. Changes only on "New seed". */
  seed: number
  /** pick-odds model: 'B' fitted availability (default); 'A' everyone projected plays every week */
  model?: 'A' | 'B'
  /** per league: how much its managers trade like the market (0–1); 1 = fully */
  marketBeta?: Record<string, number>
  /** manual injury overrides, applied in Pick Odds, PWOPR and Start/Sit */
  injuries?: ManualInjury[]
  /** replace usernames and team names with "Team #n" everywhere */
  hideNames?: boolean
  /** trade builder: 'raw' = the sheet as-is (default), 'relative' = within position. Ideas always use raw. */
  tradeDelta?: 'relative' | 'raw'
  /** Sheet board for ranks shown on Players and player pages: 'league' (default) follows the
   *  league's TE bonus; 'tep' / 'plain' force the TE-prem or no-TE-prem block */
  rankBoard?: 'league' | 'tep' | 'plain'
  /** per league: your direction for trade ideas; unset = worked out from record and pick odds */
  tradeMode?: Record<string, 'contend' | 'rebuild' | 'middle'>
  /** phone app: when the rankings workbook in `ranksFile` was picked (it has no watcher) */
  ranksPickedAt?: string
  /** phone app: the picked workbook's own file name (the stored copy has a fixed name) */
  ranksName?: string
  /** Sleeper connected for sending trade offers (the token itself is in secure storage — the
   *  phone's Keychain/Keystore, the desktop's OS-encrypted file — never here) */
  sleeperLink?: { name: string; expiresAt: number | null; connectedAt: string }
  /** the rankings sheet's Google Sheets link: when set, Monte keeps the sheet current from it */
  sheetLink?: string
  /** phone app: when the linked sheet was last checked (the desktop checks on a timer) */
  sheetCheckedAt?: string
  /** desktop: closing the window keeps Monte in the tray, so offer notifications keep coming */
  keepRunning?: boolean
  /** alerts for new trade offers. Desktop: on unless turned off. Phone: off until turned on, since it needs permission. */
  notifyOffers?: boolean
  /** offers already alerted about, oldest first */
  seenOffers?: string[]
  /** players marked taken by hand on a draft's Board, by draft id (the few most recent drafts) */
  draftMarks?: Record<string, string[]>
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
  /** `original:round` -> roster id that currently owns that next-draft pick */
  pickOwner: Record<string, number>
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
  /** added by Monte: the RNG seed the run used */
  seed: number
  /** added by Monte: the model the run used */
  model: 'A' | 'B'
  /** added by Monte: the what-if results the run assumed (week -> forced winners) */
  forced: Record<number, number[]>
  /** added by Monte: the next unfinished week's head-to-head pairs, for what-if toggles */
  whatIf: { week: number; pairs: Array<[number, number]> } | null
  ranAt: string
}

/** `seed` defaults to the saved setting; pass it when the setting is being changed in the same step. */
export type PickOddsOpts = {
  sims: number
  strengthCV: number
  forced?: Record<number, number[]>
  seed?: number
  model?: 'A' | 'B'
  /** a run nobody asked for by hand: a recent saved result with the same inputs will do */
  cached?: boolean
}

export type Signal = 'Over (Strong)' | 'Over' | 'Neutral' | 'Under' | 'Under (Strong)'

/** plain means over a run of played games */
export type UsageWindow = {
  games: number
  tgtShare: number
  airShare: number
  tgtPerGame: number
  /** offensive snap share: Sleeper has no routes, so this stands in for route participation */
  snapShare: number | null
}

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
  /** the last few played games (3) and the whole season; absent from runs made before they existed */
  recent?: UsageWindow | null
  season?: UsageWindow | null
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
  /** Sheet overall rank on the TE-prem board; null = unranked */
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
  /** opponent text from the board, e.g. "at LV" */
  matchup: string
  /** positional rank on this week's board; null = not on the board */
  rank: number | null
  /** "WR24", or "WR—" when unranked */
  rankLabel: string
  /** rank on the sheet's Flex board, when it is filled */
  flexRank: number | null
  /** rank mapped to last season's PPG at that positional rank, in this league's scoring */
  proj: number
  startable: boolean
  /** why he is or isn't startable, in the sheet's words where it gave them */
  flag: string
  /** The sheet and Sleeper disagree about him */
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
  rosterId: number
  /** Sleeper's starters as read, slot order ("0" = empty), including slots Monte doesn't rank */
  starters: string[]
  /** week number in the sheet's tab names */
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

export type TradeTeam = {
  roster_id: number
  name: string
  owner: string
  wins: number
  losses: number
  full: boolean
  /** starters out this week, by position */
  holes: Array<{ pos: string; name: string; status: string }>
}

export type TradeData = {
  /** every rostered player; picks are priced in the renderer from `picks` + `pickInputs` */
  assets: import('./tradeMath').Asset[]
  /** players on no roster here that the sheet or the market prices (owner 0): the Vacuum tab's extra pool */
  freeAgents: import('./tradeMath').Asset[]
  ranks: Record<string, { sheetRank: number | null; marketRank: number | null }>
  picks: Array<{ season: string; round: number; originalOwner: number; owner: number }>
  pickInputs: import('./tradeMath').PickInputs
  teams: TradeTeam[]
  myRosterId: number | null
  phase: import('./strategy').Phase
  deadline: import('./strategy').TradeDeadline
  /** in-season positional PPG rank a weekly starter clears, per position */
  starterLine: Record<string, number>
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
  /** Sheet overall rank, TE-prem board */
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

/** One row of a superflex board, as the sheet ranks it, matched to Sleeper where possible. */
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
/** Desktop only: where the app is in updating itself from GitHub Releases. */
export type UpdateState = {
  status: 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
  /** the running version */
  current: string
  /** the newer version, once one is known */
  version?: string
  percent?: number
  error?: string
  checkedAt?: string
}

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
  /** The sheet's superflex boards, matched to this league's rosters */
  ranks(leagueId: string, userId: string): Promise<Result<RanksData>>
  searchPlayers(query: string): Promise<Result<PlayerHit[]>>
  /** Sleeper bio and this season's weekly games, for the player page */
  playerInfo(id: string): Promise<Result<PlayerInfo>>
  /** the return weeks / season-enders hard-coded in sleeperStandings' config, resolved to players */
  bundledInjuries(): Promise<Result<ManualInjury[]>>
  chooseRanksFile(): Promise<Result<RanksFileInfo | null>>
  ranksFileInfo(): Promise<Result<RanksFileInfo | null>>
  /** Connect Sleeper for trade offers: the session token must work and be this user's. */
  connectSleeper(token: string): Promise<Result<Settings>>
  /** Sign in on Sleeper's own page in a separate window. Null if the window was just closed. */
  signInSleeper(): Promise<Result<Settings | null>>
  disconnectSleeper(): Promise<Settings>
  /** Send a trade offer in Sleeper. `needsConnect` means connect (again) and retry. */
  /** this week's matchups with Monte's win chance */
  leagueWeek(leagueId: string): Promise<Result<LeagueWeek>>
  /** completed trades, and your open offers when Sleeper is connected */
  leagueTrades(leagueId: string): Promise<Result<LeagueTrades>>
  proposeTrade(p: TradeProposal): Promise<Result<{ transactionId: string; mismatch: string | null }> & { needsConnect?: boolean }>
  /** Accept or reject an offer made to you. `needsConnect` means connect (again) and retry. */
  answerOffer(a: import('./sleeperOffers').OfferAnswer): Promise<Result<{ status: string; mismatch: string | null }> & { needsConnect?: boolean }>
  /** Set this week's starters in Sleeper. `needsConnect` means connect (again) and retry. */
  setLineup(w: LineupWrite): Promise<Result<{ mismatch: string | null }> & { needsConnect?: boolean }>
  /** keep the rankings sheet current from a Google Sheets link; null stops. Returns the sheet now in use. */
  setSheetLink(link: string | null): Promise<Result<RanksFileInfo | null>>
  /** how Monte's matchup win chances have held up this season */
  trackRecord(userId: string): Promise<Result<import('./trackRecord').TrackRecord>>
  /** fires when a new-offer notification is clicked, with its league */
  onOpenLeague(cb: (leagueId: string) => void): () => void
  /** fires when the watched rankings file changes on disk */
  onRanksFileChanged(cb: (info: RanksFileInfo | null) => void): () => void
  updateState(): Promise<UpdateState>
  checkForUpdate(): Promise<UpdateState>
  downloadUpdate(): Promise<UpdateState>
  /** quits, installs the downloaded update and relaunches */
  installUpdate(): Promise<void>
  onUpdateChanged(cb: (state: UpdateState) => void): () => void
}
