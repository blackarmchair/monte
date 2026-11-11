// One NFL team's regular season from Sleeper's schedule (opponent, home or away, date and game
// status each week; a week without a game is his bye), for the player page. Sleeper's schedule has
// no scores or kickoff times; a played week shows his own points from the game log instead.
export type NflGame = { week: number; home: string; away: string; date: string; status: string }

export type NflWeek = {
  week: number
  /** null on a bye */
  opp: string | null
  away: boolean
  /** YYYY-MM-DD; '' on a bye */
  date: string
  state: 'pre' | 'live' | 'done' | 'bye'
}

/** Week 1 to the schedule's last week, byes filled in. Empty when the team isn't on the schedule (FA). */
export function teamWeeks(games: NflGame[], team: string): NflWeek[] {
  const mine = games.filter(g => g.home === team || g.away === team)
  if (!mine.length) return []
  const last = Math.max(...games.map(g => g.week))
  return Array.from({ length: last }, (_, i) => {
    const week = i + 1
    const g = mine.find(x => x.week === week)
    if (!g) return { week, opp: null, away: false, date: '', state: 'bye' as const }
    const away = g.away === team
    const state = g.status === 'complete' ? 'done' : g.status === 'in_game' ? 'live' : 'pre'
    return { week, opp: away ? g.home : g.away, away, date: g.date ?? '', state }
  })
}

/** "Nov 15" from "2026-11-15", read as a calendar date (not shifted by time zone). */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' })
}
