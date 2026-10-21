// Tyler's dynasty board -> per-player values, matched to Sleeper ids.
//
// Pure sheet, the same transform as reference/dynasty_daddy_export.py so Monte's numbers agree
// with the Dynasty Daddy upload: the .75 TE-prem column (always the right-hand block), value =
// 10000·e^(−rank/70), unranked rostered players = 1. No scoring, market or conviction layer.
import type { Workbook } from './xlsx'

export const value = (rank: number) => 10000 * Math.exp(-rank / 70)
export const UNRANKED = 1
/** Pick discount by seasons ahead of the current one; matches dynasty_model.py. */
export const FUTURE_DISCOUNT = [1, 0.72, 0.52, 0.45]

export type SheetRow = { rank: number; name: string; pos: string }
export type Board = { tab: string; column: string; rows: SheetRow[] }

const SUFFIX = /\s+(jr|sr|ii|iii|iv|v)$/i
export function norm(s: string): string {
  let n = (s ?? '').toLowerCase().replace(/[.'’`]/g, '').replace(/-/g, ' ')
  n = n.replace(SUFFIX, '').replace(/\s+/g, ' ').trim()
  return ALIAS[n] ?? n
}
// Sheet spelling -> Sleeper spelling, both normalised. Grows as mismatches are found; every
// entry here is a name the unmatched list once showed.
const ALIAS: Record<string, string> = {
  'kenny gainwell': 'kenneth gainwell',
  'mitch trubisky': 'mitchell trubisky',
  'josh palmer': 'joshua palmer',
  'matt hibner': 'matthew hibner',
}

const isTep = (banner: string) => /te prem/i.test(banner) && !/no te prem/i.test(banner)

/**
 * Every block on the dynasty overall board, left to right, found by layout rather than tab name:
 * a header row holding Rank / Player / Pos (twice on Tyler's sheet: no-TE-prem on the left, .75
 * TE-prem on the right). `column` is the block's banner text. Refuses rather than guesses.
 */
export function findBoards(wb: Workbook): Board[] {
  const problems: string[] = []
  for (const tab of wb.sheets) {
    const g = wb.grid(tab)
    for (let h = 0; h < Math.min(g.length, 6); h++) {
      const row = (g[h] ?? []).map(c => c.trim().toLowerCase())
      const starts: number[] = []
      for (let c = 0; c + 2 < row.length; c++)
        if (row[c] === 'rank' && row[c + 1] === 'player' && row[c + 2] === 'pos') starts.push(c)
      if (starts.length === 0) continue
      const boards: Board[] = []
      starts.forEach((col, i) => {
        const rows: SheetRow[] = []
        for (let r = h + 1; r < g.length; r++) {
          const rank = Number.parseFloat(g[r]?.[col] ?? '')
          const name = (g[r]?.[col + 1] ?? '').trim()
          if (!Number.isFinite(rank) || !name) continue
          rows.push({ rank, name, pos: (g[r]?.[col + 2] ?? '').trim().toUpperCase() })
        }
        if (rows.length < 150 || rows[0].rank !== 1) {
          problems.push(`"${tab}" looks like a rankings table but has ${rows.length} rows`)
          return
        }
        const banner = (g[h - 1]?.[col] ?? '').trim()
        boards.push({ tab, column: banner || (i === starts.length - 1 ? 'right-hand block' : 'left-hand block'), rows })
      })
      if (boards.length) return boards
    }
  }
  throw new Error(
    problems.length
      ? `No usable dynasty board: ${problems.join('; ')}.`
      : 'No dynasty overall board found (a tab with Rank / Player / Pos columns). Is this Tyler’s sheet?',
  )
}

/** The board Monte values off: the block whose banner says TE Prem — but not "No TE Prem", which
 *  is the left-hand block and the exact opposite — else the right-most block. */
export function findBoard(wb: Workbook): Board {
  const boards = findBoards(wb)
  return boards.find(b => isTep(b.column)) ?? boards[boards.length - 1]
}

export const boardIsTep = (b: Board) => isTep(b.column)

export type Meta = Record<string, any>
export type Valued = { rank: number | null; value: number }

/**
 * Sheet rows -> Sleeper player ids. Exact normalised name first, preferring a position match,
 * then a player who is on a roster in this league, then one with an NFL team.
 */
export function matchBoard(board: Board, meta: Meta, rostered: Set<string>) {
  const idFor = rowMatcher(meta, rostered)
  const values = new Map<string, Valued>()
  const unmatched: string[] = []
  for (const row of board.rows) {
    const id = idFor(row)
    if (!id) {
      unmatched.push(`${row.rank} ${row.name} (${row.pos})`)
      continue
    }
    if (!values.has(id)) values.set(id, { rank: row.rank, value: value(row.rank) })
  }
  return { values, unmatched }
}

/** One sheet row -> its Sleeper id, or null when no skill player has that name. */
export function rowMatcher(meta: Meta, rostered: Set<string>): (row: SheetRow) => string | null {
  const byName = new Map<string, string[]>()
  for (const [id, p] of Object.entries(meta)) {
    // fantasy_positions too: a two-way player (Travis Hunter) is position CB, fantasy WR.
    const skill = ['QB', 'RB', 'WR', 'TE']
    if (!skill.includes(p?.position) && !(p?.fantasy_positions ?? []).some((f: string) => skill.includes(f))) continue
    const nm = p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`
    const k = norm(nm)
    if (!k) continue
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k)!.push(id)
  }
  return row => {
    const cands = byName.get(norm(row.name)) ?? []
    if (!cands.length) return null
    const score = (id: string) =>
      (meta[id].position === row.pos || (meta[id].fantasy_positions ?? []).includes(row.pos) ? 4 : 0) + (rostered.has(id) ? 2 : 0) + (meta[id].team ? 1 : 0)
    return [...cands].sort((a, b) => score(b) - score(a))[0]
  }
}

/**
 * Rookie-pick curve: this season's rookies, valued off the overall board, sorted descending.
 * Index (round−1)·teams + slot−1 is that pick's value before the future discount. The export
 * built this from the Rookie tab, which the sheet no longer has; the overall board's values for
 * the same class are what that tab's names were mapped to anyway.
 */
export function rookieCurve(values: Map<string, Valued>, meta: Meta): number[] {
  return [...values.entries()]
    .filter(([id]) => Number(meta[id]?.years_exp) === 0)
    .map(([, v]) => v.value)
    .sort((a, b) => b - a)
}

/** A team's picture: its league-specific avatar if the manager set one, else their Sleeper avatar. */
export const userAvatar = (u: { avatar?: string | null; metadata?: { avatar?: string } | null } | undefined): string | null =>
  u?.metadata?.avatar || (u?.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : null)
