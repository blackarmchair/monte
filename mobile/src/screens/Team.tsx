// Team (a full page, pushed from League): a team-coloured hero with the verdict and the next move,
// four heat tiles (value, starters, age, picks), then the roster: all of it or one position. It opens
// as Sleeper draws it, starters in their slots then the bench, IR and taxi squad; Value / Position /
// Youngest sort it instead. Tap a player for his page.
import { useMemo, useState } from 'react'
import Svg, { Circle, G, Line, Polygon, Text as SvgText } from 'react-native-svg'
import { Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useApp } from '@/lib/store'
import AppHeader from '@/ui/AppHeader'
import { Btn, ErrorBox, GradCard, Headshot, HeatTiles, Loading, ORD, Pills, Screen, Section, Seg, Stack2, T, Tag, TeamAvatar, num } from '@/ui/kit'
import { lineupSections, ROSTER_SORT, ROSTER_VIEWS, type LineupRow, type RosterView } from '@monte/core/rosterSort'
import type { OvPlayer } from '@monte/core/types'
import { alpha, font, grad, nflColor, R, rankHeat, teamColor, useTheme } from '@/ui/theme'
import { breakdownOptions, fmtPct, fmtTimes, radarPoint, shareRadar, type Breakdown } from '@monte/core/shareRadar'
import { TeamSchedule } from './Schedule'
import { headline, POS, record, statusTag, thinnest, useOverview, verdict, type Pos, type TeamRow } from './overviewLogic'

export default function Team() {
  const { rid } = useLocalSearchParams<{ rid: string }>()
  const { res, data, rows, n, load } = useOverview()
  const row = rows.find(r => String(r.team.roster_id) === rid)
  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={row?.team.team_name ?? ''} />
      {row && data ? (
        <TeamBody key={rid} row={row} rows={rows} n={n} />
      ) : res && !res.ok ? (
        <Screen>
          <ErrorBox message={res.error} onRetry={load} />
        </Screen>
      ) : (
        <Loading label="Reading your rankings file…" />
      )}
    </View>
  )
}

function TeamBody({ row, rows, n }: { row: TeamRow; rows: TeamRow[]; n: number }) {
  const t = useTheme()
  const { context, findTargets, tradeWith, hide, openPlayer } = useApp()
  const team = row.team
  const mine = team.roster_id === context?.myRosterId
  const need = thinnest(row)
  const [tab, setTab] = useState<Pos | 'All' | 'Picks' | 'Schedule'>('All')
  const [view, setView] = useState<RosterView>('lineup')
  const notRoster = tab === 'Picks' || tab === 'Schedule'
  const lineup = !notRoster && view === 'lineup'
  const sections = lineup ? lineupSections(team, tab === 'All' ? undefined : tab) : []
  const players = notRoster || lineup ? [] : team.players.filter(x => tab === 'All' || x.pos === tab).sort(ROSTER_SORT[view as Exclude<RosterView, 'lineup'>])
  const room = notRoster || tab === 'All' ? null : row.pos[tab]

  return (
    <Screen pad={false} gap={18}>
      <View style={[{ marginHorizontal: 16, padding: 20, borderRadius: R.heroLg, gap: 14 }, grad(t, teamColor(team.roster_id))]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <TeamAvatar rid={team.roster_id} name={team.team_name} size={60} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T v="head" lines={2}>
              {team.team_name}
            </T>
            <T size={14} c="ink2">
              {[hide ? null : team.display_name, record(team), row.tier?.name].filter(Boolean).join(' · ')}
            </T>
          </View>
        </View>
        <T size={17}>
          {headline(row, n)} {verdict(row)}
        </T>
        <ShareRadarView row={row} rows={rows} n={n} />
        <Btn
          kind="primary"
          label={mine ? `Find ${need} targets` : 'Start a trade'}
          onPress={() => (mine ? findTargets(need) : tradeWith(team.roster_id))}
        />
      </View>

      <View style={{ paddingHorizontal: 16 }}>
        <HeatTiles
          items={[
            { k: 'Value', v: `#${row.ranks.overall}`, colors: rankHeat(t, row.ranks.overall, n) },
            { k: 'Starters', v: row.ranks.starter ? `#${row.ranks.starter}` : '…', colors: rankHeat(t, row.ranks.starter, n) },
            { k: 'Age', v: row.avgAge?.toFixed(1) ?? '—', colors: rankHeat(t, row.ranks.youngest, n) },
            { k: 'Picks', v: `#${row.ranks.picks}`, colors: rankHeat(t, row.ranks.picks, n) },
          ]}
        />
      </View>

      <Pills
        padX={16}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'All' as const, label: `All ${team.players.length}` },
          ...POS.map(p => ({ value: p as Pos | 'All' | 'Picks' | 'Schedule', label: `${p} #${row.pos[p].rank}` })),
          { value: 'Picks' as const, label: `Picks #${row.ranks.picks}` },
          { value: 'Schedule' as const, label: 'Schedule' },
        ]}
      />
      {!notRoster && <Seg fill value={view} onChange={setView} options={ROSTER_VIEWS} style={{ marginHorizontal: 16 }} />}

      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        {sections.map(s => [
          <Section key={s.title} title={`${s.title} ${s.rows.length}`} style={s.title === 'Starters' ? undefined : { paddingTop: 12 }} />,
          ...s.rows.map(r => <SlotCard key={`${s.title}${r.key}`} row={r} starter={s.title === 'Starters'} onOpen={openPlayer} />),
        ])}
        {lineup && !sections.length && (
          <T c="mute" size={14}>
            No {tab === 'All' ? '' : `${tab}s `}on this roster.
          </T>
        )}
        {players.map(x => {
          const tag = statusTag(x)
          return (
            <GradCard key={x.id} color={nflColor(t, x.team)} onPress={() => openPlayer(x.id, x.name)} accessibilityLabel={x.name}>
              <Headshot id={x.id} name={x.name} />
              <Stack2 title={x.name} sub={playerSub(x, tab === 'All', true)} />
              {tag && <Tag label={tag.label} tone={tag.tone} />}
              <T v="bold" num>
                {x.rank ? num(x.value) : '–'}
              </T>
            </GradCard>
          )
        })}
        {tab === 'Picks' &&
          row.picks.map((p, i) => (
            <GradCard key={i} color={teamColor(p.orig)} minHeight={60}>
              <Stack2 title={`${p.season} ${ORD[p.round] ?? `R${p.round}`}`} sub={[p.slot ? `projected ${p.slot}` : null, p.via ? `via ${p.via}` : 'own'].filter(Boolean).join(' · ')} />
              <T v="bold" num>
                {num(p.value)}
              </T>
            </GradCard>
          ))}
        {tab === 'Picks' && row.picks.length === 0 && (
          <T c="mute" size={14}>
            No picks owned.
          </T>
        )}
        {tab === 'Schedule' && <TeamSchedule rid={team.roster_id} />}
        {tab !== 'Schedule' && (
          <T v="small" c="mute" style={{ paddingTop: 4 }}>
            {room
              ? `${tab} room: ${num(room.value)} total value, avg age ${room.age?.toFixed(1) ?? '—'}.`
              : tab === 'Picks'
              ? `${row.picks.length} pick${row.picks.length === 1 ? '' : 's'}: ${num(row.pickValue)} total value.`
              : `${team.players.length} players.`}
          </T>
        )}
      </View>
    </Screen>
  )
}

const playerSub = (x: OvPlayer, showPos: boolean, showStarter: boolean) =>
  [showPos ? x.pos : null, x.team, x.age, showStarter && x.starter ? 'Starter' : null].filter(v => v != null && v !== '').join(' · ')

/** A lineup row: the slot badge (QB, FLEX, SF… or the bench position / IR / TX), then the player.
 * Starters wear their NFL colour; the bench, IR and taxi sit on plain cards, as in Lineup. */
function SlotCard({ row, starter, onOpen }: { row: LineupRow; starter: boolean; onOpen: (id: string, name: string) => void }) {
  const t = useTheme()
  const x = row.player
  // The IR and taxi sections already say so; keep the injury tag only.
  const tag = x && statusTag(x)
  const shown = tag && !(row.badge === 'IR' && tag.label === 'IR') && !(row.badge === 'TX' && tag.label === 'Taxi') ? tag : null
  return (
    <GradCard
      color={starter && x ? nflColor(t, x.team) : null}
      minHeight={starter ? 64 : 60}
      onPress={x ? () => onOpen(x.id, x.name) : undefined}
      style={{ paddingVertical: 8, paddingLeft: 10 }}
      accessibilityLabel={x ? x.name : row.name ?? `Empty ${row.badge}`}
    >
      <View style={{ width: 44, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surf2 }}>
        <Text style={{ fontFamily: font.sansBold, fontSize: 12, color: starter ? t.ink : t.mute }}>{row.badge}</Text>
      </View>
      {x ? (
        <>
          <Headshot id={x.id} name={x.name} size={40} />
          <Stack2 title={x.name} sub={playerSub(x, starter, false)} />
          {shown && <Tag label={shown.label} tone={shown.tone} />}
          <T v="bold" num>
            {x.rank ? num(x.value) : '–'}
          </T>
        </>
      ) : (
        <>
          <View style={{ width: 40 }} />
          <Stack2 title={row.name ?? 'Empty'} sub={row.name ? row.pos : 'No one in this slot'} titleC={row.name ? undefined : 'mute'} />
        </>
      )}
    </GradCard>
  )
}

/** The share radar (maths in core's shareRadar): value by position or role, or production. Tap a
 * spoke for its numbers, tap it again to go back to the mix. */
let lastBreakdown: Breakdown = 'pos'

function ShareRadarView({ row, rows, n }: { row: TeamRow; rows: TeamRow[]; n: number }) {
  const t = useTheme()
  const [want, setWant] = useState<Breakdown>(lastBreakdown)
  const [picked, setPicked] = useState<string | null>(null)
  const r = useMemo(() => shareRadar(rows, row, n, want), [rows, row, n, want])
  const setMode = (m: Breakdown) => {
    lastBreakdown = m
    setWant(m)
    setPicked(null)
  }
  const count = r.spokes.length
  const W = 300
  const H = 220
  const cx = W / 2
  const cy = H / 2 + 2
  const RAD = 74
  const pt = (i: number, f: number) => radarPoint(i, count, f, cx, cy, RAD)
  const poly = (fs: number[]) => fs.map((f, i) => pt(i, f).join(',')).join(' ')
  const color = teamColor(row.team.roster_id)
  const grid = alpha(t.ink, 0.12)
  const tap = (k: string) => setPicked(p => (p === k ? null : k))

  return (
    <View style={{ gap: 10 }}>
      <Seg fill value={r.mode} onChange={setMode} options={breakdownOptions(rows)} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T size={13} c="mute">
            {r.title}
          </T>
          <T size={26} v="bold" num>
            {fmtPct(r.overall)}
          </T>
        </View>
        <T size={12} c="mute" style={{ textAlign: 'right', maxWidth: 150 }}>
          Dashed ring = even split ({fmtPct(r.even)}); rim = 2×
        </T>
      </View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel={`${r.title}: ${r.spokes.map(s => `${s.key} ${fmtPct(s.share)}`).join(', ')}`}>
        {[0.25, 0.75, 1].map(f => (
          <Polygon key={f} points={poly(r.spokes.map(() => f))} fill="none" stroke={grid} strokeWidth={1} />
        ))}
        {r.spokes.map((_, i) => {
          const [x, y] = pt(i, 1)
          return <Line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={grid} strokeWidth={1} />
        })}
        <Polygon points={poly(r.spokes.map(() => 0.5))} fill="none" stroke={t.mute} strokeWidth={1.5} strokeDasharray="4 4" />
        <Polygon points={poly(r.spokes.map(s => s.rad))} fill={alpha(color, 0.28)} stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {r.spokes.map((s, i) => {
          const [x, y] = pt(i, s.rad)
          const [lx, ly] = pt(i, 1.26)
          const anchor = Math.abs(lx - cx) < 4 ? 'middle' : lx > cx ? 'start' : 'end'
          const on = picked === s.key
          return (
            <G key={s.key} onPress={() => tap(s.key)}>
              <Circle cx={x} cy={y} r={18} fill="transparent" />
              <Circle cx={x} cy={y} r={on ? 6.5 : 5} fill={color} stroke={t.card} strokeWidth={2} />
              <SvgText x={lx} y={ly - 2} textAnchor={anchor} fontSize={12} fontWeight="700" fill={t.ink}>
                {s.key}
              </SvgText>
              <SvgText x={lx} y={ly + 12} textAnchor={anchor} fontSize={12} fill={t.ink2}>
                {fmtTimes(s.times)}
              </SvgText>
            </G>
          )
        })}
      </Svg>
      <T size={13} c="ink2" style={{ minHeight: 36 }}>
        {picked ? r.describe(picked) : `${r.mix}. Tap a spoke for its numbers.`}
      </T>
    </View>
  )
}
