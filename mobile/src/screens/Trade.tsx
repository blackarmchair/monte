// Trade: two clear steps — pick a partner, add players to each side — with a verdict bar that
// floats above the tab bar while the trade has anything in it. "Review" opens the full read.
import { useMemo, useState } from 'react'
import { Linking, Pressable, ScrollView, Text, View } from 'react-native'
import type { Asset } from '@monte/core/tradeMath'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { assetMeta, marketTag, mineOf, useTrade, verdictText, type VerdictTone } from '@/lib/trade'
import { useOverlay } from '@/ui/overlay'
import { DivBar, ErrorBox, Kicker, Loading, NeedsSheet, PlayerAvatar, Row, Seg, Slider, T, TeamSquare, num, signed, useTopOnFocus, Btn, Notice } from '@/ui/kit'
import { FLOAT_RADIUS, font, RADIUS, useTheme, type Palette } from '@/ui/theme'
import SleeperConnect from './SleeperConnect'

const toneColor = (t: Palette, tone: VerdictTone) => (tone === 'mute' ? t.mute : t[tone])

export default function Trade() {
  const t = useTheme()
  const { sheet, tradeUi, setTradeUi, trade } = useApp()
  const { openSheet } = useOverlay()
  const x = useTrade()
  const scroll = useTopOnFocus<ScrollView>()
  const { d, res, partner, give, get, count } = x

  // Deal ideas while the trade is empty: your top assets shopped one at a time, both sides winning.
  const ideas = useMemo(() => (d && count === 0 ? x.findDeals([], 2, 3) : []), [d, count, x.assets]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sheet) return <NeedsSheet />

  const list = tradeUi.list
  const rows: Asset[] = list === 'theirs' ? (partner == null ? [] : x.assets.filter(a => a.owner === partner).sort((a, b) => mineOf(b) - mineOf(a))) : x.mine
  const inTrade = (id: string) => trade.give.includes(id) || trade.get.includes(id)
  const partnerName = partner == null ? null : x.teamName(partner)

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: count ? 108 : 32 }}>
        {res && !res.ok && (
          <View style={{ padding: 16 }}>
            <ErrorBox message={res.error} onRetry={x.load} />
          </View>
        )}
        {!res && <Loading label="Pricing every roster…" />}

        {d && (
          <>
            <Step n={1} label="Pick a trade partner" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 }}>
              {d.teams
                .filter(tm => tm.roster_id !== x.me)
                .map(tm => {
                  const on = tm.roster_id === partner
                  return (
                    <Pressable
                      key={tm.roster_id}
                      onPress={() => {
                        x.setPartner(tm.roster_id)
                        setTradeUi(() => ({ list: 'theirs' }))
                      }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        minHeight: 44,
                        maxWidth: 180,
                        paddingLeft: 6,
                        paddingRight: 12,
                        borderWidth: 1,
                        borderColor: on ? t.ink : t.line,
                        borderRadius: RADIUS,
                        backgroundColor: on ? t.card : 'transparent',
                      }}
                    >
                      <TeamSquare rid={tm.roster_id} name={tm.name} size={30} />
                      <T size={14} lines={1} style={{ flexShrink: 1 }}>
                        {tm.name}
                      </T>
                    </Pressable>
                  )
                })}
            </ScrollView>

            {count === 0 && ideas.length > 0 && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 8 }}>
                <T c="mute" size={14}>
                  Or start from a deal Monte found:
                </T>
                {ideas.map((deal, i) => {
                  const v = verdictText(deal.verdict)
                  return (
                    <Pressable
                      key={i}
                      onPress={() => {
                        x.loadDeal(deal)
                        setTradeUi(() => ({ list: 'theirs' }))
                      }}
                      style={({ pressed }) => ({
                        gap: 4,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        borderWidth: 1,
                        borderColor: t.line,
                        borderRadius: RADIUS,
                        backgroundColor: pressed ? t.card : t.card2,
                      })}
                    >
                      <Row style={{ justifyContent: 'space-between' }}>
                        <T v="small" c="mute" lines={1} style={{ flexShrink: 1 }}>
                          with {x.teamName(deal.partner)}
                        </T>
                        <T v="smallSemi" color={toneColor(t, v.tone)}>
                          {v.label}
                        </T>
                      </Row>
                      <T>
                        <T c="mute">Give</T> {deal.give.map(a => (a.kind === 'pick' && a.slot ? a.slot : a.name)).join(', ')} <T c="mute">· Get</T>{' '}
                        {deal.get.map(a => a.name).join(' + ')}
                      </T>
                    </Pressable>
                  )
                })}
              </View>
            )}

            <View style={{ borderTopWidth: 1, borderColor: t.line, paddingTop: 8 }}>
              <Step n={2} label="Add players to each side" />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 }}>
              <Side
                title="You give"
                items={give}
                empty="Tap + on your assets"
                onRemove={x.remove}
              />
              <Side
                title="You get"
                items={get}
                empty={partnerName ? `Tap + on ${partnerName}'s roster` : 'Pick a partner first'}
                onRemove={x.remove}
              />
            </View>
            <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
              <Seg
                fill
                value={list}
                onChange={v => setTradeUi(() => ({ list: v }))}
                options={[
                  { value: 'mine', label: 'Your assets' },
                  { value: 'theirs', label: partnerName ?? 'Their roster' },
                ]}
              />
            </View>
            {rows.length === 0 && (
              <T c="mute" size={14} style={{ padding: 16 }}>
                {list === 'theirs' && partner == null ? 'Pick a trade partner above to see their roster.' : 'Nothing tradeable here.'}
              </T>
            )}
            {rows.map(a => (
              <AssetLine key={a.id} a={a} on={inTrade(a.id)} onPress={() => x.toggle(a.id)} />
            ))}
            <T v="small" c="mute" style={{ padding: 16 }}>
              Your side is Tyler's sheet; theirs is the market, blended by Market influence (in Review). Verdicts use effective value: one star beats a bundle
              of the same raw total.
            </T>
          </>
        )}
      </ScrollView>

      {count > 0 && (
        <Pressable
          onPress={() => openSheet(<TradeSheet />)}
          style={({ pressed }) => ({
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            minHeight: 64,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderWidth: 1,
            borderColor: t.line,
            borderRadius: FLOAT_RADIUS,
            backgroundColor: pressed ? t.chip : t.card,
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 6 },
            elevation: 10,
          })}
          accessibilityLabel="Review trade"
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <T v="serif" size={21} color={toneColor(t, x.tone)} lines={1}>
              {x.label}
            </T>
            <T v="small" c="mute">
              You{' '}
              <Text style={{ fontFamily: font.mono, color: t.ink }}>{x.verdict ? signed(x.verdict.em) : '—'}</Text> · Them{' '}
              <Text style={{ fontFamily: font.mono, color: t.ink }}>{x.verdict ? signed(x.verdict.et) : '—'}</Text>
            </T>
          </View>
          <T v="smallSemi" size={14} c="acc">
            Review ›
          </T>
        </Pressable>
      )}
    </View>
  )
}

function Step({ n, label }: { n: number; label: string }) {
  return (
    <Row gap={8} align="baseline" style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
      <T v="monoSemi" size={12} c="acc">
        {n}
      </T>
      <T v="semi">{label}</T>
    </Row>
  )
}

function Side({ title, items, empty, onRemove }: { title: string; items: Asset[]; empty: string; onRemove: (id: string) => void }) {
  const t = useTheme()
  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 84, gap: 6, padding: 10, borderWidth: 1, borderColor: t.line, borderRadius: RADIUS, backgroundColor: t.card2 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Kicker>{title}</Kicker>
        <T v="mono" size={12} c="mute">
          {items.length ? num(items.reduce((s, a) => s + mineOf(a), 0)) : ''}
        </T>
      </Row>
      {items.length === 0 && (
        <T v="small" c="mute">
          {empty}
        </T>
      )}
      {items.map(a => (
        <Pressable
          key={a.id}
          onPress={() => onRemove(a.id)}
          accessibilityLabel={`Remove ${a.name}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: t.line, borderRadius: RADIUS, backgroundColor: t.card }}
        >
          <T v="smallSemi" size={14} lines={1} style={{ flex: 1, minWidth: 0 }}>
            {a.kind === 'pick' && a.slot ? `${a.name.split(' · ')[0]} (${a.slot})` : a.name}
          </T>
          <T c="mute">×</T>
        </Pressable>
      ))}
    </View>
  )
}

function AssetLine({ a, on, onPress }: { a: Asset; on: boolean; onPress: () => void }) {
  const t = useTheme()
  const tag = marketTag(a)
  const tagColor = tag.tone === 'acc' ? t.acc : tag.tone === 'pos' ? t.pos : t.mute
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 60,
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderColor: t.line,
        backgroundColor: on || pressed ? t.card : 'transparent',
      })}
      accessibilityLabel={`${on ? 'Remove' : 'Add'} ${a.name}`}
    >
      {a.kind === 'player' ? <PlayerAvatar id={a.id} name={a.name} /> : <View style={{ width: 32 }} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <T v="semi" size={16} lines={1}>
          {a.name}
        </T>
        <T v="small" c="mute" lines={1}>
          {assetMeta(a)} · <T v="small" color={tagColor}>{tag.label}</T>
        </T>
      </View>
      <T v="mono">{num(mineOf(a))}</T>
      <View
        style={{
          width: 36,
          height: 36,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: on ? t.ink : t.line,
          borderRadius: RADIUS,
          backgroundColor: on ? t.ink : 'transparent',
        }}
      >
        <Text style={{ fontFamily: font.sans, fontSize: 18, color: on ? t.bg : t.ink }}>{on ? '✓' : '+'}</Text>
      </View>
    </Pressable>
  )
}

type Step = 'review' | 'connect' | 'confirm' | 'sending' | 'sent'

/** Trade review: verdict, both sides' value, roster-full and fit warnings, roster value after by
 *  position, Market influence; then send it in Sleeper (connect if needed, confirm, sent). */
function TradeSheet() {
  const t = useTheme()
  const { context, settings } = useApp()
  const { closeSheet, showToast } = useOverlay()
  const x = useTrade()
  const [step, setStep] = useState<Step>('review')
  const [error, setError] = useState<string | null>(null)
  const [mismatch, setMismatch] = useState<string | null>(null)
  const v = x.verdict
  const scale = Math.max(1500, Math.abs(v?.em ?? 0), Math.abs(v?.et ?? 0))
  const maxPos = Math.max(1, ...x.groups.flatMap(g => [g.before, g.after]))
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
        <T v="title">Send this offer to {partnerName}?</T>
        {(
          [
            ['You give', x.give],
            ['You get', x.get],
          ] as const
        ).map(([k, as]) => (
          <View key={k} style={{ gap: 4 }}>
            <Kicker>{k}</Kicker>
            {as.map(a => (
              <T key={a.id} v="semi">
                {a.kind === 'pick' && a.slot ? `${a.name} (${a.slot})` : a.name}
              </T>
            ))}
          </View>
        ))}
        <Notice message={`This goes to ${partnerName}'s manager as soon as you tap Send. If your league has no trade review period, their accepting it completes the trade.`} />
        {error && <ErrorBox message={error} />}
        <Btn big full kind="primary" label={step === 'sending' ? 'Sending…' : 'Send offer'} disabled={step === 'sending'} onPress={send} />
        <Btn big full kind="quiet" label="Back" disabled={step === 'sending'} onPress={() => setStep('review')} />
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
        <T v="title" color={t.pos}>
          Offer sent to {partnerName}.
        </T>
        <T c="ink2">It's waiting in Sleeper for their answer. You can withdraw it there.</T>
        {mismatch && <Notice message={mismatch} />}
        {context && <Btn big full label="Open in Sleeper ↗" onPress={() => void Linking.openURL(`https://sleeper.com/leagues/${context.league.league_id}/trades`)} />}
        <Btn
          big
          full
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
    <View style={{ gap: 14 }}>
      <T v="title" size={28} color={toneColor(t, x.tone)}>
        {x.label}
      </T>
      <View style={{ gap: 10 }}>
        {(
          [
            ['You', v?.em ?? 0],
            ['Them', v?.et ?? 0],
          ] as const
        ).map(([k, val]) => (
          <Row key={k} gap={8}>
            <T c="mute" size={14} style={{ width: 48 }}>
              {k}
            </T>
            <DivBar v={val} scale={scale} />
            <T v="mono" size={14} style={{ width: 72, textAlign: 'right' }}>
              {v ? signed(val) : '—'}
            </T>
          </Row>
        ))}
      </View>
      {x.extra > 0 && x.d && (
        <Notice message={`Adds ${x.extra} bod${x.extra === 1 ? 'y' : 'ies'} to a full roster: someone gets cut (−${num(x.d.spotCost)} each).`} />
      )}
      {x.fitWarnings.map(w => (
        <Notice key={w} message={w} />
      ))}

      <Kicker>Your roster value after</Kicker>
      {x.groups.map(g => {
        const delta = Math.round(g.after - g.before)
        const color = delta > 0 ? t.pos : delta < 0 ? t.neg : t.mute
        return (
          <Row key={g.g} gap={8}>
            <T size={14} style={{ width: 44 }}>
              {g.g}
            </T>
            <View style={{ flex: 1, height: 10, backgroundColor: t.chip }}>
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(g.before / maxPos) * 100}%`, backgroundColor: t.mute, opacity: 0.45 }} />
              <View style={{ position: 'absolute', left: 0, top: 3, bottom: 3, width: `${(Math.max(0, g.after) / maxPos) * 100}%`, backgroundColor: delta ? color : t.ink2 }} />
            </View>
            <T v="mono" size={14} color={color} style={{ width: 64, textAlign: 'right' }}>
              {delta ? signed(delta) : '–'}
            </T>
          </Row>
        )
      })}

      <Row gap={10} style={{ paddingTop: 4 }}>
        <T c="mute" size={14}>
          Market influence
        </T>
        <Slider value={Math.round(x.beta * 100)} min={0} max={100} step={5} onChange={val => x.setBeta(val / 100)} onDone={val => x.commitBeta(val / 100)} />
        <T v="mono" size={14} style={{ width: 48, textAlign: 'right' }}>
          {Math.round(x.beta * 100)}%
        </T>
      </Row>
      <T v="small" c="mute">
        Their side is FantasyCalc's market, blended toward Tyler's sheet as you lower this: how much your league trades like the market.
      </T>
      <Row gap={8}>
        <Btn
          big
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
          big
          kind="quiet"
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
