// Add an unrostered player, from his page: set a bid and who to drop, confirm, done. A free agent joins at
// once; a player on waivers becomes a claim, which This week can change or cancel.
import { useEffect, useMemo, useState } from 'react'
import { bidProblem } from '@shared/sleeperWaivers'
import type { AddResult } from '@shared/sleeperWaivers'
import type { WaiverDesk } from '@shared/waivers'
import { useApp } from './store'
import { useTrade } from './tradeModel'
import { Btn, ErrorBox, Link, Notice } from './ui'

type Step = 'edit' | 'confirm' | 'sending' | 'sent'

export default function Claim({ id, name }: { id: string; name: string }) {
  const { context, settings, settingsSaved, showToast, openSettings } = useApp()
  const x = useTrade()
  const [desk, setDesk] = useState<WaiverDesk | null>(null)
  const [step, setStep] = useState<Step>('edit')
  const [bidText, setBidText] = useState('')
  const [drop, setDrop] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<AddResult | null>(null)
  const [fixing, setFixing] = useState(false)
  const leagueId = context?.league.league_id
  const rosterId = context?.myRosterId ?? null
  const sleeperUrl = `https://sleeper.com/leagues/${leagueId}/players`
  const openSleeper = () => window.open(sleeperUrl, '_blank')

  const loadDesk = () => {
    if (!leagueId || !settings.userId) return
    void window.monte.waiverDesk(leagueId, settings.userId).then(r => {
      if (!r.ok) return
      setDesk(r.value)
      if (r.value.faab) setBidText(t => t || String(r.value.faab!.minBid))
    })
  }
  useEffect(loadDesk, [leagueId, settings.userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lowest-ranked first: the likeliest drop. Someone the sheet doesn't rank counts as lowest.
  const choices = useMemo(() => {
    const rank = (pid: string) => x.d?.ranks[pid]?.sheetRank ?? Infinity
    return [...(desk?.roster?.players ?? [])].sort((a, b) => rank(b.id) - rank(a.id))
  }, [desk, x.d])
  const full = !!desk?.roster && desk.roster.active >= desk.roster.slots
  useEffect(() => {
    if (full && !drop && choices[0]) setDrop(choices[0].id)
  }, [full, drop, choices])

  if (!settings.sleeperLink) return <Btn kind="primary" label="Connect Sleeper to add him" onClick={openSettings} />
  if (!desk || rosterId == null || !leagueId) return <Btn kind="primary" label="Add in Sleeper ↗" onClick={openSleeper} />

  const faab = desk.faab
  const bid = faab ? (bidText.trim() === '' ? null : Number(bidText)) : null
  const bad = bidProblem(bid, faab) ?? (full && !drop ? 'Your roster is full, so pick someone to drop.' : null)
  const dropName = choices.find(p => p.id === drop)?.name ?? null
  const rankLabel = (pid: string) => {
    const r = x.d?.ranks[pid]?.sheetRank
    return r == null ? 'unranked' : `#${r}`
  }
  const blockers = desk.ir?.blockers ?? []

  const fixIr = async () => {
    setFixing(true)
    setError(null)
    for (const p of blockers) {
      const r = await window.monte.moveIr({ leagueId, rosterId, playerId: p.id, to: 'bench' })
      if (!r.ok) {
        setError(r.error)
        if (r.needsConnect) settingsSaved(await window.monte.getSettings())
        break
      }
      showToast(r.value.mismatch ?? `${p.name} moved off IR`)
    }
    setFixing(false)
    loadDesk()
  }

  const send = async () => {
    setStep('sending')
    setError(null)
    const r = await window.monte.sendWaiverClaim({ leagueId, rosterId, playerId: id, bid, drop: drop || null })
    if (r.ok) {
      setDone(r.value)
      showToast(r.value.kind === 'added' ? `${name} added` : `Claim placed for ${name}`)
      return setStep('sent')
    }
    setError(r.error)
    if (r.needsConnect) settingsSaved(await window.monte.getSettings())
    setStep('edit')
  }

  if (step === 'sent' && done)
    return (
      <div className="stack" style={{ gap: 10 }}>
        <span style={{ fontWeight: 700, color: 'var(--pos)' }}>
          {done.kind === 'added' ? `${name} is on your team${dropName ? `, and ${dropName} is gone` : ''}.` : `Claim placed for ${name}.`}
        </span>
        {done.mismatch ? (
          <Notice message={done.mismatch} />
        ) : (
          <span className="sub" style={{ fontSize: 14 }}>
            {done.kind === 'added' ? 'He was a free agent, so he joined at once.' : `He's on waivers, so it processes when they run${dropName ? `, and ${dropName} leaves only if it wins` : ''}. Change the bid or cancel it on This week.`}
          </span>
        )}
        <div>
          <Btn label="Open in Sleeper ↗" onClick={openSleeper} />
        </div>
      </div>
    )

  if (step === 'confirm' || step === 'sending')
    return (
      <div className="stack" style={{ gap: 10 }}>
        <span style={{ fontWeight: 700 }}>
          Add {name}
          {dropName ? `, drop ${dropName}` : ', drop nobody'}?
        </span>
        <Notice
          message={[
            `This goes to Sleeper as soon as you click Send.`,
            `If he's a free agent, he joins your team right away${dropName ? ` and ${dropName} is dropped at once` : ''}${faab ? ', for no FAAB' : ''}.`,
            `If he's on waivers, Monte places a claim instead${faab ? ` for $${bid}` : ''}${dropName ? `, and ${dropName} leaves only if it wins` : ''}.`,
            dropName ? `A dropped player goes to waivers, where anyone can claim him.` : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
        <div className="row" style={{ gap: 8 }}>
          <Btn kind="primary" label={step === 'sending' ? 'Sending…' : 'Send'} disabled={step === 'sending'} onClick={() => void send()} />
          <Btn label="Back" disabled={step === 'sending'} onClick={() => setStep('edit')} />
        </div>
      </div>
    )

  return (
    <div className="stack" style={{ gap: 10 }}>
      {blockers.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <Notice message={`${blockers.map(p => p.name).join(' and ')} ${blockers.length === 1 ? 'is' : 'are'} on your IR but no longer ${blockers.length === 1 ? 'qualifies' : 'qualify'}, and Sleeper blocks every add and claim until ${blockers.length === 1 ? "he's" : "they're"} moved off.`} />
          <div>
            <Btn label={fixing ? 'Moving…' : `Move ${blockers.length === 1 ? blockers[0].name : 'them'} off IR`} disabled={fixing} onClick={() => void fixIr()} />
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        {faab && (
          <label className="field on-surf" style={{ width: 110, flex: 'none' }}>
            <span className="mute">$</span>
            <input inputMode="numeric" aria-label="Bid in dollars" placeholder="Bid" value={bidText} onChange={e => setBidText(e.target.value)} />
          </label>
        )}
        <label className="field on-surf" style={{ width: 300, flex: 'none' }}>
          <select aria-label="Who to drop" value={drop} onChange={e => setDrop(e.target.value)}>
            {!full && <option value="">Drop nobody</option>}
            {choices.map(p => (
              <option key={p.id} value={p.id}>
                Drop {p.name} · {p.pos} · {rankLabel(p.id)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <span className="small mute">
        {faab ? `$${faab.left} of $${faab.budget} left${desk.bids ? ` · median winning bid $${desk.bids.median}` : ''} · ` : ''}
        {desk.roster ? `${desk.roster.active} of ${desk.roster.slots} roster spots used` : ''}
        {faab ? ". The bid only counts if he's on waivers." : ''}
      </span>
      {bad && (bidText.trim() !== '' || full) && <span className="small" style={{ color: 'var(--neg)' }}>{bad}</span>}
      {error && <ErrorBox message={error} />}
      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        <Btn kind="primary" label={dropName ? `Add him, drop ${dropName}` : 'Add him, drop nobody'} disabled={!!bad || blockers.length > 0} onClick={() => setStep('confirm')} />
        <Link label="Add in Sleeper ↗" onClick={openSleeper} />
      </div>
    </div>
  )
}
