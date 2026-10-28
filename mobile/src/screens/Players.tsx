// Players: search and the usage board in one tab. Value = Tyler's superflex board for this league,
// each player with a value-rank heat chip and his market read; Usage = PWOPR, heat on the usage
// gap. Swipe a card left for its action, long-press to drop him straight into the trade, tap for
// his page.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, FlatList, Linking, PanResponder, Pressable, ScrollView, Text, View } from 'react-native'
import { tepBoardFor, type RanksData, type Result } from '@monte/core/types'
import { teamLabel } from '@monte/core/names'
import { value as rankValue } from '@monte/core/tradeMath'
import { monte } from '@/lib/monte'
import { useApp, type PlayersUi } from '@/lib/store'
import { marketTag, mineOf, useAddToTrade, useTrade } from '@/lib/trade'
import { Icon } from '@/ui/icons'
import { ErrorBox, Field, Headshot, HeatChip, kfmt, Loading, NeedsSheet, Pills, Seg, Stack2, T, useTopOnFocus } from '@/ui/kit'
import { useOverlay } from '@/ui/overlay'
import { font, grad, nflColor, R, useTheme } from '@/ui/theme'

/** usage gap (PPG) at which a player reads as Buy or Sell; the desktop's default */
const SIGNAL = 3
const ACTION_W = 112

type Line = {
  key: string
  id: string
  name: string
  pos: string
  team: string
  owner: number | null
  meta: string
  /** Tyler's board: "#12 · WR4", null when he isn't on it */
  rank: string | null
  v: string
  /** heat position, 0 … 1 */
  h: number
  tag: string
  tagColor: string
  /** trade asset id, when he can be traded */
  assetId: string | null
}

export default function Players() {
  const t = useTheme()
  const { context, settings, sheet, hide, dataVersion, playersUi: ui, setPlayersUi, pw, runPW, openPlayer } = useApp()
  const { byId, me } = useTrade()
  const { showToast } = useOverlay()
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

  const lines = useMemo((): Line[] => {
    const q = ui.q.trim().toLowerCase()
    // The board that matches the league (TE-premium leagues get the TE-prem block), unless Settings
    // picks one. Usage rows take their Tyler rank from it too.
    const board = ranks ? ranks.boards[Math.max(0, ranks.boards.findIndex(b => b.tep === tepBoardFor(settings?.rankBoard, ranks.tePremium)))] : null
    const rankOf = new Map((board?.rows ?? []).filter(r => r.id).map(r => [r.id!, `#${r.rank} · ${r.pos}${r.posRank}`]))
    if (ui.mode === 'value') {
      if (!ranks) return []
      const teAdj = 1 + 0.25 * (ranks.tePremium - 0.75)
      const rows = (board?.rows ?? []).filter(r => r.id)
      const last = Math.max(2, rows[rows.length - 1]?.rank ?? 2)
      return rows
        .filter(r => (ui.pos === 'All' || r.pos === ui.pos) && (!q || r.name.toLowerCase().includes(q)))
        .map(r => {
          const a = byId.get(r.id!)
          const tag = a ? marketTag(a) : null
          // Free agents aren't trade assets: Tyler's rank through the same value curve.
          const v = a ? mineOf(a) : rankValue(r.rank) * (r.pos === 'TE' ? teAdj : 1)
          return {
            key: r.id!,
            id: r.id!,
            name: r.name,
            pos: r.pos,
            team: r.team,
            owner: r.owner,
            meta: [r.team, ownerName(r.owner)].filter(Boolean).join(' · '),
            rank: rankOf.get(r.id!) ?? null,
            v: kfmt(v),
            h: 1 - (r.rank - 1) / (last - 1),
            tag: tag && tag.label !== 'No market' ? tag.label : r.owner == null ? 'Free agent' : '',
            tagColor: tag?.tone === 'acc' ? t.acc : tag?.tone === 'pos' ? t.pos : t.mute,
            assetId: a ? a.id : null,
          }
        })
    }
    const rows = pw.result?.rows ?? []
    return rows
      .filter(r => r.delta != null && (ui.pos === 'All' || r.pos === ui.pos) && (!q || r.name.toLowerCase().includes(q)))
      .sort((a, b) => b.delta! - a.delta!)
      .map(r => {
        const owner = ownerOf.get(r.player_id) ?? null
        const d = r.delta!
        const sig = d >= SIGNAL ? 'Buy' : d <= -SIGNAL ? 'Sell' : 'Hold'
        return {
          key: r.player_id,
          id: r.player_id,
          name: r.name,
          pos: r.pos,
          team: r.team,
          owner,
          meta: `${rankOf.has(r.player_id) ? '' : `${r.pos} · `}${r.team} · ${r.usagePPG?.toFixed(1) ?? '—'} → ${r.sleeperPPG?.toFixed(1) ?? '—'} PPG`,
          rank: rankOf.get(r.player_id) ?? null,
          v: `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)}`,
          h: 0.5 + d / 16,
          tag: sig,
          tagColor: sig === 'Buy' ? t.pos : sig === 'Sell' ? t.acc : t.mute,
          assetId: byId.has(r.player_id) ? r.player_id : null,
        }
      })
  }, [ui, ranks, pw.result, byId, ownerOf, me, hide, teamNames, settings?.rankBoard, t]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!sheet) return <NeedsSheet />

  const act = (l: Line) => {
    setSwiped(null)
    if (l.owner == null) {
      if (context) void Linking.openURL(`https://sleeper.com/leagues/${context.league.league_id}/players`)
      return
    }
    if (!l.assetId) return showToast(`${l.name} isn't in the trade pool.`)
    add(l.assetId, l.owner, l.name)
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
      <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, gap: 10, backgroundColor: t.bg }}>
        <Field
          icon={<Icon name="search" size={18} color={t.mute} stroke={2} />}
          value={ui.q}
          onChangeText={q => set({ q })}
          placeholder="Search players"
          returnKeyType="search"
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Seg
            value={ui.mode}
            onChange={mode => set({ mode, pos: mode === 'usage' && !['All', 'WR', 'TE'].includes(ui.pos) ? 'All' : ui.pos })}
            options={[
              { value: 'value', label: 'Value' },
              { value: 'usage', label: 'Usage' },
            ]}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', gap: 4 }}>
            <Pills bare small value={ui.pos} onChange={pos => set({ pos })} options={(usage ? ['All', 'WR', 'TE'] : ['All', 'QB', 'RB', 'WR', 'TE']).map(v => ({ value: v, label: v }))} />
          </ScrollView>
        </View>
      </View>

      <FlatList
        ref={list}
        data={lines}
        keyExtractor={l => l.key}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={14}
        windowSize={9}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        ItemSeparatorComponent={Gap}
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            {!usage && res && !res.ok && <ErrorBox message={res.error} />}
            {usage && pw.error && <ErrorBox message={`Usage board failed: ${pw.error}`} onRetry={runPW} />}
            {((!usage && !res) || (usage && !pw.result && pw.busy)) && <Loading label={usage ? 'Building the usage board…' : 'Reading the board…'} />}
            {!!note && (
              <T v="small" c="mute" style={{ paddingBottom: 8 }}>
                {note}
              </T>
            )}
          </View>
        }
        ListEmptyComponent={
          (usage ? pw.result : ranks) ? (
            <T c="mute" size={14}>
              No players match.
            </T>
          ) : null
        }
        ListFooterComponent={
          lines.length ? (
            <T v="small" c="mute" style={{ paddingTop: 18, textAlign: 'center' }}>
              Swipe left or long-press to add to a trade.
            </T>
          ) : null
        }
        renderItem={({ item: l }) => (
          <SwipeCard
            color={nflColor(t, l.team)}
            open={swiped === l.key}
            onOpen={() => setSwiped(l.key)}
            onClose={() => swiped === l.key && setSwiped(null)}
            action={l.owner == null ? 'Claim' : l.owner === me ? 'Offer' : 'Trade for'}
            onAction={() => act(l)}
            onPress={() => (swiped ? setSwiped(null) : openPlayer(l.id, l.name))}
            onLongPress={() => (l.owner == null ? showToast(`${l.name} is a free agent: claim him in Sleeper.`) : act(l))}
          >
            <Headshot id={l.id} name={l.name} />
            <Stack2
              title={l.name}
              sub={
                <>
                  {!!l.rank && <Text style={{ fontFamily: font.sansBold, color: t.acc }}>{l.rank} · </Text>}
                  {l.meta}
                </>
              }
            />
            <View style={{ alignItems: 'flex-end', gap: 3 }}>
              <HeatChip label={l.v} v={l.h} minWidth={52} height={28} size={14} />
              {!!l.tag && <Text style={{ fontFamily: font.sansSemi, fontSize: 12, color: l.tagColor }}>{l.tag}</Text>}
            </View>
          </SwipeCard>
        )}
      />
    </View>
  )
}

const Gap = () => <View style={{ height: 8 }} />

/**
 * A card that slides left to show one action on the accent behind it. Horizontal drags past 8px
 * belong to the card (the list keeps vertical ones); release past halfway snaps open. Taps and
 * long-presses go to the card.
 */
function SwipeCard(props: {
  color: string
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
    <View style={{ overflow: 'hidden', borderRadius: R.card, backgroundColor: t.acc }}>
      <Pressable
        onPress={props.onAction}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: ACTION_W, alignItems: 'center', justifyContent: 'center' }}
        accessibilityLabel={props.action}
      >
        <Text style={{ fontFamily: font.sansBold, fontSize: 14, color: t.accInk }}>{props.action}</Text>
      </Pressable>
      <Animated.View style={[{ transform: [{ translateX: x }], borderRadius: R.card, backgroundColor: t.bg }]} {...pan.panHandlers}>
        <Pressable
          onPress={props.onPress}
          onLongPress={props.onLongPress}
          delayLongPress={480}
          style={({ pressed }) => [
            { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, paddingVertical: 10, paddingHorizontal: 14, borderRadius: R.card, opacity: pressed ? 0.85 : 1 },
            grad(t, props.color),
          ]}
        >
          {props.children}
        </Pressable>
      </Animated.View>
    </View>
  )
}
