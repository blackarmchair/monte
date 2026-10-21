// Phone storage: settings and the picked workbook in the app's documents (kept until the user
// replaces them), Sleeper/FantasyCalc caches in the OS cache directory (which it may clear).
// storage.web.ts is the browser stand-in Metro picks for the web build.
import { Directory, File, Paths } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const ensure = (d: Directory) => {
  if (!d.exists) d.create({ intermediates: true })
  return d
}
const cacheDir = () => ensure(new Directory(Paths.cache, 'monte'))
const sheetDir = () => ensure(new Directory(Paths.document, 'sheet'))
const settingsFile = () => new File(Paths.document, 'settings.json')

async function writeText(f: File, data: string) {
  if (!f.exists) f.create()
  await f.write(data)
}

export async function readSettings(): Promise<string | null> {
  const f = settingsFile()
  return f.exists ? f.text() : null
}

export async function writeSettings(json: string): Promise<void> {
  await writeText(settingsFile(), json)
}

export async function cacheRead(key: string): Promise<string | null> {
  const f = new File(cacheDir(), key)
  return f.exists ? f.text() : null
}

export async function cacheWrite(key: string, data: string): Promise<void> {
  await writeText(new File(cacheDir(), key), data)
}

/**
 * Let the user pick the rankings .xlsx and read it. Uses expo-file-system's own picker: the file
 * it returns carries read permission. expo-document-picker's cached copy does not in Expo Go,
 * where reading it fails with "Missing 'READ' permission".
 */
export async function pickSheetFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const r = await File.pickFileAsync({ mimeTypes: [XLSX, 'application/octet-stream'] })
  if (r.canceled || !r.result) return null
  // Android's picker can hand back a document id ("document:1000000020") rather than the file
  // name; show something honest instead of that.
  const name = /\.xlsx$/i.test(r.result.name) ? r.result.name : 'Your rankings sheet'
  return { name, bytes: await r.result.bytes() }
}

/** Keep our own copy of the workbook (one at a time: a new pick replaces the old one), under a
 *  fixed name so the user's file name (spaces and all) never ends up in a path. */
export async function storeSheet(bytes: Uint8Array): Promise<string> {
  const dir = sheetDir()
  for (const f of dir.list()) f.delete()
  const dest = new File(dir, 'rankings.xlsx')
  dest.create()
  await dest.write(bytes)
  return dest.uri
}

// The Sleeper session token: secure storage (Keychain / Keystore), never the settings file.
const TOKEN_KEY = 'sleeper_token'
export const readToken = () => SecureStore.getItemAsync(TOKEN_KEY)
export const writeToken = (token: string) => SecureStore.setItemAsync(TOKEN_KEY, token)
export const clearToken = () => SecureStore.deleteItemAsync(TOKEN_KEY)

export async function readSheet(uri: string): Promise<Uint8Array> {
  const f = new File(uri)
  if (!f.exists) throw new Error('The saved rankings workbook is missing. Pick it again in Settings.')
  // Await here, so `f` stays referenced until the read finishes: a native File collected
  // mid-read fails with "Cannot use shared object that was already released".
  const bytes = await f.bytes()
  return bytes
}
