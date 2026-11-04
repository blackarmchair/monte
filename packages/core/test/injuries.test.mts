import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { injurySeason, isCurrentInjury, isExpiredInjury, overridesFor } from '../src/injuries.ts'
import type { ManualInjury } from '../src/types.ts'

const injury = (o: Partial<ManualInjury>): ManualInjury => ({ id: 'p1', name: 'P', pos: 'RB', team: 'DAL', returnWeek: null, addedAt: '2026-10-01T00:00:00Z', ...o })

describe('injurySeason', () => {
  it('uses the stored season first', () => assert.equal(injurySeason(injury({ season: '2025' })), '2025'))
  it('dates older entries by when they were added', () => assert.equal(injurySeason(injury({})), '2026'))
  it('counts January and February as the season before', () => {
    assert.equal(injurySeason(injury({ addedAt: '2027-01-10T00:00:00Z' })), '2026')
    assert.equal(injurySeason(injury({ addedAt: '2027-02-28T00:00:00Z' })), '2026')
    assert.equal(injurySeason(injury({ addedAt: '2027-03-01T00:00:00Z' })), '2027')
  })
  it('has no season for an unreadable date', () => assert.equal(injurySeason(injury({ addedAt: 'nope' })), null))
})

describe('overridesFor', () => {
  it('applies this season and maps out-for-season to 99', () => {
    assert.deepEqual(overridesFor([injury({ season: '2026' }), injury({ id: 'p2', season: '2026', returnWeek: 12 })], '2026'), { p1: 99, p2: 12 })
  })
  it('drops last season, including season-ending entries', () => {
    assert.deepEqual(overridesFor([injury({ season: '2026' }), injury({ id: 'p2', season: '2026', returnWeek: 14 })], '2027'), {})
  })
  it('drops an undated-season entry from last year', () => assert.deepEqual(overridesFor([injury({})], '2027'), {}))
  it('handles no overrides', () => assert.deepEqual(overridesFor(undefined, '2026'), {}))
})

describe('isCurrentInjury', () => {
  it('counts as current until the season is known', () => assert.equal(isCurrentInjury(injury({ season: '2020' }), undefined), true))
})

describe('isExpiredInjury', () => {
  it('expires when the return week arrives', () => {
    assert.equal(isExpiredInjury(injury({ season: '2026', returnWeek: 9 }), '2026', 8), false)
    assert.equal(isExpiredInjury(injury({ season: '2026', returnWeek: 9 }), '2026', 9), true)
  })
  it('keeps out-for-season all season, then expires it', () => {
    assert.equal(isExpiredInjury(injury({ season: '2026' }), '2026', 18), false)
    assert.equal(isExpiredInjury(injury({ season: '2026' }), '2027', 1), true)
  })
})
