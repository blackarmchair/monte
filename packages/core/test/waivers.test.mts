import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { waiverItems } from '../src/inbox.ts'
import type { Asset } from '../src/tradeMath.ts'
import { buildWaiverDesk, fetchPendingClaims, moveDrop, moveTitle } from '../src/waivers.ts'

const NOW = Date.parse('2026-11-04T12:00:00Z')
const days = (n: number) => NOW - n * 86400000
const meta = { p1: { first_name: 'Add', last_name: 'Ed' }, p2: { first_name: 'Drop', last_name: 'Ped' } }
const league = (s: object = {}) => ({ settings: { waiver_type: 2, waiver_budget: 100, waiver_bid_min: 1, daily_waivers: 0, waiver_clear_days: 1, ...s } })
const waiver = (o: object = {}) => ({ transaction_id: 'W1', type: 'waiver', status: 'complete', adds: { p1: 3 }, drops: { p2: 3 }, settings: { waiver_bid: 10 }, status_updated: days(3), ...o })
const desk = (o: Partial<Parameters<typeof buildWaiverDesk>[0]> = {}) =>
  buildWaiverDesk({ league: league(), roster: { settings: { waiver_budget_used: 42, waiver_position: 4 } }, transactions: [], pending: [], pendingNote: null, meta, now: NOW, ...o })

describe('budget', () => {
  it('reports what is left', () => assert.deepEqual(desk().faab, { budget: 100, used: 42, left: 58, minBid: 1 }))
  it('never goes below zero', () => assert.equal(desk({ roster: { settings: { waiver_budget_used: 140 } } }).faab?.left, 0))
  it('shows priority instead in a league with no budget', () => {
    const d = desk({ league: league({ waiver_type: 0 }) })
    assert.equal(d.faab, null)
    assert.equal(d.priority, 4)
  })
  it('copes with having no team here', () => assert.equal(desk({ roster: null }).faab?.left, 100))
})

describe('when waivers run', () => {
  it('reads the cadence', () => {
    assert.equal(desk().cadence, 'weekly')
    assert.equal(desk({ league: league({ daily_waivers: 1 }) }).cadence, 'daily')
  })
  it('takes the last run from what actually processed, failures included', () => {
    assert.equal(desk({ transactions: [waiver({ status_updated: days(9) }), waiver({ status: 'failed', status_updated: days(2) })] }).lastRun, days(2))
  })
  it('ignores free-agent moves and open claims', () => {
    assert.equal(desk({ transactions: [waiver({ type: 'free_agent', status_updated: days(1) }), waiver({ status: 'pending', status_updated: days(1) })] }).lastRun, null)
  })
})

describe('winning bids', () => {
  const at = (...bids: number[]) => desk({ transactions: bids.map((b, i) => waiver({ transaction_id: `W${i}`, settings: { waiver_bid: b } })) }).bids
  it('summarizes paid bids', () => assert.deepEqual(at(35, 1, 41), { count: 3, median: 35, high: 41 }))
  it('averages the middle two', () => assert.equal(at(1, 2, 3, 40)?.median, 2.5))
  it('leaves out $0 claims', () => assert.equal(at(0, 0, 10)?.count, 1))
  it('has nothing to say with none paid', () => assert.equal(at(0), null))
  it('does not count failed bids as winning', () => {
    assert.equal(desk({ transactions: [waiver({ status: 'failed', settings: { waiver_bid: 99 } })] }).bids, null)
  })
})

describe('moves', () => {
  it('lists completed moves newest first, with names and the bid', () => {
    const [a, b] = desk({ transactions: [waiver({ transaction_id: 'old', status_updated: days(5) }), waiver({ transaction_id: 'new', type: 'free_agent', settings: null, status_updated: days(1) })] }).recent
    assert.equal(a.id, 'new')
    assert.equal(a.kind, 'free_agent')
    assert.equal(a.bid, null)
    assert.equal(b.bid, 10)
    assert.equal(b.rosterId, 3)
    assert.deepEqual(b.adds, [{ id: 'p1', name: 'Add Ed' }])
  })
  it('keeps the list short', () => {
    assert.equal(desk({ transactions: Array.from({ length: 20 }, (_, i) => waiver({ transaction_id: `W${i}` })) }).recent.length, 8)
  })
  it('leaves out commissioner and trade entries', () => assert.deepEqual(desk({ transactions: [waiver({ type: 'trade' }), waiver({ type: 'commissioner' })] }).recent, []))
  it('writes a claim out', () => {
    const [m] = desk({ transactions: [waiver()] }).recent
    assert.equal(moveTitle(m), 'Add Add Ed')
    assert.equal(moveDrop(m), 'drop Drop Ped')
    assert.equal(moveTitle({ adds: [], drops: m.drops }), 'Drop Drop Ped')
    assert.equal(moveDrop({ adds: [], drops: m.drops }), '')
    assert.equal(moveDrop({ adds: m.adds, drops: [] }), '')
  })
})

describe('pending claims', () => {
  it('passes on a note when they could not be read', () => {
    const d = desk({ pending: null, pendingNote: 'Connect Sleeper' })
    assert.equal(d.pending, null)
    assert.equal(d.pendingNote, 'Connect Sleeper')
  })

  const reply = (...lists: any[][]) => {
    const sent: any[] = []
    const fn = (async (_u: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ data: { league_transactions: lists.shift() } }))
    }) as typeof fetch
    return { fn, sent }
  }
  const claim = (o: object = {}) => waiver({ status: 'pending', roster_ids: [3], ...o })

  it('keeps only your own pending waivers', async () => {
    const f = reply([claim({ transaction_id: 'mine' }), claim({ transaction_id: 'theirs', roster_ids: [4] }), claim({ transaction_id: 'done', status: 'complete' }), claim({ transaction_id: 'fa', type: 'free_agent' })])
    assert.deepEqual((await fetchPendingClaims('L1', [9], 3, 'tok', f.fn)).map(t => t.transaction_id), ['mine'])
  })
  it('reads each week once and drops repeats', async () => {
    const f = reply([claim()], [claim()])
    assert.equal((await fetchPendingClaims('L1', [8, 9], 3, 'tok', f.fn)).length, 1)
    assert.deepEqual(f.sent.map(s => s.variables.leg), [8, 9])
  })
  it('only ever asks a read query', async () => {
    const f = reply([])
    await fetchPendingClaims('L1', [9], 3, 'tok', f.fn)
    assert.match(f.sent[0].query, /^query /)
    assert.doesNotMatch(f.sent[0].query, /mutation/)
  })
})

describe('likely on waivers', () => {
  it('flags a fresh drop', () => assert.deepEqual(desk({ transactions: [waiver({ status_updated: days(0.5) })] }).likelyOnWaivers, ['p2']))
  it('lets an old drop clear', () => assert.deepEqual(desk({ transactions: [waiver({ status_updated: days(3) })] }).likelyOnWaivers, []))
  it('respects a longer waiver period', () => {
    assert.deepEqual(desk({ league: league({ waiver_clear_days: 4 }), transactions: [waiver({ status_updated: days(3) })] }).likelyOnWaivers, ['p2'])
  })
  it('forgets a player who was picked back up', () => {
    const t = [waiver({ transaction_id: 'a', adds: {}, drops: { p1: 3 }, status_updated: days(0.5) }), waiver({ transaction_id: 'b', adds: { p1: 4 }, drops: {}, status_updated: days(0.25) })]
    assert.deepEqual(desk({ transactions: t }).likelyOnWaivers, [])
  })

  it('shows on a waiver suggestion', () => {
    const a = (id: string) => ({ id, name: id, kind: 'player', pos: 'WR', team: 'DAL', sheet: 1 }) as Asset
    const ranks = { low: { sheetRank: 300 }, fresh: { sheetRank: 100 }, other: { sheetRank: 120 } }
    const [x, y] = waiverItems([a('fresh'), a('other')], [a('low')], ranks, ['fresh'])
    assert.match(x.detail, /likely on waivers/)
    assert.doesNotMatch(y.detail, /likely on waivers/)
  })
})

describe('IR and roster on the desk', () => {
  const irMeta = { ...meta, hurt: { first_name: 'Hurt', last_name: 'Guy', position: 'RB', team: 'KC', injury_status: 'IR' }, well: { first_name: 'Well', last_name: 'Guy', position: 'WR', team: 'NE' }, sit: { first_name: 'Sit', last_name: 'Guy', position: 'TE', team: 'SF', injury_status: 'IR' } }
  const lg = { ...league({ reserve_slots: 2 }), roster_positions: ['QB', 'RB', 'BN', 'IR', 'IR', 'TAXI'] }
  const roster = { settings: {}, players: ['hurt', 'well', 'sit', 'tx'], reserve: ['well'], taxi: ['tx'] }
  const d = desk({ league: lg, roster, meta: irMeta })
  it('finds a healthy player blocking IR', () => assert.deepEqual(d.ir?.blockers.map(p => p.name), ['Well Guy']))
  it('finds injured players on the active roster', () => assert.deepEqual(d.ir?.eligible.map(p => p.id), ['hurt', 'sit']))
  it('counts IR slots', () => assert.deepEqual([d.ir?.slots, d.ir?.used], [2, 1]))
  it('lists the active roster for a drop, leaving out IR and taxi', () => {
    assert.deepEqual(d.roster?.players.map(p => p.id), ['hurt', 'sit'])
    assert.deepEqual([d.roster?.active, d.roster?.slots], [2, 3])
  })
  it('has no IR picture in a league without IR', () => assert.equal(desk({ roster: { ...roster, reserve: [] } }).ir, null))
})
