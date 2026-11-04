// Noticing new trade offers across all your leagues, for notifications. Each host decides when to
// look and how to show it; this decides what counts as new and what to say.
import { normaliseTrade, teamNames } from './leagueWeek'
import { offerRole } from './offers'

export type FoundOffer = {
  id: string
  leagueId: string
  leagueName: string
  from: string
  gets: string[]
  gives: string[]
}

/** How many offer ids to remember. Enough that an old one can't come back as new. */
const SEEN_LIMIT = 200

/** Offers in one league waiting on your answer, from Sleeper's raw transactions. */
export function offersInLeague(o: { league: any; rosters: any[]; users: any[]; pending: any[]; userId: string }): FoundOffer[] {
  const mine = o.rosters.find(r => r.owner_id === o.userId || (r.co_owners ?? []).includes(o.userId))
  if (!mine) return []
  const rosterOf = new Map<string, number>()
  for (const r of o.rosters) for (const u of [r.owner_id, ...(r.co_owners ?? [])]) if (u) rosterOf.set(String(u), r.roster_id)
  const names = teamNames(o.rosters, o.users)
  const out: FoundOffer[] = []
  for (const raw of o.pending) {
    // Names come from the transaction's own player_map: a background check can't afford the full player table.
    const tx = normaliseTrade(raw, {}, u => rosterOf.get(u) ?? null)
    if (offerRole(tx, mine.roster_id) !== 'received') continue
    const label = (s: (typeof tx.sides)[number]) => [...s.players.map(p => p.name), ...s.picks.map(p => `${p.season} round ${p.round}`)]
    out.push({
      id: tx.id,
      leagueId: String(o.league.league_id),
      leagueName: String(o.league.name ?? 'your league'),
      from: tx.creator != null ? names.get(tx.creator)?.name ?? 'Another team' : 'Another team',
      gets: tx.sides.filter(s => s.rosterId === mine.roster_id).flatMap(label),
      gives: tx.sides.filter(s => s.rosterId !== mine.roster_id).flatMap(label),
    })
  }
  return out
}

/** Which offers are new, and the list to remember next time. Never forgets on absence: a league
 *  that failed to load this round must not make its offers look new on the next. */
export function diffOffers(found: FoundOffer[], seen: string[]): { fresh: FoundOffer[]; seen: string[] } {
  const known = new Set(seen)
  const fresh = found.filter(o => !known.has(o.id))
  return { fresh, seen: fresh.length ? [...seen, ...fresh.map(o => o.id)].slice(-SEEN_LIMIT) : seen }
}

/** With Hide names on, or a player Sleeper didn't name, the notification says only that there's an offer. */
export function offerMessage(o: FoundOffer, hideNames: boolean): { title: string; body: string } {
  if (hideNames) return { title: 'New trade offer', body: 'Open Monte to see it.' }
  const title = `Trade offer · ${o.leagueName}`
  if ([...o.gets, ...o.gives].some(n => /^\d+$/.test(n))) return { title, body: `From ${o.from}. Open Monte to see it.` }
  const list = (xs: string[]) => xs.join(', ') || 'nothing'
  return { title, body: `From ${o.from}. You get ${list(o.gets)}. You give ${list(o.gives)}.` }
}
