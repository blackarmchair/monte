// The Team page's share radar, for both apps: what fraction of the league's total each team holds
// in each bucket. Three breakdowns: value by position (QB, RB, WR, TE, picks), value by role (core,
// win-now, upside, depth, picks; see rolesOf), and in season weekly production by position (see
// production). Shares cluster near an even split (1/n), so the radius is the share against that
// split on a log scale: mid-radius is even, the rim is double (or more, clipped), the centre half
// (or less). 13% against a 10% split then reads as the edge it is. The apps only draw it.
import { POS, production, ROLE_HELP, ROLES, roleValues, hasProduction, type Pos, type Role, type TeamRow } from './overviewMath'

export type Breakdown = 'pos' | 'role' | 'prod'

export const breakdownOptions = (rows: TeamRow[]): Array<{ value: Breakdown; label: string }> => [
  { value: 'pos', label: 'Position' },
  { value: 'role', label: 'Role' },
  ...(hasProduction(rows) ? [{ value: 'prod' as const, label: 'Production' }] : []),
]

export type RadarSpoke = {
  key: string
  /** this team's amount (value, or points per week) */
  amount: number
  /** the league's total in this bucket */
  total: number
  /** this team's fraction of the total */
  share: number
  /** share against an even split */
  times: number
  /** 0..1 radius on the log scale */
  rad: number
  /** 1 = most in the league */
  rank: number
}

export type ShareRadar = {
  /** the breakdown shown: production falls back to position when there's none (off-season) */
  mode: Breakdown
  spokes: RadarSpoke[]
  /** an even split, 1/n */
  even: number
  /** this team's total and its share of the league's */
  mine: number
  overall: number
  /** "Share of league value" / "Share of league production · 128.4 pts/wk" */
  title: string
  /** this team's own mix across the buckets: "Core 48% · Win-now 22% · …" */
  mix: string
  /** the line for one spoke when it's pointed at or tapped */
  describe: (key: string) => string
}

const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`
export const fmtPct = pct
export const fmtTimes = (v: number) => `${v.toFixed(1)}×`
const whole = (v: number) => Math.round(v).toLocaleString()

export function shareRadar(rows: TeamRow[], row: TeamRow, n: number, want: Breakdown): ShareRadar {
  const mode: Breakdown = want === 'prod' && !hasProduction(rows) ? 'pos' : want
  let keys: string[]
  let val: (r: TeamRow, k: string) => number
  if (mode === 'pos') {
    keys = [...POS, 'Picks']
    val = (r, k) => (k === 'Picks' ? r.pickValue : r.pos[k as Pos].value)
  } else if (mode === 'prod') {
    const by = new Map(rows.map(r => [r, production(r.team)]))
    keys = [...POS]
    val = (r, k) => by.get(r)![k as Pos | 'total']
  } else {
    const by = new Map(rows.map(r => [r, roleValues(r)]))
    keys = [...ROLES, 'Picks']
    val = (r, k) => by.get(r)![k as Role | 'Picks']
  }

  const even = 1 / Math.max(1, n)
  const spokes = keys.map(key => {
    const amount = val(row, key)
    const total = rows.reduce((s, r) => s + val(r, key), 0)
    const share = total > 0 ? amount / total : 0
    const times = share / even
    return {
      key,
      amount,
      total,
      share,
      times,
      rad: Math.min(1, Math.max(0, 0.5 + Math.log2(Math.max(times, 1e-9)) / 2)),
      rank: 1 + rows.filter(r => val(r, key) > amount).length,
    }
  })

  const prod = mode === 'prod'
  const mine = prod ? val(row, 'total') : row.value
  const league = rows.reduce((s, r) => s + (prod ? val(r, 'total') : r.value), 0)
  const fmt = (v: number) => (prod ? `${v.toFixed(1)} pts/wk` : whole(v))
  const byKey = new Map(spokes.map(s => [s.key, s]))

  return {
    mode,
    spokes,
    even,
    mine,
    overall: league > 0 ? mine / league : 0,
    title: prod ? `Share of league production · ${mine.toFixed(1)} pts/wk` : 'Share of league value',
    mix: `Mix: ${spokes.map(s => `${s.key} ${mine > 0 ? Math.round((s.amount / mine) * 100) : 0}%`).join(' · ')}`,
    describe: key => {
      const s = byKey.get(key)
      if (!s) return ''
      const help = mode === 'role' ? ` (${ROLE_HELP[key as Role | 'Picks']})` : ''
      return `${key}${help}: ${prod ? `${fmt(s.amount)}, ` : ''}${pct(s.share)} of the league's ${fmt(s.total)} (${fmtTimes(s.times)} even), #${s.rank} of ${n}.`
    },
  }
}

/** A point on spoke i of `count`, at radius fraction f, around (cx, cy) with full radius r. Spoke 0 points up. */
export function radarPoint(i: number, count: number, f: number, cx: number, cy: number, r: number): [number, number] {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / count
  return [cx + Math.cos(a) * r * f, cy + Math.sin(a) * r * f]
}
