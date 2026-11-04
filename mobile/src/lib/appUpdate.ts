// Is a newer APK on GitHub? Checked once per launch; failing quietly is fine, since being offline is
// not worth telling anyone about.
import Constants from 'expo-constants'
import { useEffect, useState } from 'react'
import { newerApk, RELEASES_URL, type AppUpdate } from '@monte/core/appUpdate'

const TIMEOUT_MS = 15_000
export const appVersion = Constants.expoConfig?.version ?? '0.0.0'

let check: Promise<AppUpdate | null> | null = null
function checkOnce() {
  check ??= fetch(RELEASES_URL, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then(res => (res.ok ? res.json() : null))
    .then(release => newerApk(release, appVersion))
    .catch(() => null)
  return check
}

export function useAppUpdate(): AppUpdate | null {
  const [update, setUpdate] = useState<AppUpdate | null>(null)
  useEffect(() => {
    let live = true
    void checkOnce().then(u => live && setUpdate(u))
    return () => {
      live = false
    }
  }, [])
  return update
}
