// How good are Monte's matchup win chances? Finished games scored against what the model would have
// said beforehand. Brier score: the mean squared gap between the chance given and what happened; a
// coin flip scores 0.25 and lower is better.
import type { LeagueWeek } from './leagueWeek'

/** The chance given to one side, and whether that side won. */
export type ScoredGame = { p: number; won: boolean }

export type CalibrationBucket = { label: string; games: number; predicted: number; actual: number }

export type ForecastScore = {
  games: number
  /** games the favourite won; a true 50/50 counts for neither */
  favouriteWins: number
  favouriteGames: number
  brier: number | null
  buckets: CalibrationBucket[]
}

export type TrackRecord = ForecastScore & { season: string; throughWeek: number; leagues: number }

/** Finished, untied games from a week built with `pregame`, so each chance saw no results. */
export function forecastGames(week: LeagueWeek): ScoredGame[] {
  const out: ScoredGame[] = []
  for (const { sides } of week.matchups) {
    const [a, b] = sides
    if (a.points <= 0 || b.points <= 0 || a.points === b.points) continue
    out.push({ p: a.winPct, won: a.points > b.points })
  }
  return out
}

const EDGES = [50, 60, 70, 80, 90, 100]

export function scoreForecasts(games: ScoredGame[]): ForecastScore {
  const brier = games.length ? games.reduce((s, g) => s + (g.p - (g.won ? 1 : 0)) ** 2, 0) / games.length : null
  // Everything from the favourite's side, so the buckets read "when Monte said 70%, how often?"
  const fav = games.map(g => (g.p >= 0.5 ? g : { p: 1 - g.p, won: !g.won }))
  const clear = fav.filter(g => g.p > 0.5)
  const buckets: CalibrationBucket[] = []
  for (let i = 0; i < EDGES.length - 1; i++) {
    const [lo, hi] = [EDGES[i] / 100, EDGES[i + 1] / 100]
    const inside = fav.filter(g => g.p >= lo && (hi === 1 ? g.p <= 1 : g.p < hi))
    if (!inside.length) continue
    buckets.push({
      label: `${EDGES[i]}–${EDGES[i + 1]}%`,
      games: inside.length,
      predicted: inside.reduce((s, g) => s + g.p, 0) / inside.length,
      actual: inside.filter(g => g.won).length / inside.length,
    })
  }
  return { games: games.length, favouriteWins: clear.filter(g => g.won).length, favouriteGames: clear.length, brier, buckets }
}
