// The first write that can change a roster. Nothing here touches the network.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { addFreeAgent, bidProblem, cancelClaim, claimProblem, claimVariables, irBlockers, irProblem, isOnWaivers, liveRosters, moveIr, submitClaim, updateClaimBid, type WaiverClaim } from '../src/sleeperWaivers.ts'
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
  it('asks for a drop on a full roster', () => {
    assert.match(check({ rosters: [me({ players: ['a', 'b', 'c'] }), other] }) ?? '', /pick someone to drop/)
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
    assert.match((await submitClaim(CLAIM, [9], 'tok', fake(stored({ drops: { a: 3 } })).fn)).mismatch ?? '', /different drop/)
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

describe('claims with a drop', () => {
  const check = (claim: Partial<WaiverClaim>, mine = me({ players: ['a', 'b', 'c'] })) => claimProblem({ ...CLAIM, ...claim }, league(), [mine, other], [], { a: { first_name: 'Al', last_name: 'A' }, c: { first_name: 'Cy', last_name: 'C', injury_status: 'IR' } })
  it('sends the drop on your roster', () => {
    const v = claimVariables({ ...CLAIM, drop: 'a' })
    assert.deepEqual([v.k_drops, v.v_drops], [['a'], [3]])
  })
  it('lets a drop make room on a full roster', () => assert.equal(check({ drop: 'a' }), null))
  it('asks for a drop when the roster is full', () => assert.match(check({}) ?? '', /pick someone to drop/))
  it('refuses a drop who is no longer yours', () => assert.match(check({ drop: 'x' }) ?? '', /isn't on your team anymore/))
  it('refuses a drop from IR or taxi on a full roster: it frees nothing', () => {
    assert.match(check({ drop: 'c' }, me({ players: ['a', 'b', 'c', 'd'], reserve: ['c'] })) ?? '', /Cy C is on your IR/)
    assert.match(check({ drop: 'c' }, me({ players: ['a', 'b', 'c', 'd'], taxi: ['c'] })) ?? '', /taxi squad/)
  })
  it('says so when one drop is not enough', () => assert.match(check({ drop: 'a' }, me({ players: ['a', 'b', 'c', 'd'] })) ?? '', /over the limit even after this drop/))
})

function fakeFetch(...replies: any[]) {
  const sent: any[] = []
  const fn = (async (_u: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)))
    const r = replies.shift()
    if (r instanceof Error) throw r
    return r?.status ? new Response('', { status: r.status }) : new Response(JSON.stringify(r))
  }) as typeof fetch
  return { fn, sent }
}
const rostersReply = (players: string[], reserve: string[] = []) => ({ data: { league_rosters: [{ roster_id: 3, players, reserve }] } })
const pendingReply = (rows: object[]) => ({ data: { league_transactions: rows.map(r => ({ type: 'waiver', status: 'pending', roster_ids: [3], ...r })) } })

describe('submitClaim with a drop', () => {
  it('passes when Sleeper stores the same drop', async () => {
    const f = fakeFetch({ data: { submit_waiver_claim: { transaction_id: 'W1', adds: { p9: 3 }, drops: { a: 3 }, settings: { waiver_bid: 0 } } } }, pendingReply([{ transaction_id: 'W1' }]))
    assert.equal((await submitClaim({ ...CLAIM, drop: 'a' }, [9], 'tok', f.fn)).mismatch, null)
  })
  it('flags a different drop', async () => {
    const f = fakeFetch({ data: { submit_waiver_claim: { transaction_id: 'W1', adds: { p9: 3 }, drops: { b: 3 }, settings: { waiver_bid: 0 } } } })
    assert.match((await submitClaim({ ...CLAIM, drop: 'a' }, [9], 'tok', f.fn)).mismatch ?? '', /different drop/)
  })
})

describe('addFreeAgent', () => {
  const added = { data: { league_create_transaction: { transaction_id: 'T1', status: 'complete', adds: { p9: 3 }, drops: { a: 3 } } } }
  it('adds as a free agent with no bid, then reads the roster back', async () => {
    const f = fakeFetch(added, rostersReply(['p9', 'b']))
    assert.deepEqual(await addFreeAgent({ ...CLAIM, bid: 7, drop: 'a' }, 'tok', f.fn), { transactionId: 'T1', mismatch: null })
    assert.match(f.sent[0].query, /league_create_transaction/)
    assert.deepEqual(f.sent[0].variables, { type: 'free_agent', league_id: 'L1', k_adds: ['p9'], v_adds: [3], k_drops: ['a'], v_drops: [3] })
  })
  it('flags him missing from the roster', async () => assert.match((await addFreeAgent(CLAIM, 'tok', fakeFetch(added, rostersReply(['b'])).fn)).mismatch ?? '', /isn't on your roster yet/))
  it('flags the drop still there', async () => assert.match((await addFreeAgent({ ...CLAIM, drop: 'a' }, 'tok', fakeFetch(added, rostersReply(['p9', 'a'])).fn)).mismatch ?? '', /still there too/))
  it('throws the waivers refusal so the caller can claim instead', async () => {
    const err = await addFreeAgent(CLAIM, 'tok', fakeFetch({ errors: [{ message: 'At least one of the players being added in is on waivers.' }] }).fn).catch(e => e)
    assert.equal(isOnWaivers(err), true)
  })
  it('does not mistake other refusals for waivers', async () => {
    const err = await addFreeAgent(CLAIM, 'tok', fakeFetch({ errors: [{ message: 'You have players on your IR slot that are no longer IR eligible.' }] }).fn).catch(e => e)
    assert.equal(isOnWaivers(err), false)
  })
})

describe('cancelClaim and updateClaimBid', () => {
  const ref = { leagueId: 'L1', rosterId: 3, transactionId: 'W1' }
  const open = [{ transaction_id: 'W1', leg: 9, settings: { waiver_bid: 0 } }]
  it('cancels in the week the claim sits in, then checks it is gone', async () => {
    const f = fakeFetch({ data: { cancel_waiver_claim: { transaction_id: 'W1', status: 'cancelled' } } }, pendingReply([]), pendingReply([]))
    assert.deepEqual(await cancelClaim(ref, open, [8, 9], 'tok', f.fn), { mismatch: null })
    assert.match(f.sent[0].query, /cancel_waiver_claim/)
    assert.deepEqual(f.sent[0].variables, { leg: 9, league_id: 'L1', transaction_id: 'W1' })
  })
  it('flags a claim still pending after the cancel', async () => {
    assert.match((await cancelClaim(ref, open, [9], 'tok', fakeFetch({ data: {} }, pendingReply([{ transaction_id: 'W1' }])).fn)).mismatch ?? '', /still shows as pending/)
  })
  it('refuses a claim that is no longer pending, sending nothing', async () => {
    const f = fakeFetch()
    await assert.rejects(cancelClaim(ref, [], [9], 'tok', f.fn), /isn't pending anymore/)
    assert.equal(f.sent.length, 0)
  })
  it('changes the bid and reads it back', async () => {
    const f = fakeFetch({ data: { update_waiver_claim: {} } }, pendingReply([{ transaction_id: 'W1', settings: { waiver_bid: 4 } }]))
    assert.deepEqual(await updateClaimBid(ref, 4, open, [9], 'tok', f.fn), { mismatch: null })
    assert.deepEqual(f.sent[0].variables, { leg: 9, league_id: 'L1', transaction_id: 'W1', k_settings: ['waiver_bid'], v_settings: [4] })
  })
  it('flags a bid that did not change', async () => {
    assert.match((await updateClaimBid(ref, 4, open, [9], 'tok', fakeFetch({ data: {} }, pendingReply([{ transaction_id: 'W1', settings: { waiver_bid: 0 } }])).fn)).mismatch ?? '', /still shows a bid of \$0/)
  })
})

describe('IR moves', () => {
  const meta = { hurt: { first_name: 'Hurt', last_name: 'Guy', injury_status: 'IR' }, fine: { first_name: 'Fine', last_name: 'Guy' }, q: { first_name: 'Q', last_name: 'Guy', injury_status: 'Questionable' } }
  const lg = league({ reserve_slots: 1 })
  const mine = (o: object = {}) => ({ roster_id: 3, players: ['hurt', 'fine', 'q'], reserve: [], taxi: [], ...o })
  const move = (playerId: string, to: 'ir' | 'bench' = 'ir') => ({ leagueId: 'L1', rosterId: 3, playerId, to })
  it('lets an IR-tagged player onto open IR', () => assert.equal(irProblem(move('hurt'), lg, mine(), meta), null))
  it('refuses a healthy or questionable player', () => {
    assert.match(irProblem(move('fine'), lg, mine(), meta) ?? '', /isn't injured/)
    assert.match(irProblem(move('q'), lg, mine(), meta) ?? '', /tagged Questionable/)
  })
  it('refuses a full IR', () => assert.match(irProblem(move('hurt'), lg, mine({ players: ['hurt', 'x'], reserve: ['x'] }), meta) ?? '', /IR is full/))
  it('moves anyone off IR who is on it', () => {
    assert.equal(irProblem(move('fine', 'bench'), lg, mine({ reserve: ['fine'] }), meta), null)
    assert.match(irProblem(move('fine', 'bench'), lg, mine(), meta) ?? '', /isn't on your IR/)
  })
  it('refuses a player who left the team', () => assert.match(irProblem(move('gone'), lg, mine(), meta) ?? '', /isn't on your team/))
  it('keeps the rest of IR as it is, and reads back', async () => {
    const f = fakeFetch({ data: { roster_update_reserve: {} } }, rostersReply([], ['x', 'hurt']))
    assert.deepEqual(await moveIr(move('hurt'), ['x'], 'tok', f.fn), { mismatch: null })
    assert.deepEqual(f.sent[0].variables, { league_id: 'L1', roster_id: 3, reserve: ['x', 'hurt'] })
    const g = fakeFetch({ data: {} }, rostersReply([], ['x']))
    assert.deepEqual(await moveIr(move('hurt', 'bench'), ['x', 'hurt'], 'tok', g.fn), { mismatch: null })
    assert.deepEqual(g.sent[0].variables.reserve, ['x'])
  })
  it('flags a move that did not show up', async () => {
    assert.match((await moveIr(move('hurt'), [], 'tok', fakeFetch({ data: {} }, rostersReply([], [])).fn)).mismatch ?? '', /doesn't show the move/)
  })
})
