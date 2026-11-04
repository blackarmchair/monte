import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isSleeperPage, loginMayVisit, tokenFromStorage } from '../src/sleeperLogin.ts'
import { sheetName } from '../src/names.ts'

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const JWT = `${b64({ alg: 'HS256' })}.${b64({ user_id: '1', exp: 2000000000 })}.sig`

describe('tokenFromStorage', () => {
  it('takes a plain token', () => assert.equal(tokenFromStorage(JWT), JWT))
  it('strips the quotes the page may save it with', () => assert.equal(tokenFromStorage(`"${JWT}"`), JWT))
  it('trims', () => assert.equal(tokenFromStorage(`  ${JWT}\n`), JWT))
  for (const bad of [null, undefined, '', 'null', 'undefined', 'abc', 'a.b', 'a.b.c', 12])
    it(`waits on ${JSON.stringify(bad)}`, () => assert.equal(tokenFromStorage(bad), null))
})

describe('isSleeperPage', () => {
  it('accepts Sleeper', () => {
    assert.equal(isSleeperPage('https://sleeper.com/?login='), true)
    assert.equal(isSleeperPage('https://www.sleeper.com/leagues'), true)
  })
  it('refuses lookalikes and anything insecure', () => {
    for (const url of ['https://sleeper.com.evil.example/', 'https://evilsleeper.com/', 'http://sleeper.com/', 'https://example.com/?sleeper.com', 'nope'])
      assert.equal(isSleeperPage(url), false, url)
  })
})

describe('loginMayVisit', () => {
  it('allows Sleeper and its bot check', () => {
    for (const url of ['https://sleeper.com/login', 'https://api.sleeper.app/x', 'https://www.google.com/recaptcha/api2/anchor', 'https://www.recaptcha.net/recaptcha/', 'https://www.gstatic.com/recaptcha/x.js'])
      assert.equal(loginMayVisit(url), true, url)
  })
  it('refuses the rest of the web', () => {
    for (const url of ['https://www.google.com/search?q=x', 'https://example.com/', 'http://sleeper.com/', 'https://sleeper.com.evil.example/', 'nope'])
      assert.equal(loginMayVisit(url), false, url)
  })
})

describe('sheetName', () => {
  it('shows the name normally', () => assert.equal(sheetName('Patreon Rankings.xlsx', false), 'Patreon Rankings.xlsx'))
  it('hides it with Hide names on', () => assert.equal(sheetName('Patreon Rankings.xlsx', true), 'your rankings sheet'))
})
