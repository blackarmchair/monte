// League maths: per-team value, positional and starter ranks, pick values, tiers and the verdict lines.
import { projectedSlots } from './slots'
import type { BBResult, OverviewData, OvPlayer, OvTeam } from './types'

export const POS = ['QB', 'RB', 'WR', 'TE'] as const
export type Pos = (typeof POS)[number]

type Tier = 'Contender' | 'Last dance' | 'Frisky' | 'Fraud' | 'Rebuilding'

/** Tier thresholds, as fractions of the league size so they work for 10 or 12 teams. */
export const TIER_RULES = {
  /** Fraud: record at or above this fraction while starters are below it */
  fraudRecord: 0.5,
  /** Contender: starters in this top fraction, and value in the top `contenderValue` */
  contenderStarters: 1 / 3,
  contenderValue: 0.5,
  /** Last dance: starters in the top half but value in the bottom half, or this average age */
  lastDanceAge: 27,
  /** Frisky: starters outside this bottom fraction, value in the top half */
  friskyStarterFloor: 1 / 3,
}

export type TeamRow = {
  team: OvTeam
  value: number
  pos: Record<Pos, { value: number; age: number | null; rank: number }>
  picks: Array<{ season: string; round: number; orig: number; via: string | null; value: number; slot: string | null }>
  pickValue: number
  avgAge: number | null
  ranks: { overall: number; starter: number | null; picks: number; record: number; youngest: number }
  starterPPG: number | null
  needs: Pos[]
  deep: Pos[]
  tier: { name: Tier; why: string } | null
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** 1-based rank of every key by a score, best first. */
function rankBy<K>(keys: K[], score: (k: K) => number): Map<K, number> {
  return new Map([...keys].sort((a, b) => score(b) - score(a)).map((k, i) => [k, i + 1]))
}

/**
 * Contender tier: a transparent rule on starter rank (the sim's projected optimal lineup, never
 * dynasty value), value rank and record, checked in order: Fraud, Contender, Last dance, Frisky,
 * else Rebuilding.
 */
function tierOf(r: Omit<TeamRow, 'tier'>, n: number): TeamRow['tier'] {
  const s = r.ranks.starter
  if (s == null) return null
  const R = TIER_RULES
  const o = r.ranks.overall
  const old = (r.avgAge ?? 0) >= R.lastDanceAge
  if (r.ranks.record <= n * R.fraudRecord && s > n * R.fraudRecord)
    return { name: 'Fraud', why: `record #${r.ranks.record} but starters #${s}: winning past the roster` }
  if (s <= n * R.contenderStarters && o <= n * R.contenderValue) return { name: 'Contender', why: `starters #${s} and value #${o}` }
  if (s <= n / 2 && (o > n / 2 || old))
    return { name: 'Last dance', why: `starters #${s} but value #${o}${old ? `, avg age ${r.avgAge!.toFixed(1)}` : ''}` }
  if (s <= n - n * R.friskyStarterFloor && o <= n / 2) return { name: 'Frisky', why: `starters #${s}, value #${o}: young and close` }
  return { name: 'Rebuilding', why: `starters #${s}, value #${o}` }
}

export function buildRows(data: OverviewData, bb: BBResult | undefined): TeamRow[] {
  const n = data.teams.length
  const bbBy = new Map(bb?.teams.map(t => [t.roster_id, t]))
  const name = new Map(data.teams.map(t => [t.roster_id, t.display_name]))
  const curve = (rd: number, slot: number) => data.pickCurve[(rd - 1) * n + slot - 1] ?? 0
  const weeksLeft = bb ? Math.max(1, bb.weeks.length - bb.lastScoredWeek) : 1
  const seasons = [...new Set(data.picks.map(p => p.season))].sort()

  // Next draft: expected value over the sim's slot distribution. Later drafts: the round's average.
  const pickEV = (season: string, rd: number, orig: number) => {
    const disc = data.discount[seasons.indexOf(season)] ?? data.discount[data.discount.length - 1]
    const dist = season === data.season ? bbBy.get(orig)?.slotDist : undefined
    const ev = dist
      ? dist.reduce((s, p, k) => s + p * curve(rd, k + 1), 0)
      : Array.from({ length: n }, (_, k) => curve(rd, k + 1)).reduce((a, b) => a + b, 0) / n
    return ev * disc
  }
  const slotOf = projectedSlots(bb?.teams ?? [])

  const base = data.teams.map(team => {
    const pos = Object.fromEntries(
      POS.map(p => {
        const ps = team.players.filter(x => x.pos === p)
        return [p, { value: ps.reduce((s, x) => s + x.value, 0), age: mean(ps.flatMap(x => (x.age == null ? [] : [x.age]))), rank: 0 }]
      }),
    ) as TeamRow['pos']
    const picks = data.picks
      .filter(p => p.ownerRosterId === team.roster_id)
      .sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round || (slotOf.get(a.originalRosterId) ?? 99) - (slotOf.get(b.originalRosterId) ?? 99))
      .map(p => ({
        season: p.season,
        round: p.round,
        orig: p.originalRosterId,
        via: p.originalRosterId === team.roster_id ? null : name.get(p.originalRosterId) ?? null,
        value: pickEV(p.season, p.round, p.originalRosterId),
        slot: p.season === data.season && slotOf.has(p.originalRosterId) ? `${p.round}.${String(slotOf.get(p.originalRosterId)).padStart(2, '0')}` : null,
      }))
    const pickValue = picks.reduce((s, p) => s + p.value, 0)
    const t = bbBy.get(team.roster_id)
    return {
      team,
      value: team.players.reduce((s, x) => s + x.value, 0) + pickValue,
      pos,
      picks,
      pickValue,
      avgAge: mean(team.players.flatMap(x => (x.age == null ? [] : [x.age]))),
      starterPPG: t ? t.rosMaxPF / weeksLeft : null,
      ranks: { overall: 0, starter: null as number | null, picks: 0, record: 0, youngest: 0 },
      needs: [] as Pos[],
      deep: [] as Pos[],
    }
  })

  const ids = base.map(b => b.team.roster_id)
  const by = new Map(base.map(b => [b.team.roster_id, b]))
  const overall = rankBy(ids, id => by.get(id)!.value)
  const picksR = rankBy(ids, id => by.get(id)!.pickValue)
  const record = rankBy(ids, id => {
    const t = by.get(id)!.team
    return t.wins + t.ties / 2 + t.pf / 1e6
  })
  const starter = bb ? rankBy(ids, id => by.get(id)!.starterPPG ?? 0) : null
  const youngest = rankBy(ids, id => -(by.get(id)!.avgAge ?? 99))
  const posR = Object.fromEntries(POS.map(p => [p, rankBy(ids, id => by.get(id)!.pos[p].value)])) as Record<Pos, Map<number, number>>

  return base
    .map(b => {
      const id = b.team.roster_id
      for (const p of POS) b.pos[p].rank = posR[p].get(id)!
      b.ranks = { overall: overall.get(id)!, starter: starter?.get(id) ?? null, picks: picksR.get(id)!, record: record.get(id)!, youngest: youngest.get(id)! }
      // Thin = bottom 3 at a position, deepest = top 2.
      b.needs = POS.filter(p => b.pos[p].rank > n - 3)
      b.deep = POS.filter(p => b.pos[p].rank <= 2)
      return { ...b, tier: tierOf(b, n) }
    })
    .sort((a, b) => a.ranks.overall - b.ranks.overall)
}

export function statusTag(p: OvPlayer): { label: string; tone: 'bad' | 'warn' | 'mid' } | null {
  if (p.ir || p.injury === 'IR') return { label: 'IR', tone: 'warn' }
  const s = p.injury
  if (s === 'Out' || s === 'Sus' || s === 'PUP' || s === 'NFI') return { label: s, tone: 'bad' }
  if (s === 'Questionable') return { label: 'Q', tone: 'warn' }
  if (s === 'Doubtful') return { label: 'D', tone: 'warn' }
  if (p.taxi) return { label: 'Taxi', tone: 'mid' }
  return null
}

const joinAnd = (xs: string[]) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
export const record = (t: OvTeam) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`
/** The position where a team ranks worst: what "thinnest" means in the CTA and Next-move bar. */
export const thinnest = (r: TeamRow): Pos => [...POS].sort((a, b) => r.pos[b].rank - r.pos[a].rank)[0]

/** The verdict's first beat: where a team stands now (starters) and later (total value). */
export function headline(r: TeamRow, n: number): string {
  const now = r.ranks.starter
  const later = r.ranks.overall
  if (now == null) return later <= Math.ceil(n * 0.3) ? 'Rich in value.' : 'Still simulating.'
  if (now <= Math.ceil(n * 0.3) && later <= Math.ceil(n * 0.3)) return 'Strong now and later.'
  if (now <= Math.ceil(n * 0.4)) return 'Built to win this year.'
  if (later <= Math.ceil(n * 0.3)) return 'Rich in value, weak on Sundays.'
  if (now > n - 3 && later > n - 3) return 'Stuck at the bottom.'
  return 'Stuck in the middle.'
}

export function verdict(r: TeamRow): string {
  const S = r.ranks.starter
  const O = r.ranks.overall
  const s1 = S == null ? `Total value #${O}; starter rank is still simulating.` : `Starters #${S}, total value #${O}.`
  const parts = [r.deep.length ? `Deepest at ${joinAnd(r.deep)}` : '', r.needs.length ? `thin at ${joinAnd(r.needs)}` : ''].filter(Boolean)
  const s2 = parts.length ? `${parts.join(', ')}.` : 'No thin spots.'
  return `${s1} ${s2.charAt(0).toUpperCase()}${s2.slice(1)}`
}

// ---- value by role: where a team's value sits, not what it's worth ------------------------------

/** The age each position falls off: RBs at 28 (only elite and pass-catching backs hold value past
 * it), WRs fade from 30, TEs last a year or so longer, QBs into their mid 30s (running QBs sooner;
 * nothing here tells them apart). */
export const AGE_CLIFF: Record<Pos, number> = { RB: 28, WR: 30, TE: 31, QB: 34 }
/** "Aging" = within this many years of the cliff. */
export const AGING_WINDOW = 2

export const ROLES = ['Core', 'Win-now', 'Upside', 'Depth'] as const
export type Role = (typeof ROLES)[number]
export const ROLE_HELP: Record<Role | 'Picks', string> = {
  Core: 'starting and young',
  'Win-now': `starting, within ${AGING_WINDOW} years of the age cliff`,
  Upside: 'not starting, young',
  Depth: `not starting, within ${AGING_WINDOW} years of the age cliff`,
  Picks: 'draft picks',
}

export const isAging = (p: OvPlayer) => p.age != null && p.age >= AGE_CLIFF[p.pos] - AGING_WINDOW

/**
 * Each player's role on his team. Starting = in Sleeper's lineup this week, or out of it for a reason
 * that isn't his standing (IR, an injury tag, or his bye) and worth at least the team's cheapest
 * starter at his position, so a hurt or idle stud still counts as a producer.
 */
export function rolesOf(team: OvTeam): Map<string, Role> {
  const floor = new Map<string, number>()
  for (const p of team.players) if (p.starter) floor.set(p.pos, Math.min(floor.get(p.pos) ?? Infinity, p.value))
  return new Map(
    team.players.map(p => {
      const excused = p.ir || !!p.injury || !!p.bye
      const starting = p.starter || (excused && p.value >= (floor.get(p.pos) ?? Infinity))
      const role: Role = starting ? (isAging(p) ? 'Win-now' : 'Core') : isAging(p) ? 'Depth' : 'Upside'
      return [p.id, role]
    }),
  )
}

/** A team's value in each role, plus picks. */
export function roleValues(r: TeamRow): Record<Role | 'Picks', number> {
  const out = { Core: 0, 'Win-now': 0, Upside: 0, Depth: 0, Picks: r.pickValue }
  const roles = rolesOf(r.team)
  for (const p of r.team.players) out[roles.get(p.id)!] += p.value
  return out
}

// ---- production: what a roster puts up each week -----------------------------------------------

/** Skill positions each starting slot takes; a slot with none (K, DEF, IDP) is left out. */
const SLOT_TAKES: Record<string, Pos[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
}
const DEFAULT_SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']
/** Out for the foreseeable: not counted as producing. Questionable and Doubtful still are. */
const SIDELINED = new Set(['IR', 'Out', 'PUP', 'NFI', 'Sus'])

/** Whether the overview carries production (season stats; in season only). */
export const hasProduction = (rows: TeamRow[]) => rows.some(r => r.team.players.some(p => p.ppg != null))

/**
 * A team's weekly production by position: its best available lineup by points per game this
 * season, filled slot by slot (fixed slots first, then the narrowest flex first). Players on IR or
 * ruled out don't count; a player's PPG is his whole season's, wherever he played it.
 */
export function production(team: OvTeam): Record<Pos, number> & { total: number } {
  const slots = (team.lineup?.map(s => s.slot) ?? DEFAULT_SLOTS).filter(s => SLOT_TAKES[s]).sort((a, b) => SLOT_TAKES[a].length - SLOT_TAKES[b].length)
  const pool = team.players.filter(p => p.ppg != null && !p.ir && !SIDELINED.has(p.injury)).sort((a, b) => b.ppg! - a.ppg!)
  const used = new Set<string>()
  const out = { QB: 0, RB: 0, WR: 0, TE: 0, total: 0 }
  for (const s of slots) {
    const p = pool.find(x => !used.has(x.id) && SLOT_TAKES[s].includes(x.pos))
    if (!p) continue
    used.add(p.id)
    out[p.pos] += p.ppg!
    out.total += p.ppg!
  }
  return out
}
