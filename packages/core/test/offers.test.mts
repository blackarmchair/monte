// Answering and countering offers. Nothing here touches the network.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normaliseTrade, type TradeTx } from '../src/leagueWeek.ts'
import { offerRole, offerSides, offerVerdictText, pickAssetId } from '../src/offers.ts'
import { answerOffer, type OfferAnswer } from '../src/sleeperOffers.ts'
import { buildProposal, proposeTrade, SleeperAuthError, type TradeProposal } from '../src/sleeperTrade.ts'
import type { Asset, Verdict } from '../src/tradeMath.ts'

function fakeFetch(...replies: unknown[]) {
  const sent: any[] = []
  const fn = (async (_u: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify(replies.shift()))
  }) as typeof fetch
  return { fn, sent }
}

const ANSWER: OfferAnswer = { leagueId: 'L1', transactionId: 'T1', leg: 9, myRosterId: 3, action: 'accept' }
const pending = (o: object = {}) => ({ data: { league_transactions_by_status: [{ transaction_id: 'T1', type: 'trade', roster_ids: [3, 4], consenter_ids: [4], ...o }] } })

describe('answerOffer', () => {
  it('accepts an offer that is still open, in the leg it lives in', async () => {
    const f = fakeFetch(pending(), { data: { accept_trade: { transaction_id: 'T1', status: 'proposed' } } })
    assert.deepEqual(await answerOffer(ANSWER, 'tok', f.fn), { status: 'proposed', mismatch: null })
    assert.match(f.sent[1].query, /accept_trade/)
    assert.deepEqual(f.sent[1].variables, { leg: 9, league_id: 'L1', transaction_id: 'T1' })
  })

  it('rejects, and confirms from the status Sleeper returns', async () => {
    const f = fakeFetch(pending(), { data: { reject_trade: { transaction_id: 'T1', status: 'rejected' } } })
    assert.equal((await answerOffer({ ...ANSWER, action: 'reject' }, 'tok', f.fn)).mismatch, null)
    assert.match(f.sent[1].query, /reject_trade/)
  })

  it('flags a rejection Sleeper did not confirm', async () => {
    const f = fakeFetch(pending(), { data: { reject_trade: { transaction_id: 'T1', status: 'proposed' } } })
    assert.match((await answerOffer({ ...ANSWER, action: 'reject' }, 'tok', f.fn)).mismatch ?? '', /didn't confirm/)
  })

  it('sends nothing when the offer is gone', async () => {
    const f = fakeFetch({ data: { league_transactions_by_status: [] } })
    await assert.rejects(answerOffer(ANSWER, 'tok', f.fn), /no longer open/)
    assert.equal(f.sent.length, 1)
  })

  it('sends nothing for an offer that is not yours', async () => {
    const f = fakeFetch(pending({ roster_ids: [4, 5] }))
    await assert.rejects(answerOffer(ANSWER, 'tok', f.fn), /doesn't involve/)
    assert.equal(f.sent.length, 1)
  })

  it('does not accept twice', async () => {
    const f = fakeFetch(pending({ consenter_ids: [3, 4] }))
    await assert.rejects(answerOffer(ANSWER, 'tok', f.fn), /already accepted/)
    assert.equal(f.sent.length, 1)
  })

  it('surfaces a refused token', async () => {
    await assert.rejects(answerOffer(ANSWER, 'tok', fakeFetch({ errors: [{ message: 'Unauthorized' }] }).fn), SleeperAuthError)
  })
})

describe('counter-offers', () => {
  const TRADE: TradeProposal = { leagueId: 'L1', myRosterId: 1, partnerRosterId: 2, give: { players: ['100'], picks: [] }, get: { players: ['200'], picks: [] } }

  it('a normal offer sends no reject fields', async () => {
    const f = fakeFetch({ data: { propose_trade: { transaction_id: 'T2', adds: { 100: 2, 200: 1 }, drops: { 100: 1, 200: 2 } } } })
    await proposeTrade(TRADE, 'tok', f.fn)
    assert.equal('reject_transaction_id' in f.sent[0].variables, false)
    assert.doesNotMatch(f.sent[0].query, /reject_transaction/)
  })

  it('a counter names the offer it rejects, in one call', async () => {
    const counter = { ...TRADE, counter: { transactionId: 'T1', leg: 9 } }
    assert.equal(buildProposal(counter).reject_transaction_id, 'T1')
    const f = fakeFetch({ data: { propose_trade: { transaction_id: 'T2', adds: { 100: 2, 200: 1 }, drops: { 100: 1, 200: 2 } } } })
    const r = await proposeTrade(counter, 'tok', f.fn)
    assert.equal(r.mismatch, null)
    assert.equal(f.sent.length, 1)
    assert.equal(f.sent[0].variables.reject_transaction_id, 'T1')
    assert.equal(f.sent[0].variables.reject_transaction_leg, 9)
    assert.match(f.sent[0].query, /reject_transaction_id: \$reject_transaction_id/)
  })
})

describe('reading an offer', () => {
  const tx = (o: Partial<TradeTx> = {}): TradeTx => ({
    id: 'T1',
    status: 'proposed',
    created: 0,
    week: 9,
    creator: 4,
    consenters: [4],
    sides: [
      { rosterId: 3, players: [{ id: 'p1', name: 'Got', pos: 'WR', team: 'DAL' }], picks: [] },
      { rosterId: 4, players: [{ id: 'p2', name: 'Gave', pos: 'RB', team: 'SF' }], picks: [{ season: '2027', round: 1, orig: 3 }] },
    ],
    ...o,
  })
  const byId = new Map(['p1', 'p2', pickAssetId({ season: '2027', round: 1, orig: 3 })].map(id => [id, { id } as Asset]))

  it('knows whose move it is', () => {
    assert.equal(offerRole(tx(), 3), 'received')
    assert.equal(offerRole(tx({ consenters: [3, 4] }), 3), 'accepted')
    assert.equal(offerRole(tx({ creator: 3 }), 3), 'sent')
    assert.equal(offerRole(tx(), 7), 'none')
    assert.equal(offerRole(tx(), null), 'none')
  })

  it('splits a two-team offer into give and get, picks included', () => {
    const s = offerSides(tx(), 3, byId)
    assert.deepEqual(s.get.map(a => a.id), ['p1'])
    assert.deepEqual(s.give.map(a => a.id), ['p2', 'pick:2027:1:3'])
    assert.equal(s.partner, 4)
    assert.deepEqual(s.missing, [])
  })

  it('names assets it cannot value', () => {
    assert.deepEqual(offerSides(tx(), 3, new Map([['p1', { id: 'p1' } as Asset]])).missing, ['Gave', '2027 round 1'])
  })

  it('leaves three-team offers alone', () => {
    const three = tx({ sides: [...tx().sides, { rosterId: 5, players: [], picks: [] }] })
    assert.equal(offerSides(three, 3, byId).partner, null)
  })

  it('reads the verdict from your side only', () => {
    const v = (em: number) => ({ em, et: -9999 }) as Verdict
    assert.equal(offerVerdictText(v(500)).label, 'Worth taking')
    assert.equal(offerVerdictText(v(0)).label, 'Close call')
    assert.equal(offerVerdictText(v(-500)).label, 'You lose value')
    assert.equal(offerVerdictText(null).label, '')
  })

  it('reads who agreed from Sleeper, as numbers', () => {
    const n = normaliseTrade({ transaction_id: 1, roster_ids: [3, 4], consenter_ids: ['4'], status: 'proposed' }, {}, () => null)
    assert.deepEqual(n.consenters, [4])
    assert.deepEqual(normaliseTrade({ transaction_id: 1, roster_ids: [] }, {}, () => null).consenters, [])
  })
})
