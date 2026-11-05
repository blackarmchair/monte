// Placing a waiver claim in Sleeper: the undocumented GraphQL its own apps use (see sleeperTrade). It can
// change without notice, so Monte checks everything it can first, reads the claim back afterwards, and
// for now only makes claims that drop nobody.
//
// Tested live on a real league (2026-11-04): a claim, with or without a drop, comes back "pending" and
// changes nothing until waivers run; update_waiver_claim changes the bid; cancel_waiver_claim removes it.
// Sleeper refuses any claim while a player on IR no longer qualifies, whatever the roster's space.
//
// Sources: github.com/Filip-Kin/sleeper-graphql (docs/mutations.md: submit_waiver_claim signature),
// github.com/bealmot/sleeper-mcp (API-NOTES.md: the bid goes in settings.waiver_bid; confirm a claim
// with league_transactions, status "pending").
import { gql } from './sleeperLineup'
import { fetchPendingClaims } from './waivers'

export type WaiverClaim = {
  leagueId: string
  rosterId: number
  playerId: string
  /** the FAAB bid; null in a league with no budget */
  bid: number | null
}

const FAAB_TYPE = 2
/** Roster slots that don't count against the active roster. */
const OFF_ROSTER = new Set(['IR', 'TAXI'])

const MUTATION = `mutation claim($league_id: Snowflake!, $k_adds: [String], $v_adds: [Int], $k_drops: [String], $v_drops: [Int], $k_settings: [String], $v_settings: [Int]) {
  submit_waiver_claim(league_id: $league_id, k_adds: $k_adds, v_adds: $v_adds, k_drops: $k_drops, v_drops: $v_drops, k_settings: $k_settings, v_settings: $v_settings) {
    transaction_id status adds drops settings leg
  }
}`

export function claimVariables(c: WaiverClaim) {
  return {
    league_id: c.leagueId,
    k_adds: [c.playerId],
    v_adds: [c.rosterId],
    k_drops: [] as string[],
    v_drops: [] as number[],
    ...(c.bid == null ? {} : { k_settings: ['waiver_bid'], v_settings: [c.bid] }),
  }
}

const ROSTERS = `query rosters($league_id: Snowflake!) {
  league_rosters(league_id: $league_id) { roster_id owner_id co_owners players reserve taxi settings }
}`

/**
 * Rosters as they are this moment. The public REST rosters are CDN-cached for up to 5 minutes, so they
 * can't back a check before a write or confirm one after it. Source: sleeper-graphql docs/queries.md
 * (league_rosters, uncached; REST s-maxage=300).
 */
export async function liveRosters(leagueId: string, token: string, fetchFn: typeof fetch = fetch): Promise<any[]> {
  const { league_rosters: rosters } = await gql<{ league_rosters: any[] | null }>(ROSTERS, { league_id: leagueId }, token, fetchFn)
  return rosters ?? []
}

/** Why a bid won't do, or null. */
export function bidProblem(bid: number | null, faab: { left: number; minBid: number } | null): string | null {
  if (!faab) return bid == null ? null : "This league doesn't use a budget, so there's nothing to bid."
  if (bid == null || !Number.isInteger(bid) || bid < 0) return 'Enter a whole-dollar bid.'
  if (bid < faab.minBid) return `The minimum bid is $${faab.minBid}.`
  if (bid > faab.left) return `You have $${faab.left} left.`
  return null
}

/** Players on IR who no longer qualify under this league's rules. Sleeper blocks waiver moves until they're off it. */
export function irBlockers(roster: any, league: any, meta: Record<string, any>): string[] {
  const s = league.settings ?? {}
  const allowed = new Set(['IR'])
  for (const [setting, tag] of [['reserve_allow_out', 'Out'], ['reserve_allow_doubtful', 'Doubtful'], ['reserve_allow_sus', 'Sus'], ['reserve_allow_na', 'NA'], ['reserve_allow_dnr', 'DNR'], ['reserve_allow_cov', 'COV']])
    if (Number(s[setting])) allowed.add(tag)
  // A player missing from the table can't be judged, so he's left for Sleeper to decide.
  return ((roster.reserve ?? []) as string[]).filter(id => meta[id] && !allowed.has(meta[id].injury_status ?? '')).map(id => `${meta[id].first_name ?? ''} ${meta[id].last_name ?? ''}`.trim())
}

/** Everything that can be checked against the league as it stands right now, or null if it's fine. */
export function claimProblem(c: WaiverClaim, league: any, rosters: any[], openClaims: any[], meta: Record<string, any> = {}): string | null {
  if (league.status === 'pre_draft') return "This league hasn't drafted yet, so waivers aren't open."
  const s = league.settings ?? {}
  const faabLeague = Number(s.waiver_type) === FAAB_TYPE
  const mine = rosters.find(r => r.roster_id === c.rosterId)
  if (!mine) return "Monte can't find your team in this league."
  const holder = rosters.find(r => (r.players ?? []).includes(c.playerId))
  if (holder) return holder === mine ? 'He is already on your team.' : 'He is already on another team.'
  const ineligible = irBlockers(mine, league, meta)
  if (ineligible.length) return `${ineligible.join(' and ')} no longer ${ineligible.length === 1 ? 'qualifies' : 'qualify'} for your IR slot, and Sleeper blocks waiver moves until that's fixed. Move ${ineligible.length === 1 ? 'him' : 'them'} off IR in Sleeper first.`
  if (openClaims.some(t => Object.keys(t.adds ?? {}).includes(c.playerId))) return 'You already have a pending claim on him.'
  const budget = faabLeague ? Number(s.waiver_budget ?? 0) : 0
  const used = Number(mine.settings?.waiver_budget_used ?? 0)
  const bad = bidProblem(c.bid, faabLeague ? { left: Math.max(0, budget - used), minBid: Number(s.waiver_bid_min ?? 0) } : null)
  if (bad) return bad
  // Monte only makes claims that drop nobody for now, so the new player needs a free roster spot.
  const slots = ((league.roster_positions ?? []) as string[]).filter(p => !OFF_ROSTER.has(p)).length
  const away = new Set<string>([...(mine.reserve ?? []), ...(mine.taxi ?? [])])
  const active = ((mine.players ?? []) as string[]).filter(p => !away.has(p)).length
  if (active >= slots) return "Your roster is full. This claim would need a drop, and Monte can't make those yet. Claim him in Sleeper."
  return null
}

/**
 * Send the claim, then read it back. Throws SleeperAuthError when Sleeper refuses the token. A timeout
 * throws too, and says the claim may have landed. `mismatch` flags a reply or read-back that doesn't
 * show the claim as sent.
 */
export async function submitClaim(c: WaiverClaim, legs: number[], token: string, fetchFn: typeof fetch = fetch): Promise<{ transactionId: string; mismatch: string | null }> {
  const { submit_waiver_claim: tx } = await gql<{ submit_waiver_claim: any }>(MUTATION, claimVariables(c), token, fetchFn, "Sleeper didn't answer in time. The claim may still have gone through, so check Sleeper before sending it again.")
  if (!tx?.transaction_id) throw new Error('Sleeper accepted the request but returned no claim. Check Sleeper before sending it again.')
  const id = String(tx.transaction_id)
  const check = "Check your claims in Sleeper to confirm it's right."
  const added = Object.keys(tx.adds ?? {})
  if (added.length !== 1 || added[0] !== c.playerId || Number(tx.adds[c.playerId]) !== c.rosterId) return { transactionId: id, mismatch: `Sleeper stored a different player from the one Monte sent. ${check}` }
  if (Object.keys(tx.drops ?? {}).length) return { transactionId: id, mismatch: `Sleeper stored a drop Monte didn't send. ${check}` }
  if (c.bid != null && tx.settings?.waiver_bid != null && Number(tx.settings.waiver_bid) !== c.bid) return { transactionId: id, mismatch: `Sleeper stored a bid of $${tx.settings.waiver_bid}, not $${c.bid}. ${check}` }
  try {
    const open = await fetchPendingClaims(c.leagueId, legs, c.rosterId, token, fetchFn)
    if (!open.some(t => String(t.transaction_id) === id)) return { transactionId: id, mismatch: `Sleeper took the claim, but it isn't in your pending claims. ${check}` }
  } catch {
    return { transactionId: id, mismatch: `Sleeper took the claim, but Monte couldn't read it back. ${check}` }
  }
  return { transactionId: id, mismatch: null }
}
