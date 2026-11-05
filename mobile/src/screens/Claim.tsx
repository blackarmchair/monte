// Add an unrostered player, from his page: set a bid and who to drop, confirm, done. A free agent joins at
// once; a player on waivers becomes a claim, which This week can change or cancel.
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { bidProblem, type AddResult } from '@monte/core/sleeperWaivers'
import type { WaiverDesk } from '@monte/core/waivers'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { useTrade } from '@/lib/trade'
import { Btn, ErrorBox, Field, Notice, T } from '@/ui/kit'
import { useOverlay } from '@/ui/overlay'
import { useTheme } from '@/ui/theme'

type Step = 'edit' | 'confirm' | 'sending' | 'sent'
/** Drop choices shown before "Show all": the lowest-ranked, likeliest drops. */
const SHORT_LIST = 5

export default function Claim({ id, name }: { id: string; name: string }) {
  const t = useTheme()
  const { context, settings, setSettings } = useApp()
  const x = useTrade()
  const { showToast } = useOverlay()
  const [desk, setDesk] = useState<WaiverDesk | null>(null)
  const [step, setStep] = useState<Step>('edit')
  const [bidText, setBidText] = useState('')
  const [drop, setDrop] = useState<string>('')
  const [all, setAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<AddResult | null>(null)
  const [fixing, setFixing] = useState(false)
  const leagueId = context?.league.league_id
  const rosterId = context?.myRosterId ?? null
  const openSleeper = () => void Linking.openURL(`https://sleeper.com/leagues/${leagueId}/players`)

  const loadDesk = () => {
    if (!leagueId || !settings?.userId) return
    void monte.waiverDesk(leagueId, settings.userId).then(r => {
      if (!r.ok) return
      setDesk(r.value)
      if (r.value.faab) setBidText(b => b || String(r.value.faab!.minBid))
    })
  }
  useEffect(loadDesk, [leagueId, settings?.userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lowest-ranked first: the likeliest drop. Someone the sheet doesn't rank counts as lowest.
  const choices = useMemo(() => {
    const rank = (pid: string) => x.d?.ranks[pid]?.sheetRank ?? Infinity
    return [...(desk?.roster?.players ?? [])].sort((a, b) => rank(b.id) - rank(a.id))
  }, [desk, x.d])
  const full = !!desk?.roster && desk.roster.active >= desk.roster.slots
  useEffect(() => {
    if (full && !drop && choices[0]) setDrop(choices[0].id)
  }, [full, drop, choices])

  if (!settings?.sleeperLink) return <Btn full size="lg" kind="primary" label="Connect Sleeper to add him" onPress={() => router.navigate('/settings')} />
  if (!desk || rosterId == null || !leagueId) return <Btn full size="lg" kind="primary" label="Add in Sleeper ↗" onPress={openSleeper} />

  const faab = desk.faab
  const bid = faab ? (bidText.trim() === '' ? null : Number(bidText)) : null
  const bad = bidProblem(bid, faab) ?? (full && !drop ? 'Your roster is full, so pick someone to drop.' : null)
  const dropName = choices.find(p => p.id === drop)?.name ?? null
  const rankLabel = (pid: string) => {
    const r = x.d?.ranks[pid]?.sheetRank
    return r == null ? 'unranked' : `#${r}`
  }
  const blockers = desk.ir?.blockers ?? []
  const shown = all ? choices : choices.slice(0, SHORT_LIST)
  if (drop && !shown.some(p => p.id === drop)) {
    const picked = choices.find(p => p.id === drop)
    if (picked) shown.push(picked)
  }

  const fixIr = async () => {
    setFixing(true)
    setError(null)
    for (const p of blockers) {
      const r = await monte.moveIr({ leagueId, rosterId, playerId: p.id, to: 'bench' })
      if (!r.ok) {
        setError(r.error)
        if (r.needsConnect) void setSettings({ sleeperLink: undefined })
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
    const r = await monte.sendWaiverClaim({ leagueId, rosterId, playerId: id, bid, drop: drop || null })
    if (r.ok) {
      setDone(r.value)
      showToast(r.value.kind === 'added' ? `${name} added` : `Claim placed for ${name}`)
      return setStep('sent')
    }
    setError(r.error)
    if (r.needsConnect) void setSettings({ sleeperLink: undefined })
    setStep('edit')
  }

  if (step === 'sent' && done)
    return (
      <View style={{ gap: 10 }}>
        <T v="bold" color={t.pos}>
          {done.kind === 'added' ? `${name} is on your team${dropName ? `, and ${dropName} is gone` : ''}.` : `Claim placed for ${name}.`}
        </T>
        {done.mismatch ? (
          <Notice message={done.mismatch} />
        ) : (
          <T size={14} c="ink2">
            {done.kind === 'added' ? 'He was a free agent, so he joined at once.' : `He's on waivers, so it processes when they run${dropName ? `, and ${dropName} leaves only if it wins` : ''}. Change the bid or cancel it on This week.`}
          </T>
        )}
        <Btn full size="lg" label="Open in Sleeper ↗" onPress={openSleeper} />
      </View>
    )

  if (step === 'confirm' || step === 'sending')
    return (
      <View style={{ gap: 10 }}>
        <T v="bold">
          Add {name}
          {dropName ? `, drop ${dropName}` : ', drop nobody'}?
        </T>
        <Notice
          message={[
            'This goes to Sleeper as soon as you tap Send.',
            `If he's a free agent, he joins your team right away${dropName ? ` and ${dropName} is dropped at once` : ''}${faab ? ', for no FAAB' : ''}.`,
            `If he's on waivers, Monte places a claim instead${faab ? ` for $${bid}` : ''}${dropName ? `, and ${dropName} leaves only if it wins` : ''}.`,
            dropName ? 'A dropped player goes to waivers, where anyone can claim him.' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
        <Btn full size="lg" kind="primary" label={step === 'sending' ? 'Sending…' : 'Send'} disabled={step === 'sending'} onPress={() => void send()} />
        <Btn full size="lg" label="Back" disabled={step === 'sending'} onPress={() => setStep('edit')} />
      </View>
    )

  return (
    <View style={{ gap: 10 }}>
      {blockers.length > 0 && (
        <View style={{ gap: 8 }}>
          <Notice message={`${blockers.map(p => p.name).join(' and ')} ${blockers.length === 1 ? 'is' : 'are'} on your IR but no longer ${blockers.length === 1 ? 'qualifies' : 'qualify'}, and Sleeper blocks every add and claim until ${blockers.length === 1 ? "he's" : "they're"} moved off.`} />
          <Btn full label={fixing ? 'Moving…' : `Move ${blockers.length === 1 ? blockers[0].name : 'them'} off IR`} disabled={fixing} onPress={() => void fixIr()} />
        </View>
      )}
      {faab && (
        <View style={{ gap: 4 }}>
          <Field icon={<T c="mute">$</T>} value={bidText} onChangeText={setBidText} placeholder="Bid" keyboardType="number-pad" accessibilityLabel="Bid in dollars" />
          <T v="small" c="mute">
            ${faab.left} of ${faab.budget} left{desk.bids ? ` · median winning bid $${desk.bids.median}` : ''}. The bid only counts if he's on waivers.
          </T>
        </View>
      )}
      <View style={{ gap: 6 }}>
        <T v="label">{desk.roster ? `Drop · ${desk.roster.active} of ${desk.roster.slots} spots used` : 'Drop'}</T>
        {!full && <DropRow label="Nobody" sub="Keep everyone" on={drop === ''} onPress={() => setDrop('')} />}
        {shown.map(p => (
          <DropRow key={p.id} label={p.name} sub={`${p.pos} · ${p.team} · ${rankLabel(p.id)}`} on={drop === p.id} onPress={() => setDrop(p.id)} />
        ))}
        {choices.length > SHORT_LIST && <Btn kind="link" label={all ? 'Show fewer' : `Show all ${choices.length}`} onPress={() => setAll(!all)} />}
      </View>
      {!!bad && (bidText.trim() !== '' || full) && (
        <T v="small" color={t.neg}>
          {bad}
        </T>
      )}
      {error && <ErrorBox message={error} />}
      <Btn full size="lg" kind="primary" label={dropName ? `Add him, drop ${dropName}` : 'Add him, drop nobody'} disabled={!!bad || blockers.length > 0} onPress={() => setStep('confirm')} />
      <Btn kind="link" label="Add in Sleeper ↗" onPress={openSleeper} />
    </View>
  )
}

function DropRow({ label, sub, on, onPress }: { label: string; sub: string; on: boolean; onPress: () => void }) {
  const t = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: on ? t.accTint : t.surf2 }}
    >
      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: on ? t.acc : t.mute, alignItems: 'center', justifyContent: 'center' }}>{on && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.acc }} />}</View>
      <View style={{ flex: 1 }}>
        <T v="bold" size={15}>
          {label}
        </T>
        <T v="small" c="mute">
          {sub}
        </T>
      </View>
    </Pressable>
  )
}
