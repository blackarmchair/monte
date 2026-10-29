// Player (a full page, pushed from anywhere a player shows): an NFL-colour hero with his headshot
// and a six-cell bio, then sticky tabs. Value: sheet against market. Stats: this season's games,
// every cell heat-coloured within its column. Trade: who has him, the one action, and a deal
// Monte found. Injury: the override that every model uses (this replaces the Overrides screen).
import { useEffect, useMemo, useState } from 'react'
import { Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useLocalSearchParams } from 'expo-router'
import { gameTable } from '@monte/core/gameLog'
import { tepBoardFor, tylerFor, tylerLabel, type ManualInjury, type PlayerInfo, type Result } from '@monte/core/types'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { marketTag, mineOf, useAddToTrade, useTrade, verdictText } from '@/lib/trade'
import AppHeader from '@/ui/AppHeader'
import { Btn, Card, ErrorBox, headshotUrl, kfmt, Loading, Row, StatTile, Stepper, T, num } from '@/ui/kit'
import { useOverlay } from '@/ui/overlay'
import { font, heat, heroGrad, nflColor, R, useTheme } from '@/ui/theme'

type Tab = 'value' | 'stats' | 'trade' | 'injury'
const TABS: Array<[Tab, string]> = [
  ['value', 'Value'],
  ['stats', 'Stats'],
  ['trade', 'Trade'],
  ['injury', 'Injury'],
]
const n1 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(1))
const sgn1 = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`

export default function Player() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={name ?? ''} />
      {!!id && <PlayerBody key={id} id={id} fallbackName={name ?? ''} />}
    </View>
  )
}

function PlayerBody({ id, fallbackName }: { id: string; fallbackName: string }) {
  const t = useTheme()
  const { context, pw, settings } = useApp()
  const { byId, me, teamName, d } = useTrade()
  const [info, setInfo] = useState<Result<PlayerInfo> | null>(null)
  const [tab, setTab] = useState<Tab>('value')
  useEffect(() => {
    let live = true
    void monte.playerInfo(id).then(r => live && setInfo(r))
    return () => {
      live = false
    }
  }, [id])

  const p = info?.ok ? info.value : null
  const asset = byId.get(id)
  const owner = asset?.owner ?? context?.rosters.find(r => r.players.includes(id))?.roster_id ?? null
  const name = p?.name ?? asset?.name ?? fallbackName
  const pos = p?.pos ?? asset?.pos ?? ''
  const nfl = p?.team ?? asset?.team ?? ''
  const exp = p?.yearsExp == null ? '' : p.yearsExp === 0 ? 'Rookie' : `${p.yearsExp} yr${p.yearsExp === 1 ? '' : 's'} exp`
  const bio: Array<[string, string]> = [
    ['Age', String(p?.age ?? asset?.age ?? '–')],
    ['Height', p?.height ? `${Math.floor(p.height / 12)}'${p.height % 12}"` : '–'],
    ['Weight', p?.weight ? `${p.weight}` : '–'],
    ['College', p?.college ?? '–'],
    ['Owner', owner == null ? 'FA' : owner === me ? 'You' : teamName(owner)],
    ['Value', asset ? kfmt(mineOf(asset)) : '–'],
  ]
  const usage = pw.result?.rows.find(r => r.player_id === id)
  // Tyler's rank, on the board that matches the league (or the one Settings picks).
  const tyler = tylerFor(p?.tyler, tepBoardFor(settings?.rankBoard, context?.league.tePremium ?? 0))
  const tylerText = p?.tyler ? tylerLabel(tyler, pos) ?? 'Not on Tyler’s board' : null

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingBottom: 28 }} stickyHeaderIndices={[1]} keyboardShouldPersistTaps="handled">
      <View style={[{ marginHorizontal: 16, borderRadius: R.heroLg, minHeight: 300, overflow: 'hidden' }, heroGrad(t, nflColor(t, nfl))]}>
        {/^\d+$/.test(id) && <HeroShot id={id} />}
        <View style={{ paddingTop: 22, paddingHorizontal: 20, maxWidth: '62%', gap: 10 }}>
          <T v="bold" size={32} style={{ lineHeight: 33, letterSpacing: -0.64 }}>
            {name}
          </T>
          <Row gap={8} wrap>
            {!!nfl && (
              <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, backgroundColor: nflColor(t, nfl) }}>
                <Text style={{ fontFamily: font.sansBold, fontSize: 13, color: '#fff' }}>{nfl}</Text>
              </View>
            )}
            <T v="bold">{pos}</T>
            {!!exp && (
              <T v="small" c="ink2">
                {exp}
              </T>
            )}
          </Row>
          {!!tylerText && (
            <View style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, backgroundColor: tyler ? t.acc : t.surf2 }}>
              <Text style={{ fontFamily: font.sansBold, fontSize: 15, color: tyler ? t.accInk : t.mute }}>{tylerText}</Text>
            </View>
          )}
        </View>
        <View
          style={{
            marginTop: 'auto',
            paddingTop: 14,
            paddingHorizontal: 20,
            paddingBottom: 18,
            flexDirection: 'row',
            flexWrap: 'wrap',
            rowGap: 12,
            backgroundColor: t.card,
            borderTopLeftRadius: R.heroLg,
            borderTopRightRadius: R.heroLg,
          }}
        >
          {bio.map(([k, v]) => (
            <View key={k} style={{ width: '33.33%', minWidth: 0, paddingRight: 8, gap: 1 }}>
              <T v="label">{k}</T>
              <T v="bold" size={16} lines={1}>
                {v}
              </T>
            </View>
          ))}
        </View>
      </View>

      <View style={{ flexDirection: 'row', paddingTop: 10, paddingHorizontal: 16, backgroundColor: t.bg }}>
        {TABS.map(([k, label]) => {
          const on = tab === k
          return (
            <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={{ flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.sansSemi, fontSize: 15, color: on ? t.ink : t.mute }}>{label}</Text>
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: on ? 3 : 1, backgroundColor: on ? t.acc : t.surf2 }} />
            </Pressable>
          )
        })}
      </View>

      <View style={{ paddingTop: 18, paddingHorizontal: 16, gap: 14 }}>
        {tab === 'value' && <ValueTab id={id} usage={usage} ranks={d?.ranks[id]} />}
        {tab === 'stats' &&
          (info == null ? <Loading label="Reading his games…" /> : !info.ok ? <ErrorBox message={info.error} /> : <StatsTab p={info.value} usage={usage?.usagePPG ?? null} proj={usage?.sleeperPPG ?? null} />)}
        {tab === 'trade' && <TradeTab id={id} name={name} owner={owner} />}
        {tab === 'injury' && <InjuryTab id={id} name={name} pos={pos} team={nfl} sleeperTag={p?.injury ?? ''} />}
      </View>
    </ScrollView>
  )
}

/** The full cut-out headshot, top right of the hero; hidden when Sleeper has none. */
function HeroShot({ id }: { id: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <Image
      source={headshotUrl(id, true)}
      style={{ position: 'absolute', right: -24, top: 8, width: 210, height: 180 }}
      contentFit="contain"
      contentPosition="right"
      cachePolicy="disk"
      onError={() => setFailed(true)}
    />
  )
}

function ValueTab({ id, usage, ranks }: { id: string; usage: { usagePPG: number | null; sleeperPPG: number | null; delta: number | null } | undefined; ranks?: { sheetRank: number | null; marketRank: number | null } }) {
  const t = useTheme()
  const { byId } = useTrade()
  const a = byId.get(id)
  if (!a)
    return (
      <>
        <T v="bold" size={19}>
          Not in the trade pool: he isn't on a roster in this league, or not on Tyler's sheet.
        </T>
        {usage && <UsageCard usage={usage} />}
      </>
    )
  const tag = marketTag(a)
  const mine = mineOf(a)
  const gap = mine > 0 ? Math.round(Math.abs(a.val / mine - 1) * 100) : 0
  const line =
    tag.label === 'Sell high'
      ? `Sell high. The market pays ${gap}% more than Tyler's sheet.`
      : tag.label === 'Undervalued'
      ? `Undervalued. The market is ${gap}% below Tyler's sheet.`
      : tag.label === 'No market'
      ? "No market price: the market source doesn't list him."
      : 'Fairly priced. Market and sheet are within 10%.'
  return (
    <>
      <T v="bold" size={19} style={{ lineHeight: 25 }}>
        {line}
      </T>
      <Row gap={8}>
        <StatTile k="Tyler's sheet" v={num(mine)} sub={ranks?.sheetRank ? `#${ranks.sheetRank} overall` : undefined} />
        <StatTile
          k="Market"
          v={a.market == null ? '—' : num(a.val)}
          color={tag.tone === 'acc' ? t.acc : tag.tone === 'pos' ? t.pos : undefined}
          sub={ranks?.marketRank ? `#${Math.round(ranks.marketRank)} overall` : undefined}
        />
      </Row>
      {usage && <UsageCard usage={usage} />}
    </>
  )
}

function UsageCard({ usage }: { usage: { usagePPG: number | null; sleeperPPG: number | null; delta: number | null } }) {
  const t = useTheme()
  const gap = usage.delta
  return (
    <Card gap={4}>
      <T v="small" c="mute">
        Usage vs projection
      </T>
      <Row style={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
        <T v="bold" size={19} num>
          {n1(usage.usagePPG)} → {n1(usage.sleeperPPG)} PPG
        </T>
        {gap != null && (
          <T v="bold" num color={gap > 0 ? t.pos : t.neg}>
            {sgn1(gap)}
          </T>
        )}
      </Row>
      {gap != null && (
        <T size={14} c="ink2">
          {gap > 0 ? 'His role earns more than Sleeper projects: room to grow.' : "He's scoring past his role: running hot."}
        </T>
      )}
    </Card>
  )
}

function StatsTab({ p, usage, proj }: { p: PlayerInfo; usage: number | null; proj: number | null }) {
  const t = useTheme()
  const tb = gameTable(p.pos, p.games)
  const cell = { height: 36, borderRadius: 8, alignItems: 'center' as const, justifyContent: 'center' as const }
  const CW = 46 // each stat column; the block scrolls sideways past the screen edge
  const gap = 5
  const label = { textAlign: 'center' as const, fontFamily: font.sansSemi, fontSize: 11, letterSpacing: 0.66, color: t.mute }
  const headH = 16
  return (
    <>
      <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <T v="bold" size={17}>
          {p.season} by week
        </T>
        <T v="small" c="mute">
          {p.pos} · PPR
        </T>
      </Row>
      {tb.rows.length === 0 ? (
        <T c="mute" size={14}>
          No games yet this season.
        </T>
      ) : (
        <View style={{ flexDirection: 'row', gap }}>
          {/* WK and OPP stay pinned while the stat columns scroll. */}
          <View style={{ gap }}>
            <View style={{ height: headH }} />
            <View style={{ flexDirection: 'row', gap, height: headH }}>
              <Text style={[label, { width: 30 }]}>WK</Text>
              <Text style={[label, { width: 46 }]}>OPP</Text>
            </View>
            {tb.rows.map(r => (
              <View key={r.week} style={{ flexDirection: 'row', gap }}>
                <View style={[cell, { width: 30 }]}>
                  <T v="semi" size={14} c="mute" num>
                    {r.week}
                  </T>
                </View>
                <View style={[cell, { width: 46 }]}>
                  <T v="medium" size={13} c="ink2">
                    {r.opp}
                  </T>
                </View>
              </View>
            ))}
            <View style={[cell, { width: 30 }]}>
              <T v="bold" size={13} c="mute">
                AVG
              </T>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={{ gap }}>
              <View style={{ flexDirection: 'row', gap, height: headH }}>
                {tb.groups.map((g, i) => (
                  <Text key={i} numberOfLines={1} style={[label, { width: g.span * CW + (g.span - 1) * gap, fontSize: 10, borderBottomWidth: 1, borderColor: t.surf2 }]}>
                    {g.label.toUpperCase()}
                  </Text>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap, height: headH }}>
                {tb.cols.map((h, j) => (
                  <Text key={j} style={[label, { width: CW }]}>
                    {h}
                  </Text>
                ))}
              </View>
              {tb.rows.map(r => (
                <View key={r.week} style={{ flexDirection: 'row', gap }}>
                  {r.cells.map((c, j) => {
                    const h = c.heat == null ? { bg: t.surf, fg: t.mute } : heat(t, c.heat)
                    return (
                      <View key={j} style={[cell, { width: CW, backgroundColor: h.bg }]}>
                        <Text style={{ fontFamily: j === 0 ? font.sansBold : font.sansSemi, fontSize: 14, color: h.fg, fontVariant: ['tabular-nums'] }}>{c.text}</Text>
                      </View>
                    )
                  })}
                </View>
              ))}
              <View style={{ flexDirection: 'row', gap }}>
                {tb.avg.map((x, j) => (
                  <View key={j} style={[cell, { width: CW, backgroundColor: t.surf }]}>
                    <Text style={{ fontFamily: font.sansBold, fontSize: 14, color: t.ink, fontVariant: ['tabular-nums'] }}>{x}</Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>
      )}
      <T v="small" c="mute">
        Brighter cells are his best weeks in that stat. Swipe for more. RK is his PPR finish at {p.pos} that week; SNP% his share of offensive snaps; FL fumbles lost.
        {usage != null ? ` Usage ${n1(usage)} PPG vs projection ${n1(proj)}.` : ''}
      </T>
    </>
  )
}

function TradeTab({ id, name, owner }: { id: string; name: string; owner: number | null }) {
  const t = useTheme()
  const { context, openTrade } = useApp()
  const x = useTrade()
  const add = useAddToTrade()
  const a = x.byId.get(id)
  const yours = owner != null && owner === x.me
  const first = name.split(' ')[0]
  const last = name.split(' ').slice(-1)[0]
  // A deal with him in it: shop him if he's yours, else the best package that lands him.
  const deal = useMemo(() => {
    if (!a) return null
    if (yours) return x.findDeals([a], 1, 1)[0] ?? null
    return x.findDeals([], 2, 40).find(dl => dl.get.some(g => g.id === id)) ?? null
  }, [a?.id, yours, x.assets]) // eslint-disable-line react-hooks/exhaustive-deps
  const v = deal && verdictText(deal.verdict)
  const line =
    owner == null
      ? `${name} is a free agent.`
      : yours
      ? `${first} is yours. ${a && marketTag(a).label === 'Sell high' ? 'Now is a good time to shop him.' : 'Hold unless the return is clear.'}`
      : `${name} is on ${x.teamName(owner)}.`
  return (
    <>
      <T v="bold" size={19} style={{ lineHeight: 25 }}>
        {line}
      </T>
      {owner != null && a ? (
        <Btn full size="lg" kind="primary" label={yours ? 'Offer him in a trade' : `Trade for ${last}`} onPress={() => add(a.id, owner, a.name)} />
      ) : owner == null && context ? (
        <Btn full size="lg" kind="primary" label="Claim in Sleeper ↗" onPress={() => void Linking.openURL(`https://sleeper.com/leagues/${context.league.league_id}/players`)} />
      ) : null}
      {deal && v && (
        <Card
          gap={4}
          onPress={() => {
            x.loadDeal(deal)
            openTrade()
          }}
        >
          <T v="small" c="mute">
            Monte found a deal{yours ? '' : ` with ${x.teamName(deal.partner)}`}
          </T>
          <T v="semi" size={16}>
            Give {deal.give.map(g => (g.kind === 'pick' && g.slot ? g.slot : g.name)).join(', ')}. Get {deal.get.map(g => g.name).join(' + ')}.
          </T>
          <T v="bold" size={14} color={v.tone === 'mute' ? t.mute : t[v.tone]}>
            {v.label}
          </T>
        </Card>
      )}
    </>
  )
}

function InjuryTab({ id, name, pos, team, sleeperTag }: { id: string; name: string; pos: string; team: string; sleeperTag: string }) {
  const t = useTheme()
  const { settings, setSettings, context } = useApp()
  const { showToast } = useOverlay()
  const injuries = settings?.injuries ?? []
  const o = injuries.find(i => i.id === id)
  const first = Math.max(1, (context?.week ?? 0) + 1)
  const [wk, setWk] = useState(Math.min(18, Math.max(first, o?.returnWeek ?? first)))
  const save = (returnWeek: number | null) => {
    const entry: ManualInjury = { id, name, pos, team, returnWeek, addedAt: new Date().toISOString() }
    void setSettings({ injuries: [...injuries.filter(i => i.id !== id), entry] })
    showToast(returnWeek == null ? `${name} out for the season` : `${name} out until week ${returnWeek}`)
  }
  const status = o
    ? o.returnWeek == null
      ? 'Out for the season (your override)'
      : `Out until week ${o.returnWeek} (your override)`
    : sleeperTag
    ? `${sleeperTag}, per Sleeper`
    : 'Healthy'
  return (
    <>
      <Card gap={4}>
        <T v="small" c="mute">
          Status Monte is using
        </T>
        <T v="bold" size={19} color={o || sleeperTag ? t.warn : t.pos}>
          {status}
        </T>
      </Card>
      <T size={14} c="ink2">
        Overrides outrank Sleeper's tag and ESPN's estimate in Pick odds, Usage and Lineup.
      </T>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}>
        <T v="semi" style={{ flex: 1 }}>
          Back in week
        </T>
        <Stepper value={wk} onDec={() => setWk(w => Math.max(first, w - 1))} onInc={() => setWk(w => Math.min(18, w + 1))} />
      </Card>
      <Row gap={8}>
        <Btn kind="primary" label="Save" onPress={() => save(wk)} style={{ flex: 1, minHeight: 48 }} />
        <Btn label="Out for season" onPress={() => save(null)} style={{ flex: 1, minHeight: 48 }} />
      </Row>
      {o && (
        <Btn
          kind="link"
          label="Clear override"
          style={{ alignSelf: 'center' }}
          onPress={() => {
            void setSettings({ injuries: injuries.filter(i => i.id !== id) })
            showToast('Override cleared')
          }}
        />
      )}
    </>
  )
}
