// Does the newest GitHub release carry a newer phone build? The APK rides on the same release as the
// desktop installer, named Monte-<phone version>.apk: the phone and desktop number their versions
// separately, and the desktop updater reads the same "latest" release, so it can't get its own.
export const RELEASES_URL = 'https://api.github.com/repos/blackarmchair/monte/releases/latest'
/** The blank rankings workbook (scripts/make-template.py), attached to every release. */
export const TEMPLATE_URL = 'https://github.com/blackarmchair/monte/releases/latest/download/Monte-Rankings-Template.xlsx'

/** Negative when a is older than b. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split('.').map(n => Number(n) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return 0
}

export type AppUpdate = { version: string; url: string }

export function newerApk(release: any, current: string): AppUpdate | null {
  for (const asset of release?.assets ?? []) {
    const version = String(asset?.name ?? '').match(/^Monte-(\d+\.\d+\.\d+)\.apk$/i)?.[1]
    const url = String(asset?.browser_download_url ?? '')
    if (version && url.startsWith('https://github.com/') && compareVersions(version, current) > 0) return { version, url }
  }
  return null
}
