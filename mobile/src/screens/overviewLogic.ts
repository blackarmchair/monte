// League maths, ported from the desktop OverviewView: per-team value, positional and starter
// ranks, pick values, tiers and the verdict lines. Shared by the League tab and its team sheet,
// plus useOverview(), which loads the data and starts the sim the starter ranks need.
import { useEffect, useMemo, useState } from 'react'
import type { BBResult, OverviewData, OvPlayer, OvTeam, Result } from '@monte/core/types'
import { anonOverview } from '@monte/core/names'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'

export const POS = ['QB', 'RB', 'WR', 'TE'] as const
export type Pos = (typeof POS)[number]
export { num, ORD } from '@/ui/kit'

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
  const slotOf = new Map([...(bb?.teams ?? [])].sort((a, b) => a.meanDraftSlot - b.meanDraftSlot).map((t, i) => [t.roster_id, i + 1]))

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

export function statusTag(p: OvPlayer): { label: string; tone: 'neg' | 'warn' | 'chip' } | null {
  if (p.ir || p.injury === 'IR') return { label: 'IR', tone: 'neg' }
  const s = p.injury
  if (s === 'Out' || s === 'Sus' || s === 'PUP' || s === 'NFI') return { label: s, tone: 'neg' }
  if (s === 'Questionable') return { label: 'Q', tone: 'warn' }
  if (s === 'Doubtful') return { label: 'D', tone: 'warn' }
  if (p.taxi) return { label: 'Taxi', tone: 'chip' }
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

/** Overview data for the selected league, ranked against the pick-odds sim (started if needed). */
export function useOverview() {
  const { context, bbBase, runBB, hide, dataVersion, sheet } = useApp()
  const [tick, setTick] = useState(0)
  const [res, setRes] = useState<Result<OverviewData> | null>(null)
  const leagueId = context?.league.league_id

  useEffect(() => {
    if (!leagueId || !sheet) return
    let live = true
    setRes(null)
    void monte.leagueOverview(leagueId).then(r => live && setRes(r))
    return () => {
      live = false
    }
  }, [leagueId, dataVersion, tick, !!sheet]) // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => setTick(x => x + 1)
  // Starter ranks and pick values need the sim; start it if this league has none yet.
  useEffect(() => {
    if (leagueId && sheet && !bbBase.result && !bbBase.busy && !bbBase.error) runBB()
  }, [leagueId, !!sheet]) // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => (res?.ok ? (hide ? anonOverview(res.value) : res.value) : null), [res, hide])
  const rows = useMemo(() => (data ? buildRows(data, bbBase.result) : []), [data, bbBase.result])
  const n = data?.teams.length ?? context?.rosters.length ?? 10
  return { res, data, rows, n, load, simBusy: !!bbBase.busy, simError: bbBase.error, runBB }
}
