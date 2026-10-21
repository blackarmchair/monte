// "Hide names": replace every username and team name with "Team #n" (n = Sleeper roster slot,
// so the numbering is stable across tabs and refreshes), and every league name with "League #n".
// Team and league names are replaced too because they identify people just as well. Applied to
// data as it reaches a view, so no screen has to remember to do it.
import type { BBResult, LeagueContext, OverviewData, Run, StartSitData, TradeData } from './types'

export const teamLabel = (rosterId: number) => `Team #${rosterId}`
/** `index` is the league's position in the user's Sleeper league list (0-based). */
export const leagueLabel = (index: number) => `League #${index + 1}`

export function anonContext(c: LeagueContext): LeagueContext {
  return {
    ...c,
    rosters: c.rosters.map(r => ({ ...r, display_name: teamLabel(r.roster_id), avatar: null })),
    myPicks: c.myPicks.map(p => ({ ...p, originalName: teamLabel(p.originalRosterId) })),
  }
}

export function anonBB(run: Run<BBResult>): Run<BBResult> {
  if (!run.result) return run
  return {
    ...run,
    result: {
      ...run.result,
      teams: run.result.teams.map(t => ({ ...t, team: teamLabel(t.roster_id) })),
      zeroed: run.result.zeroed.map(z => ({ ...z, team: 'a team' })),
    },
  }
}

export function anonOverview(d: OverviewData): OverviewData {
  return { ...d, teams: d.teams.map(t => ({ ...t, team_name: teamLabel(t.roster_id), display_name: teamLabel(t.roster_id), avatar: null })) }
}

export function anonTrades(d: TradeData): TradeData {
  return { ...d, teams: d.teams.map(t => ({ ...t, name: teamLabel(t.roster_id), owner: teamLabel(t.roster_id) })) }
}

export function anonStartSit(d: StartSitData): StartSitData {
  return d.opponent ? { ...d, opponent: { ...d.opponent, name: d.opponent.rosterId != null ? teamLabel(d.opponent.rosterId) : 'Opponent' } } : d
}
