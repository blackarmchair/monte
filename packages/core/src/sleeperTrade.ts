// Proposing a trade in Sleeper. Sleeper has no public write API: this is the same undocumented
// GraphQL mutation its own apps use, called with the user's Sleeper session token. It can change
// or close without notice, and an offer sent here reaches a real person.
//
// Encoding (verified live by third-party tools, see the notes below): players go in parallel
// arrays, and every player appears in BOTH maps — k_adds/v_adds keyed to the roster receiving
// him, k_drops/v_drops keyed to the roster losing him. Draft picks are strings in the format
// Sleeper uses when it reads a transaction back: "original roster,season,round,new owner,
// previous owner". The reply echoes what Sleeper stored, which proposeTrade checks.
//
// Sources: github.com/Filip-Kin/sleeper-graphql (docs/mutations.md: propose_trade executed),
// github.com/bealmot/sleeper-mcp (API-NOTES.md: endpoint, User-Agent, pick string order).

export const SLEEPER_GRAPHQL = 'https://sleeper.com/graphql'

export type TradeSide = {
  /** Sleeper player ids */
  players: string[]
  picks: Array<{ season: string; round: number; originalRosterId: number }>
}

export type TradeProposal = {
  leagueId: string
  myRosterId: number
  partnerRosterId: number
  give: TradeSide
  get: TradeSide
}

export type ProposeVariables = {
  league_id: string
  k_adds: string[]
  v_adds: number[]
  k_drops: string[]
  v_drops: number[]
  draft_picks: string[]
}

const MUTATION = `mutation propose($league_id: Snowflake!, $k_adds: [String], $v_adds: [Int], $k_drops: [String], $v_drops: [Int], $draft_picks: [String]) {
  propose_trade(league_id: $league_id, k_adds: $k_adds, v_adds: $v_adds, k_drops: $k_drops, v_drops: $v_drops, draft_picks: $draft_picks) {
    transaction_id status adds drops draft_picks roster_ids
  }
}`

export const pickString = (p: { season: string; round: number; originalRosterId: number }, to: number, from: number) =>
  `${p.originalRosterId},${p.season},${p.round},${to},${from}`

export function buildProposal(t: TradeProposal): ProposeVariables {
  const me = t.myRosterId
  const them = t.partnerRosterId
  // Each player: added to the roster receiving him, dropped from the roster losing him.
  const moves = [...t.give.players.map(id => ({ id, to: them, from: me })), ...t.get.players.map(id => ({ id, to: me, from: them }))]
  return {
    league_id: t.leagueId,
    k_adds: moves.map(m => m.id),
    v_adds: moves.map(m => m.to),
    k_drops: moves.map(m => m.id),
    v_drops: moves.map(m => m.from),
    draft_picks: [...t.give.picks.map(p => pickString(p, them, me)), ...t.get.picks.map(p => pickString(p, me, them))],
  }
}

/** What the token says about itself (a JWT); nothing is verified, it only catches mistakes. */
export function readToken(token: string): { userId: string | null; expiresAt: number | null } | null {
  const part = token.trim().split('.')[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(decodeBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    const userId = json.user_id ?? json.userId ?? json.sub ?? null
    return { userId: userId == null ? null : String(userId), expiresAt: typeof json.exp === 'number' ? json.exp * 1000 : null }
  } catch {
    return null
  }
}

// atob is in Hermes and browsers; spelled out so the core has no platform dependency.
function decodeBase64(s: string): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let bits = 0
  let acc = 0
  let out = ''
  for (const ch of s) {
    if (ch === '=') break
    const v = A.indexOf(ch)
    if (v < 0) continue
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out += String.fromCharCode((acc >> bits) & 0xff)
    }
  }
  return out
}

export class SleeperAuthError extends Error {}

export type ProposeResult = { transactionId: string; status: string; mismatch: string | null }

const sameMap = (got: unknown, ids: string[], rosters: number[]) => {
  if (!got || typeof got !== 'object') return false
  const m = got as Record<string, unknown>
  return ids.length === Object.keys(m).length && ids.every((id, i) => Number(m[id]) === rosters[i])
}

/** Send the offer. Throws SleeperAuthError when Sleeper refuses the token. */
export async function proposeTrade(t: TradeProposal, token: string, fetchFn: typeof fetch = fetch): Promise<ProposeResult> {
  const variables = buildProposal(t)
  const res = await fetchFn(SLEEPER_GRAPHQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: token.trim(), 'user-agent': 'Monte (dynasty desk)' },
    body: JSON.stringify({ operationName: 'propose', query: MUTATION, variables }),
  })
  const text = await res.text()
  if (res.status === 401 || res.status === 403) throw new SleeperAuthError('Sleeper refused the session token. Connect Sleeper again in Settings.')
  if (!res.ok) throw new Error(`Sleeper answered HTTP ${res.status}: ${text.slice(0, 160)}`)
  let body: { data?: { propose_trade?: any }; errors?: Array<{ message?: string; code?: string }> }
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`Sleeper sent something that isn't JSON: ${text.slice(0, 160)}`)
  }
  if (body.errors?.length) {
    const msg = body.errors.map(e => e.message ?? e.code ?? 'error').join('; ')
    if (/unauth|not logged|token|forbidden/i.test(msg)) throw new SleeperAuthError(`Sleeper refused the session token (${msg}). Connect Sleeper again in Settings.`)
    throw new Error(`Sleeper said: ${msg}`)
  }
  const tx = body.data?.propose_trade
  if (!tx?.transaction_id) throw new Error('Sleeper accepted the request but returned no trade.')
  // Check Sleeper stored what was meant: players moving the right way, picks as sent.
  const problems: string[] = []
  if (!sameMap(tx.adds, variables.k_adds, variables.v_adds) || !sameMap(tx.drops, variables.k_drops, variables.v_drops)) problems.push('players')
  const picks: string[] = Array.isArray(tx.draft_picks) ? tx.draft_picks.map(String) : []
  if (variables.draft_picks.length && !variables.draft_picks.every(p => picks.includes(p))) problems.push('picks')
  return {
    transactionId: String(tx.transaction_id),
    status: String(tx.status ?? 'proposed'),
    mismatch: problems.length ? `Sleeper stored the ${problems.join(' and ')} differently from what Monte sent. Check the offer in Sleeper and withdraw it if it's wrong.` : null,
  }
}

/**
 * Check a session token with a harmless read (`me`): it must work and belong to `userId`.
 * Returns the account's display name.
 */
export async function checkToken(token: string, userId: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(SLEEPER_GRAPHQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: token.trim(), 'user-agent': 'Monte (dynasty desk)' },
    body: JSON.stringify({ query: 'query { me { user_id display_name } }' }),
  })
  const text = await res.text()
  if (res.status === 401 || res.status === 403) throw new SleeperAuthError("Sleeper doesn't accept that token. Copy it again from a signed-in sleeper.com.")
  let body: { data?: { me?: { user_id?: string; display_name?: string } | null }; errors?: Array<{ message?: string }> }
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`Sleeper answered HTTP ${res.status}: ${text.slice(0, 160)}`)
  }
  const me = body.data?.me
  if (!me?.user_id) throw new SleeperAuthError("Sleeper doesn't accept that token. Copy it again from a signed-in sleeper.com.")
  if (String(me.user_id) !== userId) throw new SleeperAuthError(`That token is for ${me.display_name ?? 'another account'}, not the account Monte is using.`)
  return me.display_name ?? ''
}
