// Everything Monte does between "the user asked for a screen" and "here is its data": Sleeper,
// FantasyCalc and schedule fetches, short-lived caches, and the screen builders. The host (the
// Electron main process, or the phone) supplies settings, storage, the workbook and the engine,
// so the same code serves both apps.
import { Config } from 'sleeper-standings/dist/config.js'
import { buildDraft, buildPoll, defaultDraft, summariseDraft } from './draft'
import type { EngineJob } from './engine'
import { buildOverview } from './overview'
import { buildRanks } from './ranks'
import { buildStartSit, type SeasonStats } from './startSit'
import { buildTrades, type FcRow } from './trades'
import type {
  BBResult,
  DraftData,
  DraftPoll,
  LeagueContext,
  LeagueSummary,
  ManualInjury,
  OverviewData,
  OwnedPick,
  PickOddsOpts,
  PlayerHit,
  PWOPRResult,
  RanksData,
  Result,
  RosterInfo,
  Settings,
  StartSitData,
  TradeData,
} from './types'
import { userAvatar } from './values'
import type { Book } from './xlsx'

const SLEEPER = 'https://api.sleeper.app/v1'
// Injury tags drive the sim's zeroing, so this cache must stay short. A 7-day cache once left
// 46 of 281 injury fields wrong after three days.
const PLAYERS_TTL_MS = 6 * 3600 * 1000

export const DEFAULT_SETTINGS: Settings = { sims: 3000, strengthCV: 0.08 }

// sleeperStandings' hard-coded injury notes, copied at load: on the phone the engine runs in this
// same JS context and overwrites Config.bb.returnWeek with the user's overrides on every run.
const BUNDLED_INJURIES = {
  returnWeek: { ...(Config.bb.returnWeek as Record<string, number>) },
  seasonEnders: [...(Config.bb.seasonEnders as string[])],
}

/** What a platform provides. Cache keys are flat file-like names ("players_nfl.json"). */
export type Host = {
  settings(): Promise<Settings>
  cacheRead(key: string): Promise<string | null>
  cacheWrite(key: string, data: string): Promise<void>
  /** the user's rankings workbook; throws a user-facing message when there is none */
  loadBook(): Promise<Book>
  runEngine(job: EngineJob): Promise<unknown>
}

/** Turn a throwing call into the Result shape the screens read. */
export async function toResult<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function sleeper<T = any>(path: string): Promise<T> {
  const res = await fetch(SLEEPER + path)
  if (!res.ok) throw new Error(`Sleeper ${path} returned ${res.status}`)
  return res.json() as Promise<T>
}

export function summarise(l: any): LeagueSummary {
  const positions: string[] = l.roster_positions ?? []
  return {
    league_id: l.league_id,
    name: l.name,
    season: String(l.season),
    status: l.status,
    total_rosters: l.total_rosters,
    superflex: positions.includes('SUPER_FLEX') || positions.filter(p => p === 'QB').length > 1,
    tePremium: Number(l.scoring_settings?.bonus_rec_te ?? 0),
    avatar: l.avatar ? `https://sleepercdn.com/avatars/thumbs/${l.avatar}` : null,
  }
}

/**
 * Which picks the user owns in the next rookie draft. Every roster starts with its own picks;
 * traded_picks then reassigns ownership. Without traded_picks "every team owns its own picks"
 * is wrong the moment one moves.
 */
function pickOwners(rosters: RosterInfo[], traded: any[], draftSeason: string, rounds: number): Map<string, number> {
  const owner = new Map<string, number>()
  for (const r of rosters) for (let rd = 1; rd <= rounds; rd++) owner.set(`${r.roster_id}:${rd}`, r.roster_id)
  for (const t of traded ?? [])
    if (String(t.season) === draftSeason && t.round <= rounds) owner.set(`${t.roster_id}:${t.round}`, t.owner_id)
  return owner
}

function ownedPicks(rosters: RosterInfo[], owner: Map<string, number>, draftSeason: string, myRosterId: number | null): OwnedPick[] {
  if (myRosterId == null) return []
  const name = new Map(rosters.map(r => [r.roster_id, r.display_name]))
  const out: OwnedPick[] = []
  for (const [key, o] of owner) {
    if (o !== myRosterId) continue
    const [orig, rd] = key.split(':').map(Number)
    out.push({ season: draftSeason, round: rd, originalRosterId: orig, originalName: name.get(orig) ?? `Roster ${orig}` })
  }
  return out.sort((a, b) => a.round - b.round || a.originalName.localeCompare(b.originalName))
}

/** Sleeper id -> return week (99 = season), the shape the engine's resolver takes. */
function overridesOf(s: Settings): Record<string, number> {
  const out: Record<string, number> = {}
  for (const i of s.injuries ?? []) out[i.id] = i.returnWeek ?? 99
  return out
}

const SKILL = new Set(['QB', 'RB', 'WR', 'TE'])
const nameOf = (p: any) => (p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`).trim()
const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '')
    .replace(/\s+/g, ' ')
    .trim()

export function createMonteService(host: Host) {
  async function cachedJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await host.cacheRead(key)
      return raw == null ? null : (JSON.parse(raw) as T)
    } catch {
      return null
    }
  }

  // Sleeper's whole player table (~5 MB): cached for a few hours, never longer (see TTL note).
  // Kept in memory too, since every screen asks for it and parsing it is not free on a phone.
  let metaMem: { at: number; players: Record<string, any> } | null = null
  async function playersMeta(): Promise<Record<string, any>> {
    if (metaMem && Date.now() - metaMem.at < PLAYERS_TTL_MS) return metaMem.players
    const cached = await cachedJson<{ fetchedAt: string; players: Record<string, any> }>('players_nfl.json')
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < PLAYERS_TTL_MS) {
      metaMem = { at: Date.parse(cached.fetchedAt), players: cached.players }
      return cached.players
    }
    const players = await sleeper<Record<string, any>>('/players/nfl')
    await host.cacheWrite('players_nfl.json', JSON.stringify({ fetchedAt: new Date().toISOString(), players }))
    metaMem = { at: Date.now(), players }
    return players
  }

  // Last season's stats never change once it's over, so they are fetched once and kept.
  async function seasonStats(season: number): Promise<SeasonStats> {
    const cached = await cachedJson<SeasonStats>(`stats_${season}.json`)
    if (cached) return cached
    const stats = await sleeper<SeasonStats>(`/stats/nfl/regular/${season}`)
    await host.cacheWrite(`stats_${season}.json`, JSON.stringify(stats))
    return stats
  }

  // Game status moves during a slate (pre_game -> in_game -> complete), so this cache is short.
  let schedCache: { season: string; at: number; games: Record<string, Record<number, string>> } | null = null
  async function nflSchedule(season: string) {
    if (schedCache && schedCache.season === season && Date.now() - schedCache.at < 5 * 60 * 1000) return schedCache.games
    const res = await fetch(`https://api.sleeper.app/schedule/nfl/regular/${season}`)
    if (!res.ok) throw new Error(`NFL schedule unavailable (${res.status}); byes can't be guessed, so no lineup.`)
    const games: Record<string, Record<number, string>> = {}
    for (const g of (await res.json()) as any[]) {
      if (g.status === 'canceled') continue
      for (const t of [g.home, g.away]) (games[t] ??= {})[g.week] = g.status || 'pre_game'
    }
    schedCache = { season, at: Date.now(), games }
    return games
  }

  /**
   * FantasyCalc dynasty values for one league format, with picks. The market moves daily, so the
   * cache is 12h; on a network failure a stale copy is reused (and flagged) rather than failing.
   */
  async function fantasyCalc(o: { teams: number; qbs: number; ppr: number }) {
    const key = `market_fc_${o.teams}tm_${o.qbs}qb_${o.ppr}ppr.json`
    const cached = await cachedJson<{ asOf: string; rows: FcRow[] }>(key)
    if (cached && Date.now() - Date.parse(cached.asOf) < 12 * 3600 * 1000) return { ...cached, stale: false }
    const url = `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=${o.qbs}&ppr=${o.ppr}&numTeams=${o.teams}&includePicks=true`
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`FantasyCalc returned ${res.status}`)
      const fresh = { asOf: new Date().toISOString(), rows: (await res.json()) as FcRow[] }
      await host.cacheWrite(key, JSON.stringify(fresh))
      return { ...fresh, stale: false }
    } catch (e) {
      if (cached) return { ...cached, stale: true }
      throw new Error(`Market values unavailable (${e instanceof Error ? e.message : e}) and no cached copy.`)
    }
  }

  async function league4(leagueId: string, traded = true) {
    return Promise.all([
      sleeper<any>(`/league/${leagueId}`),
      sleeper<any[]>(`/league/${leagueId}/rosters`),
      sleeper<any[]>(`/league/${leagueId}/users`),
      traded ? sleeper<any[]>(`/league/${leagueId}/traded_picks`) : Promise.resolve([] as any[]),
    ])
  }

  return {
    playersMeta,

    async findUser(username: string) {
      const u = await sleeper<any>(`/user/${encodeURIComponent(username.trim())}`)
      if (!u?.user_id) throw new Error(`No Sleeper user named "${username}"`)
      return { user_id: u.user_id as string, display_name: (u.display_name ?? username) as string }
    },

    async listLeagues(userId: string): Promise<LeagueSummary[]> {
      const state = await sleeper<any>('/state/nfl')
      const season = state.league_season || state.season
      const leagues = await sleeper<any[]>(`/user/${userId}/leagues/nfl/${season}`)
      return (leagues ?? []).map(summarise)
    },

    async leagueContext(leagueId: string, userId: string): Promise<LeagueContext> {
      const [[league, rosters, users, traded], state] = await Promise.all([league4(leagueId), sleeper<any>('/state/nfl')])
      const nameOfUser = new Map(users.map(u => [u.user_id, u.display_name as string]))
      const userOf = new Map(users.map(u => [u.user_id, u]))
      const infos: RosterInfo[] = rosters.map(r => ({
        roster_id: r.roster_id,
        owner_id: r.owner_id ?? null,
        display_name: nameOfUser.get(r.owner_id) ?? `Roster ${r.roster_id}`,
        avatar: userAvatar(userOf.get(r.owner_id)),
        players: r.players ?? [],
        wins: Number(r.settings?.wins ?? 0),
        losses: Number(r.settings?.losses ?? 0),
      }))
      const mine = rosters.find(r => r.owner_id === userId || (r.co_owners ?? []).includes(userId))
      // Before the rookie draft the next draft is this season's; after it, next season's.
      const draftSeason = league.status === 'pre_draft' ? String(league.season) : String(Number(league.season) + 1)
      const draftRounds = Number(league.settings?.draft_rounds) || 3
      const owners = pickOwners(infos, traded, draftSeason, draftRounds)
      const firstOwner: Record<number, number> = {}
      for (const r of infos) firstOwner[r.roster_id] = owners.get(`${r.roster_id}:1`) ?? r.roster_id
      return {
        league: summarise(league),
        rosters: infos,
        myRosterId: mine?.roster_id ?? null,
        draftSeason,
        draftRounds,
        myPicks: ownedPicks(infos, owners, draftSeason, mine?.roster_id ?? null),
        firstOwner,
        week: Number(state?.display_week ?? state?.week ?? 0),
        fetchedAt: new Date().toISOString(),
      }
    },

    async runPickOdds(leagueId: string, opts: PickOddsOpts): Promise<BBResult> {
      const [meta, settings] = await Promise.all([playersMeta(), host.settings()])
      return (await host.runEngine({
        kind: 'bb',
        leagueId,
        sims: opts.sims,
        strengthCV: opts.strengthCV,
        forced: opts.forced ?? {},
        playersMeta: meta,
        overrides: overridesOf(settings),
      })) as BBResult
    },

    async runPwopr(leagueId: string): Promise<PWOPRResult> {
      return (await host.runEngine({ kind: 'pwopr', leagueId, overrides: overridesOf(await host.settings()) })) as PWOPRResult
    },

    async leagueOverview(leagueId: string): Promise<OverviewData> {
      const [[league, rosters, users, traded], meta, book] = await Promise.all([league4(leagueId), playersMeta(), host.loadBook()])
      return buildOverview({ book, league, rosters, users, traded, meta })
    },

    async ranks(leagueId: string, userId: string): Promise<RanksData> {
      const [[league, rosters, users], meta, book] = await Promise.all([league4(leagueId, false), playersMeta(), host.loadBook()])
      return buildRanks({ book, league, rosters, users, meta, userId })
    },

    async startSit(leagueId: string, userId: string): Promise<StartSitData> {
      const [[league, rosters, users], state, meta, settings] = await Promise.all([
        league4(leagueId, false),
        sleeper<any>('/state/nfl'),
        playersMeta(),
        host.settings(),
      ])
      const season = String(state.league_season || state.season)
      const week = Number(state.display_week || state.week) || 1
      const [book, matchups, schedule, stats] = await Promise.all([
        host.loadBook(),
        sleeper<any[]>(`/league/${leagueId}/matchups/${week}`),
        nflSchedule(season),
        seasonStats(Number(season) - 1).catch(() => ({}) as SeasonStats),
      ])
      return buildStartSit({
        wb: book.wb,
        sheetPath: book.path,
        modifiedAt: book.modifiedAt,
        league,
        rosters,
        users,
        matchups,
        schedule,
        stats,
        meta,
        userId,
        week,
        overrides: overridesOf(settings),
      })
    },

    async trades(leagueId: string, userId: string): Promise<TradeData> {
      const [[league, rosters, users, traded], meta, settings] = await Promise.all([league4(leagueId), playersMeta(), host.settings()])
      const positions: string[] = league.roster_positions ?? []
      const superflex = positions.includes('SUPER_FLEX') || positions.filter(p => p === 'QB').length > 1
      const rec = Number(league.scoring_settings?.rec ?? 1)
      const [book, fc] = await Promise.all([
        host.loadBook(),
        fantasyCalc({ teams: rosters.length, qbs: superflex ? 2 : 1, ppr: rec >= 0.75 ? 1 : rec >= 0.25 ? 0.5 : 0 }),
      ])
      return buildTrades({
        wb: book.wb,
        sheetPath: book.path,
        modifiedAt: book.modifiedAt,
        league,
        rosters,
        users,
        traded,
        meta,
        fc: { rows: fc.rows, asOf: fc.asOf, stale: fc.stale },
        beta: settings.marketBeta?.[leagueId] ?? 1,
        userId,
      })
    },

    async draft(leagueId: string, userId: string, draftId?: string): Promise<DraftData> {
      const [drafts, state, meta] = await Promise.all([sleeper<any[]>(`/league/${leagueId}/drafts`), sleeper<any>('/state/nfl'), playersMeta()])
      const id = draftId?.trim() || defaultDraft((drafts ?? []).map(summariseDraft))?.draft_id
      if (!id) throw new Error('This league has no Sleeper draft yet. Sleeper creates next season’s after the league renews.')
      const [draft, picks, traded] = await Promise.all([
        sleeper<any>(`/draft/${id}`),
        sleeper<any[]>(`/draft/${id}/picks`),
        sleeper<any[]>(`/draft/${id}/traded_picks`),
      ])
      if (!draft?.draft_id) throw new Error(`No Sleeper draft with id ${id}`)
      // A mock (or another league's draft) brings its own league, or none at all.
      const draftLeague = draft.league_id ? String(draft.league_id) : null
      const [league, rosters, users] = draftLeague ? await league4(draftLeague, false) : [null, [], []]
      const book = await host.loadBook()
      return buildDraft({
        wb: book.wb,
        sheetPath: book.path,
        modifiedAt: book.modifiedAt,
        draft,
        drafts: draftLeague === leagueId ? drafts : [...drafts, draft],
        league,
        rosters,
        users,
        traded,
        picks,
        meta,
        userId,
        nflSeason: String(state.league_season || state.season),
      })
    },

    async draftPicks(draftId: string): Promise<DraftPoll> {
      const [draft, picks] = await Promise.all([sleeper<any>(`/draft/${draftId}`), sleeper<any[]>(`/draft/${draftId}/picks`)])
      return buildPoll(draft, picks)
    },

    async searchPlayers(query: string): Promise<PlayerHit[]> {
      const q = normName(query)
      if (q.length < 2) return []
      const meta = await playersMeta()
      const hits: Array<PlayerHit & { score: number }> = []
      for (const [id, p] of Object.entries(meta)) {
        if (!SKILL.has(p.position)) continue
        const n = normName(nameOf(p))
        const at = n.indexOf(q)
        if (at < 0) continue
        // Prefer name starts and players on a team, then anyone with a search rank.
        const score = (at === 0 || n[at - 1] === ' ' ? 0 : 1000) + (p.team ? 0 : 500) + Math.min(999, Number(p.search_rank) || 999)
        hits.push({ id, name: nameOf(p), pos: p.position, team: p.team ?? 'FA', injury: p.injury_status ?? '', score })
      }
      return hits
        .sort((a, b) => a.score - b.score)
        .slice(0, 12)
        .map(({ score: _s, ...h }) => h)
    },

    /** The bundled config list, resolved to Sleeper ids so it can be imported as editable entries. */
    async bundledInjuries(): Promise<ManualInjury[]> {
      const meta = await playersMeta()
      const byName = new Map<string, string>()
      for (const [id, p] of Object.entries(meta))
        if (SKILL.has(p.position) && (p.team || !byName.has(normName(nameOf(p))))) byName.set(normName(nameOf(p)), id)
      const now = new Date().toISOString()
      const entry = (name: string, returnWeek: number | null): ManualInjury | null => {
        const id = byName.get(normName(name))
        const p = id ? meta[id] : null
        return id && p ? { id, name: nameOf(p), pos: p.position, team: p.team ?? 'FA', returnWeek, note: 'imported from sleeperStandings config', addedAt: now } : null
      }
      return [
        ...Object.entries(BUNDLED_INJURIES.returnWeek).map(([n, w]) => entry(n, w)),
        ...BUNDLED_INJURIES.seasonEnders.map(n => entry(n, null)),
      ].filter((x): x is ManualInjury => !!x)
    },
  }
}

export type MonteService = ReturnType<typeof createMonteService>
