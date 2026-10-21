// Browser stand-in for storage.ts, so the app can be previewed with `expo start --web`.
// localStorage holds settings and the workbook (base64); big caches (Sleeper's 5 MB player
// table) stay in memory because localStorage tops out around 5 MB.
const mem = new Map<string, string>()
const LS_MAX = 1_000_000

const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* full or blocked: memory still has it */
    }
  },
}

export async function readSettings(): Promise<string | null> {
  return ls.get('monte:settings')
}

export async function writeSettings(json: string): Promise<void> {
  ls.set('monte:settings', json)
}

export async function cacheRead(key: string): Promise<string | null> {
  return mem.get(key) ?? ls.get(`monte:cache:${key}`)
}

export async function cacheWrite(key: string, data: string): Promise<void> {
  mem.set(key, data)
  if (data.length < LS_MAX) ls.set(`monte:cache:${key}`, data)
}

const toB64 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

/** Browser picker: expo-document-picker works on web, and fetch reads its blob URL. */
export async function pickSheetFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const DocumentPicker = await import('expo-document-picker')
  const r = await DocumentPicker.getDocumentAsync({ type: ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] })
  if (r.canceled || !r.assets?.[0]) return null
  const a = r.assets[0]
  return { name: a.name ?? 'rankings.xlsx', bytes: new Uint8Array(await (await fetch(a.uri)).arrayBuffer()) }
}

export async function storeSheet(bytes: Uint8Array): Promise<string> {
  ls.set('monte:sheet', toB64(bytes))
  mem.set('monte:sheet', toB64(bytes))
  return 'web://sheet/rankings.xlsx'
}

export async function readSheet(_uri: string): Promise<Uint8Array> {
  const b64 = mem.get('monte:sheet') ?? ls.get('monte:sheet')
  if (!b64) throw new Error('No rankings workbook yet. Pick it in Settings.')
  return fromB64(b64)
}

// The Sleeper session token: memory only in the browser preview (no secure store there).
let token: string | null = null
export const readToken = async () => token
export const writeToken = async (t: string) => {
  token = t
}
export const clearToken = async () => {
  token = null
}
