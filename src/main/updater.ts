// In-app updates from GitHub Releases, through electron-updater. It reads latest.yml from the
// newest release (see the README's release steps), compares versions, and checks the installer's
// sha512 against that file. Nothing downloads until the user asks; a downloaded update installs
// on Restart, or on the next normal quit.
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '@monte/core/types'

const RECHECK_MS = 6 * 60 * 60 * 1000

export function createUpdater(publish: (state: UpdateState) => void) {
  // Only the Windows installer ships, and an unpackaged dev run has nothing to replace.
  const supported = app.isPackaged && process.platform === 'win32'
  const current = app.getVersion()
  let state: UpdateState = { status: supported ? 'idle' : 'unsupported', current }

  const set = (next: Omit<UpdateState, 'current' | 'checkedAt'>, checkedAt = state.checkedAt) => {
    state = { ...next, current, checkedAt }
    publish(state)
  }
  const busy = () => state.status === 'downloading' || state.status === 'ready'

  /** Background checks stay quiet: being offline at launch is not worth telling anyone about. */
  async function check(manual: boolean): Promise<UpdateState> {
    if (!supported || busy()) return state
    if (manual) set({ status: 'checking', version: state.version })
    try {
      const r = await autoUpdater.checkForUpdates()
      if (busy()) return state
      const checkedAt = new Date().toISOString()
      if (r?.isUpdateAvailable) set({ status: 'available', version: r.updateInfo.version }, checkedAt)
      else set({ status: 'idle' }, checkedAt)
    } catch (e) {
      console.warn('update check failed:', e)
      if (manual) set({ status: 'error', version: state.version, error: "Couldn't reach GitHub to check for updates." })
    }
    return state
  }

  async function download(): Promise<UpdateState> {
    const version = state.version
    if (!version || busy()) return state
    set({ status: 'downloading', version, percent: 0 })
    try {
      await autoUpdater.downloadUpdate()
      set({ status: 'ready', version })
    } catch (e) {
      console.warn('update download failed:', e)
      set({ status: 'error', version, error: "The download didn't finish." })
    }
    return state
  }

  function install() {
    // Silent, because the user already chose to update; the second true relaunches Monte after.
    if (state.status === 'ready') autoUpdater.quitAndInstall(true, true)
  }

  if (supported) {
    autoUpdater.autoDownload = false
    autoUpdater.on('download-progress', p => {
      const percent = Math.floor(p.percent)
      if (state.status === 'downloading' && percent !== state.percent) set({ status: 'downloading', version: state.version, percent })
    })
    void check(false)
    setInterval(() => void check(false), RECHECK_MS)
  }

  return { state: () => state, check: () => check(true), download, install }
}
