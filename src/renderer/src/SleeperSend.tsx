// Send in Sleeper: connect (paste the session token) if needed, confirm, sent. The offer itself
// goes out from the main process, which holds the token; see @monte/core/sleeperTrade. The connect
// step is also its own dialog, for Lineup's push, and sits inline in Settings.
import { useState } from 'react'
import type { Settings } from '@shared/types'
import type { Asset } from '@shared/tradeMath'
import { Btn, ErrorBox, Link, Notice } from './ui'

type Step = 'connect' | 'confirm' | 'sending' | 'sent'

const side = (as: Asset[]) => ({
  players: as.filter(a => a.kind === 'player').map(a => a.id),
  picks: as.filter(a => a.kind === 'pick').map(a => ({ season: a.season!, round: a.round!, originalRosterId: a.originalOwner! })),
})
const label = (a: Asset) => (a.kind === 'pick' && a.slot ? `${a.name} (${a.slot})` : a.name)

/** Connect Sleeper: paste the session token from a signed-in sleeper.com. */
export function SleeperConnect({ onDone }: { onDone: (s: Settings) => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    if (!token.trim() || busy) return
    setBusy(true)
    setError(null)
    const r = await window.monte.connectSleeper(token)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setToken('')
    onDone(r.value)
  }
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="sub" style={{ fontSize: 14 }}>
        Sleeper has no public way to send a trade, so Monte uses your Sleeper session, the way Sleeper's own website does. Sign in at sleeper.com in your browser, open
        the developer tools (F12) → Application → Local Storage → https://sleeper.com, and copy the value of <b>token</b>. Paste it here.
      </div>
      <div className="small mute">
        The token can act as you on Sleeper. Monte keeps it encrypted by your OS and uses it only for the trade offers and lineups you send from Monte. Disconnect any
        time in Settings; signing out of sleeper.com also ends it.
      </div>
      <label className="field on-surf">
        <input type="password" autoFocus placeholder="Paste the token" value={token} onChange={e => setToken(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
      </label>
      {error && <ErrorBox message={error} />}
      <div>
        <Btn kind="primary" label={busy ? 'Checking with Sleeper…' : 'Connect Sleeper'} disabled={busy || !token.trim()} onClick={go} />
      </div>
    </div>
  )
}

/** Connect Sleeper on its own, e.g. before a lineup push. */
export function ConnectModal(props: { why: string; error?: string | null; onDone: (s: Settings) => void; onClose: () => void }) {
  return (
    <div className="scrim" onMouseDown={e => e.target === e.currentTarget && props.onClose()}>
      <div className="modal wide" role="dialog" aria-label="Connect Sleeper">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div className="stack" style={{ gap: 4 }}>
            <div className="modal-title">Connect Sleeper</div>
            <div className="sub" style={{ fontSize: 14 }}>
              {props.why}
            </div>
          </div>
          <Link label="Cancel" onClick={props.onClose} />
        </div>
        {props.error && <ErrorBox message={props.error} />}
        <SleeperConnect onDone={props.onDone} />
      </div>
    </div>
  )
}

export default function SleeperSend(props: {
  settings: Settings
  hideNames: boolean
  leagueId: string
  myRosterId: number
  partnerRosterId: number
  partnerName: string
  give: Asset[]
  get: Asset[]
  /** the settings main saved (connected / disconnected), for the app's copy */
  onSettings: (s: Settings) => void
  onSent: () => void
  onClose: () => void
}) {
  const { settings, partnerName } = props
  const [step, setStep] = useState<Step>(settings.sleeperLink ? 'confirm' : 'connect')
  const [error, setError] = useState<string | null>(null)
  const [mismatch, setMismatch] = useState<string | null>(null)
  const busy = step === 'sending'

  const send = async () => {
    setStep('sending')
    setError(null)
    const r = await window.monte.proposeTrade({
      leagueId: props.leagueId,
      myRosterId: props.myRosterId,
      partnerRosterId: props.partnerRosterId,
      give: side(props.give),
      get: side(props.get),
    })
    if (r.ok) {
      setMismatch(r.value.mismatch)
      return setStep('sent')
    }
    setError(r.error)
    if (r.needsConnect) {
      // main already dropped the refused token; keep the app's settings in step
      props.onSettings(await window.monte.getSettings())
      return setStep('connect')
    }
    setStep('confirm')
  }

  const close = () => {
    if (busy) return
    if (step === 'sent') props.onSent()
    props.onClose()
  }

  const title = step === 'connect' ? 'Connect Sleeper' : step === 'sent' ? `Offer sent to ${partnerName}.` : `Send this offer to ${partnerName}?`

  return (
    <div className="scrim" onMouseDown={e => e.target === e.currentTarget && close()}>
      <div className="modal wide" role="dialog" aria-label={title}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div className="modal-title" style={step === 'sent' ? { color: 'var(--pos)' } : undefined}>
            {title}
          </div>
          <Link label={step === 'sent' ? 'Done' : 'Cancel'} disabled={busy} onClick={close} />
        </div>

        {step === 'connect' && (
          <>
            {error && <ErrorBox message={error} />}
            <SleeperConnect
              onDone={s => {
                props.onSettings(s)
                setError(null)
                setStep('confirm')
              }}
            />
          </>
        )}

        {(step === 'confirm' || step === 'sending') && (
          <div className="stack" style={{ gap: 12 }}>
            {(
              [
                ['You give', props.give],
                ['You get', props.get],
              ] as const
            ).map(([k, as]) => (
              <div key={k} className="card stack" style={{ gap: 4 }}>
                <span className="small mute">{k}</span>
                {as.map(a => (
                  <span key={a.id} style={{ fontWeight: 600 }}>
                    {label(a)}
                  </span>
                ))}
              </div>
            ))}
            <Notice message={`This goes to ${partnerName}'s manager as soon as you click Send. If your league has no trade review period, their accepting it completes the trade.`} />
            {error && <ErrorBox message={error} />}
            <Btn kind="primary" size="lg" label={busy ? 'Sending…' : 'Send offer'} disabled={busy} onClick={send} />
            {settings.sleeperLink && <div className="small mute">Sending as {props.hideNames ? 'you' : settings.sleeperLink.name || 'you'} on Sleeper.</div>}
          </div>
        )}

        {step === 'sent' && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="sub" style={{ fontSize: 14 }}>
              It's waiting in Sleeper for their answer. You can withdraw it there.
            </div>
            {mismatch && <Notice message={mismatch} />}
            <div>
              <Btn label="Open in Sleeper ↗" onClick={() => window.open(`https://sleeper.com/leagues/${props.leagueId}/trades`, '_blank')} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
