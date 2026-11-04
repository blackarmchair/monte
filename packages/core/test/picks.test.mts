import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ownedPicks, pickOwners } from '../src/picks.ts'
import type { RosterInfo } from '../src/types.ts'

const rosters = [1, 2, 3].map(id => ({ roster_id: id, display_name: `Team ${id}` })) as RosterInfo[]

describe('pickOwners', () => {
  it('starts every roster with its own picks', () => {
    const o = pickOwners(rosters, [], '2027', 2)
    assert.equal(o.size, 6)
    assert.equal(o.get('2:2'), 2)
  })

  it('applies traded picks for the draft season', () => {
    assert.equal(pickOwners(rosters, [{ season: 2027, round: 1, roster_id: 2, owner_id: 3 }], '2027', 2).get('2:1'), 3)
  })

  it('ignores other seasons and rounds past the draft', () => {
    const o = pickOwners(rosters, [{ season: '2028', round: 1, roster_id: 2, owner_id: 3 }, { season: '2027', round: 5, roster_id: 2, owner_id: 3 }], '2027', 2)
    assert.equal(o.get('2:1'), 2)
    assert.equal(o.has('2:5'), false)
  })
})

describe('ownedPicks', () => {
  it('lists own and acquired picks by round, then original team', () => {
    const owner = pickOwners(rosters, [{ season: '2027', round: 1, roster_id: 2, owner_id: 1 }, { season: '2027', round: 2, roster_id: 1, owner_id: 3 }], '2027', 2)
    assert.deepEqual(
      ownedPicks(rosters, owner, '2027', 1).map(p => [p.round, p.originalName]),
      [[1, 'Team 1'], [1, 'Team 2']],
    )
  })

  it('is empty without a roster', () => assert.deepEqual(ownedPicks(rosters, pickOwners(rosters, [], '2027', 1), '2027', null), []))
})
