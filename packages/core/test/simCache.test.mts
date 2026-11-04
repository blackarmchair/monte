import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { staleSheetNote } from '../src/inbox.ts'
import { simCacheKey, simResultFresh } from '../src/simCache.ts'

const BASE = { leagueId: 'L1', sims: 1000, strengthCV: 0.04, seed: 1, model: 'B', overrides: { a: 9, b: 99 } }
const NOW = Date.parse('2026-11-04T12:00:00Z')

describe('simCacheKey', () => {
  it('is the same for the same inputs, whatever order overrides arrive in', () => {
    assert.equal(simCacheKey(BASE), simCacheKey({ ...BASE, overrides: { b: 99, a: 9 } }))
  })
  for (const [name, change] of Object.entries({ league: { leagueId: 'L2' }, sims: { sims: 3000 }, spread: { strengthCV: 0.08 }, seed: { seed: 2 }, model: { model: 'A' }, injury: { overrides: { a: 9 } } }))
    it(`changes with ${name}`, () => assert.notEqual(simCacheKey(BASE), simCacheKey({ ...BASE, ...change })))
  it('is safe as a file name', () => assert.match(simCacheKey(BASE), /^[\w.-]+$/))
})

describe('simResultFresh', () => {
  it('keeps a recent result', () => assert.equal(simResultFresh('2026-11-04T07:00:00Z', NOW), true))
  it('drops one past six hours', () => assert.equal(simResultFresh('2026-11-04T05:00:00Z', NOW), false))
  it('drops one with no usable time', () => {
    assert.equal(simResultFresh(undefined, NOW), false)
    assert.equal(simResultFresh('nope', NOW), false)
  })
  it('drops one dated in the future', () => assert.equal(simResultFresh('2026-11-05T12:00:00Z', NOW), false))
})

describe('staleSheetNote', () => {
  it('is quiet for a week', () => assert.equal(staleSheetNote('2026-10-28T12:00:00Z', NOW), null))
  it('warns past a week', () => assert.match(staleSheetNote('2026-10-20T12:00:00Z', NOW) ?? '', /15 days old/))
})
