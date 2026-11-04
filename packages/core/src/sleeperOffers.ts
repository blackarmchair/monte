// Answering a trade offer in Sleeper: the same undocumented GraphQL as sending one (see
// sleeperTrade). Accepting records your consent; the trade then processes under the league's review
// period, immediately if it has none. Neither answer can be taken back from here.
//
// Source: github.com/Filip-Kin/sleeper-graphql (docs/mutations.md: accept_trade, reject_trade executed).
import { fetchPending } from './leagueWeek'
import { gql } from './sleeperLineup'

export type OfferAnswer = {
  leagueId: string
  transactionId: string
  /** the week the offer lives in (TradeTx.week) */
  leg: number
  myRosterId: number
  action: 'accept' | 'reject'
}

const fields = 'transaction_id status consenter_ids'
const ACCEPT = `mutation accept($leg: Int!, $league_id: Snowflake!, $transaction_id: Snowflake!) {
  accept_trade(leg: $leg, league_id: $league_id, transaction_id: $transaction_id) { ${fields} }
}`
const REJECT = `mutation reject($leg: Int!, $league_id: Snowflake!, $transaction_id: Snowflake!) {
  reject_trade(leg: $leg, league_id: $league_id, transaction_id: $transaction_id) { ${fields} }
}`

/** Throws SleeperAuthError when Sleeper refuses the token. `mismatch` flags a reply that doesn't show the answer landed. */
export async function answerOffer(a: OfferAnswer, token: string, fetchFn: typeof fetch = fetch): Promise<{ status: string; mismatch: string | null }> {
  // What's on screen can be old: it may have been withdrawn, expired or answered on the phone.
  const open = await fetchPending(a.leagueId, [a.leg], token, fetchFn)
  const tx = open.find(t => String(t.transaction_id) === a.transactionId)
  if (!tx) throw new Error('This offer is no longer open. Refresh to see where it stands.')
  if (!(tx.roster_ids ?? []).map(Number).includes(a.myRosterId)) throw new Error("This offer doesn't involve your team.")
  if (a.action === 'accept' && (tx.consenter_ids ?? []).map(Number).includes(a.myRosterId)) throw new Error('You already accepted this offer.')

  const variables = { leg: a.leg, league_id: a.leagueId, transaction_id: a.transactionId }
  const timeout = "Sleeper didn't answer in time. Your answer may still have landed, so check Sleeper before trying again."
  if (a.action === 'reject') {
    const { reject_trade: r } = await gql<{ reject_trade: any }>(REJECT, variables, token, fetchFn, timeout)
    const status = String(r?.status ?? '')
    return { status, mismatch: status === 'rejected' ? null : "Sleeper didn't confirm the rejection. Check the offer in Sleeper." }
  }
  const { accept_trade: r } = await gql<{ accept_trade: any }>(ACCEPT, variables, token, fetchFn, timeout)
  return { status: String(r?.status ?? ''), mismatch: r?.transaction_id ? null : "Sleeper didn't confirm the acceptance. Check the offer in Sleeper." }
}
