// The user's downloaded rankings workbook. Phase 1 only reads its identity (name, modified
// time, tab names) so the sidebar card can show which file is in use and how old it is; the
// tab parsers arrive with the trade engine and start/sit.
import { readFile, stat } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { basename } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import type { RanksFileInfo } from '@monte/core/types'

/** Sheet names from xl/workbook.xml, in workbook order. */
function sheetNames(workbookXml: string): string[] {
  const names: string[] = []
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g))
    names.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
  return names
}

export async function readRanksFile(path: string): Promise<RanksFileInfo> {
  const [buf, st] = await Promise.all([readFile(path), stat(path)])
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(buf), { filter: f => f.name === 'xl/workbook.xml' })
  } catch {
    throw new Error(`${basename(path)} is not an .xlsx workbook. In Google Sheets use File → Download → Microsoft Excel.`)
  }
  const wb = files['xl/workbook.xml']
  if (!wb) throw new Error(`${basename(path)} has no workbook inside; is it really an .xlsx?`)
  return {
    path,
    name: basename(path),
    modifiedAt: st.mtime.toISOString(),
    syncedAt: new Date().toISOString(),
    tabs: sheetNames(strFromU8(wb)),
  }
}

/**
 * Watch one file and call back (debounced) when it changes. Re-downloading usually replaces
 * the file rather than writing into it, which ends an fs.watch handle, so the watcher re-arms
 * itself after every event.
 */
export function watchRanksFile(path: string, onChange: () => void): () => void {
  let w: FSWatcher | null = null
  let timer: NodeJS.Timeout | null = null
  let closed = false
  const arm = () => {
    if (closed) return
    try {
      w = watch(path, () => {
        w?.close()
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          onChange()
          arm()
        }, 800)
      })
    } catch {
      // File briefly missing mid-replace: try again shortly.
      timer = setTimeout(arm, 2000)
    }
  }
  arm()
  return () => {
    closed = true
    w?.close()
    if (timer) clearTimeout(timer)
  }
}
