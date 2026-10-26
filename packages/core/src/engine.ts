// Run one sleeperStandings engine job: pick odds (bb) or PWOPR. Shared by desktop, which runs it
// in a worker thread, and the phone, which runs it in-process one job at a time.
// sleeperStandings keeps a module-level mutable Config, so callers must never run two jobs at
// once in the same JS context.
import { Config } from 'sleeper-standings/dist/config.js'
import { getBBProjections, type BBSnapshot } from 'sleeper-standings/dist/bbProjections.js'
import { getPWOPRProjections } from 'sleeper-standings/dist/pwoprProjections.js'
import { getLeague, getRosters, getUsers, getNFLState, getWeekMatchups } from 'sleeper-standings/dist/fetchers.js'

/** Manual injury overrides by Sleeper id: return week, 99 = out for the season. */
export type Overrides = Record<string, number>

export type EngineJob =
  | {
      kind: 'bb'
      leagueId: string
      sims: number
      strengthCV: number
      /** what-if: week -> roster ids forced to win that week */
      forced: Record<number, number[]>
      /** RNG seed: same inputs + seed = same odds */
      seed: number
      /** return what the run knew as `snapshot`, for the desktop's backtest archive */
      archive?: boolean
      playersMeta: unknown
      overrides: Overrides
    }
  | { kind: 'pwopr'; leagueId: string; overrides: Overrides }

export async function runEngineJob(job: EngineJob): Promise<unknown> {
  const nflState = await getNFLState()
  // Same as sleeperStandings' main.ts: never project a season off the literal fallback.
  Config.year = Number(nflState.league_season || nflState.season) || Config.year
  // The user's in-app overrides REPLACE the list hard-coded in sleeperStandings' config: that
  // list is one person's notes from one week and must not ship to everyone. The resolver accepts
  // Sleeper ids as keys, so entries match the exact player rather than a name.
  Config.bb.returnWeek = { ...job.overrides }
  Config.bb.seasonEnders = []
  const league = await getLeague(job.leagueId)
  if (!league?.league_id) throw new Error(`League ${job.leagueId} not found on Sleeper`)

  if (job.kind === 'bb') {
    Config.bb.simulations = job.sims
    Config.bb.teamStrengthCV = job.strengthCV
    Config.bb.forcedWinners = job.forced
    Config.bb.seed = job.seed
    const [users, rosters] = await Promise.all([getUsers(job.leagueId), getRosters(job.leagueId)])
    let snapshot: BBSnapshot | undefined
    const res = await getBBProjections(league, rosters, users, job.playersMeta, job.leagueId, nflState, {
      print: false,
      onInputs: job.archive ? s => (snapshot = s) : undefined,
    })
    // The what-if week is the next one without a final score: its head-to-head pairs, so the
    // UI can offer "pick the winner" toggles for it.
    const week = res.inProgressWeek ?? res.weeks.find(w => w > res.currentWeek) ?? null
    let whatIf: { week: number; pairs: Array<[number, number]> } | null = null
    if (week != null) {
      const byMatchup = new Map<number, number[]>()
      for (const m of (await getWeekMatchups(week, job.leagueId)) as Array<{ roster_id: number; matchup_id: number | null }>) {
        if (m?.roster_id == null || m?.matchup_id == null) continue
        byMatchup.set(m.matchup_id, [...(byMatchup.get(m.matchup_id) ?? []), m.roster_id])
      }
      whatIf = { week, pairs: [...byMatchup.values()].filter(p => p.length === 2).map(p => [p[0], p[1]] as [number, number]) }
    }
    return {
      ...res,
      strengthCV: job.strengthCV,
      seed: job.seed,
      forced: job.forced,
      whatIf,
      ranAt: new Date().toISOString(),
      ...(snapshot ? { snapshot } : {}),
    }
  }
  const res = await getPWOPRProjections(league, nflState, { print: false })
  // fits carry training internals the UI does not use; keep the payload small.
  const { fits: _fits, ...rest } = res as typeof res & { fits: unknown }
  return { ...rest, ranAt: new Date().toISOString() }
}

