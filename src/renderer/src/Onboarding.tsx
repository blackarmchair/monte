import { useState } from 'react'
import { InlineError, Logo } from './ui'

export default function Onboarding({ onDone }: { onDone: (u: { user_id: string; display_name: string }) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    const r = await window.monte.findUser(name)
    setBusy(false)
    if (r.ok) onDone(r.value)
    else setError(r.error)
  }

  return (
    <div className="onboard">
      <div className="onboard-box panel">
        <div className="brand">
          <Logo />
          <div>
            <div className="wordmark">Monte</div>
            <small>dynasty desk</small>
          </div>
        </div>
        <p>Enter your Sleeper username. Monte only reads public league data; it never asks for a password.</p>
        {error && <InlineError message={error} />}
        <form onSubmit={submit}>
          <input autoFocus placeholder="Sleeper username" value={name} onChange={e => setName(e.target.value)} />
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Looking up…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
