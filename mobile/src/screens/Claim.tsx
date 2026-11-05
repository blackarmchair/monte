// Claim an unrostered player, from his page: set a bid, confirm, sent. Claims drop nobody for now.
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Linking, View } from 'react-native'
import { bidProblem } from '@monte/core/sleeperWaivers'
import type { WaiverDesk } from '@monte/core/waivers'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { Btn, ErrorBox, Field, Notice, T } from '@/ui/kit'
import { useOverlay } from '@/ui/overlay'
import { useTheme } from '@/ui/theme'

type Step = 'edit' | 'confirm' | 'sending' | 'sent'

export default function Claim({ id, name }: { id: string; name: string }) {
  const t = useTheme()
  const { context, settings, setSettings } = useApp()
  const { showToast } = useOverlay()
  const [desk, setDesk] = useState<WaiverDesk | null>(null)
  const [step, setStep] = useState<Step>('edit')
  const [bidText, setBidText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const leagueId = context?.league.league_id
  const rosterId = context?.myRosterId ?? null
  const openSleeper = () => void Linking.openURL(`https://sleeper.com/leagues/${leagueId}/players`)

  useEffect(() => {
    if (!leagueId || !settings?.userId) return
    void monte.waiverDesk(leagueId, settings.userId).then(r => {
      if (!r.ok) return
      setDesk(r.value)
      if (r.value.faab) setBidText(String(r.value.faab.minBid))
    })
  }, [leagueId, settings?.userId])

  if (!settings?.sleeperLink) return <Btn full size="lg" kind="primary" label="Connect Sleeper to claim" onPress={() => router.navigate('/settings')} />
  if (!desk || rosterId == null || !leagueId) return <Btn full size="lg" kind="primary" label="Claim in Sleeper ↗" onPress={openSleeper} />

  const faab = desk.faab
  const bid = faab ? (bidText.trim() === '' ? null : Number(bidText)) : null
  const bad = bidProblem(bid, faab)
  const send = async () => {
    setStep('sending')
    setError(null)
    const r = await monte.sendWaiverClaim({ leagueId, rosterId, playerId: id, bid })
    if (r.ok) {
      setNote(r.value.mismatch)
      showToast(`Claim sent for ${name}`)
      return setStep('sent')
    }
    setError(r.error)
    if (r.needsConnect) void setSettings({ sleeperLink: undefined })
    setStep('edit')
  }

  if (step === 'sent')
    return (
      <View style={{ gap: 10 }}>
        <T v="bold" color={t.pos}>
          Claim sent for {name}.
        </T>
        {note ? (
          <Notice message={note} />
        ) : (
          <T size={14} c="ink2">
            It's in your pending claims and processes when waivers run. To change or cancel it, use Sleeper.
          </T>
        )}
        <Btn full size="lg" label="Open in Sleeper ↗" onPress={openSleeper} />
      </View>
    )

  if (step === 'confirm' || step === 'sending')
    return (
      <View style={{ gap: 10 }}>
        <T v="bold">
          Claim {name}
          {faab ? ` for $${bid}` : ''}? Drops nobody.
        </T>
        <Notice message={`This goes to Sleeper as soon as you tap Send.${faab ? ` If it wins, $${bid} comes out of your FAAB` : ' If it wins'} and ${name} joins your roster. Monte can't cancel it: you'd do that in Sleeper.`} />
        <Btn full size="lg" kind="primary" label={step === 'sending' ? 'Sending…' : 'Send claim'} disabled={step === 'sending'} onPress={() => void send()} />
        <Btn full size="lg" label="Back" disabled={step === 'sending'} onPress={() => setStep('edit')} />
      </View>
    )

  return (
    <View style={{ gap: 10 }}>
      {faab && (
        <View style={{ gap: 4 }}>
          <Field value={bidText} onChangeText={setBidText} placeholder="Bid" keyboardType="number-pad" accessibilityLabel="Bid in dollars" />
          <T v="small" c="mute">
            ${faab.left} of ${faab.budget} left{desk.bids ? ` · median winning bid $${desk.bids.median}` : ''}
          </T>
        </View>
      )}
      {!!bad && bidText.trim() !== '' && (
        <T v="small" color={t.neg}>
          {bad}
        </T>
      )}
      {error && <ErrorBox message={error} />}
      <Btn full size="lg" kind="primary" label="Claim him, drop nobody" disabled={!!bad} onPress={() => setStep('confirm')} />
      <Btn kind="link" label="Claim in Sleeper ↗" onPress={openSleeper} />
    </View>
  )
}
