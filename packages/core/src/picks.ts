// Who owns which picks in the next rookie draft.
import type { OwnedPick, RosterInfo } from './types'

/**
 * Every roster starts with its own picks; traded_picks then reassigns ownership. Without
 * traded_picks "every team owns its own picks" is wrong the moment one moves.
 */
export function pickOwners(rosters: RosterInfo[], traded: any[], draftSeason: string, rounds: number): Map<string, number> {
  const owner = new Map<string, number>()
  for (const r of rosters) for (let rd = 1; rd <= rounds; rd++) owner.set(`${r.roster_id}:${rd}`, r.roster_id)
  for (const t of traded ?? [])
    if (String(t.season) === draftSeason && t.round <= rounds) owner.set(`${t.roster_id}:${t.round}`, t.owner_id)
  return owner
}

export function ownedPicks(rosters: RosterInfo[], owner: Map<string, number>, draftSeason: string, myRosterId: number | null): OwnedPick[] {
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
