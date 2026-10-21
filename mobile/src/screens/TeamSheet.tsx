// Team sheet (from League): the verdict, the next action, four headline ranks, and the roster by
// position. Tap a player for his sheet.
import { Pressable, View } from 'react-native'
import { useApp } from '@/lib/store'
import { useOverlay } from '@/ui/overlay'
import { Btn, Chip, ORD, PlayerAvatar, RankTag, Row, T, TeamSquare, Tiles, num } from '@/ui/kit'
import { useTheme } from '@/ui/theme'
import { headline, POS, record, statusTag, thinnest, verdict, type TeamRow } from './overviewLogic'
import PlayerSheet from './PlayerSheet'

export default function TeamSheet({ row, n, season, mine }: { row: TeamRow; n: number; season: string; mine: boolean }) {
  const t = useTheme()
  const { findTargets, tradeWith, hide } = useApp()
  const { openSheet, closeSheet } = useOverlay()
  const team = row.team
  const need = thinnest(row)
  const current = row.picks.filter(p => p.season === season)
  const future = [...new Set(row.picks.filter(p => p.season !== season).map(p => p.season))].map(s => {
    const ps = row.picks.filter(p => p.season === s)
    const counts = new Map<number, number>()
    for (const p of ps) counts.set(p.round, (counts.get(p.round) ?? 0) + 1)
    const rounds = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([rd, c]) => `${ORD[rd] ?? `R${rd}`}${c > 1 ? ` ×${c}` : ''}`)
    return { season: s, label: `${s} ${rounds.join(' · ')}`, value: ps.reduce((x, p) => x + p.value, 0) }
  })

  const group = (title: string, rank: number, meta: string) => (
    <Row gap={8} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: t.line }}>
      <T v="semi">{title}</T>
      <RankTag rank={rank} n={n} />
      <View style={{ flex: 1 }} />
      <T v="mono" size={13} c="mute">
        {meta}
      </T>
    </Row>
  )

  return (
    <View style={{ gap: 14 }}>
      <Row gap={12}>
        <TeamSquare rid={team.roster_id} name={team.team_name} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T v="title" lines={2}>
            {team.team_name}
          </T>
          <T v="small" c="mute" size={14}>
            {[hide ? null : team.display_name, record(team), row.tier?.name].filter(Boolean).join(' · ')}
          </T>
        </View>
      </Row>
      <T v="serifItalic">
        {headline(row, n)} {verdict(row)}
      </T>
      <Btn
        big
        full
        kind="primary"
        label={mine ? `Find ${need} targets` : `Trade with ${team.team_name}`}
        onPress={() => {
          closeSheet()
          if (mine) findTargets(need)
          else tradeWith(team.roster_id)
        }}
      />
      <Tiles
        items={[
          { k: 'Value', v: `#${row.ranks.overall}`, s: num(row.value) },
          { k: 'Starters', v: row.ranks.starter ? `#${row.ranks.starter}` : '—', s: row.starterPPG ? `${row.starterPPG.toFixed(1)}/wk` : 'simulating' },
          { k: 'Age', v: row.avgAge?.toFixed(1) ?? '—', s: `#${row.ranks.youngest} youngest` },
          { k: 'Picks', v: `#${row.ranks.picks}`, s: num(row.pickValue) },
        ]}
      />

      {POS.map(p => {
        const ps = team.players.filter(x => x.pos === p).sort((a, b) => b.value - a.value)
        if (!ps.length) return null
        return (
          <View key={p}>
            {group(p, row.pos[p].rank, `${num(row.pos[p].value)} · ${row.pos[p].age?.toFixed(1) ?? '—'} yrs`)}
            {ps.map(x => {
              const tag = statusTag(x)
              return (
                <Pressable
                  key={x.id}
                  onPress={() =>
                    openSheet(<PlayerSheet player={{ id: x.id, name: x.name, pos: x.pos, team: x.team, age: x.age, owner: team.roster_id }} />)
                  }
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 44,
                    borderBottomWidth: 1,
                    borderColor: t.line,
                    backgroundColor: pressed ? t.card : 'transparent',
                  })}
                >
                  <PlayerAvatar id={x.id} name={x.name} size={28} />
                  <T v={x.starter ? 'semi' : 'body'} c={x.starter ? 'ink' : 'ink2'} lines={1} style={{ flex: 1, minWidth: 0 }}>
                    {x.name}{' '}
                    <T v="small" c="mute">
                      {x.team}
                      {x.age ? ` · ${x.age}` : ''}
                    </T>
                  </T>
                  {tag && <Chip label={tag.label} tone={tag.tone === 'neg' ? 'neg' : tag.tone === 'warn' ? 'warn' : 'chip'} />}
                  <T v="mono" size={14} style={{ width: 56, textAlign: 'right' }}>
                    {x.rank ? num(x.value) : '–'}
                  </T>
                </Pressable>
              )
            })}
          </View>
        )
      })}

      <View>
        {group('Picks', row.ranks.picks, num(row.pickValue))}
        {current.map((p, i) => (
          <Row key={i} gap={10} style={{ minHeight: 44, borderBottomWidth: 1, borderColor: t.line }}>
            <T v="semi" style={{ width: 74 }}>
              {p.season} {ORD[p.round] ?? `R${p.round}`}
            </T>
            <T v="small" c="mute" lines={1} style={{ flex: 1 }}>
              {[p.slot, p.via ? `via ${p.via}` : null].filter(Boolean).join(' · ')}
            </T>
            <T v="mono" size={14} style={{ width: 56, textAlign: 'right' }}>
              {num(p.value)}
            </T>
          </Row>
        ))}
        {future.map(f => (
          <Row key={f.season} gap={10} style={{ minHeight: 44, borderBottomWidth: 1, borderColor: t.line }}>
            <T v="semi" style={{ flex: 1 }}>
              {f.label}
            </T>
            <T v="mono" size={14} style={{ width: 56, textAlign: 'right' }}>
              {num(f.value)}
            </T>
          </Row>
        ))}
        {row.picks.length === 0 && (
          <T v="small" c="mute" style={{ paddingVertical: 10 }}>
            No picks owned.
          </T>
        )}
      </View>
      <T v="small" c="mute">
        Bold players are this week's starters. Tap a player for more.
      </T>
    </View>
  )
}
