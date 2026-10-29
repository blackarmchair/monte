// A team's roster in the order the League / Team pages offer: value, position, youngest, or this
// week's starters first. Ties fall back to value.
import type { OvPlayer } from './types'

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
