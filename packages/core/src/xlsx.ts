// Minimal .xlsx reader: sheet names and cell grids, nothing else. An .xlsx is a zip of XML;
// fflate unzips it and the few elements we need are regular enough to read with regexes.
// Formatting, formulas and merged ranges are ignored on purpose — the parsers above this
// validate layout themselves and refuse anything that does not match.
import { unzipSync, strFromU8 } from 'fflate'

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')

/** Text of every <t> inside an element (shared strings may be split into rich-text runs). */
const textOf = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => decode(m[1])).join('')

function colIndex(ref: string): number {
  let n = 0
  for (const ch of ref.match(/^[A-Z]+/)![0]) n = n * 26 + ch.charCodeAt(0) - 64
  return n - 1
}

export type Workbook = { sheets: string[]; grid(sheet: string): string[][] }

/** A parsed workbook plus where it came from: the host (desktop file, phone pick) supplies it. */
export type Book = { wb: Workbook; path: string; modifiedAt: string }

export function readWorkbook(buf: Uint8Array): Workbook {
  const files = unzipSync(buf)
  const text = (p: string) => (files[p] ? strFromU8(files[p]) : '')
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]))

  const rels = new Map<string, string>()
  for (const m of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1]
    const target = /Target="([^"]+)"/.exec(m[0])?.[1]
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }
  const sheetPath = new Map<string, string>()
  for (const m of text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(m[0])?.[1]
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1]
    if (name && rid && rels.has(rid)) sheetPath.set(decode(name), rels.get(rid)!)
  }

  return {
    sheets: [...sheetPath.keys()],
    grid(sheet) {
      const xml = text(sheetPath.get(sheet) ?? '')
      const rows: string[][] = []
      for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
        const r = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1) - 1
        const row: string[] = []
        for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ref = /\br="([A-Z]+)\d+"/.exec(cm[1])?.[1]
          if (!ref) continue
          const t = /\bt="([^"]+)"/.exec(cm[1])?.[1]
          const body = cm[2] ?? ''
          const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
          let val = ''
          if (t === 's' && v !== undefined) val = shared[Number(v)] ?? ''
          else if (t === 'inlineStr') val = textOf(body)
          else if (v !== undefined) val = decode(v)
          row[colIndex(ref)] = val
        }
        rows[r] = Array.from(row, x => x ?? '')
      }
      return Array.from(rows, x => x ?? [])
    },
  }
}
