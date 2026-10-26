import { useState } from 'react'
import { Btn, ErrorBox } from './ui'

/** First run: find the Sleeper account by username. */
export default function Onboarding({ onDone }: { onDone: (u: { user_id: string; display_name: string }) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    const r = await window.monte.findUser(name.trim())
    setBusy(false)
    if (r.ok) onDone(r.value)
    else setError(r.error)
  }

  return (
    <div className="onboard">
      <div className="onboard-box hero" style={{ padding: 32, gap: 16 }}>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.02em' }}>Monte</div>
        <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>Enter your Sleeper username to load your leagues.</div>
        <div className="sub" style={{ fontSize: 15 }}>
          Monte only reads public league data; it never asks for a password.
        </div>
        {error && <ErrorBox message={error} />}
        <label className="field on-surf" style={{ minHeight: 50 }}>
          <input autoFocus placeholder="Sleeper username" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
        </label>
        <Btn kind="primary" size="lg" label={busy ? 'Looking up…' : 'Continue'} disabled={busy || !name.trim()} onClick={submit} />
      </div>
    </div>
  )
}
