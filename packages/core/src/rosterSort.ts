// A team's roster in the order the League / Team pages offer: value, position, youngest, or this
// week's starters first. Ties fall back to value.
import type { OvPlayer, OvTeam } from './types'

export type RosterSort = 'value' | 'pos' | 'age' | 'starters'

const POS_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3 }
const byPos = (a: OvPlayer, b: OvPlayer) => (POS_ORDER[a.pos] ?? 9) - (POS_ORDER[b.pos] ?? 9)
const byValue = (a: OvPlayer, b: OvPlayer) => b.value - a.value

export const ROSTER_SORT: Record<RosterSort, (a: OvPlayer, b: OvPlayer) => number> = {
  value: byValue,
  pos: (a, b) => byPos(a, b) || byValue(a, b),
  age: (a, b) => (a.age ?? 99) - (b.age ?? 99) || byValue(a, b),
  starters: (a, b) => Number(b.starter) - Number(a.starter) || byPos(a, b) || byValue(a, b),
}

export const ROSTER_SORTS: Array<{ value: RosterSort; label: string }> = [
  { value: 'value', label: 'Value' },
  { value: 'pos', label: 'Position' },
  { value: 'age', label: 'Youngest' },
  { value: 'starters', label: 'Starters' },
]

// ---- the lineup view: the default, laid out the way Sleeper's own team page is ----------------

/** The Team page's roster views: the lineup first, then the sorts (starters-first is the lineup). */
export type RosterView = 'lineup' | Exclude<RosterSort, 'starters'>
export const ROSTER_VIEWS: Array<{ value: RosterView; label: string }> = [
  { value: 'lineup', label: 'Lineup' },
  ...ROSTER_SORTS.filter((s): s is { value: Exclude<RosterSort, 'starters'>; label: string } => s.value !== 'starters'),
]

const SLOT_LABEL: Record<string, string> = { SUPER_FLEX: 'SF', WRRB_FLEX: 'W/R', REC_FLEX: 'W/T', IDP_FLEX: 'IDP' }
export const slotLabel = (slot: string) => SLOT_LABEL[slot] ?? slot

/** One row of the lineup view. `player` is null for an empty slot or a non-skill starter (`name` set). */
export type LineupRow = { key: string; badge: string; player: OvPlayer | null; name?: string; pos?: string }
export type LineupSection = { title: 'Starters' | 'Bench' | 'IR' | 'Taxi'; rows: LineupRow[] }

/**
 * Starters in their slots, then the bench, IR and taxi squad (each by position, then value). With
 * `pos`, only that position's players, still in the same sections. Empty sections are left out.
 */
export function lineupSections(team: OvTeam, pos?: string): LineupSection[] {
  const byId = new Map(team.players.map(p => [p.id, p]))
  const keep = (p: OvPlayer | null | undefined) => !pos || p?.pos === pos
  const starters: LineupRow[] = team.lineup
    ? team.lineup.flatMap((s, i) => {
        const p = s.id ? byId.get(s.id) ?? null : null
        if (pos && !keep(p)) return []
        return [{ key: `s${i}`, badge: slotLabel(s.slot), player: p, name: p ? undefined : s.name, pos: s.pos }]
      })
    : // Data from before lineups were carried: starters by position, no slot order to follow.
      team.players
        .filter(p => p.starter && keep(p))
        .sort(ROSTER_SORT.pos)
        .map(p => ({ key: `s${p.id}`, badge: p.pos, player: p }))
  const placed = new Set(starters.map(r => r.player?.id))
  const rest = team.players.filter(p => !placed.has(p.id) && keep(p)).sort(ROSTER_SORT.pos)
  const rows = (ps: OvPlayer[], badge: (p: OvPlayer) => string) => ps.map(p => ({ key: p.id, badge: badge(p), player: p }))
  const sections: LineupSection[] = [
    { title: 'Starters', rows: starters },
    { title: 'Bench', rows: rows(rest.filter(p => !p.ir && !p.taxi), p => p.pos) },
    { title: 'IR', rows: rows(rest.filter(p => p.ir), () => 'IR') },
    { title: 'Taxi', rows: rows(rest.filter(p => p.taxi && !p.ir), () => 'TX') },
  ]
  return sections.filter(s => s.rows.length)
}
