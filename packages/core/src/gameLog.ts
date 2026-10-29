// The player page's week-by-week table, shared by desktop and mobile: which of Sleeper's stat keys
// show for a position, grouped the way Sleeper groups them, with each cell's heat (0..1 within its
// column, best = 1) worked out here so the two views only draw.
import type { GameLog } from './types'

type S = Record<string, number>
type Col = {
  k: string
  get: (s: S) => number | null
  /** a lower number is the better week (INT, sacks, rank) */
  low?: boolean
  /** the AVG row is sum(num) / sum(den) over the season, not the mean of weekly ratios */
  ratio?: [(s: S) => number, (s: S) => number, number]
  f?: 'pts' | 'dec'
}
type Group = { label: string; cols: Col[]; /** dropped when every week is 0 */ optional?: boolean }

const n = (key: string) => (s: S) => Number(s[key] ?? 0)
const per = (num: string, den: string, scale = 1): Pick<Col, 'get' | 'ratio'> => ({
  get: s => (Number(s[den] ?? 0) > 0 ? (scale * Number(s[num] ?? 0)) / Number(s[den]) : null),
  ratio: [n(num), n(den), scale],
})
// Sleeper leaves zero stats out, so a missing key is 0 — except rank and snaps, which can be truly absent.
const fantasy: Group = {
  label: 'Fantasy',
  cols: [
    { k: 'PPR', get: n('pts_ppr'), f: 'pts' },
    { k: 'RK', get: s => (s.pos_rank_ppr != null ? Number(s.pos_rank_ppr) : null), low: true },
    { k: 'SNP%', ...per('off_snp', 'tm_off_snp', 100) },
  ],
}
const fum: Group = { label: 'Misc', cols: [{ k: 'FL', get: n('fum_lost'), low: true }], optional: true }

function groupsFor(pos: string): Group[] {
  if (pos === 'QB')
    return [
      fantasy,
      {
        label: 'Passing',
        cols: [
          { k: 'CMP', get: n('pass_cmp') },
          { k: 'ATT', get: n('pass_att') },
          { k: 'YDS', get: n('pass_yd') },
          { k: 'TD', get: n('pass_td') },
          { k: 'INT', get: n('pass_int'), low: true },
          { k: 'SK', get: n('pass_sack'), low: true },
          { k: 'Y/A', ...per('pass_yd', 'pass_att'), f: 'dec' },
          { k: 'RTG', get: s => (s.pass_rtg != null ? Number(s.pass_rtg) : null) },
        ],
      },
      { label: 'Rushing', cols: [{ k: 'ATT', get: n('rush_att') }, { k: 'YDS', get: n('rush_yd') }, { k: 'TD', get: n('rush_td') }] },
      fum,
    ]
  const rushing: Group = {
    label: 'Rushing',
    cols: [
      { k: 'ATT', get: n('rush_att') },
      { k: 'YDS', get: n('rush_yd') },
      { k: 'Y/A', ...per('rush_yd', 'rush_att'), f: 'dec' },
      { k: 'TD', get: n('rush_td') },
      { k: 'RZ', get: n('rush_rz_att') },
    ],
  }
  const receiving = (deep: boolean): Group => ({
    label: 'Receiving',
    cols: [
      { k: 'TGT', get: n('rec_tgt') },
      { k: 'REC', get: n('rec') },
      { k: 'YDS', get: n('rec_yd') },
      { k: 'TD', get: n('rec_td') },
      ...(deep
        ? [
            { k: 'Y/R', ...per('rec_yd', 'rec'), f: 'dec' as const },
            { k: 'LNG', get: n('rec_lng') },
            { k: 'AIR', get: n('rec_air_yd') },
            { k: 'RZ', get: n('rec_rz_tgt') },
            { k: '1D', get: n('rec_fd') },
          ]
        : []),
    ],
  })
  if (pos === 'RB') return [fantasy, rushing, receiving(false), fum]
  return [fantasy, receiving(true), { label: 'Rushing', cols: rushing.cols.slice(0, 2), optional: true }, fum]
}

export type GameTable = {
  groups: Array<{ label: string; span: number }>
  cols: string[]
  rows: Array<{ week: number; opp: string; cells: Array<{ text: string; heat: number | null }> }>
  avg: string[]
}

const show = (c: Col, x: number | null, mean = false) =>
  x == null || !Number.isFinite(x) ? '–' : c.f === 'pts' || c.f === 'dec' ? x.toFixed(1) : mean && x < 10 ? x.toFixed(1) : String(Math.round(x))

export function gameTable(pos: string, games: GameLog[]): GameTable {
  const groups = groupsFor(pos).filter(g => !g.optional || games.some(gm => g.cols.some(c => (c.get(gm.stats) ?? 0) !== 0)))
  const cols = groups.flatMap(g => g.cols)
  const vals = games.map(gm => cols.map(c => c.get(gm.stats)))
  const col = (j: number) => vals.map(v => v[j]).filter((x): x is number => x != null)
  const lo = cols.map((_, j) => Math.min(...col(j)))
  const hi = cols.map((_, j) => Math.max(...col(j)))
  return {
    groups: groups.map(g => ({ label: g.label, span: g.cols.length })),
    cols: cols.map(c => c.k),
    rows: games.map((gm, i) => ({
      week: gm.week,
      opp: (gm.away ? '@' : '') + gm.opp,
      cells: cols.map((c, j) => {
        const x = vals[i][j]
        if (x == null) return { text: '–', heat: null }
        const v = hi[j] === lo[j] ? 0.5 : (x - lo[j]) / (hi[j] - lo[j])
        return { text: show(c, x), heat: c.low ? 1 - v : v }
      }),
    })),
    avg: cols.map((c, j) => {
      if (c.ratio) {
        const [num, den, scale] = c.ratio
        const d = games.reduce((t, gm) => t + den(gm.stats), 0)
        return show(c, d > 0 ? (scale * games.reduce((t, gm) => t + num(gm.stats), 0)) / d : null, true)
      }
      const xs = col(j)
      return show(c, xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null, true)
    }),
  }
}
