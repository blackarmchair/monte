// League (the default tab): a hero with where you stand and the one next move, then Standings:
// one team-coloured card per team with a heat chip for the sorted metric, or the value-vs-starters
// map. Tap a team for its page.
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useApp } from '@/lib/store'
import { Btn, ErrorBox, GradCard, HeatChip, Hero, kfmt, Loading, NeedsSheet, Section, Seg, Stack2, T, TeamAvatar, useTopOnFocus } from '@/ui/kit'
import { font, R, rankHeat, ring, teamColor, useTheme } from '@/ui/theme'
import { record, thinnest, useOverview, type TeamRow } from './overviewLogic'

type Sort = 'overall' | 'starter' | 'record' | 'map'
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'overall', label: 'Value' },
  { value: 'starter', label: 'Starters' },
  { value: 'record', label: 'Record' },
  { value: 'map', label: 'Map' },
]

export default function League() {
  const t = useTheme()
  const { context, sheet, findTargets, openTeam } = useApp()
  const { res, data, rows, n, load, simBusy, simError, runBB } = useOverview()
  const [sort, setSort] = useState<Sort>('overall')
  const scroll = useTopOnFocus<ScrollView>()
  const by = sort === 'map' ? 'overall' : sort
  const ordered = useMemo(() => [...rows].sort((a, b) => (a.ranks[by] ?? 99) - (b.ranks[by] ?? 99)), [rows, by])

  if (!sheet) return <NeedsSheet />

  const me = context?.myRosterId ?? null
  const myRow = rows.find(r => r.team.roster_id === me)
  const need = myRow && thinnest(myRow)

  return (
    <ScrollView ref={scroll} style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 28, gap: 20 }}>
      {myRow && need && (
        <Hero>
          <T v="small" c="mute">
            {[context && context.week > 0 ? `Week ${context.week}` : null, record(myRow.team), myRow.tier?.name].filter(Boolean).join(' · ')}
          </T>
          <T v="head" size={26}>
            You're #{myRow.ranks.overall} in value and {myRow.ranks.starter ? `#${myRow.ranks.starter}` : '…'} in starters.
          </T>
          <T c="ink2">
            {need} is your thinnest spot, #{myRow.pos[need].rank} of {n}.{simBusy ? ' Simulating starters…' : ''}
          </T>
          <Btn kind="primary" label={`Find ${need} targets`} onPress={() => findTargets(need)} style={{ marginTop: 6 }} />
        </Hero>
      )}

      {res && !res.ok && <ErrorBox message={res.error} onRetry={load} />}
      {simError && <ErrorBox message={`Starter ranks need the sim, which failed: ${simError}`} onRetry={() => runBB()} />}
      {!data && !(res && !res.ok) && <Loading label="Reading your rankings file…" />}

      {data && (
        <View style={{ gap: 10 }}>
          <Section title="Standings" />
          <Seg fill value={sort} onChange={setSort} options={SORTS} />
          {sort !== 'map' &&
            ordered.map((r, i) => (
              <TeamCard key={r.team.roster_id} i={i + 1} r={r} n={n} sort={sort} mine={r.team.roster_id === me} onPress={() => openTeam(r.team.roster_id)} />
            ))}
          {sort === 'map' &&
            (rows.some(r => r.ranks.starter == null) ? (
              <Loading label="The map needs starter ranks: simulating…" />
            ) : (
              <TeamMap rows={rows} n={n} me={me} onPick={r => openTeam(r.team.roster_id)} />
            ))}
          <T v="small" c="mute" style={{ paddingTop: 4 }}>
            {data.sheet.name} · {data.sheet.ranked} players matched
            {data.sheet.unmatched.length ? ` · ${data.sheet.unmatched.length} sheet names didn't match Sleeper` : ''}
          </T>
        </View>
      )}
    </ScrollView>
  )
}

function TeamCard({ i, r, n, sort, mine, onPress }: { i: number; r: TeamRow; n: number; sort: Exclude<Sort, 'map'>; mine: boolean; onPress: () => void }) {
  const t = useTheme()
  const rank = r.ranks[sort]
  const metric = sort === 'overall' ? kfmt(r.value) : sort === 'starter' ? (r.starterPPG != null ? `${r.starterPPG.toFixed(0)}/wk` : '…') : record(r.team)
  const sub =
    sort === 'overall'
      ? `${record(r.team)} · Starters ${r.ranks.starter ? `#${r.ranks.starter}` : '…'}`
      : sort === 'starter'
      ? `${record(r.team)} · Value #${r.ranks.overall}`
      : `${r.tier?.name ?? 'Tier pending'} · Value #${r.ranks.overall}`
  return (
    <GradCard color={teamColor(r.team.roster_id)} selected={mine} minHeight={72} onPress={onPress} accessibilityLabel={r.team.team_name}>
      <T v="semi" size={14} c="mute" num style={{ width: 20 }}>
        {i}
      </T>
      <TeamAvatar rid={r.team.roster_id} name={r.team.team_name} />
      <Stack2 title={r.team.team_name} sub={sub} />
      <HeatChip label={metric} colors={rankHeat(t, rank, n)} />
    </GradCard>
  )
}

/** Value rank (y, #1 at top) against starter rank (x, #1 at right). */
function TeamMap({ rows, n, me, onPick }: { rows: TeamRow[]; n: number; me: number | null; onPick: (r: TeamRow) => void }) {
  const t = useTheme()
  const [w, setW] = useState(0)
  const h = w * 1.1
  const span = Math.max(1, n - 1)
  const DOT = 44
  // Place every team, then push apart any two dots that would overlap (ties sit on one spot).
  const pts = useMemo(() => {
    const out = rows.map(r => {
      const s = r.ranks.starter
      return {
        r,
        x: (s == null ? 0.5 : ((n - s) / span) * 0.8 + 0.1) * w,
        y: (((r.ranks.overall - 1) / span) * 0.78 + 0.11) * h,
      }
    })
    const min = DOT + 18
    for (let pass = 0; pass < 12; pass++)
      for (let i = 0; i < out.length; i++)
        for (let j = i + 1; j < out.length; j++) {
          const a = out[i]
          const b = out[j]
          const dx = b.x - a.x
          const dy = b.y - a.y
          if (Math.abs(dx) < DOT && Math.abs(dy) < min) {
            const push = (min - Math.abs(dy)) / 2
            const dir = dy >= 0 ? 1 : -1
            a.y -= push * dir
            b.y += push * dir
          }
        }
    // Keep dots and their names clear of the corner labels.
    for (const p of out) p.y = Math.max(DOT / 2 + 30, Math.min(h - DOT / 2 - 48, p.y))
    return out
  }, [rows, w, h, n, span])
  const corner = { position: 'absolute' as const, fontFamily: font.sansSemi, fontSize: 12 }
  return (
    <View style={{ gap: 8 }}>
      <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height: h || 300, borderRadius: R.hero, backgroundColor: t.surf, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: t.bg }} />
        <View style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 2, marginTop: -1, backgroundColor: t.bg }} />
        <Text style={[corner, { left: 12, top: 10, color: t.mute }]}>Rich later</Text>
        <Text style={[corner, { right: 12, top: 10, color: t.pos }]}>Strong both</Text>
        <Text style={[corner, { left: 12, bottom: 10, color: t.neg }]}>Stuck</Text>
        <Text style={[corner, { right: 12, bottom: 10, color: t.mute }]}>Win-now</Text>
        {w > 0 &&
          pts.map(({ r, x, y }) => {
            const mine = r.team.roster_id === me
            return (
              <Pressable
                key={r.team.roster_id}
                onPress={() => onPick(r)}
                style={{ position: 'absolute', left: x - 44, top: y - DOT / 2, width: 88, alignItems: 'center', gap: 3 }}
                accessibilityLabel={r.team.team_name}
              >
                <View style={[{ borderRadius: DOT / 2 + 3, padding: 3 }, mine && ring(t)]}>
                  <TeamAvatar rid={r.team.roster_id} name={r.team.team_name} size={mine ? DOT - 6 : DOT} />
                </View>
                <Text numberOfLines={1} style={{ maxWidth: 84, fontFamily: font.sansSemi, fontSize: 12, color: t.ink }}>
                  {r.team.team_name}
                </Text>
              </Pressable>
            )
          })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T v="small" c="mute">
          ↑ Total roster value
        </T>
        <T v="small" c="mute">
          Starter strength →
        </T>
      </View>
    </View>
  )
}
