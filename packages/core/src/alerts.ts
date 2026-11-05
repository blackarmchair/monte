// Alerts beyond new offers: lineup trouble before kickoff, waiver results, claims that will fail, the
// trade deadline, and a Sleeper connection about to end. Each alert has a key that names the exact
// situation, so it's sent once; a new situation (a different injury tag, another run) gets a new key.
// The hosts decide when to look and how to show it, as with offers.
import type { FoundOffer } from './offerWatch'
import { tradeDeadline } from './strategy'
import { irBlockerIds } from './waivers'

export type Alert = {
  key: string
  /** the league a tap should open; '' for one about Monte itself */
  leagueId: string
  title: string
  body: string
  /** alerts sharing a group are sent as one: their `line`s joined, then `tail` */
  group?: string
  line?: string
  tail?: string
}

export type Message = { title: string; body: string; leagueId: string }

/** What a check needs to know about a player: from the week's projections, which carry fresh injury tags. */
export type WeekPlayer = { name: string; team: string | null; injury: string | null }

/** By team, then week: the game's status. A team with no entry for a week is on bye. */
export type Games = Record<string, Record<number, string>>

const DAY_MS = 86400000
/** How many alert keys to remember. Enough to cover a season's worth of checks. */
const SEEN_LIMIT = 500
/** Waiver results older than this aren't news, which also keeps a first check from replaying last week. */
const RESULT_WINDOW_MS = 36 * 3600 * 1000
const TOKEN_WARN_DAYS = [7, 1]
const FAAB_TYPE = 2

/** Tags worth an alert on a starter, and how to say it. Questionable is a heads-up, not a swap. */
const WONT_PLAY: Record<string, string> = {
  Questionable: 'questionable',
  Out: 'ruled out',
  Doubtful: 'doubtful',
  IR: 'on IR',
  PUP: 'on PUP',
  Sus: 'suspended',
  NA: 'inactive',
  DNR: 'inactive',
}

const SLOT_LABEL: Record<string, string> = { FLEX: 'flex', SUPER_FLEX: 'superflex', REC_FLEX: 'flex', WRRB_FLEX: 'flex', IDP_FLEX: 'IDP flex' }
const NOT_STARTING = new Set(['BN', 'IR', 'TAXI'])
const slotLabel = (s: string | undefined) => (s ? SLOT_LABEL[s] ?? s : 'lineup')

const nameFrom = (id: string, players: Record<string, WeekPlayer>, map?: Record<string, any>) => {
  const p = map?.[id]
  const fromMap = p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() : ''
  return fromMap || players[id]?.name || 'a player'
}
const list = (xs: string[]) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)
const leagueNameOf = (league: any) => String(league?.name ?? 'your league')

/**
 * Starters who won't play and empty slots, while there's still time to fix them. A starter whose
 * game has started is locked, so he's left alone; an empty slot counts while any game is still to come.
 */
export function lineupAlerts(o: { league: any; rosterId: number; matchups: any[]; week: number; players: Record<string, WeekPlayer>; games: Games }): Alert[] {
  const m = o.matchups.find(x => x?.roster_id === o.rosterId)
  // No matchup id: a bye week in the playoffs, or out of them.
  if (!m || m.matchup_id == null) return []
  const id = String(o.league.league_id)
  const name = leagueNameOf(o.league)
  const slots = ((o.league.roster_positions ?? []) as string[]).filter(p => !NOT_STARTING.has(p))
  const statusOf = (team: string) => o.games[team]?.[o.week]
  const weekKnown = Object.values(o.games).some(w => w[o.week] != null)
  const anyToCome = Object.values(o.games).some(w => w[o.week] === 'pre_game')
  const out: Alert[] = []
  ;((m.starters ?? []) as string[]).forEach((pid, i) => {
    const slot = slotLabel(slots[i])
    if (!pid || pid === '0') {
      if (anyToCome)
        out.push({ key: `lineup:${id}:${o.week}:${i}:empty`, leagueId: id, title: `Empty ${slot} slot · ${name}`, body: `Your ${slot} slot is empty this week. Fill it before kickoff.` })
      return
    }
    const p = o.players[pid]
    if (!p) return
    const team = p.team ?? (/^[A-Z]{2,3}$/.test(pid) ? pid : null)
    let why: string | null = null
    let tag: string
    if (!team) {
      why = 'not on an NFL team'
      tag = 'FA'
    } else if (weekKnown && statusOf(team) == null) {
      why = 'on bye'
      tag = 'bye'
    } else {
      if (statusOf(team) !== 'pre_game') return
      tag = p.injury ?? ''
      why = WONT_PLAY[tag] ?? null
    }
    if (!why) return
    out.push({
      key: `lineup:${id}:${o.week}:${pid}:${tag}`,
      leagueId: id,
      title: `${p.name} is ${why} · ${name}`,
      body: tag === 'Questionable' ? `He's in your lineup at ${slot}. Check on him before kickoff.` : `He's in your lineup at ${slot}. Swap him before kickoff.`,
    })
  })
  return out
}

/**
 * Claims of yours that waivers just processed, from the league's transactions (the GraphQL read,
 * which names the players). One alert each, sent as one message per league.
 */
export function waiverResultAlerts(o: { league: any; rosterId: number; transactions: any[]; players: Record<string, WeekPlayer>; faabLeft: number | null; now?: number }): Alert[] {
  const now = o.now ?? Date.now()
  const id = String(o.league.league_id)
  const tail = o.faabLeft == null ? undefined : `$${o.faabLeft} left.`
  return o.transactions
    .filter(t => t?.type === 'waiver' && (t.status === 'complete' || t.status === 'failed'))
    .filter(t => (t.roster_ids ?? []).map(Number).includes(o.rosterId))
    .filter(t => now - Number(t.status_updated ?? t.created ?? 0) < RESULT_WINDOW_MS)
    .sort((a, b) => Number(a.status_updated ?? 0) - Number(b.status_updated ?? 0))
    .map(t => {
      const adds = list(Object.keys(t.adds ?? {}).map(p => nameFrom(p, o.players, t.player_map)))
      const drops = list(Object.keys(t.drops ?? {}).map(p => nameFrom(p, o.players, t.player_map)))
      const bid = t.settings?.waiver_bid
      const line =
        t.status === 'complete' ? `Won ${adds}${bid != null && o.faabLeft != null ? ` for $${bid}` : ''}${drops ? `, dropping ${drops}` : ''}.` : `Didn't get ${adds}.`
      return { key: `waiver:${t.transaction_id}`, leagueId: id, title: `Waivers ran · ${leagueNameOf(o.league)}`, body: line, group: `waiver:${id}`, line, tail }
    })
}

/**
 * Your pending claims that will fail as things stand: the player's gone, the drop's gone, the bid's
 * over budget, or an ineligible player on IR is blocking every claim.
 */
export function claimAlerts(o: { league: any; rosterId: number; rosters: any[]; pending: any[]; players: Record<string, WeekPlayer>; faabLeft: number | null }): Alert[] {
  const mine = o.rosters.find(r => r.roster_id === o.rosterId)
  if (!mine || !o.pending.length) return []
  const id = String(o.league.league_id)
  const title = `Claim won't go through · ${leagueNameOf(o.league)}`
  const out: Alert[] = []
  for (const t of o.pending) {
    const add = Object.keys(t.adds ?? {})[0]
    const drop = Object.keys(t.drops ?? {})[0]
    if (!add) continue
    const who = nameFrom(add, o.players, t.player_map)
    const tx = String(t.transaction_id)
    const holder = o.rosters.find(r => (r.players ?? []).includes(add))
    if (holder && holder !== mine) out.push({ key: `claim:${tx}:taken`, leagueId: id, title, body: `Another team picked up ${who}, so your claim on him will fail.` })
    if (drop && !(mine.players ?? []).includes(drop))
      out.push({ key: `claim:${tx}:nodrop`, leagueId: id, title, body: `Your claim on ${who} drops ${nameFrom(drop, o.players, t.player_map)}, who isn't on your team anymore. Pick another drop.` })
    const bid = Number(t.settings?.waiver_bid ?? 0)
    if (o.faabLeft != null && bid > o.faabLeft) out.push({ key: `claim:${tx}:budget:${o.faabLeft}`, leagueId: id, title, body: `Your $${bid} bid on ${who} is more than the $${o.faabLeft} you have left.` })
  }
  const meta = Object.fromEntries(Object.entries(o.players).map(([pid, p]) => [pid, { injury_status: p.injury }]))
  const blockers = irBlockerIds(mine, o.league, meta)
  if (blockers.length) {
    const names = list(blockers.map(b => nameFrom(b, o.players)))
    out.push({
      key: `claim:${id}:ir:${[...blockers].sort().join(',')}`,
      leagueId: id,
      title,
      body: `${names} ${blockers.length === 1 ? 'is' : 'are'} on your IR but no longer ${blockers.length === 1 ? 'qualifies' : 'qualify'}, and Sleeper blocks every claim until that's fixed.`,
    })
  }
  return out
}

/** The week before the trade deadline, and the week of it. */
export function deadlineAlerts(league: any, nflWeek: number | null): Alert[] {
  const d = tradeDeadline(league, nflWeek)
  if (d.closed || d.weeksLeft == null || d.weeksLeft > 1) return []
  const id = String(league.league_id)
  const name = leagueNameOf(league)
  const when = d.weeksLeft === 0 ? 'this week' : 'next week'
  return [{ key: `deadline:${id}:${league.season}:${d.weeksLeft}`, leagueId: id, title: `Trade deadline ${when} · ${name}`, body: `Trades close after week ${d.week}.` }]
}

/** Hours before an offer lapses at which to say so: a day out, and the last couple of hours. */
const OFFER_WARN_HOURS = [24, 2]

/** Offers waiting on you that lapse soon, if their sender set a time. */
export function offerExpiryAlerts(offers: FoundOffer[], hideNames: boolean, now = Date.now()): Alert[] {
  return offers.flatMap(o => {
    if (o.expiresAt == null || o.expiresAt <= now) return []
    const hours = (o.expiresAt - now) / 3600000
    const step = [...OFFER_WARN_HOURS].reverse().find(h => hours <= h)
    if (step == null) return []
    const left = hours < 1 ? 'in under an hour' : `in ${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`
    if (hideNames) return [{ key: `offer-expiry:${o.id}:${step}`, leagueId: o.leagueId, title: 'Trade offer ending', body: `An offer waiting on you ends ${left}. Open Monte to see it.` }]
    const what = [...o.gets, ...o.gives].some(n => /^\d+$/.test(n)) ? '' : ` You get ${o.gets.join(', ') || 'nothing'}. You give ${o.gives.join(', ') || 'nothing'}.`
    return [{ key: `offer-expiry:${o.id}:${step}`, leagueId: o.leagueId, title: `Offer ending · ${o.leagueName}`, body: `${o.from}'s offer ends ${left}.${what}` }]
  })
}

/** A week out and a day out from the saved Sleeper session ending. */
export function tokenAlerts(expiresAt: number | null | undefined, now = Date.now()): Alert[] {
  if (expiresAt == null) return []
  const days = Math.ceil((expiresAt - now) / DAY_MS)
  const step = [...TOKEN_WARN_DAYS].reverse().find(d => days <= d)
  if (step == null || days < 0) return []
  const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
  return [{ key: `token:${expiresAt}:${step}`, leagueId: '', title: 'Sleeper connection ending', body: `Monte's connection to Sleeper ends ${when}. Connect again in Settings to keep alerts and moves working.` }]
}

/** FAAB left for a roster, or null when the league doesn't use a budget. */
export function faabLeft(league: any, roster: any): number | null {
  const s = league?.settings ?? {}
  if (Number(s.waiver_type) !== FAAB_TYPE) return null
  return Math.max(0, Number(s.waiver_budget ?? 0) - Number(roster?.settings?.waiver_budget_used ?? 0))
}

/** Which alerts are new, and the keys to remember. Never forgets on absence, like offers. */
export function diffAlerts(found: Alert[], seen: string[]): { fresh: Alert[]; seen: string[] } {
  const known = new Set(seen)
  const fresh = found.filter(a => !known.has(a.key) && known.add(a.key))
  return { fresh, seen: fresh.length ? [...seen, ...fresh.map(a => a.key)].slice(-SEEN_LIMIT) : seen }
}

/** What to show: grouped alerts become one message, in the order first seen. */
export function alertMessages(fresh: Alert[]): Message[] {
  const out: Array<Message & { group?: string; lines?: string[]; tail?: string }> = []
  for (const a of fresh) {
    const g = a.group ? out.find(m => m.group === a.group) : undefined
    if (g) g.lines!.push(a.line ?? a.body)
    else out.push({ title: a.title, body: a.body, leagueId: a.leagueId, group: a.group, lines: [a.line ?? a.body], tail: a.tail })
  }
  return out.map(m => ({ title: m.title, leagueId: m.leagueId, body: m.group ? [...m.lines!, m.tail].filter(Boolean).join(' ') : m.body }))
}
