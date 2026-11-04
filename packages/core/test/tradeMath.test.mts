import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { eff, evaluate, gammaFor, scoringAdj, spotCostFor, value, type Asset } from '../src/tradeMath.ts'

const asset = (id: string, sheet: number, val = sheet, extra: Partial<Asset> = {}) => ({ id, sheet, val, ...extra }) as Asset
const PARAMS = { gamma: 1.5, spotCost: 450, meFull: false, themFull: false }

describe('curves', () => {
  it('value falls with rank, and an unranked asset is worth nothing', () => {
    assert.equal(value(0), 10000)
    assert.ok(value(10) > value(11))
    assert.equal(value(null), 0)
  })

  it('eff makes one star worth more than a bundle of the same raw total', () => {
    assert.ok(eff(6000, 1.5) > 2 * eff(3000, 1.5))
    assert.equal(eff(-5, 1.5), 0)
  })

  it('scoringAdj only moves TEs and QBs', () => {
    const src = { te: 0, passTd: 4 }
    const lg = { te: 1, passTd: 6 }
    assert.equal(scoringAdj('TE', 1000, src, lg), 1250)
    assert.equal(scoringAdj('QB', 1000, src, lg), 1080)
    assert.equal(scoringAdj('RB', 1000, src, lg), 1000)
  })

  it('the reference league shape gives the reference constants', () => {
    assert.equal(gammaFor({ nStart: 9, rosterCap: 19 }), 1.5)
    assert.equal(spotCostFor({ nStart: 9, rosterCap: 19 }), 450)
  })
})

describe('evaluate', () => {
  it('scores you on the sheet and them on the market', () => {
    const v = evaluate([asset('give', 4000, 6000)], [asset('get', 6000, 4000)], PARAMS)
    assert.ok(v.em > 0, 'the sheet likes what you get')
    assert.ok(v.et > 0, 'the market likes what they get')
  })

  it('consolidating wins for the side taking the star', () => {
    const v = evaluate([asset('a', 3000), asset('b', 3000)], [asset('star', 6000)], PARAMS)
    assert.ok(v.em > 0)
    assert.ok(v.et < 0)
    assert.equal(v.bodyDelta, -1)
  })

  it('prefers `mine` to the sheet for your side', () => {
    const v = evaluate([], [asset('x', 1000, 1000, { mine: 2000 })], PARAMS)
    assert.equal(v.getSheet, 2000)
  })

  it('charges a spot only to a full roster receiving extra bodies', () => {
    const give = [asset('a', 5000)]
    const get = [asset('b', 2500), asset('c', 2500)]
    const free = evaluate(give, get, PARAMS)
    assert.equal(evaluate(give, get, { ...PARAMS, meFull: true }).em, free.em - 450)
    assert.equal(evaluate(give, get, { ...PARAMS, themFull: true }).et, free.et, 'they receive fewer bodies, so no charge')
    assert.equal(evaluate(get, give, { ...PARAMS, themFull: true }).et, evaluate(get, give, PARAMS).et - 450)
  })

  it('applies a demand multiplier to their side only', () => {
    const plain = evaluate([asset('a', 3000)], [], PARAMS)
    const keen = evaluate([asset('a', 3000)], [], { ...PARAMS, demand: () => 1.2 })
    assert.ok(keen.et > plain.et)
    assert.equal(keen.em, plain.em)
  })
})
