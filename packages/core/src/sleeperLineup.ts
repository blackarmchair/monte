// Setting this week's starters in Sleeper. Like trade offers (see sleeperTrade), this is the
// undocumented GraphQL its own apps use, called with the user's Sleeper session token.
//
// The write that counts is update_matchup_leg: the matchup leg is what the app shows and what
// scores. roster_update_starters only changes the roster's `starters` array, which looks right on
// every roster read-back and is NOT what plays. Writing the leg also updates the roster.
// `starters` is the full array in roster_positions order (BN / IR / TAXI excluded), "0" for an
// empty slot. `leg` is the NFL week; `round` the matchup round (the same number in the regular
// season), so the leg is read from matchup_legs(round) rather than assumed.
//
// Sources: github.com/Filip-Kin/sleeper-graphql (docs/mutations.md: update_matchup_leg executed,
// roster_update_starters "not sufficient on its own"), github.com/bealmot/sleeper-mcp (API-NOTES.md).
import { SLEEPER_GRAPHQL, SleeperAuthError } from './sleeperTrade'

export type LineupWrite = {
  leagueId: string
  rosterId: number
  /** Sleeper's week, as Start/Sit read it */
  week: number
  /** the starters Monte read from Sleeper, slot order: refuse to write over a newer lineup */
  expected: string[]
  /** the starters to set, slot order, "0" = empty */
  starters: string[]
}

const LEGS = `query legs($round: Int!, $league_id: Snowflake!) {
  matchup_legs_raw(round: $round, league_id: $league_id) { roster_id round leg starters }
}`

const MUTATION = `mutation lineup($round: Int!, $leg: Int!, $league_id: Snowflake!, $roster_id: Int!, $starters: [String]) {
  update_matchup_leg(round: $round, leg: $leg, league_id: $league_id, roster_id: $roster_id, starters: $starters) { roster_id round leg starters }
}`

export async function gql<T>(query: string, variables: Record<string, unknown>, token: string, fetchFn: typeof fetch = fetch): Promise<T> {
  const res = await fetchFn(SLEEPER_GRAPHQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: token.trim(), 'user-agent': 'Monte (dynasty desk)' },
    body: JSON.stringify({ query, variables }),
  })
  const text = await res.text()
  if (res.status === 401 || res.status === 403) throw new SleeperAuthError('Sleeper refused the session token. Connect Sleeper again.')
  if (!res.ok) throw new Error(`Sleeper answered HTTP ${res.status}: ${text.slice(0, 160)}`)
  let body: { data?: T; errors?: Array<{ message?: string; code?: string }> }
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`Sleeper sent something that isn't JSON: ${text.slice(0, 160)}`)
  }
  if (body.errors?.length) {
    const msg = body.errors.map(e => e.message ?? e.code ?? 'error').join('; ')
    if (/unauth|not logged|token|forbidden/i.test(msg)) throw new SleeperAuthError(`Sleeper refused the session token (${msg}). Connect Sleeper again.`)
    throw new Error(`Sleeper said: ${msg}`)
  }
  if (!body.data) throw new Error('Sleeper answered with no data.')
  return body.data
}

const norm = (xs: unknown): string[] => (Array.isArray(xs) ? xs.map(x => (x == null || x === '' ? '0' : String(x))) : [])
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** Set the starters. Throws SleeperAuthError when Sleeper refuses the token. */
export async function setStarters(w: LineupWrite, token: string, fetchFn: typeof fetch = fetch): Promise<{ mismatch: string | null }> {
  const { matchup_legs_raw: legs } = await gql<{ matchup_legs_raw: any[] | null }>(LEGS, { round: w.week, league_id: w.leagueId }, token, fetchFn)
  const mine = (legs ?? []).find(l => Number(l.roster_id) === w.rosterId)
  if (!mine) throw new Error(`Sleeper has no week ${w.week} matchup for your team, so there is no lineup to set.`)
  // Monte's plan was built on the lineup it read. If Sleeper's leg has moved on (set on the phone,
  // a commissioner edit), writing would silently undo that.
  const live = norm(mine.starters)
  if (live.length && !same(live, norm(w.expected)))
    throw new Error('Your lineup changed in Sleeper since Monte read it. Refresh, check the plan, and send again.')

  const sent = norm(w.starters)
  const { update_matchup_leg: leg } = await gql<{ update_matchup_leg: any }>(
    MUTATION,
    { round: w.week, leg: Number(mine.leg ?? w.week), league_id: w.leagueId, roster_id: w.rosterId, starters: sent },
    token,
    fetchFn,
  )
  if (!leg) throw new Error('Sleeper accepted the request but returned no lineup.')
  return {
    mismatch: same(norm(leg.starters), sent)
      ? null
      : "Sleeper stored a different lineup from the one Monte sent (a game may have kicked off). Check it in Sleeper.",
  }
}
