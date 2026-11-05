import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { alertMessages, claimAlerts, deadlineAlerts, diffAlerts, faabLeft, lineupAlerts, offerExpiryAlerts, tokenAlerts, waiverResultAlerts, type Alert, type WeekPlayer } from '../src/alerts.ts'

const league = { league_id: 'L1', name: 'Dynasty', season: '2026', status: 'in_season', roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN', 'IR'], settings: { waiver_type: 2, waiver_budget: 100, reserve_slots: 1, trade_deadline: 11 } }
const players: Record<string, WeekPlayer> = {
  q: { name: 'Q Back', team: 'BUF', injury: null },
  r: { name: 'R Back', team: 'KC', injury: 'Out' },
  w: { name: 'W Out', team: 'DET', injury: 'Questionable' },
  f: { name: 'F Lex', team: 'SF', injury: 'Doubtful' },
  ir: { name: 'Healed Guy', team: 'NYJ', injury: null },
  fa: { name: 'Free Guy', team: null, injury: null },
}
const games = { BUF: { 10: 'pre_game' }, KC: { 10: 'pre_game' }, DET: { 10: 'pre_game' }, SF: { 10: 'in_game' }, NYJ: { 10: 'pre_game' } }
const matchup = (starters: string[], o: object = {}) => [{ roster_id: 1, matchup_id: 3, starters, ...o }]
const lineup = (starters: string[], o: object = {}, g: any = games) => lineupAlerts({ league, rosterId: 1, matchups: matchup(starters, o), week: 10, players, games: g })

describe('lineupAlerts', () => {
  it('flags a starter ruled out, keyed by his tag', () => {
    const a = lineup(['q', 'r', 'q', 'q'])
    assert.deepEqual(a.map(x => x.key), ['lineup:L1:10:r:Out'])
    assert.match(a[0].title, /R Back is ruled out · Dynasty/)
    assert.match(a[0].body, /at RB/)
  })
  it('gives Questionable a heads-up rather than a swap', () => {
    const a = lineup(['q', 'q', 'w', 'q'])
    assert.deepEqual(a.map(x => x.key), ['lineup:L1:10:w:Questionable'])
    assert.match(a[0].body, /Check on him/)
  })
  it('leaves a starter whose game has started', () => assert.deepEqual(lineup(['q', 'q', 'q', 'f']), []))
  it('flags an empty slot while games are still to come', () => {
    assert.deepEqual(lineup(['q', 'q', 'q', '0']).map(x => x.key), ['lineup:L1:10:3:empty'])
    assert.match(lineup(['q', 'q', 'q', '0'])[0].title, /Empty flex slot/)
    assert.deepEqual(lineup(['q', 'q', 'q', '0'], {}, { BUF: { 10: 'complete' }, SF: { 10: 'complete' } }), [])
  })
  it('flags a starter on bye, and one with no team', () => {
    const a = lineup(['ir', 'fa', 'q', 'q'], {}, { BUF: { 10: 'pre_game' } })
    assert.deepEqual(a.map(x => x.key), ['lineup:L1:10:ir:bye', 'lineup:L1:10:fa:FA'])
  })
  it('says nothing without a matchup this week', () => assert.deepEqual(lineup(['r'], { matchup_id: null }), []))
})

const tx = (o: object) => ({ transaction_id: 'T', type: 'waiver', status: 'complete', roster_ids: [1], status_updated: 1000, adds: { x: 1 }, drops: {}, settings: { waiver_bid: 7 }, player_map: { x: { first_name: 'New', last_name: 'Guy' } }, ...o })

describe('waiverResultAlerts', () => {
  const run = (txs: object[], now = 2000) => waiverResultAlerts({ league, rosterId: 1, transactions: txs, players, faabLeft: 40, now })
  it('reports wins and losses, sent as one message with what is left', () => {
    const a = run([tx({ transaction_id: 'A', drops: { r: 1 } }), tx({ transaction_id: 'B', status: 'failed', adds: { q: 1 } }), tx({ transaction_id: 'C', status: 'pending' }), tx({ transaction_id: 'D', roster_ids: [2] })])
    assert.deepEqual(a.map(x => x.key), ['waiver:A', 'waiver:B'])
    assert.deepEqual(alertMessages(a), [{ title: 'Waivers ran · Dynasty', leagueId: 'L1', body: "Won New Guy for $7, dropping R Back. Didn't get Q Back. $40 left." }])
  })
  it('ignores old results', () => assert.deepEqual(run([tx({})], 1000 + 37 * 3600 * 1000), []))
})

describe('claimAlerts', () => {
  const rosters = [
    { roster_id: 1, players: ['q', 'ir'], reserve: ['ir'] },
    { roster_id: 2, players: ['taken'] },
  ]
  const claim = (o: object) => ({ transaction_id: 'C1', type: 'waiver', status: 'pending', adds: { new: 1 }, drops: {}, settings: { waiver_bid: 5 }, ...o })
  const run = (pending: object[], left = 40, rs: any[] = rosters) => claimAlerts({ league, rosterId: 1, rosters: rs, pending, players, faabLeft: left })
  it('flags a taken player, a missing drop, an over-budget bid, and an IR blocker', () => {
    const keys = run([claim({ adds: { taken: 1 }, drops: { gone: 1 }, settings: { waiver_bid: 50 } })]).map(x => x.key)
    assert.deepEqual(keys, ['claim:C1:taken', 'claim:C1:nodrop', 'claim:C1:budget:40', 'claim:L1:ir:ir'])
  })
  it('says nothing about a sound claim, or with no claims', () => {
    const clean = [{ roster_id: 1, players: ['q'] }]
    assert.deepEqual(run([claim({ drops: { q: 1 } })], 40, clean), [])
    assert.deepEqual(run([]), [])
  })
})

describe('deadlineAlerts', () => {
  it('warns the week before and the week of', () => {
    assert.deepEqual(deadlineAlerts(league, 9), [])
    assert.match(deadlineAlerts(league, 10)[0].title, /next week/)
    assert.match(deadlineAlerts(league, 11)[0].title, /this week/)
    assert.deepEqual(deadlineAlerts(league, 12), [])
  })
})

describe('offerExpiryAlerts', () => {
  const h = 3600000
  const offer = (expiresAt: number | null) => ({ id: 'T1', leagueId: 'L1', leagueName: 'Dynasty', from: 'Sam', gets: ['Got Guy'], gives: ['Gave Guy'], expiresAt })
  it('warns a day out and in the last two hours, once each', () => {
    assert.deepEqual(offerExpiryAlerts([offer(30 * h)], false, 0), [])
    const day = offerExpiryAlerts([offer(30 * h)], false, 10 * h)
    assert.equal(day[0].key, 'offer-expiry:T1:24')
    assert.equal(day[0].body, "Sam's offer ends in 20 hours. You get Got Guy. You give Gave Guy.")
    assert.equal(offerExpiryAlerts([offer(30 * h)], false, 29.5 * h)[0].key, 'offer-expiry:T1:2')
  })
  it('says nothing without a time, or once it has lapsed, and hides names when asked', () => {
    assert.deepEqual(offerExpiryAlerts([offer(null), offer(h)], false, 2 * h), [])
    assert.doesNotMatch(offerExpiryAlerts([offer(h)], true, 0)[0].body, /Sam/)
  })
})

describe('tokenAlerts', () => {
  const day = 86400000
  it('warns a week out and a day out, once each', () => {
    assert.deepEqual(tokenAlerts(20 * day, 0), [])
    assert.equal(tokenAlerts(5 * day, 0)[0].key, `token:${5 * day}:7`)
    assert.equal(tokenAlerts(5 * day, 4.5 * day)[0].key, `token:${5 * day}:1`)
    assert.deepEqual(tokenAlerts(5 * day, 6 * day), [])
    assert.deepEqual(tokenAlerts(null), [])
  })
})

describe('diffAlerts and faabLeft', () => {
  const a = (key: string): Alert => ({ key, leagueId: 'L1', title: '', body: '' })
  it('sends each key once, even when found twice in one check', () => {
    const { fresh, seen } = diffAlerts([a('x'), a('y'), a('y')], ['x'])
    assert.deepEqual(fresh.map(f => f.key), ['y'])
    assert.deepEqual(seen, ['x', 'y'])
  })
  it('reads the budget left, or null without one', () => {
    assert.equal(faabLeft(league, { settings: { waiver_budget_used: 30 } }), 70)
    assert.equal(faabLeft({ settings: { waiver_type: 0 } }, {}), null)
  })
})
