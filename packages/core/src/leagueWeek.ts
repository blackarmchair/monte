// League tabs beyond Standings: this week's matchups with Monte's win chance, and the league's
// trades (completed from the public API, your pending offers from Sleeper's GraphQL with the
// session token).
//
// Win chance: Sleeper publishes none (not in REST, not in its GraphQL), so Monte estimates it.
// Every starter's points are his stat line times the league's scoring_settings, which reproduces
// Sleeper's own players_points exactly; projections are Sleeper's own weekly projection lines,
// scored the same way. A finished game counts as banked, a live one as banked plus half of what
// his projection says is still to come, an unplayed one as its projection. The spread is a normal
// curve with each unplayed starter carrying sd ≈ 55% of his projection (a live one half that).
import { gql } from './sleeperLineup'
import { userAvatar } from './values'

export type GameState = 'pre' | 'live' | 'done' | 'bye' | 'empty'

export type MatchPlayer = { id: string; name: string; pos: string; team: string; points: number; proj: number; state: GameState }

export type MatchSide = {
  rosterId: number
  team: string
  avatar: string | null
  /** points banked so far (Sleeper's own number) */
  points: number
  /** Monte's expected final */
  projected: number
  /** 0..1 */
  winPct: number
  starters: MatchPlayer[]
}

export type Matchup = { id: number; sides: [MatchSide, MatchSide] }

/** `playoffs`: the week is at or past the league's playoff start, where only bracket games pair up. */
export type LeagueWeek = { season: string; week: number; playoffs: boolean; matchups: Matchup[]; builtAt: string }

export type TradeAssetMove = { id: string; name: string; pos: string; team: string }
export type TradePickMove = { season: string; round: number; /** roster the pick originally belonged to */ orig: number }

export type TradeTx = {
  id: string
  status: 'proposed' | 'complete'
  /** ms since epoch */
  created: number
  week: number
  /** roster that sent the offer, when Sleeper says */
  creator: number | null
  /** what each roster receives */
  sides: Array<{ rosterId: number; players: TradeAssetMove[]; picks: TradePickMove[] }>
}

export type LeagueTrades = {
  /** your open offers, sent and received; null when Sleeper isn't connected */
  pending: TradeTx[] | null
  /** why pending is null or partial */
  pendingNote: string | null
  /** completed trades this season, newest first */
  recent: TradeTx[]
}

type Meta = Record<string, any>
type Stats = Record<string, number>

/** A stat line in this league's scoring: Sleeper's own formula. */
export function leagueScore(stats: Stats | undefined, scoring: Record<string, number>): number {
  if (!stats) return 0
  let t = 0
  for (const k in stats) {
    const w = scoring[k]
    if (w != null && typeof stats[k] === 'number') t += stats[k] * w
  }
  return Math.round(t * 100) / 100
}

// Abramowitz–Stegun erf, good to 1.5e-7: plenty for a percentage.
function phi(z: number) {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2
}

const nameOf = (id: string, p: any) => (p ? (p.position === 'DEF' ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || id : `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()) : id)

export function teamNames(rosters: any[], users: any[]) {
  const userOf = new Map(users.map(u => [u.user_id, u]))
  return new Map<number, { name: string; avatar: string | null }>(
    rosters.map(r => {
      const u = userOf.get(r.owner_id)
      return [r.roster_id, { name: u?.metadata?.team_name || u?.display_name || `Roster ${r.roster_id}`, avatar: userAvatar(u) }]
    }),
  )
}

export function buildLeagueWeek(o: {
  league: any
  rosters: any[]
  users: any[]
  /** REST /league/{id}/matchups/{week} */
  matchups: any[]
  /** Sleeper's weekly projections: player id -> stat line */
  projections: Record<string, Stats>
  /** NFL team -> week -> game status (pre_game / in_game / complete) */
  schedule: Record<string, Record<number, string>>
  meta: Meta
  season: string
  week: number
}): LeagueWeek {
  const scoring: Record<string, number> = o.league.scoring_settings ?? {}
  const names = teamNames(o.rosters, o.users)
  const stateOf = (team: string): GameState => {
    const s = o.schedule[team]?.[o.week]
    return s == null ? 'bye' : s === 'complete' ? 'done' : s === 'in_game' ? 'live' : 'pre'
  }
  const side = (m: any) => {
    const starters: MatchPlayer[] = (m.starters ?? []).map((raw: any) => {
      const id = String(raw ?? '0')
      if (id === '0') return { id, name: 'Empty', pos: '', team: '', points: 0, proj: 0, state: 'empty' as const }
      const p = o.meta[id]
      const team = p?.position === 'DEF' ? id : p?.team ?? ''
      const points = Number(m.players_points?.[id] ?? 0)
      const state = team ? stateOf(team) : 'bye'
      return { id, name: nameOf(id, p), pos: p?.position ?? '', team, points, proj: leagueScore(o.projections[id], scoring), state }
    })
    let mean = 0
    let v = 0
    for (const s of starters) {
      if (s.state === 'done' || s.state === 'bye' || s.state === 'empty') mean += s.points
      else if (s.state === 'live') {
        mean += s.points + 0.5 * Math.max(0, s.proj - s.points)
        v += (0.275 * s.proj) ** 2
      } else {
        mean += s.proj
        v += (0.55 * s.proj) ** 2
      }
    }
    const n = names.get(m.roster_id)
    return {
      side: { rosterId: m.roster_id, team: n?.name ?? `Roster ${m.roster_id}`, avatar: n?.avatar ?? null, points: Number(m.points ?? 0), projected: Math.round(mean * 10) / 10, winPct: 0.5, starters },
      v,
    }
  }
  const byId = new Map<number, any[]>()
  for (const m of o.matchups) if (m.matchup_id != null) byId.set(m.matchup_id, [...(byId.get(m.matchup_id) ?? []), m])
  const matchups: Matchup[] = []
  for (const [id, pair] of [...byId].sort((a, b) => a[0] - b[0])) {
    if (pair.length !== 2) continue
    const [a, b] = pair.map(side)
    const sd = Math.sqrt(a.v + b.v)
    const d = a.side.projected - b.side.projected
    const pa = sd > 0 ? phi(d / sd) : d > 0 ? 1 : d < 0 ? 0 : 0.5
    a.side.winPct = pa
    b.side.winPct = 1 - pa
    matchups.push({ id, sides: [a.side, b.side] })
  }
  const poStart = Number(o.league.settings?.playoff_week_start) || 0
  return { season: o.season, week: o.week, playoffs: poStart > 0 && o.week >= poStart, matchups, builtAt: new Date().toISOString() }
}

/** One Sleeper trade (REST or GraphQL shape) as what each roster receives. */
export function normaliseTrade(t: any, meta: Meta, creatorRoster: (userId: string) => number | null): TradeTx {
  const rosters: number[] = (t.roster_ids ?? []).map(Number)
  const sides = new Map<number, TradeTx['sides'][number]>(rosters.map(r => [r, { rosterId: r, players: [], picks: [] }]))
  const at = (r: number) => sides.get(r) ?? sides.set(r, { rosterId: r, players: [], picks: [] }).get(r)!
  for (const [id, to] of Object.entries((t.adds ?? {}) as Record<string, number>)) {
    const p = meta[id] ?? t.player_map?.[id]
    at(Number(to)).players.push({ id, name: nameOf(id, p), pos: p?.position ?? '', team: p?.team ?? '' })
  }
  // REST: objects { season, round, roster_id (original), owner_id (new) }; GraphQL: "orig,season,round,new,prev".
  for (const raw of t.draft_picks ?? []) {
    const pk =
      typeof raw === 'string'
        ? (() => {
            const [orig, season, round, to] = raw.split(',')
            return { orig: Number(orig), season, round: Number(round), to: Number(to) }
          })()
        : { orig: Number(raw.roster_id), season: String(raw.season), round: Number(raw.round), to: Number(raw.owner_id) }
    at(pk.to).picks.push({ season: pk.season, round: pk.round, orig: pk.orig })
  }
  for (const s of sides.values()) s.players.sort((a, b) => a.name.localeCompare(b.name))
  return {
    id: String(t.transaction_id),
    status: t.status === 'complete' ? 'complete' : 'proposed',
    created: Number(t.created ?? t.status_updated ?? 0),
    week: Number(t.leg ?? 0),
    creator: t.creator ? creatorRoster(String(t.creator)) : null,
    sides: [...sides.values()],
  }
}

// The poller Sleeper's own apps use for open offers; `status: "proposed"` (not "pending").
// Source: github.com/Filip-Kin/sleeper-graphql (docs/queries.md: league_transactions_by_status).
const PENDING = `query pending($league_id: Snowflake!, $leg: Int!) {
  league_transactions_by_status(league_id: $league_id, leg: $leg, status: "proposed") {
    transaction_id type status created creator leg roster_ids adds drops draft_picks player_map
  }
}`

/** Open trade offers in these legs (weeks). Throws SleeperAuthError when the token is refused. */
export async function fetchPending(leagueId: string, legs: number[], token: string): Promise<any[]> {
  const out = await Promise.all(
    legs.map(leg => gql<{ league_transactions_by_status: any[] | null }>(PENDING, { league_id: leagueId, leg }, token).then(d => d.league_transactions_by_status ?? [])),
  )
  const seen = new Set<string>()
  return out.flat().filter(t => t?.type === 'trade' && !seen.has(String(t.transaction_id)) && seen.add(String(t.transaction_id)))
}
