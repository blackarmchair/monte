// Keeping the rankings sheet current from its Google Sheets link, so nobody has to re-download it.
// Google serves any sheet its link can view as an .xlsx; a private one answers with a sign-in page.

/** How often a linked sheet is checked. */
export const SHEET_CHECK_MS = 6 * 3600 * 1000
const FETCH_MS = 60_000
const PRIVATE = "Google wouldn't share that sheet with Monte. Its link needs to be viewable by anyone with the link, and its owner must allow downloads. You can still download it and choose the file."

/** The .xlsx export address for a Google Sheets link, or null if it isn't one. */
export function sheetExportUrl(link: string): string | null {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return null
  const id = url.pathname.match(/^\/spreadsheets\/d\/([\w-]{10,})/)?.[1]
  return id ? `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx` : null
}

/** Download the linked sheet. Throws a user-facing message on anything but a real workbook. */
export async function fetchSheet(link: string, fetchFn: typeof fetch = fetch): Promise<Uint8Array> {
  const url = sheetExportUrl(link)
  if (!url) throw new Error("That isn't a Google Sheets link. It should look like https://docs.google.com/spreadsheets/d/…")
  let res: Response
  let bytes: Uint8Array
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_MS) })
    bytes = new Uint8Array(await res.arrayBuffer())
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new Error("Google didn't send the sheet in time. Try again.")
    throw new Error("Couldn't reach Google to get the sheet.")
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error(PRIVATE)
  if (!res.ok) throw new Error(`Google answered ${res.status} for the sheet. Try again.`)
  // An .xlsx is a zip, which starts "PK". A sign-in page arrives as 200 with HTML.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error(PRIVATE)
  return bytes
}

const CONTENT = /^xl\/(worksheets\/[^/]+\.xml|sharedStrings\.xml|workbook\.xml)$/

/**
 * Do two workbooks hold the same data? Google rebuilds the file for every export, so the bytes differ
 * even when nothing changed, and replacing it would reload every screen and hide how old the sheet is.
 * `unzip` comes from the host (fflate's unzipSync).
 */
export function sameWorkbook(a: Uint8Array, b: Uint8Array, unzip: (bytes: Uint8Array) => Record<string, Uint8Array>): boolean {
  const pick = (bytes: Uint8Array) => Object.entries(unzip(bytes)).filter(([name]) => CONTENT.test(name))
  const [x, y] = [pick(a), new Map(pick(b))]
  if (!x.length || x.length !== y.size) return false
  return x.every(([name, data]) => {
    const other = y.get(name)
    return !!other && other.length === data.length && data.every((v, i) => v === other[i])
  })
}
