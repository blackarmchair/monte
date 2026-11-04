import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { createSettingsStore } from '../../../src/main/settingsStore.ts'
import { withDeadline } from '../src/deadline.ts'

type S = { sims: number; userId?: string; ranksFile?: string; injuries?: string[] }
const DEFAULTS: S = { sims: 3000 }

describe('settings store', () => {
  let dir: string
  let file: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'monte-settings-'))
    file = join(dir, 'settings.json')
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('starts from defaults with no file', async () => {
    assert.deepEqual(await createSettingsStore<S>(file, DEFAULTS).load(), DEFAULTS)
  })

  it('reads a saved file back in a new session, filling new defaults', async () => {
    await createSettingsStore<S>(file, DEFAULTS).save({ userId: 'u1' })
    assert.deepEqual(await createSettingsStore<S>(file, { sims: 1 }).load(), { sims: 3000, userId: 'u1' })
  })

  it('keeps every change when saves overlap', async () => {
    const store = createSettingsStore<S>(file, DEFAULTS)
    await Promise.all([store.save({ userId: 'u1' }), store.save({ ranksFile: 'r.xlsx' }), store.save({ injuries: ['p1'] }), store.save({ sims: 500 })])
    const want = { sims: 500, userId: 'u1', ranksFile: 'r.xlsx', injuries: ['p1'] }
    assert.deepEqual(await store.load(), want)
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), want)
  })

  // A reader this busy can hold the file through every retry on Windows, so a save may be refused.
  // What must hold regardless: nobody sees a partial file, and a refused save changes nothing.
  it('never exposes a partial file, and a save refused by a busy reader is safe', async () => {
    const store = createSettingsStore<S>(file, DEFAULTS)
    await store.save({ userId: 'u1' })
    const saves = Array.from({ length: 40 }, (_, i) => store.save({ injuries: Array(500).fill(`p${i}`) }))
    let done = false
    const settled = Promise.allSettled(saves).then(r => {
      done = true
      return r
    })
    while (!done) {
      const seen = JSON.parse(await readFile(file, 'utf8').catch(e => (['EPERM', 'EBUSY', 'EACCES'].includes(e.code) ? '{}' : Promise.reject(e))))
      if (seen.injuries) assert.equal(new Set(seen.injuries).size, 1, 'one save, whole')
      await new Promise(r => setImmediate(r))
    }
    for (const r of await settled) if (r.status === 'rejected') assert.equal(r.reason.code, 'EPERM')
    assert.deepEqual(await store.load(), JSON.parse(await readFile(file, 'utf8')), 'memory matches the disk')
    assert.equal((await store.save({ sims: 7 })).sims, 7, 'saves work once the reader stops')
  })

  it('leaves no temp file behind', async () => {
    await createSettingsStore<S>(file, DEFAULTS).save({ userId: 'u1' })
    assert.deepEqual(await readdir(dir), ['settings.json'])
  })

  it('keeps an unreadable file instead of letting a save destroy it', async () => {
    await writeFile(file, '{"userId":"u1","injur')
    const store = createSettingsStore<S>(file, DEFAULTS)
    assert.deepEqual(await store.load(), DEFAULTS)
    await store.save({ sims: 500 })
    assert.equal(await readFile(`${file}.corrupt`, 'utf8'), '{"userId":"u1","injur')
  })

  it('a failed save reports the error and later saves still work', async () => {
    const store = createSettingsStore<S>(join(dir, 'settings.json'), DEFAULTS)
    await store.save({ userId: 'u1' })
    const bad = { toJSON() { throw new Error('boom') } } as unknown as string
    await assert.rejects(store.save({ ranksFile: bad }), /boom/)
    assert.equal((await store.save({ sims: 7 })).sims, 7)
    assert.equal((await store.load()).ranksFile, undefined)
  })
})

describe('withDeadline', () => {
  it('rejects work that never settles', async () => {
    await assert.rejects(withDeadline(new Promise(() => {}), 10, 'too slow'), /too slow/)
  })

  it('passes results and errors through', async () => {
    assert.equal(await withDeadline(Promise.resolve(1), 1000, 'x'), 1)
    await assert.rejects(withDeadline(Promise.reject(new Error('real')), 1000, 'x'), /real/)
  })
})
