// App updates: the sidebar card that appears when a newer release exists, and the version row in
// Settings. The main process (src/main/updater.ts) owns the state; these only show it and ask.
import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'
import { Btn, Link } from './ui'

const releaseUrl = (version: string) => `https://github.com/blackarmchair/monte/releases/tag/v${version}`
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function useUpdate(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    void window.monte.updateState().then(setState)
    return window.monte.onUpdateChanged(setState)
  }, [])
  return state
}

/** The one button a state calls for, if any. */
function action(u: UpdateState): { label: string; run: () => void } | null {
  if (u.status === 'ready') return { label: 'Restart to update', run: () => void window.monte.installUpdate() }
  if (u.status === 'available') return { label: 'Update', run: () => void window.monte.downloadUpdate() }
  if (u.status === 'error' && u.version) return { label: 'Try again', run: () => void window.monte.downloadUpdate() }
  return null
}

const Progress = ({ percent }: { percent: number }) => (
  <div role="progressbar" aria-valuenow={percent} style={{ height: 6, borderRadius: 3, background: 'var(--surf)', overflow: 'hidden' }}>
    <div style={{ width: `${percent}%`, height: '100%', background: 'var(--acc)' }} />
  </div>
)

export function UpdateCard() {
  const u = useUpdate()
  if (!u?.version || !['available', 'downloading', 'ready', 'error'].includes(u.status)) return null
  const go = action(u)
  return (
    <div className="stack" style={{ gap: 8, padding: 12, marginBottom: 6, borderRadius: 14, background: 'var(--surf2)' }}>
      <span style={{ fontWeight: 700, fontSize: 14 }}>
        {u.status === 'ready' ? `Monte ${u.version} is ready` : u.status === 'downloading' ? `Downloading ${u.version}` : `Monte ${u.version} is out`}
      </span>
      {u.status === 'downloading' && <Progress percent={u.percent ?? 0} />}
      {u.status === 'error' && <span className="small" style={{ color: 'var(--neg)' }}>{u.error}</span>}
      {u.status === 'available' && <Link label="What's new" onClick={() => window.open(releaseUrl(u.version!))} style={{ alignSelf: 'flex-start' }} />}
      {go && <Btn size="sm" kind="primary" label={go.label} onClick={go.run} />}
    </div>
  )
}

export function UpdateRow() {
  const u = useUpdate()
  if (!u) return null
  const sub =
    u.status === 'unsupported' ? 'Updates work in the installed app.'
    : u.status === 'checking' ? 'Checking…'
    : u.status === 'available' ? `${u.version} is available.`
    : u.status === 'downloading' ? `Downloading ${u.version}: ${u.percent ?? 0}%`
    : u.status === 'ready' ? `${u.version} is ready to install.`
    : u.status === 'error' ? u.error
    : u.checkedAt ? `Up to date. Checked ${clock(u.checkedAt)}.`
    : 'Monte checks for updates when it opens.'
  const go = action(u)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 18, background: 'var(--surf)' }}>
      <span className="stack" style={{ flex: 1 }}>
        <span style={{ fontWeight: 600 }}>Version {u.current}</span>
        <span className="small mute">{sub}</span>
      </span>
      {go ? (
        <Btn size="sm" kind="primary" label={go.label} onClick={go.run} />
      ) : (
        u.status !== 'unsupported' && <Btn size="sm" label="Check for updates" disabled={u.status === 'checking' || u.status === 'downloading'} onClick={() => void window.monte.checkForUpdate()} />
      )}
    </div>
  )
}
