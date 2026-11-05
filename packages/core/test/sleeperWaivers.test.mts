// The first write that can change a roster. Nothing here touches the network.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bidProblem, claimProblem, claimVariables, irBlockers, liveRosters, submitClaim, type WaiverClaim } from '../src/sleeperWaivers.ts'
import { SleeperAuthError } from '../src/sleeperTrade.ts'

const CLAIM: WaiverClaim = { leagueId: 'L1', rosterId: 3, playerId: 'p9', bid: 0 }
const positions = ['QB', 'RB', 'BN', 'IR', 'TAXI']
const league = (s: object = {}, roster_positions = positions) => ({ roster_positions, settings: { waiver_type: 2, waiver_budget: 100, waiver_bid_min: 0, ...s } })
const me = (o: object = {}) => ({ roster_id: 3, players: ['a', 'b'], reserve: [], taxi: [], settings: { waiver_budget_used: 40 }, ...o })
const other = { roster_id: 4, players: ['x'] }

describe('claimVariables', () => {
  it('adds the player to your roster, drops nobody, and carries the bid', () => {
    assert.deepEqual(claimVariables({ ...CLAIM, bid: 7 }), { league_id: 'L1', k_adds: ['p9'], v_adds: [3], k_drops: [], v_drops: [], k_settings: ['waiver_bid'], v_settings: [7] })
  })
  it('keeps a $0 bid: zero is a real bid', () => assert.deepEqual(claimVariables(CLAIM).v_settings, [0]))
  it('sends no bid in a league with no budget', () => {
    const v = claimVariables({ ...CLAIM, bid: null })
    assert.equal('k_settings' in v, false)
    assert.equal('v_settings' in v, false)
  })
})

describe('bidProblem', () => {
  const faab = { left: 60, minBid: 1 }
  it('accepts a bid in range', () => {
    assert.equal(bidProblem(1, faab), null)
    assert.equal(bidProblem(60, faab), null)
  })
  it('accepts $0 where the minimum allows', () => assert.equal(bidProblem(0, { left: 60, minBid: 0 }), null))
  it('refuses below the minimum', () => assert.match(bidProblem(0, faab) ?? '', /minimum bid is \$1/))
  it('refuses more than you have', () => assert.match(bidProblem(61, faab) ?? '', /\$60 left/))
  for (const bad of [null, -1, 1.5, NaN]) it(`refuses ${bad}`, () => assert.match(bidProblem(bad, faab) ?? '', /whole-dollar/))
  it('refuses a bid where there is no budget', () => assert.match(bidProblem(5, null) ?? '', /doesn't use a budget/))
  it('needs no bid where there is no budget', () => assert.equal(bidProblem(null, null), null))
})

describe('claimProblem', () => {
  const check = (o: { claim?: Partial<WaiverClaim>; lg?: any; rosters?: any[]; open?: any[] } = {}) => claimProblem({ ...CLAIM, ...o.claim }, o.lg ?? league(), o.rosters ?? [me(), other], o.open ?? [])
  it('passes a good claim', () => assert.equal(check(), null))
  it('refuses a league that has not drafted', () => assert.match(check({ lg: { ...league(), status: 'pre_draft' } }) ?? '', /hasn't drafted/))
  it('refuses a player on your team', () => assert.match(check({ claim: { playerId: 'a' } }) ?? '', /already on your team/))
  it('refuses a player on another team, since the screen can be old', () => assert.match(check({ claim: { playerId: 'x' } }) ?? '', /another team/))
  it('refuses a repeat claim', () => assert.match(check({ open: [{ adds: { p9: 3 } }] }) ?? '', /already have a pending claim/))
  it('refuses a missing team', () => assert.match(check({ claim: { rosterId: 8 } }) ?? '', /can't find your team/))
  it('uses the budget as it stands now', () => assert.match(check({ claim: { bid: 61 } }) ?? '', /\$60 left/))
  it('refuses a full roster, since it would need a drop', () => {
    assert.match(check({ rosters: [me({ players: ['a', 'b', 'c'] }), other] }) ?? '', /roster is full/)
  })
  it('does not count IR and taxi players against the roster', () => {
    assert.equal(check({ rosters: [me({ players: ['a', 'b', 'c', 'd'], reserve: ['c'], taxi: ['d'] }), other] }), null)
  })
  it('handles a league with no budget', () => assert.equal(check({ claim: { bid: null }, lg: league({ waiver_type: 0 }) }), null))
})

describe('irBlockers', () => {
  const meta = { hurt: { first_name: 'Hurt', last_name: 'Guy', injury_status: 'IR' }, fine: { first_name: 'Fine', last_name: 'Guy' }, out: { first_name: 'Out', last_name: 'Guy', injury_status: 'Out' } }
  const roster = (...reserve: string[]) => ({ reserve })
  it('passes a player tagged IR', () => assert.deepEqual(irBlockers(roster('hurt'), league(), meta), []))
  it('flags a healthy player on IR', () => assert.deepEqual(irBlockers(roster('hurt', 'fine'), league(), meta), ['Fine Guy']))
  it('follows the league: Out only counts where it is allowed', () => {
    assert.deepEqual(irBlockers(roster('out'), league(), meta), ['Out Guy'])
    assert.deepEqual(irBlockers(roster('out'), league({ reserve_allow_out: 1 }), meta), [])
  })
  it('leaves a player it knows nothing about to Sleeper', () => assert.deepEqual(irBlockers(roster('ghost'), league(), meta), []))
  it('copes with no IR list', () => assert.deepEqual(irBlockers({}, league(), meta), []))
  it('stops a claim, naming him, before anything is sent', () => {
    const problem = claimProblem(CLAIM, league(), [me({ reserve: ['fine'] }), other], [], meta)
    assert.match(problem ?? '', /Fine Guy no longer qualifies/)
  })
})

describe('liveRosters', () => {
  it('reads through GraphQL with the session, not the cached public API', async () => {
    let body: any
    let url = ''
    const fn = (async (u: unknown, init?: RequestInit) => {
      url = String(u)
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ data: { league_rosters: [{ roster_id: 3 }] } }))
    }) as typeof fetch
    assert.deepEqual(await liveRosters('L1', 'tok', fn), [{ roster_id: 3 }])
    assert.match(url, /graphql/)
    assert.match(body.query, /^query /)
  })
})

describe('submitClaim', () => {
  const stored = (o: object = {}) => ({ data: { submit_waiver_claim: { transaction_id: 'W1', status: 'pending', adds: { p9: 3 }, drops: null, settings: { waiver_bid: 0 }, ...o } } })
  const open = (ids: string[]) => ({ data: { league_transactions: ids.map(id => ({ transaction_id: id, type: 'waiver', status: 'pending', roster_ids: [3] })) } })
  function fake(...replies: any[]) {
    const sent: any[] = []
    const signals: unknown[] = []
    const fn = (async (_u: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)))
      signals.push(init?.signal)
      const r = replies.shift()
      if (r instanceof Error) throw r
      return r?.status ? new Response('', { status: r.status }) : new Response(JSON.stringify(r))
    }) as typeof fetch
    return { fn, sent, signals }
  }

  it('sends the claim, then confirms it from your pending claims', async () => {
    const f = fake(stored(), open(['W1']))
    assert.deepEqual(await submitClaim(CLAIM, [9], 'tok', f.fn), { transactionId: 'W1', mismatch: null })
    assert.match(f.sent[0].query, /submit_waiver_claim/)
    assert.deepEqual(f.sent[0].variables, claimVariables(CLAIM))
    assert.match(f.sent[1].query, /^query /)
    assert.ok(f.signals[0], 'the write carries a deadline')
  })
  it('flags a claim missing on read-back', async () => {
    assert.match((await submitClaim(CLAIM, [9], 'tok', fake(stored(), open([])).fn)).mismatch ?? '', /isn't in your pending claims/)
  })
  it('flags a read-back that failed, without calling the claim failed', async () => {
    const r = await submitClaim(CLAIM, [9], 'tok', fake(stored(), { status: 500 }).fn)
    assert.equal(r.transactionId, 'W1')
    assert.match(r.mismatch ?? '', /couldn't read it back/)
  })
  it('flags the wrong player, and does not bother reading back', async () => {
    const f = fake(stored({ adds: { other: 3 } }))
    assert.match((await submitClaim(CLAIM, [9], 'tok', f.fn)).mismatch ?? '', /different player/)
    assert.equal(f.sent.length, 1)
  })
  it('flags the right player landing on the wrong roster', async () => {
    assert.match((await submitClaim(CLAIM, [9], 'tok', fake(stored({ adds: { p9: 4 } })).fn)).mismatch ?? '', /different player/)
  })
  it('flags a drop it never asked for', async () => {
    assert.match((await submitClaim(CLAIM, [9], 'tok', fake(stored({ drops: { a: 3 } })).fn)).mismatch ?? '', /drop Monte didn't send/)
  })
  it('flags a different bid', async () => {
    assert.match((await submitClaim({ ...CLAIM, bid: 5 }, [9], 'tok', fake(stored()).fn)).mismatch ?? '', /bid of \$0, not \$5/)
  })
  it('fails clearly with no claim in the reply', async () => {
    await assert.rejects(submitClaim(CLAIM, [9], 'tok', fake({ data: { submit_waiver_claim: null } }).fn), /returned no claim/)
  })
  it('passes on a refusal, keeping the token', async () => {
    await assert.rejects(submitClaim(CLAIM, [9], 'tok', fake({ errors: [{ message: 'forbidden: waivers are closed' }] }).fn), e => !(e instanceof SleeperAuthError) && /waivers are closed/.test((e as Error).message))
  })
  it('surfaces a refused token', async () => {
    await assert.rejects(submitClaim(CLAIM, [9], 'tok', fake({ status: 401 }).fn), SleeperAuthError)
  })
})
