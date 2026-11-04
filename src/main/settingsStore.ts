// settings.json: the one copy of the user's account, sheet path and injury overrides. Saves run one
// at a time and replace the file in a single step, so a crash or two saves at once can't truncate it
// or lose a change. A file that can't be parsed is kept beside it rather than overwritten by defaults.
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// Backs off to about 1.4s in all: replacing a file fails on Windows for as long as anything has it open.
const RETRIES = 8
const RETRY_MS = 50
const code = (e: unknown) => (e as NodeJS.ErrnoException)?.code

/** Windows can briefly refuse a file that antivirus or an indexer has open. */
async function retrying<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (e) {
      if (attempt >= RETRIES || !['EPERM', 'EBUSY', 'EACCES'].includes(code(e) ?? '')) throw e
      await new Promise(r => setTimeout(r, RETRY_MS * attempt))
    }
  }
}

export function createSettingsStore<T extends object>(file: string, defaults: T) {
  const tmp = `${file}.tmp`
  let current: Promise<T> | null = null
  let writes: Promise<unknown> = Promise.resolve()

  async function read(): Promise<T> {
    let raw: string
    try {
      raw = await retrying(() => readFile(file, 'utf8'))
    } catch (e) {
      if (code(e) === 'ENOENT') return { ...defaults }
      throw e
    }
    try {
      return { ...defaults, ...JSON.parse(raw) }
    } catch {
      await copyFile(file, `${file}.corrupt`).catch(e => console.warn('could not keep the unreadable settings file:', e))
      return { ...defaults }
    }
  }

  function load(): Promise<T> {
    if (!current) {
      const reading = read()
      current = reading
      // A read that failed isn't remembered: the next call tries the disk again.
      reading.catch(() => {
        if (current === reading) current = null
      })
    }
    return current
  }

  function save(patch: Partial<T>): Promise<T> {
    const run = writes.then(async () => {
      const next = { ...(await load()), ...patch }
      await mkdir(dirname(file), { recursive: true })
      await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
      await retrying(() => rename(tmp, file))
      current = Promise.resolve(next)
      return next
    })
    writes = run.catch(() => undefined)
    return run
  }

  return { load, save }
}
