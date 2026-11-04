// The calls that act as the user on Sleeper. Nothing here touches the network.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setStarters, type LineupWrite } from '../src/sleeperLineup.ts'
import { buildProposal, checkToken, isAuthMessage, proposeTrade, SleeperAuthError, sleeperPost, type TradeProposal } from '../src/sleeperTrade.ts'

/** A fetch that answers with the given GraphQL bodies in turn, and records what it was sent. */
function fakeFetch(...replies: Array<unknown | { status: number; body: string }>) {
  const sent: any[] = []
  const signals: Array<AbortSignal | null | undefined> = []
  const fn = (async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)))
    signals.push(init?.signal)
    const r: any = replies.shift()
    return r && typeof r.status === 'number' ? new Response(r.body, { status: r.status }) : new Response(JSON.stringify(r))
  }) as typeof fetch
  return { fn, sent, signals }
}

const TRADE: TradeProposal = {
  leagueId: 'L1',
  myRosterId: 1,
  partnerRosterId: 2,
  give: { players: ['100'], picks: [{ season: '2027', round: 1, originalRosterId: 5 }] },
  get: { players: ['200', '201'], picks: [] },
}

describe('buildProposal', () => {
  it('lists every player in both maps, keyed to the roster gaining and the roster losing him', () => {
    const v = buildProposal(TRADE)
    assert.deepEqual(v.k_adds, ['100', '200', '201'])
    assert.deepEqual(v.v_adds, [2, 1, 1])
    assert.deepEqual(v.k_drops, ['100', '200', '201'])
    assert.deepEqual(v.v_drops, [1, 2, 2])
  })

  it('encodes picks as original roster, season, round, new owner, previous owner', () => {
    assert.deepEqual(buildProposal(TRADE).draft_picks, ['5,2027,1,2,1'])
  })
})

describe('proposeTrade', () => {
  const stored = { adds: { 100: 2, 200: 1, 201: 1 }, drops: { 100: 1, 200: 2, 201: 2 }, draft_picks: ['5,2027,1,2,1'] }

  it('returns no mismatch when Sleeper stored what was sent', async () => {
    const f = fakeFetch({ data: { propose_trade: { transaction_id: 'T9', status: 'proposed', ...stored } } })
    const r = await proposeTrade(TRADE, 'tok', f.fn)
    assert.equal(r.transactionId, 'T9')
    assert.equal(r.mismatch, null)
    assert.equal(f.sent[0].operationName, 'propose')
    assert.ok(f.signals[0], 'the write carries a deadline')
  })

  it('reports a player moving the wrong way', async () => {
    const f = fakeFetch({ data: { propose_trade: { transaction_id: 'T9', ...stored, adds: { 100: 1, 200: 1, 201: 1 } } } })
    assert.match((await proposeTrade(TRADE, 'tok', f.fn)).mismatch ?? '', /players/)
  })

  it('reports a missing pick', async () => {
    const f = fakeFetch({ data: { propose_trade: { transaction_id: 'T9', ...stored, draft_picks: [] } } })
    assert.match((await proposeTrade(TRADE, 'tok', f.fn)).mismatch ?? '', /picks/)
  })

  it('treats HTTP 401 as a refused token', async () => {
    await assert.rejects(proposeTrade(TRADE, 'tok', fakeFetch({ status: 401, body: '' }).fn), SleeperAuthError)
  })

  it('does not treat a refusal of the trade itself as a refused token', async () => {
    const f = fakeFetch({ errors: [{ message: 'Forbidden: the trade deadline has passed' }] })
    await assert.rejects(proposeTrade(TRADE, 'tok', f.fn), e => !(e instanceof SleeperAuthError) && /deadline/.test((e as Error).message))
  })
})

describe('setStarters', () => {
  const WRITE: LineupWrite = { leagueId: 'L1', rosterId: 3, week: 8, expected: ['a', 'b'], starters: ['b', 'a'] }
  const legs = (starters: unknown[], leg = 8) => ({ data: { matchup_legs_raw: [{ roster_id: 9, leg: 1, starters: ['x'] }, { roster_id: 3, leg, starters }] } })

  it('refuses to write over a lineup that changed since Monte read it', async () => {
    const f = fakeFetch(legs(['a', 'c']))
    await assert.rejects(setStarters(WRITE, 'tok', f.fn), /changed in Sleeper/)
    assert.equal(f.sent.length, 1, 'no mutation was sent')
  })

  it('writes to the leg Sleeper reports, not one assumed from the week', async () => {
    const f = fakeFetch(legs(['a', 'b'], 11), { data: { update_matchup_leg: { starters: ['b', 'a'] } } })
    assert.deepEqual(await setStarters(WRITE, 'tok', f.fn), { mismatch: null })
    assert.deepEqual(f.sent[1].variables, { round: 8, leg: 11, league_id: 'L1', roster_id: 3, starters: ['b', 'a'] })
  })

  it('sends empty slots as "0" and compares them the same way', async () => {
    const write = { ...WRITE, expected: ['a', '0'], starters: ['a', null as unknown as string] }
    const f = fakeFetch(legs(['a', null]), { data: { update_matchup_leg: { starters: ['a', '0'] } } })
    assert.deepEqual(await setStarters(write, 'tok', f.fn), { mismatch: null })
    assert.deepEqual(f.sent[1].variables.starters, ['a', '0'])
  })

  it('reports when Sleeper stored a different lineup', async () => {
    const f = fakeFetch(legs(['a', 'b']), { data: { update_matchup_leg: { starters: ['a', 'b'] } } })
    assert.match((await setStarters(WRITE, 'tok', f.fn)).mismatch ?? '', /different lineup/)
  })

  it('fails clearly when the team has no matchup', async () => {
    await assert.rejects(setStarters(WRITE, 'tok', fakeFetch({ data: { matchup_legs_raw: [] } }).fn), /no week 8 matchup/)
  })

  it('keeps the token when Sleeper refuses the lineup itself', async () => {
    const f = fakeFetch(legs(['a', 'b']), { errors: [{ message: 'forbidden: player is locked' }] })
    await assert.rejects(setStarters(WRITE, 'tok', f.fn), e => !(e instanceof SleeperAuthError))
  })

  it('puts a deadline on the read and the write', async () => {
    const f = fakeFetch(legs(['a', 'b']), { data: { update_matchup_leg: { starters: ['b', 'a'] } } })
    await setStarters(WRITE, 'tok', f.fn)
    assert.ok(f.signals[0] && f.signals[1])
  })
})

describe('checkToken', () => {
  it('returns the account name for the right user', async () => {
    assert.equal(await checkToken('tok', 'u1', fakeFetch({ data: { me: { user_id: 'u1', display_name: 'Sam' } } }).fn), 'Sam')
  })

  it("refuses another account's token", async () => {
    await assert.rejects(checkToken('tok', 'u1', fakeFetch({ data: { me: { user_id: 'u2', display_name: 'Other' } } }).fn), SleeperAuthError)
  })
})

describe('isAuthMessage', () => {
  for (const msg of ['Unauthorized', 'not logged in', 'Invalid token', 'invalid session token', 'token expired', 'Token is expired', 'missing auth token'])
    it(`session problem: ${msg}`, () => assert.equal(isAuthMessage(msg), true))
  for (const msg of ['Forbidden', 'forbidden: player is locked', 'the trade deadline has passed', 'unexpected token < in JSON', 'roster is full'])
    it(`not a session problem: ${msg}`, () => assert.equal(isAuthMessage(msg), false))
})

describe('sleeperPost', () => {
  it('gives up on a request that never answers, with the message it was given', async () => {
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch
    await assert.rejects(sleeperPost({}, 'tok', hang, 10, 'may have landed'), /may have landed/)
  })

  it('passes other failures through', async () => {
    const down = (async () => {
      throw new TypeError('network down')
    }) as typeof fetch
    await assert.rejects(sleeperPost({}, 'tok', down, 1000, 'nope'), /network down/)
  })
})
