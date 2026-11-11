// The league's regular-season schedule: every week's head-to-head pairs, final scores for the weeks
// played, and (in the UI) the pick-odds sim's win chance for the rest. Sleeper pairs every week up
// front, so /matchups/{week} answers for future weeks too, with 0 points. Playoff weeks carry
// placeholder pairs until the bracket fills, so the schedule stops at the last regular-season week;
// a playoff week's real games are on the Matchups tab.
import { teamNames } from './leagueWeek'

export type WeekState = 'final' | 'current' | 'upcoming'

export type SchedSide = { rosterId: number; /** null until the week has been played */ points: number | null }
export type SchedGame = { id: number; sides: [SchedSide, SchedSide] }
export type SchedWeek = { week: number; state: WeekState; games: SchedGame[] }

export type LeagueSchedule = {
  season: string
  /** the NFL week now; 0 before the season */
  currentWeek: number
  weeks: SchedWeek[]
  teams: Record<number, { name: string; avatar: string | null }>
  builtAt: string
}

/** First and last regular-season weeks: start_week up to the week before playoff_week_start. */
export function regularWeeks(league: any): number[] {
  const start = Number(league.settings?.start_week) || 1
  const po = Number(league.settings?.playoff_week_start) || 0
  const last = po > start ? po - 1 : 17
  return Array.from({ length: Math.max(0, last - start + 1) }, (_, i) => start + i)
}

export function buildSchedule(o: {
  league: any
  rosters: any[]
  users: any[]
  season: string
  currentWeek: number
  /** week -> REST /league/{id}/matchups/{week} */
  matchups: Record<number, any[]>
}): LeagueSchedule {
  const names = teamNames(o.rosters, o.users)
  // A season that hasn't started yet (pre-draft, or a future season) has no current week.
  const now = o.league.status === 'in_season' || o.league.status === 'post_season' || o.league.status === 'complete' ? o.currentWeek : 0
  const done = o.league.status === 'complete'
  const weeks: SchedWeek[] = regularWeeks(o.league).map(week => {
    const state: WeekState = done || (now > 0 && week < now) ? 'final' : week === now ? 'current' : 'upcoming'
    const byId = new Map<number, any[]>()
    for (const m of o.matchups[week] ?? []) if (m?.matchup_id != null) byId.set(m.matchup_id, [...(byId.get(m.matchup_id) ?? []), m])
    const games: SchedGame[] = [...byId]
      .filter(([, pair]) => pair.length === 2)
      .sort((a, b) => a[0] - b[0])
      .map(([id, pair]) => ({
        id,
        sides: pair.map(m => ({ rosterId: Number(m.roster_id), points: state === 'upcoming' ? null : Number(m.points ?? 0) })) as [SchedSide, SchedSide],
      }))
    return { week, state, games }
  })
  return {
    season: o.season,
    currentWeek: now,
    weeks,
    teams: Object.fromEntries([...names].map(([rid, n]) => [rid, n])),
    builtAt: new Date().toISOString(),
  }
}

export type TeamGame = { week: number; state: WeekState; opp: number; me: number | null; them: number | null; result: 'W' | 'L' | 'T' | null }

/** One roster's season: its opponent each week and, for the weeks played, the score and result. */
export function teamSchedule(s: LeagueSchedule, rosterId: number): TeamGame[] {
  return s.weeks.flatMap(w => {
    const g = w.games.find(x => x.sides.some(y => y.rosterId === rosterId))
    if (!g) return []
    const [me, them] = g.sides[0].rosterId === rosterId ? g.sides : [g.sides[1], g.sides[0]]
    const result = w.state !== 'final' || me.points == null || them.points == null ? null : me.points > them.points ? 'W' : me.points < them.points ? 'L' : 'T'
    return [{ week: w.week, state: w.state, opp: them.rosterId, me: me.points, them: them.points, result }]
  })
}

/** The pick-odds sim's chance this roster wins its game that week, when the run covered it. */
export const simWinPct = (weekWinPct: Record<number, Record<number, number>> | undefined, week: number, rosterId: number): number | null =>
  weekWinPct?.[week]?.[rosterId] ?? null
