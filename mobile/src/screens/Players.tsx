// Players: search and the usage board in one tab. Values = Tyler's superflex board for this
// league, each player with his value and market read; Usage vs projection = PWOPR. Swipe a row
// left for its action, long-press to drop him straight into the trade, tap for his sheet.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, FlatList, Linking, PanResponder, Pressable, ScrollView, Text, View } from 'react-native'
import type { RanksData, Result } from '@monte/core/types'
import { teamLabel } from '@monte/core/names'
import { value as rankValue } from '@monte/core/tradeMath'
import { monte } from '@/lib/monte'
import { useApp, type PlayersUi } from '@/lib/store'
import { marketTag, mineOf, useAddToTrade, useTrade } from '@/lib/trade'
import { Icon } from '@/ui/icons'
import { ErrorBox, Field, Loading, NeedsSheet, Pills, PlayerAvatar, Seg, T, num, useTopOnFocus } from '@/ui/kit'
import { useOverlay } from '@/ui/overlay'
import { font, useTheme } from '@/ui/theme'
import PlayerSheet, { type PlayerRef } from './PlayerSheet'

/** usage gap (PPG) at which a player reads as Buy or Sell; the desktop's default */
const SIGNAL = 3
const ACTION_W = 112
const OWNERS: Array<{ value: PlayersUi['own']; label: string }> = ['Everyone', 'Mine', 'Others', 'FA'].map(v => ({ value: v as PlayersUi['own'], label: v }))

type Line = {
  key: string
  ref: PlayerRef
  rank: number
  meta: string
  v: string
  vColor?: string
  tag: string
  tagColor: string
  /** trade asset id, when he can be traded */
  assetId: string | null
}

export default function Players() {
  const t = useTheme()
  const { context, settings, sheet, hide, dataVersion, playersUi: ui, setPlayersUi, pw, runPW } = useApp()
  const { byId, me } = useTrade()
  const { openSheet, showToast } = useOverlay()
  const add = useAddToTrade()
  const list = useTopOnFocus<FlatList<Line>>()
  const [res, setRes] = useState<Result<RanksData> | null>(null)
  const [swiped, setSwiped] = useState<string | null>(null)
  const leagueId = context?.league.league_id
  const set = (patch: Partial<PlayersUi>) => {
    setSwiped(null)
    setPlayersUi(u => ({ ...u, ...patch }))
  }

  useEffect(() => {
    if (!leagueId || !settings?.userId || !sheet) return
    let live = true
    setRes(null)
    void monte.ranks(leagueId, settings.userId).then(r => live && setRes(r))
    return () => {
      live = false
    }
  }, [leagueId, settings?.userId, dataVersion, !!sheet]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ui.mode === 'usage' && context && !pw.result && !pw.busy && !pw.error) runPW()
  }, [ui.mode, leagueId]) // eslint-disable-line react-hooks/exhaustive-deps

  const ranks = res?.ok ? res.value : null
  const ownerOf = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of context?.rosters ?? []) for (const p of r.players) m.set(p, r.roster_id)
    return m
  }, [context])
  const teamNames = useMemo(() => new Map(ranks?.teams.map(x => [x.roster_id, x.name])), [ranks])
  const ownerName = (rid: number | null | undefined) => (rid == null ? 'FA' : rid === me ? 'You' : hide ? teamLabel(rid) : teamNames.get(rid) ?? teamLabel(rid))
  const ownOk = (rid: number | null | undefined) =>
    ui.own === 'Everyone' || (ui.own === 'Mine' ? rid === me : ui.own === 'FA' ? rid == null : rid != null && rid !== me)

  const lines = useMemo((): Line[] => {
    const q = ui.q.trim().toLowerCase()
    if (ui.mode === 'value') {
      if (!ranks) return []
      // The board that matches the league: TE-premium leagues get the TE-prem block.
      const board = ranks.boards[Math.max(0, ranks.boards.findIndex(b => b.tep === ranks.tePremium > 0))]
      const teAdj = 1 + 0.25 * (ranks.tePremium - 0.75)
      return (board?.rows ?? [])
        .filter(r => r.id && (ui.pos === 'All' || r.pos === ui.pos) && ownOk(r.owner) && (!q || r.name.toLowerCase().includes(q)))
        .map(r => {
          const a = byId.get(r.id!)
          const tag = a ? marketTag(a) : null
          // Free agents aren't trade assets: Tyler's rank through the same value curve.
          const v = a ? mineOf(a) : rankValue(r.rank) * (r.pos === 'TE' ? teAdj : 1)
          return {
            key: r.id!,
            ref: { id: r.id!, name: r.name, pos: r.pos, team: r.team, age: r.age, owner: r.owner },
            rank: r.rank,
            meta: [r.pos, r.team, r.age, ownerName(r.owner)].filter(x => x != null && x !== '').join(' · '),
            v: num(v),
            tag: tag ? tag.label : r.owner == null ? 'Free agent' : '',
            tagColor: tag?.tone === 'acc' ? t.acc : tag?.tone === 'pos' ? t.pos : t.mute,
            assetId: a ? a.id : null,
          }
        })
    }
    const rows = pw.result?.rows ?? []
    return rows
      .filter(r => r.delta != null && (ui.pos === 'All' || r.pos === ui.pos) && ownOk(ownerOf.get(r.player_id)) && (!q || r.name.toLowerCase().includes(q)))
      .sort((a, b) => b.delta! - a.delta!)
      .map((r, i) => {
        const owner = ownerOf.get(r.player_id) ?? null
        const d = r.delta!
        const sig = d >= SIGNAL ? 'Buy' : d <= -SIGNAL ? 'Sell' : 'Hold'
        return {
          key: r.player_id,
          ref: { id: r.player_id, name: r.name, pos: r.pos, team: r.team, age: null, owner },
          rank: i + 1,
          meta: `${r.pos} · ${r.team} · ${ownerName(owner)} · ${r.usagePPG?.toFixed(1) ?? '—'} → ${r.sleeperPPG?.toFixed(1) ?? '—'}`,
          v: `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)}`,
          vColor: d > 0 ? t.pos : t.neg,
          tag: sig,
          tagColor: sig === 'Buy' ? t.pos : sig === 'Sell' ? t.acc : t.mute,
          assetId: byId.has(r.player_id) ? r.player_id : null,
        }
      })
  }, [ui, ranks, pw.result, byId, ownerOf, me, hide, teamNames, t]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sheet) return <NeedsSheet />

  const act = (l: Line) => {
    setSwiped(null)
    if (l.ref.owner == null) {
      if (context) void Linking.openURL(`https://sleeper.com/leagues/${context.league.league_id}/players`)
      return
    }
    if (!l.assetId) return showToast(`${l.ref.name} isn't in the trade pool.`)
    add(l.assetId, l.ref.owner, l.ref.name)
  }
  const usage = ui.mode === 'usage'
  const note = usage
    ? pw.result
      ? `${lines.length} players · usage PPG weeks ${pw.result.usageWeeks[0]}–${pw.result.usageWeeks[pw.result.usageWeeks.length - 1]} vs Sleeper projection`
      : ''
    : ranks
    ? `${lines.length} players · values from ${ranks.sheet.name}`
    : ''

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, gap: 10, backgroundColor: t.bg, borderBottomWidth: 1, borderColor: t.line }}>
        <Field
          icon={<Icon name="search" size={18} color={t.mute} stroke={1.8} />}
          value={ui.q}
          onChangeText={q => set({ q })}
          placeholder="Search players"
          returnKeyType="search"
          boxStyle={{ minHeight: 46 }}
        />
        <Seg
          fill
          value={ui.mode}
          onChange={mode => set({ mode, pos: mode === 'usage' && !['All', 'WR', 'TE'].includes(ui.pos) ? 'All' : ui.pos })}
          options={[
            { value: 'value', label: 'Values' },
            { value: 'usage', label: 'Usage vs projection' },
          ]}
        />
        <FilterRow>
          <Pills bare value={ui.pos} onChange={pos => set({ pos })} options={(usage ? ['All', 'WR', 'TE'] : ['All', 'QB', 'RB', 'WR', 'TE']).map(v => ({ value: v, label: v }))} />
          <View style={{ width: 1, alignSelf: 'stretch', marginVertical: 6, backgroundColor: t.line }} />
          <Pills bare value={ui.own} onChange={own => set({ own })} options={OWNERS} />
        </FilterRow>
      </View>

      <FlatList
        ref={list}
        data={lines}
        keyExtractor={l => l.key}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        windowSize={11}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListHeaderComponent={
          <View>
            {!usage && res && !res.ok && (
              <View style={{ padding: 16 }}>
                <ErrorBox message={res.error} />
              </View>
            )}
            {usage && pw.error && (
              <View style={{ padding: 16 }}>
                <ErrorBox message={`Usage board failed: ${pw.error}`} onRetry={runPW} />
              </View>
            )}
            {((!usage && !res) || (usage && !pw.result && pw.busy)) && <Loading label={usage ? 'Building the usage board…' : 'Reading the board…'} />}
            {!!note && (
              <T v="small" c="mute" style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
                {note}
              </T>
            )}
          </View>
        }
        ListEmptyComponent={
          (usage ? pw.result : ranks) ? (
            <T c="mute" size={14} style={{ padding: 16 }}>
              No players match.
            </T>
          ) : null
        }
        ListFooterComponent={
          lines.length ? (
            <T v="small" c="mute" style={{ padding: 16, textAlign: 'center' }}>
              Swipe left or long-press a player to add them to a trade.
            </T>
          ) : null
        }
        renderItem={({ item: l }) => (
          <SwipeRow
            open={swiped === l.key}
            onOpen={() => setSwiped(l.key)}
            onClose={() => swiped === l.key && setSwiped(null)}
            action={l.ref.owner == null ? 'Claim' : l.ref.owner === me ? 'Offer' : 'Trade for'}
            onAction={() => act(l)}
            onPress={() => (swiped ? setSwiped(null) : openSheet(<PlayerSheet player={l.ref} />))}
            onLongPress={() => (l.ref.owner == null ? showToast(`${l.ref.name} is a free agent: claim him in Sleeper.`) : act(l))}
          >
            <T v="mono" size={13} c="mute" style={{ width: 28 }}>
              {l.rank}
            </T>
            <PlayerAvatar id={l.ref.id} name={l.ref.name} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T v="semi" size={16} lines={1}>
                {l.ref.name}
              </T>
              <T v="small" c="mute" lines={1}>
                {l.meta}
              </T>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <T v="monoSemi" size={16} color={l.vColor}>
                {l.v}
              </T>
              {!!l.tag && (
                <Text style={{ fontFamily: font.sansMed, fontSize: 12, color: l.tagColor }}>{l.tag}</Text>
              )}
            </View>
          </SwipeRow>
        )}
      />
    </View>
  )
}

function FilterRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6 }}>
      {children}
    </ScrollView>
  )
}

/**
 * A row that slides left to show one action. Horizontal drags past 8px belong to the row (the
 * list keeps vertical ones); release past halfway snaps open. Taps and long-presses go to the row.
 */
function SwipeRow(props: {
  open: boolean
  onOpen: () => void
  onClose: () => void
  action: string
  onAction: () => void
  onPress: () => void
  onLongPress: () => void
  children: ReactNode
}) {
  const t = useTheme()
  const x = useRef(new Animated.Value(0)).current
  const base = useRef(0)
  const cb = useRef(props)
  cb.current = props

  useEffect(() => {
    base.current = props.open ? -ACTION_W : 0
    Animated.timing(x, { toValue: base.current, duration: 200, useNativeDriver: true }).start()
  }, [props.open]) // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => x.setValue(Math.max(-ACTION_W - 18, Math.min(0, base.current + g.dx))),
      onPanResponderRelease: (_, g) => {
        const end = base.current + g.dx
        const open = end < -ACTION_W / 2
        base.current = open ? -ACTION_W : 0
        Animated.timing(x, { toValue: base.current, duration: 200, useNativeDriver: true }).start()
        if (open) cb.current.onOpen()
        else cb.current.onClose()
      },
      onPanResponderTerminate: () => {
        Animated.timing(x, { toValue: base.current, duration: 200, useNativeDriver: true }).start()
      },
    }),
  ).current

  return (
    <View style={{ overflow: 'hidden', borderBottomWidth: 1, borderColor: t.line }}>
      <Pressable
        onPress={props.onAction}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: ACTION_W, backgroundColor: t.acc, alignItems: 'center', justifyContent: 'center' }}
        accessibilityLabel={props.action}
      >
        <Text style={{ fontFamily: font.sansSemi, fontSize: 14, color: '#fff' }}>{props.action}</Text>
      </Pressable>
      <Animated.View style={{ transform: [{ translateX: x }], backgroundColor: t.bg }} {...pan.panHandlers}>
        <Pressable
          onPress={props.onPress}
          onLongPress={props.onLongPress}
          delayLongPress={480}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            minHeight: 64,
            paddingLeft: 12,
            paddingRight: 16,
            paddingVertical: 6,
            backgroundColor: pressed ? t.card : t.bg,
          })}
        >
          {props.children}
        </Pressable>
      </Animated.View>
    </View>
  )
}
