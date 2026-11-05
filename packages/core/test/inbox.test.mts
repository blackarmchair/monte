import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { connectionItems, irItems, lineupItems, lowestNote, offerItems, orderInbox, waiverItems } from '../src/inbox.ts'
import { matchupPollMs, type LeagueWeek, type TradeTx } from '../src/leagueWeek.ts'
import type { Asset } from '../src/tradeMath.ts'
import type { SSPlayer, SSSlot, StartSitData } from '../src/types.ts'

const NOW = Date.parse('2026-11-04T12:00:00Z')
const player = (id: string, o: Partial<SSPlayer> = {}) => ({ id, name: id.toUpperCase(), startable: true, flag: '', ...o }) as SSPlayer
const slot = (o: Partial<SSSlot> = {}): SSSlot => ({ slot: 'WR1', label: 'WR', current: player('a'), best: player('a'), locked: false, supported: true, ...o })
const ss = (o: Partial<StartSitData> = {}) =>
  ({ week: 9, boardWeek: 9, slots: [slot()], changes: [], gain: 0, minGain: 1, sheet: { name: 's', modifiedAt: '2026-11-03T00:00:00Z' }, ...o }) as StartSitData
const ids = (xs: Array<{ id: string }>) => xs.map(x => x.id)

describe('lineupItems', () => {
  it('stays quiet about a good lineup', () => assert.deepEqual(lineupItems(ss(), NOW), []))

  it('flags an empty slot with who to start', () => {
    const [i] = lineupItems(ss({ slots: [slot({ current: null, best: player('b') })] }), NOW)
    assert.equal(i.tone, 'act')
    assert.match(i.title, /Empty WR/)
    assert.match(i.detail, /Start B/)
  })

  it('flags an unstartable starter with the reason', () => {
    const [i] = lineupItems(ss({ slots: [slot({ current: player('a', { startable: false, flag: 'Out' }), best: player('b') })] }), NOW)
    assert.equal(i.title, 'A')
    assert.match(i.detail, /In your lineup: Out\. Start B/)
    assert.deepEqual(i.tag, { label: 'Out', tone: 'bad' })
    assert.equal(i.cta, 'Fix lineup')
    assert.match(i.lead ?? '', /A is in your lineup: Out\. Start B/)
  })

  it('says so when the bench has nobody better', () => {
    const [i] = lineupItems(ss({ slots: [slot({ current: player('a', { startable: false, flag: 'On bye' }) })] }), NOW)
    assert.match(i.detail, /No better option/)
  })

  it('ignores locked and unsupported slots: nothing can be done there', () => {
    const bad = player('a', { startable: false, flag: 'Out' })
    assert.deepEqual(lineupItems(ss({ slots: [slot({ current: bad, locked: true }), slot({ current: null, supported: false })] }), NOW), [])
  })

  it('offers the best swap only past the minimum gain', () => {
    const changes = [{ slot: 'WR1', label: 'WR', inPlayer: player('b'), outPlayer: player('a'), gain: 3, marginal: false }]
    assert.deepEqual(lineupItems(ss({ changes, gain: 0.5 }), NOW), [])
    const [i] = lineupItems(ss({ changes, gain: 3 }), NOW)
    assert.match(i.title, /gains 3\.0/)
    assert.match(i.detail, /Start B over A/)
  })

  it('does not repeat a swap the unstartable item already covers', () => {
    const bad = player('a', { startable: false, flag: 'Out' })
    const changes = [{ slot: 'WR1', label: 'WR', inPlayer: player('b'), outPlayer: bad, gain: 9, marginal: false }]
    assert.deepEqual(ids(lineupItems(ss({ slots: [slot({ current: bad, best: player('b') })], changes, gain: 9 }), NOW)), ['bad:a'])
  })

  it('warns about an old sheet', () => {
    assert.match(lineupItems(ss({ sheet: { name: 's', modifiedAt: '2026-10-20T00:00:00Z' } }), NOW)[0].title, /15 days old/)
  })

  it("warns when the sheet's boards are for another week", () => {
    assert.match(lineupItems(ss({ boardWeek: 8 }), NOW)[0].title, /week 8/)
  })
})

describe('waiverItems', () => {
  const a = (id: string, o: Partial<Asset> = {}) => ({ id, name: id, kind: 'player', pos: 'WR', team: 'DAL', sheet: 1, ...o }) as Asset
  const rank = (m: Record<string, number | null>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { sheetRank: v }]))
  const mine = [a('star'), a('low')]
  const ranks = rank({ star: 5, low: 320, x: 400, p1: 300, p2: 100, p3: 200, p4: 250 })

  it('lists only players ranked ahead of your lowest, best first, at most three', () => {
    assert.deepEqual(ids(waiverItems(['x', 'p1', 'p2', 'p3', 'p4'].map(i => a(i)), mine, ranks)), ['waiver:p2', 'waiver:p3', 'waiver:p4'])
  })

  it('carries the sheet rank, where lower is better, never the value score', () => {
    const [i] = waiverItems([a('p2', { sheet: 608 })], [a('star', { sheet: 9000 }), a('low', { sheet: 103 })], ranks)
    assert.equal(i.rank, 100)
    assert.equal(i.title, 'p2')
    assert.doesNotMatch(i.detail, /608|103/)
    assert.equal(lowestNote(mine, ranks), 'Ranked ahead of your lowest, low (#320).')
  })

  it('goes by rank even when scoring adjustments put value the other way', () => {
    assert.deepEqual(waiverItems([a('x', { sheet: 9999 })], mine, ranks), [])
  })

  it('counts an unranked player of yours as your lowest', () => {
    const you = [a('star'), a('off')]
    assert.equal(waiverItems([a('p1')], you, ranks).length, 1)
    assert.match(lowestNote(you, ranks) ?? '', /Your lowest, off, isn't on it/)
  })

  it('skips free agents the sheet does not rank', () => assert.deepEqual(waiverItems([a('nobody')], mine, ranks), []))
  it('skips players who are out', () => assert.deepEqual(waiverItems([a('p2', { injury: 'IR' })], mine, ranks), []))
  it('compares against players, not picks', () => assert.deepEqual(waiverItems([a('p1')], [a('star'), a('pick', { kind: 'pick' })], ranks), []))
  it('handles an empty roster', () => assert.deepEqual(waiverItems([a('p1')], [], ranks), []))
})

describe('connectionItems', () => {
  it('passes on why offers are hidden', () => assert.equal(connectionItems(undefined, 'Connect Sleeper', NOW)[0].title, 'Connect Sleeper'))
  it('is quiet with a healthy token', () => assert.deepEqual(connectionItems({ expiresAt: NOW + 30 * 86400000 }, null, NOW), []))
  it('warns before the token ends', () => assert.match(connectionItems({ expiresAt: NOW + 2 * 86400000 }, null, NOW)[0].title, /in 2 days/))
  it('is quiet when the token has no date', () => assert.deepEqual(connectionItems({ expiresAt: null }, null, NOW), []))
})

describe('inbox order', () => {
  it('puts things to act on first', () => {
    const offers = offerItems([{ tx: { id: 'T' } as TradeTx, from: 'Sam', verdict: 'Worth taking' }])
    assert.deepEqual(ids(orderInbox([...connectionItems(undefined, 'x', NOW), ...offers])), ['offer:T', 'connect'])
  })
})

describe('matchupPollMs', () => {
  const week = (...states: string[]) => ({ matchups: [{ sides: [{ starters: states.map(state => ({ state })) }, { starters: [] }] }] }) as unknown as LeagueWeek
  it('polls fast with a game on', () => assert.equal(matchupPollMs(week('done', 'live', 'pre')), 60000))
  it('polls slowly until kickoff', () => assert.equal(matchupPollMs(week('done', 'pre')), 300000))
  it('stops when the week is over', () => assert.equal(matchupPollMs(week('done', 'bye', 'empty')), null))
  it('has nothing to poll without data', () => assert.equal(matchupPollMs(null), null))
})

describe('irItems', () => {
  const p = (id: string, tag: string | null) => ({ id, name: id.toUpperCase(), pos: 'RB', team: 'KC', tag })
  it('puts a blocker first, with a button to move him off', () => {
    const items = irItems({ slots: 1, used: 1, blockers: [p('well', null)], eligible: [p('hurt', 'IR')] })
    assert.deepEqual(
      items.map(i => [i.id, i.cta]),
      [['ir-off:well', 'Move off IR']],
    )
    assert.deepEqual(items[0].action, { kind: 'ir', id: 'well', name: 'WELL', to: 'bench' })
    assert.match(items[0].lead ?? '', /blocking your adds and claims/)
  })
  it('suggests IR only while there is room', () => {
    assert.deepEqual(
      irItems({ slots: 2, used: 1, blockers: [], eligible: [p('a', 'IR'), p('b', 'IR')] }).map(i => i.id),
      ['ir-on:a'],
    )
    assert.deepEqual(irItems({ slots: 1, used: 1, blockers: [], eligible: [p('a', 'IR')] }), [])
  })
  it('is empty without IR', () => assert.deepEqual(irItems(null), []))
})
