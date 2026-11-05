// A read-only picture of a league's waivers: your budget, when they last ran, what winning bids look
// like, your pending claims, and recent moves. Facts come from what actually happened in the league's
// transactions where possible, since Sleeper's schedule settings are undocumented.
import { gql } from './sleeperLineup'

export type WaiverMove = {
  id: string
  kind: 'waiver' | 'free_agent'
  rosterId: number | null
  adds: Array<{ id: string; name: string }>
  drops: Array<{ id: string; name: string }>
  /** the FAAB bid on a waiver; null on a free-agent move */
  bid: number | null
  /** ms since epoch */
  at: number
}

export type WaiverDesk = {
  /** null when the league doesn't use a budget */
  faab: { budget: number; used: number; left: number; minBid: number } | null
  /** your place in line, when the league uses waiver priority instead of a budget */
  priority: number | null
  cadence: 'daily' | 'weekly'
  /** when waivers last processed here (ms), from the league's own transactions */
  lastRun: number | null
  /** winning bids above $0 this season; null if there have been none */
  bids: { count: number; median: number; high: number } | null
  /** your open claims; null when they couldn't be read */
  pending: WaiverMove[] | null
  pendingNote: string | null
  /** completed moves, newest first */
  recent: WaiverMove[]
  /** players dropped recently enough that they're likely still on waivers */
  likelyOnWaivers: string[]
}

const FAAB_TYPE = 2
const DAY_MS = 86400000
const RECENT_LIMIT = 8
/** Sleeper's own waiver wait is at least this, on top of any time to the next run. */
const MIN_CLEAR_DAYS = 1

const nameOf = (id: string, p: any) => (p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || id : id)

function toMove(t: any, meta: Record<string, any>): WaiverMove {
  const people = (m: unknown) => Object.keys((m ?? {}) as object).map(id => ({ id, name: nameOf(id, meta[id] ?? t.player_map?.[id]) }))
  const roster = Object.values((t.adds ?? {}) as Record<string, number>)[0] ?? Object.values((t.drops ?? {}) as Record<string, number>)[0] ?? t.roster_ids?.[0]
  const bid = t.settings?.waiver_bid
  return {
    id: String(t.transaction_id),
    kind: t.type === 'waiver' ? 'waiver' : 'free_agent',
    rosterId: roster == null ? null : Number(roster),
    adds: people(t.adds),
    drops: people(t.drops),
    bid: t.type === 'waiver' ? Number(bid ?? 0) : null,
    at: Number(t.status_updated ?? t.created ?? 0),
  }
}

export function buildWaiverDesk(o: {
  league: any
  /** your roster, or null if you have none here */
  roster: any | null
  /** this season's transactions, from every week read */
  transactions: any[]
  /** raw open claims, or null when they couldn't be read */
  pending: any[] | null
  pendingNote: string | null
  meta: Record<string, any>
  now?: number
}): WaiverDesk {
  const now = o.now ?? Date.now()
  const s = o.league.settings ?? {}
  const isMove = (t: any) => t?.type === 'waiver' || t?.type === 'free_agent'
  const done = o.transactions.filter(t => isMove(t) && t.status === 'complete')

  const budget = Number(s.waiver_budget ?? 0)
  const used = Number(o.roster?.settings?.waiver_budget_used ?? 0)
  const faab = Number(s.waiver_type) === FAAB_TYPE ? { budget, used, left: Math.max(0, budget - used), minBid: Number(s.waiver_bid_min ?? 0) } : null

  // A failed claim still shows that waivers ran.
  const ran = o.transactions.filter(t => t?.type === 'waiver' && (t.status === 'complete' || t.status === 'failed')).map(t => Number(t.status_updated ?? 0))
  const paid = done
    .filter(t => t.type === 'waiver')
    .map(t => Number(t.settings?.waiver_bid ?? 0))
    .filter(b => b > 0)
    .sort((a, b) => a - b)
  const median = paid.length ? (paid.length % 2 ? paid[(paid.length - 1) / 2] : (paid[paid.length / 2 - 1] + paid[paid.length / 2]) / 2) : 0

  const clearMs = Math.max(MIN_CLEAR_DAYS, Number(s.waiver_clear_days ?? MIN_CLEAR_DAYS)) * DAY_MS
  const rostered = new Set<string>()
  // Oldest first, so a player picked back up afterwards isn't reported as on waivers.
  const dropped = new Map<string, number>()
  for (const t of [...done].sort((a, b) => Number(a.status_updated ?? 0) - Number(b.status_updated ?? 0))) {
    const at = Number(t.status_updated ?? 0)
    for (const id of Object.keys(t.drops ?? {})) dropped.set(id, at)
    for (const id of Object.keys(t.adds ?? {})) {
      dropped.delete(id)
      rostered.add(id)
    }
  }

  return {
    faab,
    priority: faab ? null : o.roster?.settings?.waiver_position != null ? Number(o.roster.settings.waiver_position) : null,
    cadence: Number(s.daily_waivers) === 1 ? 'daily' : 'weekly',
    lastRun: ran.length ? Math.max(...ran) : null,
    bids: paid.length ? { count: paid.length, median, high: paid[paid.length - 1] } : null,
    pending: o.pending ? o.pending.map(t => toMove(t, o.meta)).sort((a, b) => b.at - a.at) : null,
    pendingNote: o.pendingNote,
    recent: done
      .map(t => toMove(t, o.meta))
      .sort((a, b) => b.at - a.at)
      .slice(0, RECENT_LIMIT),
    likelyOnWaivers: [...dropped].filter(([, at]) => now - at < clearMs).map(([id]) => id),
  }
}

const CLAIMS = `query claims($league_id: Snowflake!, $leg: Int!) {
  league_transactions(league_id: $league_id, leg: $leg) {
    transaction_id type status created status_updated creator leg roster_ids adds drops settings player_map
  }
}`

/**
 * Your open waiver claims. Sleeper's public API hides these, so this needs the session token. A read:
 * it sends nothing. Source: github.com/bealmot/sleeper-mcp (API-NOTES.md: read back with
 * league_transactions; a pending claim has status "pending" and its bid in settings.waiver_bid).
 */
export async function fetchPendingClaims(leagueId: string, legs: number[], myRosterId: number, token: string, fetchFn: typeof fetch = fetch): Promise<any[]> {
  const out = await Promise.all(legs.map(leg => gql<{ league_transactions: any[] | null }>(CLAIMS, { league_id: leagueId, leg }, token, fetchFn).then(d => d.league_transactions ?? [])))
  const seen = new Set<string>()
  return out.flat().filter(t => {
    if (t?.type !== 'waiver' || t.status !== 'pending' || !(t.roster_ids ?? []).map(Number).includes(myRosterId)) return false
    const id = String(t.transaction_id)
    return !seen.has(id) && !!seen.add(id)
  })
}

const names = (xs: WaiverMove['adds']) => xs.map(x => x.name).join(', ')

/** The headline of a claim or move: who comes in, or who goes when nobody does. */
export const moveTitle = (m: Pick<WaiverMove, 'adds' | 'drops'>) => (m.adds.length ? `Add ${names(m.adds)}` : `Drop ${names(m.drops)}`)

/** Who goes, when someone also comes in. */
export const moveDrop = (m: Pick<WaiverMove, 'adds' | 'drops'>) => (m.adds.length && m.drops.length ? `drop ${names(m.drops)}` : '')
