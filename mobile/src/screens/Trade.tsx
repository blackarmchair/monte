// Trade: who you're trading with (tap to change), deal ideas while the trade is empty, then
// You give and You get as asset cards, each with an "Add from …" picker. A verdict bar floats
// above the tab bar while the trade has anything in it; Review opens the full read and the send.
import { useMemo, useState } from 'react'
import { Linking, Pressable, ScrollView, Text, View } from 'react-native'
import type { Asset } from '@monte/core/tradeMath'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { assetMeta, marketTag, mineOf, useTrade, verdictText, type VerdictTone } from '@/lib/trade'
import { Btn, Card, Check, ErrorBox, GradCard, Headshot, HeatTiles, kfmt, Loading, NeedsSheet, Notice, Row, Section, Slider, StatTile, Stack2, T, TeamAvatar, num, signed, useTopOnFocus } from '@/ui/kit'
import { useOverlay } from '@/ui/overlay'
import { font, heat, nflColor, R, teamColor, useTheme, type Palette } from '@/ui/theme'
import SleeperConnect from './SleeperConnect'

const toneColor = (t: Palette, tone: VerdictTone) => t[tone]
/** Position change in the review that reads as fully good or bad. */
const POS_SCALE = 8000

/** Players carry their NFL colour; picks their original team's. */
const assetColor = (t: Palette, a: Asset) => (a.kind === 'pick' ? teamColor(a.originalOwner ?? 1) : nflColor(t, a.team))
const assetName = (a: Asset) => (a.kind === 'pick' && a.slot ? `${a.name.split(' · ')[0]} (${a.slot})` : a.name)

export default function Trade() {
  const t = useTheme()
  const { sheet, openPlayer } = useApp()
  const { openSheet } = useOverlay()
  const x = useTrade()
  const scroll = useTopOnFocus<ScrollView>()
  const { d, res, partner, give, get, count } = x

  // Deal ideas while the trade is empty: your top assets shopped one at a time, both sides winning.
  const ideas = useMemo(() => (d && count === 0 ? x.findDeals([], 2, 3) : []), [d, count, x.assets]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sheet) return <NeedsSheet />

  const partnerName = partner == null ? null : x.teamName(partner)
  const sides = [
    { title: 'You give', items: give, add: 'Add from your roster', ok: true, open: () => openSheet(<PickerSheet side="give" />) },
    {
      title: 'You get',
      items: get,
      add: partnerName ? `Add from ${partnerName}` : 'Choose a team first',
      ok: partner != null,
      open: () => openSheet(partner != null ? <PickerSheet side="get" /> : <PartnerSheet />),
    },
  ]

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView ref={scroll} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: count ? 110 : 28, gap: 20 }}>
        {res && !res.ok && <ErrorBox message={res.error} onRetry={x.load} />}
        {!res && <Loading label="Pricing every roster…" />}

        {d && (
          <>
            <GradCard color={partner != null ? teamColor(partner) : null} minHeight={72} onPress={() => openSheet(<PartnerSheet />)} style={{ borderRadius: 18, paddingHorizontal: 16 }}>
              {partner != null && <TeamAvatar rid={partner} name={partnerName ?? ''} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <T v="small" c="ink2">
                  Trading with
                </T>
                <T v="bold" size={18} lines={1}>
                  {partnerName ?? 'Choose a team'}
                </T>
              </View>
              <T v="semi" size={14} c="acc">
                Change
              </T>
            </GradCard>

            {count === 0 && ideas.length > 0 && (
              <View style={{ gap: 8 }}>
                <Section title="Deals Monte found" />
                {ideas.map((deal, i) => {
                  const v = verdictText(deal.verdict)
                  return (
                    <Card key={i} gap={6} onPress={() => x.loadDeal(deal)}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <T v="small" c="mute" lines={1} style={{ flexShrink: 1 }}>
                          with {x.teamName(deal.partner)}
                        </T>
                        <T v="bold" size={13} color={toneColor(t, v.tone)}>
                          {v.label}
                        </T>
                      </Row>
                      <T v="semi" size={16}>
                        Give {deal.give.map(a => (a.kind === 'pick' && a.slot ? a.slot : a.name)).join(', ')}. Get {deal.get.map(a => a.name).join(' + ')}.
                      </T>
                    </Card>
                  )
                })}
              </View>
            )}

            {sides.map(s => (
              <View key={s.title} style={{ gap: 8 }}>
                <Section
                  title={s.title}
                  right={
                    <T size={14} c="mute" num>
                      {s.items.length ? num(s.items.reduce((sum, a) => sum + mineOf(a), 0)) : ''}
                    </T>
                  }
                />
                {s.items.map(a => (
                  <AssetCard key={a.id} a={a} onOpen={a.kind === 'player' ? () => openPlayer(a.id, a.name) : undefined} onRemove={() => x.remove(a.id)} />
                ))}
                <Pressable
                  onPress={s.open}
                  style={({ pressed }) => ({ minHeight: 52, borderRadius: R.card, backgroundColor: t.surf, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: pressed ? 0.8 : 1 })}
                >
                  <Text style={{ fontFamily: font.sans, fontSize: 20, lineHeight: 22, color: s.ok ? t.ink : t.mute }}>+</Text>
                  <Text style={{ fontFamily: font.sansSemi, fontSize: 15, color: s.ok ? t.ink : t.mute }}>{s.add}</Text>
                </Pressable>
              </View>
            ))}
            <T v="small" c="mute">
              Your side is Tyler's sheet; theirs is the market, blended by Market influence (in Review). Verdicts use effective value: one star beats a bundle of the
              same raw total.
            </T>
          </>
        )}
      </ScrollView>

      {count > 0 && (
        <View
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            minHeight: 68,
            paddingVertical: 10,
            paddingLeft: 18,
            paddingRight: 10,
            borderRadius: 22,
            backgroundColor: t.surf2,
            shadowColor: '#000',
            shadowOpacity: 0.4,
            shadowRadius: 30,
            shadowOffset: { width: 0, height: 10 },
            elevation: 12,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <T v="bold" size={18} color={toneColor(t, x.tone)} lines={1}>
              {x.label}
            </T>
            <T v="small" c="ink2" num>
              You {x.verdict ? signed(x.verdict.em) : '—'} · Them {x.verdict ? signed(x.verdict.et) : '—'}
            </T>
          </View>
          <Btn kind="primary" label="Review" onPress={() => openSheet(<TradeSheet />)} style={{ minHeight: 46 }} />
        </View>
      )}
    </View>
  )
}

function AssetFace({ a, size = 42 }: { a: Asset; size?: number }) {
  const t = useTheme()
  if (a.kind === 'player') return <Headshot id={a.id} name={a.name} size={size} />
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.surf2, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: font.sansBold, fontSize: 12, color: t.ink2 }}>R{a.round}</Text>
    </View>
  )
}

function AssetCard({ a, onOpen, onRemove }: { a: Asset; onOpen?: () => void; onRemove: () => void }) {
  const t = useTheme()
  return (
    <GradCard color={assetColor(t, a)} minHeight={64} style={{ paddingVertical: 8, paddingLeft: 12, paddingRight: 6 }}>
      <AssetFace a={a} />
      <Pressable onPress={onOpen} disabled={!onOpen} style={{ flex: 1, minWidth: 0 }} accessibilityLabel={onOpen ? `Open ${a.name}` : undefined}>
        <Stack2 title={assetName(a)} sub={assetMeta(a)} />
      </Pressable>
      <T v="bold" num>
        {num(mineOf(a))}
      </T>
      <Pressable onPress={onRemove} hitSlop={4} accessibilityLabel={`Remove ${a.name}`} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: font.sans, fontSize: 20, color: t.mute }}>×</Text>
      </Pressable>
    </GradCard>
  )
}

/** Trade with: every other team; the current partner is checked. */
function PartnerSheet() {
  const x = useTrade()
  const { closeSheet } = useOverlay()
  return (
    <View style={{ gap: 8 }}>
      <T v="bold" size={20} style={{ paddingBottom: 4 }}>
        Trade with
      </T>
      {(x.d?.teams ?? [])
        .filter(tm => tm.roster_id !== x.me)
        .map(tm => (
          <GradCard
            key={tm.roster_id}
            color={teamColor(tm.roster_id)}
            minHeight={62}
            onPress={() => {
              x.setPartner(tm.roster_id)
              closeSheet()
            }}
          >
            <TeamAvatar rid={tm.roster_id} name={tm.name} size={42} />
            <Stack2 title={tm.name} sub={`${tm.wins}-${tm.losses}${tm.full ? ' · roster full' : ''}`} />
            <Check on={tm.roster_id === x.partner} />
          </GradCard>
        ))}
    </View>
  )
}

/** Add from a roster: check assets in and out of the trade, then Done. */
function PickerSheet({ side }: { side: 'give' | 'get' }) {
  const t = useTheme()
  const x = useTrade()
  const { trade } = useApp()
  const { closeSheet } = useOverlay()
  const rows = side === 'give' ? x.mine : x.assets.filter(a => a.owner === x.partner).sort((a, b) => mineOf(b) - mineOf(a))
  const on = (id: string) => trade.give.includes(id) || trade.get.includes(id)
  return (
    <View style={{ gap: 8 }}>
      <T v="bold" size={20} style={{ paddingBottom: 4 }}>
        {side === 'give' ? 'Your roster' : x.teamName(x.partner)}
      </T>
      {rows.length === 0 && (
        <T c="mute" size={14}>
          Nothing tradeable here.
        </T>
      )}
      {rows.map(a => {
        const tag = marketTag(a)
        return (
          <GradCard key={a.id} color={assetColor(t, a)} minHeight={62} onPress={() => x.toggle(a.id)} accessibilityLabel={`${on(a.id) ? 'Remove' : 'Add'} ${a.name}`}>
            <AssetFace a={a} />
            <Stack2 title={assetName(a)} sub={`${assetMeta(a)}${tag.label !== 'No market' ? ` · ${tag.label}` : ''}`} />
            <T v="bold" size={14} num>
              {kfmt(mineOf(a))}
            </T>
            <Check on={on(a.id)} off={t.surf2} />
          </GradCard>
        )
      })}
      <Btn full size="lg" kind="primary" label="Done" onPress={closeSheet} style={{ marginTop: 8 }} />
    </View>
  )
}

type Step = 'review' | 'connect' | 'confirm' | 'sending' | 'sent'

/** Trade review: verdict, both sides' value, roster-full and fit warnings, your roster by
 *  position after, Market influence; then send it in Sleeper (connect if needed, confirm, sent). */
function TradeSheet() {
  const t = useTheme()
  const { context, settings } = useApp()
  const { closeSheet, showToast } = useOverlay()
  const x = useTrade()
  const [step, setStep] = useState<Step>('review')
  const [error, setError] = useState<string | null>(null)
  const [mismatch, setMismatch] = useState<string | null>(null)
  const v = x.verdict
  const partnerName = x.teamName(x.partner)
  const canSend = !!v && x.partner != null && x.me != null && !!context

  const send = async () => {
    if (!canSend) return
    setStep('sending')
    setError(null)
    const side = (as: Asset[]) => ({
      players: as.filter(a => a.kind === 'player').map(a => a.id),
      picks: as.filter(a => a.kind === 'pick').map(a => ({ season: a.season!, round: a.round!, originalRosterId: a.originalOwner! })),
    })
    const r = await monte.proposeTrade({ leagueId: context!.league.league_id, myRosterId: x.me!, partnerRosterId: x.partner!, give: side(x.give), get: side(x.get) })
    if (r.ok) {
      setMismatch(r.value.mismatch)
      return setStep('sent')
    }
    setError(r.error)
    setStep(r.needsConnect ? 'connect' : 'confirm')
  }

  if (step === 'connect')
    return (
      <View style={{ gap: 14 }}>
        <T v="title">Connect Sleeper</T>
        {error && <ErrorBox message={error} />}
        <SleeperConnect
          onDone={() => {
            setError(null)
            setStep('confirm')
          }}
        />
        <Btn kind="link" label="Back to the trade" onPress={() => setStep('review')} />
      </View>
    )

  if (step === 'confirm' || step === 'sending')
    return (
      <View style={{ gap: 14 }}>
        <T v="head">Send this offer to {partnerName}?</T>
        {(
          [
            ['You give', x.give],
            ['You get', x.get],
          ] as const
        ).map(([k, as]) => (
          <Card key={k} gap={4}>
            <T v="small" c="mute">
              {k}
            </T>
            {as.map(a => (
              <T key={a.id} v="semi">
                {assetName(a)}
              </T>
            ))}
          </Card>
        ))}
        <Notice message={`This goes to ${partnerName}'s manager as soon as you tap Send. If your league has no trade review period, their accepting it completes the trade.`} />
        {error && <ErrorBox message={error} />}
        <Btn full size="lg" kind="primary" label={step === 'sending' ? 'Sending…' : 'Send offer'} disabled={step === 'sending'} onPress={send} />
        <Btn full size="lg" label="Back" disabled={step === 'sending'} onPress={() => setStep('review')} />
        {!!settings?.sleeperLink && (
          <T v="small" c="mute">
            Sending as {settings.sleeperLink.name || 'you'} on Sleeper.
          </T>
        )}
      </View>
    )

  if (step === 'sent')
    return (
      <View style={{ gap: 14 }}>
        <T v="head" color={t.pos}>
          Offer sent to {partnerName}.
        </T>
        <T c="ink2">It's waiting in Sleeper for their answer. You can withdraw it there.</T>
        {mismatch && <Notice message={mismatch} />}
        {context && <Btn full size="lg" label="Open in Sleeper ↗" onPress={() => void Linking.openURL(`https://sleeper.com/leagues/${context.league.league_id}/trades`)} />}
        <Btn
          full
          size="lg"
          kind="primary"
          label="Done"
          onPress={() => {
            x.clear()
            closeSheet()
            showToast(`Offer sent to ${partnerName}`)
          }}
        />
      </View>
    )

  return (
    <View style={{ gap: 16 }}>
      <T v="bold" size={28} color={toneColor(t, x.tone)} style={{ lineHeight: 31 }}>
        {x.label}
      </T>
      <Row gap={8}>
        <StatTile k="You" v={v ? signed(v.em) : '—'} color={v ? (v.em >= 0 ? t.pos : t.neg) : undefined} />
        <StatTile k="Them" v={v ? signed(v.et) : '—'} color={v ? (v.et >= 0 ? t.pos : t.neg) : undefined} />
      </Row>
      {x.extra > 0 && x.d && (
        <Notice message={`You take on ${x.extra} extra player${x.extra === 1 ? '' : 's'} on a full roster, so someone gets cut (−${num(x.d.spotCost)} each).`} />
      )}
      {x.fitWarnings.map(w => (
        <Notice key={w} message={w} />
      ))}

      <T v="bold" size={16}>
        Your roster after
      </T>
      <HeatTiles
        size={14}
        items={x.groups.map(g => {
          const delta = Math.round(g.after - g.before)
          return {
            k: g.g,
            v: delta ? `${delta > 0 ? '+' : '−'}${kfmt(Math.abs(delta))}` : '–',
            colors: delta ? heat(t, 0.5 + Math.max(-0.5, Math.min(0.5, delta / POS_SCALE))) : { bg: t.surf, fg: t.mute },
          }
        })}
      />

      <Row gap={10}>
        <T size={14} c="ink2">
          Market influence
        </T>
        <Slider value={Math.round(x.beta * 100)} min={0} max={100} step={5} onChange={val => x.setBeta(val / 100)} onDone={val => x.commitBeta(val / 100)} />
        <T v="bold" size={14} num style={{ width: 44, textAlign: 'right' }}>
          {Math.round(x.beta * 100)}%
        </T>
      </Row>
      <T v="small" c="mute">
        Their side is FantasyCalc's market, blended toward Tyler's sheet as you lower this: how much your league trades like the market.
      </T>
      <Row gap={8}>
        <Btn
          size="lg"
          kind="primary"
          label="Send in Sleeper"
          disabled={!canSend}
          style={{ flex: 1 }}
          onPress={() => {
            setError(null)
            setStep(settings?.sleeperLink ? 'confirm' : 'connect')
          }}
        />
        <Btn
          size="lg"
          label="Clear"
          onPress={() => {
            x.clear()
            closeSheet()
          }}
        />
      </Row>
    </View>
  )
}
