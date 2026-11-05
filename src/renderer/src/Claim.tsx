// Claim an unrostered player, from his page: set a bid, confirm, sent. Claims drop nobody for now.
import { useEffect, useState } from 'react'
import { bidProblem } from '@shared/sleeperWaivers'
import type { WaiverDesk } from '@shared/waivers'
import { useApp } from './store'
import { Btn, ErrorBox, Link, Notice } from './ui'

type Step = 'edit' | 'confirm' | 'sending' | 'sent'

export default function Claim({ id, name }: { id: string; name: string }) {
  const { context, settings, settingsSaved, showToast, openSettings } = useApp()
  const [desk, setDesk] = useState<WaiverDesk | null>(null)
  const [step, setStep] = useState<Step>('edit')
  const [bidText, setBidText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const leagueId = context?.league.league_id
  const rosterId = context?.myRosterId ?? null
  const sleeperUrl = `https://sleeper.com/leagues/${leagueId}/players`
  const openSleeper = () => window.open(sleeperUrl, '_blank')

  useEffect(() => {
    if (!leagueId || !settings.userId) return
    void window.monte.waiverDesk(leagueId, settings.userId).then(r => {
      if (!r.ok) return
      setDesk(r.value)
      if (r.value.faab) setBidText(String(r.value.faab.minBid))
    })
  }, [leagueId, settings.userId])

  if (!settings.sleeperLink) return <Btn kind="primary" label="Connect Sleeper to claim" onClick={openSettings} />
  if (!desk || rosterId == null || !leagueId) return <Btn kind="primary" label="Claim in Sleeper ↗" onClick={openSleeper} />

  const faab = desk.faab
  const bid = faab ? (bidText.trim() === '' ? null : Number(bidText)) : null
  const bad = bidProblem(bid, faab)
  const send = async () => {
    setStep('sending')
    setError(null)
    const r = await window.monte.sendWaiverClaim({ leagueId, rosterId, playerId: id, bid })
    if (r.ok) {
      setNote(r.value.mismatch)
      showToast(`Claim sent for ${name}`)
      return setStep('sent')
    }
    setError(r.error)
    if (r.needsConnect) settingsSaved(await window.monte.getSettings())
    setStep('edit')
  }

  if (step === 'sent')
    return (
      <div className="stack" style={{ gap: 10 }}>
        <span style={{ fontWeight: 700, color: 'var(--pos)' }}>Claim sent for {name}.</span>
        {note ? <Notice message={note} /> : <span className="sub" style={{ fontSize: 14 }}>It's in your pending claims and processes when waivers run. To change or cancel it, use Sleeper.</span>}
        <div>
          <Btn label="Open in Sleeper ↗" onClick={openSleeper} />
        </div>
      </div>
    )

  if (step === 'confirm' || step === 'sending')
    return (
      <div className="stack" style={{ gap: 10 }}>
        <span style={{ fontWeight: 700 }}>
          Claim {name}{faab ? ` for $${bid}` : ''}? Drops nobody.
        </span>
        <Notice message={`This goes to Sleeper as soon as you click Send.${faab ? ` If it wins, $${bid} comes out of your FAAB` : ' If it wins'} and ${name} joins your roster. Monte can't cancel it: you'd do that in Sleeper.`} />
        <div className="row" style={{ gap: 8 }}>
          <Btn kind="primary" label={step === 'sending' ? 'Sending…' : 'Send claim'} disabled={step === 'sending'} onClick={() => void send()} />
          <Btn label="Back" disabled={step === 'sending'} onClick={() => setStep('edit')} />
        </div>
      </div>
    )

  return (
    <div className="stack" style={{ gap: 10 }}>
      {faab && (
        <div className="row" style={{ gap: 12 }}>
          <label className="field on-surf" style={{ width: 120, flex: 'none' }}>
            <input inputMode="numeric" aria-label="Bid in dollars" placeholder="Bid" value={bidText} onChange={e => setBidText(e.target.value)} />
          </label>
          <span className="small mute">
            ${faab.left} of ${faab.budget} left{desk.bids ? ` · median winning bid $${desk.bids.median}` : ''}
          </span>
        </div>
      )}
      {bad && bidText.trim() !== '' && <span className="small" style={{ color: 'var(--neg)' }}>{bad}</span>}
      {error && <ErrorBox message={error} />}
      <div className="row" style={{ gap: 14 }}>
        <Btn kind="primary" label="Claim him, drop nobody" disabled={!!bad} onClick={() => setStep('confirm')} />
        <Link label="Claim in Sleeper ↗" onClick={openSleeper} />
      </div>
    </div>
  )
}
