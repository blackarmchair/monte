import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { diffOffers, offerMessage, offersInLeague, type FoundOffer } from '../src/offerWatch.ts'

const rosters = [
  { roster_id: 1, owner_id: 'me' },
  { roster_id: 2, owner_id: 'them' },
]
const users = [{ user_id: 'them', display_name: 'Sam', metadata: {} }]
const raw = (o: object = {}) => ({
  transaction_id: 'T1',
  type: 'trade',
  status: 'proposed',
  creator: 'them',
  roster_ids: [1, 2],
  consenter_ids: [2],
  adds: { 10: 1, 20: 2 },
  draft_picks: ['2,2027,1,1,2'],
  player_map: { 10: { first_name: 'Got', last_name: 'Guy' }, 20: { first_name: 'Gave', last_name: 'Guy' } },
  ...o,
})
const find = (o: object = {}, userId = 'me') => offersInLeague({ league: { league_id: 'L1', name: 'Dynasty' }, rosters, users, pending: [raw(o)], userId })
const offer = (id: string, o: Partial<FoundOffer> = {}): FoundOffer => ({ id, leagueId: 'L1', leagueName: 'Dynasty', from: 'Sam', gets: ['Got Guy'], gives: ['Gave Guy'], ...o })

describe('offersInLeague', () => {
  it('finds an offer waiting on you, with who and what', () => {
    assert.deepEqual(find(), [{ id: 'T1', leagueId: 'L1', leagueName: 'Dynasty', from: 'Sam', gets: ['Got Guy', '2027 round 1'], gives: ['Gave Guy'], expiresAt: null }])
  })
  it('reads when the offer lapses, from seconds', () => {
    assert.equal(find({ settings: { expires_at: 1788630762 } })[0].expiresAt, 1788630762000)
  })
  it('skips offers you sent', () => assert.deepEqual(find({ creator: 'me', consenter_ids: [1] }), []))
  it('skips offers you already accepted', () => assert.deepEqual(find({ consenter_ids: [1, 2] }), []))
  it('skips other teams’ offers', () => assert.deepEqual(find({ roster_ids: [2, 3], adds: {}, draft_picks: [] }), []))
  it('skips a league you have no team in', () => assert.deepEqual(find({}, 'stranger'), []))
  it('counts a co-owned team as yours', () => {
    const found = offersInLeague({ league: { league_id: 'L1' }, rosters: [{ roster_id: 1, owner_id: 'x', co_owners: ['me'] }, rosters[1]], users, pending: [raw()], userId: 'me' })
    assert.equal(found.length, 1)
  })
})

describe('diffOffers', () => {
  it('reports only what it has not seen', () => {
    const { fresh, seen } = diffOffers([offer('A'), offer('B')], ['A'])
    assert.deepEqual(fresh.map(o => o.id), ['B'])
    assert.deepEqual(seen, ['A', 'B'])
  })
  it('does not re-notify when a league failed to load for one round', () => {
    const first = diffOffers([offer('A')], [])
    const failedRound = diffOffers([], first.seen)
    assert.deepEqual(diffOffers([offer('A')], failedRound.seen).fresh, [])
  })
  it('caps what it remembers, keeping the newest', () => {
    const old = Array.from({ length: 200 }, (_, i) => `old${i}`)
    const { seen } = diffOffers([offer('new')], old)
    assert.equal(seen.length, 200)
    assert.equal(seen.at(-1), 'new')
    assert.equal(seen.includes('old0'), false)
  })
})

describe('offerMessage', () => {
  it('says who and what', () => {
    assert.deepEqual(offerMessage(offer('A'), false), { title: 'Trade offer · Dynasty', body: 'From Sam. You get Got Guy. You give Gave Guy.' })
  })
  it('reveals nothing with Hide names on', () => {
    const m = offerMessage(offer('A'), true)
    assert.doesNotMatch(m.title + m.body, /Sam|Guy|Dynasty/)
  })
  it('stays vague instead of showing a raw player id', () => {
    assert.match(offerMessage(offer('A', { gets: ['4046'] }), false).body, /Open Monte to see it/)
  })
})
