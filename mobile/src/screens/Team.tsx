// Team (a full page, pushed from League): a team-coloured hero with the verdict and the next move,
// four heat tiles (value, starters, age, picks), then the roster: all of it or one position, sorted
// by value, position, age or starters first. Tap a player for his page.
import { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useApp } from '@/lib/store'
import AppHeader from '@/ui/AppHeader'
import { Btn, ErrorBox, GradCard, Headshot, HeatTiles, Loading, ORD, Pills, Screen, Seg, Stack2, T, Tag, TeamAvatar, num } from '@/ui/kit'
import { ROSTER_SORT, ROSTER_SORTS, type RosterSort } from '@monte/core/rosterSort'
import { grad, nflColor, R, rankHeat, teamColor, useTheme } from '@/ui/theme'
import { headline, POS, record, statusTag, thinnest, useOverview, verdict, type Pos, type TeamRow } from './overviewLogic'

export default function Team() {
  const { rid } = useLocalSearchParams<{ rid: string }>()
  const { res, data, rows, n, load } = useOverview()
  const row = rows.find(r => String(r.team.roster_id) === rid)
  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={row?.team.team_name ?? ''} />
      {row && data ? (
        <TeamBody key={rid} row={row} n={n} />
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

function TeamBody({ row, n }: { row: TeamRow; n: number }) {
  const t = useTheme()
  const { context, findTargets, tradeWith, hide, openPlayer } = useApp()
  const team = row.team
  const mine = team.roster_id === context?.myRosterId
  const need = thinnest(row)
  const [tab, setTab] = useState<Pos | 'All' | 'Picks'>('All')
  const [sort, setSort] = useState<RosterSort>('value')
  const players = tab === 'Picks' ? [] : team.players.filter(x => tab === 'All' || x.pos === tab).sort(ROSTER_SORT[sort])
  const room = tab === 'Picks' || tab === 'All' ? null : row.pos[tab]

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
          ...POS.map(p => ({ value: p as Pos | 'All' | 'Picks', label: `${p} #${row.pos[p].rank}` })),
          { value: 'Picks' as const, label: `Picks #${row.ranks.picks}` },
        ]}
      />
      {tab !== 'Picks' && <Seg fill value={sort} onChange={setSort} options={ROSTER_SORTS} style={{ marginHorizontal: 16 }} />}

      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        {players.map(x => {
          const tag = statusTag(x)
          return (
            <GradCard key={x.id} color={nflColor(t, x.team)} onPress={() => openPlayer(x.id, x.name)} accessibilityLabel={x.name}>
              <Headshot id={x.id} name={x.name} />
              <Stack2 title={x.name} sub={[tab === 'All' ? x.pos : null, x.team, x.age, x.starter ? 'Starter' : null].filter(v => v != null && v !== '').join(' · ')} />
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
        <T v="small" c="mute" style={{ paddingTop: 4 }}>
          {room
            ? `${tab} room: ${num(room.value)} total value, avg age ${room.age?.toFixed(1) ?? '—'}.`
            : tab === 'Picks'
            ? `${row.picks.length} pick${row.picks.length === 1 ? '' : 's'}: ${num(row.pickValue)} total value.`
            : `${team.players.length} players.`}
        </T>
      </View>
    </Screen>
  )
}
