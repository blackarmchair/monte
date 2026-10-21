// One parsed copy of the user's rankings workbook, shared by every screen. The file only changes
// when the user re-downloads it, so it is re-read only when its modification time moves.
import { readFile, stat } from 'node:fs/promises'
import { readWorkbook, type Book, type Workbook } from '@monte/core/xlsx'

let cached: { path: string; mtime: number; wb: Workbook } | null = null

export async function loadWorkbook(path: string | undefined): Promise<Book> {
  if (!path) throw new Error('Choose your rankings workbook in the sidebar first.')
  const st = await stat(path)
  if (!cached || cached.path !== path || cached.mtime !== st.mtimeMs) {
    cached = { path, mtime: st.mtimeMs, wb: readWorkbook(new Uint8Array(await readFile(path))) }
  }
  return { wb: cached.wb, modifiedAt: st.mtime.toISOString(), path }
}
