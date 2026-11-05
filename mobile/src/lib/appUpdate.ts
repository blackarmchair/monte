// Is a newer APK on GitHub? Checked at launch and again on return to the app once the last check is
// CHECK_EVERY_MS old; the background check (offerWatch) also looks, and notifies once per version.
// Failing quietly is fine: being offline is not worth telling anyone about.
import Constants from 'expo-constants'
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { newerApk, RELEASES_URL, type AppUpdate } from '@monte/core/appUpdate'
import { cacheRead, cacheWrite } from './storage'

const TIMEOUT_MS = 15_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const NOTIFIED_KEY = 'update-notified.txt'
export const appVersion = Constants.expoConfig?.version ?? '0.0.0'

/** One fresh look at the newest release. */
export function fetchUpdate(): Promise<AppUpdate | null> {
  return fetch(RELEASES_URL, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then(res => (res.ok ? res.json() : null))
    .then(release => newerApk(release, appVersion))
    .catch(() => null)
}

let last: { at: number; check: Promise<AppUpdate | null> } | null = null
const listeners = new Set<(u: AppUpdate | null) => void>()

function checkIfDue() {
  if (last && Date.now() - last.at < CHECK_EVERY_MS) return last.check
  const check = fetchUpdate()
  last = { at: Date.now(), check }
  void check.then(u => listeners.forEach(l => l(u)))
  return check
}

export function useAppUpdate(): AppUpdate | null {
  const [update, setUpdate] = useState<AppUpdate | null>(null)
  useEffect(() => {
    let live = true
    listeners.add(setUpdate)
    void checkIfDue().then(u => live && setUpdate(u))
    const state = AppState.addEventListener('change', s => s === 'active' && void checkIfDue())
    return () => {
      live = false
      listeners.delete(setUpdate)
      state.remove()
    }
  }, [])
  return update
}

/** A new version not yet announced, marked as announced. Null when there's nothing new to say. */
export async function unannouncedUpdate(): Promise<AppUpdate | null> {
  const u = await fetchUpdate()
  if (!u || (await cacheRead(NOTIFIED_KEY).catch(() => null)) === u.version) return null
  await cacheWrite(NOTIFIED_KEY, u.version)
  return u
}
