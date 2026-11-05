// Adding players, waiver claims and IR moves in Sleeper: the undocumented GraphQL its own apps use (see
// sleeperTrade). It can change without notice, so Monte checks everything it can first and reads every
// write back afterwards.
//
// Tested live on a real league (2026-11-04): a claim, with or without a drop, comes back "pending" and
// changes nothing until waivers run; update_waiver_claim changes the bid; cancel_waiver_claim removes it;
// roster_update_reserve sets IR; a drop-only league_create_transaction (type free_agent) completes at
// once. Sleeper refuses any add or claim while a player on IR no longer qualifies, and refuses a
// free-agent add of a player on waivers ("...is on waivers."). A free-agent add that succeeds is NOT yet
// tested: the only leagues open to testing use daily waivers, where every unrostered player is always on
// waivers and every add is a claim.
//
// Sources: github.com/Filip-Kin/sleeper-graphql (docs/mutations.md: submit_waiver_claim signature),
// github.com/bealmot/sleeper-mcp (API-NOTES.md: the bid goes in settings.waiver_bid; confirm a claim
// with league_transactions, status "pending").
import { gql } from './sleeperLineup'
import { fetchPendingClaims, irAllowed, irBlockerIds, irSlots } from './waivers'

export { irAllowed, irBlockerIds, irSlots }

export type WaiverClaim = {
  leagueId: string
  rosterId: number
  playerId: string
  /** the FAAB bid; null in a league with no budget */
  bid: number | null
  /** who leaves to make room: at once for a free agent, only if the claim wins on waivers */
  drop?: string | null
}

/** What became of an add: done at once as a free agent, or placed as a waiver claim. */
export type AddResult = { kind: 'added' | 'claimed'; transactionId: string; mismatch: string | null }

/** A pending claim of yours, for Monte to change. Its leg is read fresh, not trusted from the screen. */
export type ClaimRef = { leagueId: string; rosterId: number; transactionId: string }
export type IrMove = { leagueId: string; rosterId: number; playerId: string; to: 'ir' | 'bench' }

const FAAB_TYPE = 2
/** Roster slots that don't count against the active roster. */
const OFF_ROSTER = new Set(['IR', 'TAXI'])
/** Spots on the active roster: everything but IR and taxi. */
export const rosterSlots = (league: any) => ((league.roster_positions ?? []) as string[]).filter(p => !OFF_ROSTER.has(p)).length

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
    k_drops: c.drop ? [c.drop] : [],
    v_drops: c.drop ? [c.rosterId] : [],
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

const fullName = (id: string, meta: Record<string, any>) => (meta[id] ? `${meta[id].first_name ?? ''} ${meta[id].last_name ?? ''}`.trim() || id : 'That player')

/** The same, by name. */
export const irBlockers = (roster: any, league: any, meta: Record<string, any>): string[] => irBlockerIds(roster, league, meta).map(id => fullName(id, meta))

/** Everything that can be checked against the league as it stands right now, or null if it's fine. */
export function claimProblem(c: WaiverClaim, league: any, rosters: any[], openClaims: any[], meta: Record<string, any> = {}): string | null {
  if (league.status === 'pre_draft') return "This league hasn't drafted yet, so waivers aren't open."
  const s = league.settings ?? {}
  const faabLeague = Number(s.waiver_type) === FAAB_TYPE
  const mine = rosters.find(r => r.roster_id === c.rosterId)
  if (!mine) return "Monte can't find your team in this league."
  const holder = rosters.find(r => (r.players ?? []).includes(c.playerId))
  if (holder) return holder === mine ? 'He is already on your team.' : 'He is already on another team.'
  if (c.drop && !(mine.players ?? []).includes(c.drop)) return `${fullName(c.drop, meta)} isn't on your team anymore. Pick someone else to drop.`
  const ineligible = irBlockers(mine, league, meta)
  if (ineligible.length) return `${ineligible.join(' and ')} no longer ${ineligible.length === 1 ? 'qualifies' : 'qualify'} for your IR slot, and Sleeper blocks adds and claims until that's fixed. Move ${ineligible.length === 1 ? 'him' : 'them'} off IR first: This week has a button for it.`
  if (openClaims.some(t => Object.keys(t.adds ?? {}).includes(c.playerId))) return 'You already have a pending claim on him.'
  const budget = faabLeague ? Number(s.waiver_budget ?? 0) : 0
  const used = Number(mine.settings?.waiver_budget_used ?? 0)
  const bad = bidProblem(c.bid, faabLeague ? { left: Math.max(0, budget - used), minBid: Number(s.waiver_bid_min ?? 0) } : null)
  if (bad) return bad
  const slots = rosterSlots(league)
  const away = new Set<string>([...(mine.reserve ?? []), ...(mine.taxi ?? [])])
  const active = ((mine.players ?? []) as string[]).filter(p => !away.has(p)).length
  const freed = c.drop && !away.has(c.drop) ? 1 : 0
  if (active - freed < slots) return null
  if (!c.drop) return 'Your roster is full, so pick someone to drop.'
  if (!freed) return `${fullName(c.drop, meta)} is on your ${(mine.taxi ?? []).includes(c.drop) ? 'taxi squad' : 'IR'}, so dropping him doesn't free a roster spot. Pick someone on your active roster.`
  return `Your roster is ${active - slots + 1} over the limit even after this drop. Make room in Sleeper first.`
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
  const dropped = Object.keys(tx.drops ?? {})
  if (dropped.length !== (c.drop ? 1 : 0) || (c.drop && dropped[0] !== c.drop)) return { transactionId: id, mismatch: `Sleeper stored a different drop from the one Monte sent. ${check}` }
  if (c.bid != null && tx.settings?.waiver_bid != null && Number(tx.settings.waiver_bid) !== c.bid) return { transactionId: id, mismatch: `Sleeper stored a bid of $${tx.settings.waiver_bid}, not $${c.bid}. ${check}` }
  try {
    const open = await fetchPendingClaims(c.leagueId, legs, c.rosterId, token, fetchFn)
    if (!open.some(t => String(t.transaction_id) === id)) return { transactionId: id, mismatch: `Sleeper took the claim, but it isn't in your pending claims. ${check}` }
  } catch {
    return { transactionId: id, mismatch: `Sleeper took the claim, but Monte couldn't read it back. ${check}` }
  }
  return { transactionId: id, mismatch: null }
}

const MOVE = `mutation add($type: String!, $league_id: Snowflake!, $k_adds: [String], $v_adds: [Int], $k_drops: [String], $v_drops: [Int]) {
  league_create_transaction(type: $type, league_id: $league_id, k_adds: $k_adds, v_adds: $v_adds, k_drops: $k_drops, v_drops: $v_drops) {
    transaction_id status type adds drops leg
  }
}`

/** Sleeper's refusal when a free-agent add names a player still on waivers: the cue to claim him instead. */
export const isOnWaivers = (e: unknown) => /on waivers/i.test(e instanceof Error ? e.message : String(e))

/** The variables for a free-agent add: a claim's, with no bid. */
export function addVariables(c: WaiverClaim) {
  const { league_id, k_adds, v_adds, k_drops, v_drops } = claimVariables(c)
  return { type: 'free_agent', league_id, k_adds, v_adds, k_drops, v_drops }
}

/**
 * Add a free agent at once, then read the roster back. Throws when Sleeper refuses; isOnWaivers says
 * he needs a claim instead, and nothing has changed.
 */
export async function addFreeAgent(c: WaiverClaim, token: string, fetchFn: typeof fetch = fetch): Promise<{ transactionId: string; mismatch: string | null }> {
  const { league_create_transaction: tx } = await gql<{ league_create_transaction: any }>(
    MOVE,
    addVariables(c),
    token,
    fetchFn,
    "Sleeper didn't answer in time. The add may still have gone through, so check your roster before trying again.",
  )
  if (!tx?.transaction_id) throw new Error('Sleeper accepted the request but returned no move. Check your roster before trying again.')
  const id = String(tx.transaction_id)
  const check = 'Check your roster in Sleeper.'
  try {
    const players: string[] = (await liveRosters(c.leagueId, token, fetchFn)).find(r => r.roster_id === c.rosterId)?.players ?? []
    if (!players.includes(c.playerId)) return { transactionId: id, mismatch: `Sleeper took the add, but he isn't on your roster yet. ${check}` }
    if (c.drop && players.includes(c.drop)) return { transactionId: id, mismatch: `He's on your roster, but the player you dropped is still there too. ${check}` }
  } catch {
    return { transactionId: id, mismatch: `Sleeper took the add, but Monte couldn't read your roster back. ${check}` }
  }
  return { transactionId: id, mismatch: null }
}

const CANCEL = `mutation cancel($leg: Int!, $league_id: Snowflake!, $transaction_id: Snowflake!) {
  cancel_waiver_claim(leg: $leg, league_id: $league_id, transaction_id: $transaction_id) { transaction_id status }
}`

const UPDATE = `mutation bid($leg: Int!, $league_id: Snowflake!, $transaction_id: Snowflake!, $k_settings: [String], $v_settings: [Int]) {
  update_waiver_claim(leg: $leg, league_id: $league_id, transaction_id: $transaction_id, k_settings: $k_settings, v_settings: $v_settings) { transaction_id status settings }
}`

/** The claim among those still pending, or why it can't be changed. */
export function pendingOne(open: any[], transactionId: string): any {
  const t = open.find(x => String(x.transaction_id) === transactionId)
  if (!t) throw new Error("That claim isn't pending anymore: waivers may have run, or it changed in Sleeper. Refresh to see where it stands.")
  if (t.leg == null) throw new Error("Sleeper didn't say which week that claim is in, so Monte can't change it. Use Sleeper.")
  return t
}

/** Cancel a pending claim, then check it's gone. `open` is your pending claims, read just now. */
export async function cancelClaim(ref: ClaimRef, open: any[], legs: number[], token: string, fetchFn: typeof fetch = fetch): Promise<{ mismatch: string | null }> {
  const t = pendingOne(open, ref.transactionId)
  await gql(CANCEL, { leg: Number(t.leg), league_id: ref.leagueId, transaction_id: ref.transactionId }, token, fetchFn, "Sleeper didn't answer in time. The claim may already be cancelled, so refresh before trying again.")
  try {
    const after = await fetchPendingClaims(ref.leagueId, legs, ref.rosterId, token, fetchFn)
    if (after.some(x => String(x.transaction_id) === ref.transactionId)) return { mismatch: 'Sleeper answered, but the claim still shows as pending. Check Sleeper.' }
  } catch {
    return { mismatch: "Sleeper answered, but Monte couldn't read your claims back. Check Sleeper." }
  }
  return { mismatch: null }
}

/** Change a pending claim's bid, then read it back. */
export async function updateClaimBid(ref: ClaimRef, bid: number, open: any[], legs: number[], token: string, fetchFn: typeof fetch = fetch): Promise<{ mismatch: string | null }> {
  const t = pendingOne(open, ref.transactionId)
  await gql(UPDATE, { leg: Number(t.leg), league_id: ref.leagueId, transaction_id: ref.transactionId, k_settings: ['waiver_bid'], v_settings: [bid] }, token, fetchFn, "Sleeper didn't answer in time. The bid may have changed, so refresh before trying again.")
  try {
    const after = (await fetchPendingClaims(ref.leagueId, legs, ref.rosterId, token, fetchFn)).find(x => String(x.transaction_id) === ref.transactionId)
    if (!after) return { mismatch: "The claim isn't in your pending claims anymore. Check Sleeper." }
    if (Number(after.settings?.waiver_bid ?? 0) !== bid) return { mismatch: `Sleeper still shows a bid of $${after.settings?.waiver_bid ?? 0}. Check Sleeper.` }
  } catch {
    return { mismatch: "Sleeper answered, but Monte couldn't read the claim back. Check Sleeper." }
  }
  return { mismatch: null }
}

/** Why an IR move won't do, against the roster as it is right now, or null. */
export function irProblem(m: IrMove, league: any, mine: any | undefined, meta: Record<string, any>): string | null {
  if (!mine) return "Monte can't find your team in this league."
  const reserve: string[] = mine.reserve ?? []
  const who = fullName(m.playerId, meta)
  if (!(mine.players ?? []).includes(m.playerId)) return `${who} isn't on your team anymore.`
  if (m.to === 'bench') return reserve.includes(m.playerId) ? null : `${who} isn't on your IR.`
  if (reserve.includes(m.playerId)) return `${who} is already on IR.`
  if ((mine.taxi ?? []).includes(m.playerId)) return `${who} is on your taxi squad. Move him up in Sleeper first.`
  const tag = meta[m.playerId]?.injury_status
  if (!irAllowed(league).has(tag ?? '')) return `${who} ${tag ? `is tagged ${tag}, which doesn't` : "isn't injured, so he doesn't"} qualify for IR in this league.`
  if (reserve.length >= irSlots(league)) return 'Your IR is full.'
  return null
}

const RESERVE = `mutation ir($league_id: Snowflake!, $roster_id: Int!, $reserve: [String]) {
  roster_update_reserve(league_id: $league_id, roster_id: $roster_id, reserve: $reserve) { roster_id reserve }
}`

/** Move one player on or off IR, leaving the rest of IR as it is (`current`, read just now), then read it back. */
export async function moveIr(m: IrMove, current: string[], token: string, fetchFn: typeof fetch = fetch): Promise<{ mismatch: string | null }> {
  const reserve = m.to === 'ir' ? [...current, m.playerId] : current.filter(id => id !== m.playerId)
  await gql(RESERVE, { league_id: m.leagueId, roster_id: m.rosterId, reserve }, token, fetchFn, "Sleeper didn't answer in time. The move may have gone through, so refresh before trying again.")
  try {
    const after: string[] = (await liveRosters(m.leagueId, token, fetchFn)).find(r => r.roster_id === m.rosterId)?.reserve ?? []
    if (after.includes(m.playerId) !== (m.to === 'ir')) return { mismatch: "Sleeper answered, but your IR doesn't show the move. Check Sleeper." }
  } catch {
    return { mismatch: "Sleeper answered, but Monte couldn't read your roster back. Check Sleeper." }
  }
  return { mismatch: null }
}
