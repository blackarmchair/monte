// League (the default tab): where you stand, then every team as a summary row (or on the
// value-vs-starters map). Tap a team for its sheet.
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useApp } from '@/lib/store'
import { useOverlay } from '@/ui/overlay'
import { Band, Btn, ErrorBox, Loading, NeedsSheet, Pills, RankCell, Row, Seg, T, TeamSquare, useTopOnFocus } from '@/ui/kit'
import { font, useTheme } from '@/ui/theme'
import { record, thinnest, useOverview, type TeamRow } from './overviewLogic'
import TeamSheet from './TeamSheet'

type Sort = 'overall' | 'starter' | 'record' | 'youngest'
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'overall', label: 'Value' },
  { value: 'starter', label: 'Starters' },
  { value: 'record', label: 'Record' },
  { value: 'youngest', label: 'Youngest' },
]

export default function League() {
  const t = useTheme()
  const { context, sheet, findTargets, openPicks } = useApp()
  const { openSheet } = useOverlay()
  const { res, data, rows, n, load, simBusy, simError, runBB } = useOverview()
  const [view, setView] = useState<'list' | 'map'>('list')
  const [sort, setSort] = useState<Sort>('overall')
  const scroll = useTopOnFocus<ScrollView>()
  const ordered = useMemo(() => [...rows].sort((a, b) => (a.ranks[sort] ?? 99) - (b.ranks[sort] ?? 99)), [rows, sort])

  if (!sheet) return <NeedsSheet />

  const me = context?.myRosterId ?? null
  const myRow = rows.find(r => r.team.roster_id === me)
  const need = myRow && thinnest(myRow)
  const open = (r: TeamRow) => data && openSheet(<TeamSheet row={r} n={n} season={data.season} mine={r.team.roster_id === me} />)

  return (
    <ScrollView ref={scroll} style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      {myRow && need && (
        <Band>
          <T v="serif">
            You're #{myRow.ranks.overall} in total value and {myRow.ranks.starter ? `#${myRow.ranks.starter}` : '…'} in starters.
          </T>
          <T v="small" c="mute" size={14}>
            {need} is your thinnest spot (#{myRow.pos[need].rank} of {n}).{simBusy ? ' Simulating starters…' : ''}
          </T>
          <Row wrap>
            <Btn label={`Find ${need} targets`} kind="primary" onPress={() => findTargets(need)} />
            <Btn label="See pick odds" onPress={() => openPicks('odds')} />
          </Row>
        </Band>
      )}

      <Row gap={10} style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <Seg value={view} onChange={setView} options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />
        <View style={{ flex: 1 }} />
        <T v="small" c="mute">
          tap a team
        </T>
      </Row>

      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        {res && !res.ok && <ErrorBox message={res.error} onRetry={load} />}
        {simError && <ErrorBox message={`Starter ranks need the sim, which failed: ${simError}`} onRetry={() => runBB()} />}
        {!data && !(res && !res.ok) && <Loading label="Reading your rankings file…" />}
      </View>

      {data && view === 'list' && (
        <>
          <View style={{ paddingBottom: 10 }}>
            <Pills value={sort} onChange={setSort} options={SORTS} padX={16} />
          </View>
          <ColumnHead />
          {ordered.map((r, i) => (
            <TeamLine key={r.team.roster_id} i={i + 1} r={r} n={n} mine={r.team.roster_id === me} onPress={() => open(r)} />
          ))}
          <T v="small" c="mute" style={{ padding: 16 }}>
            {data.sheet.name} · {data.sheet.ranked} players matched
            {data.sheet.unmatched.length ? ` · ${data.sheet.unmatched.length} sheet names didn't match Sleeper` : ''}
          </T>
        </>
      )}
      {data && view === 'map' &&
        (rows.some(r => r.ranks.starter == null) ? (
          <Loading label="The map needs starter ranks: simulating…" />
        ) : (
          <TeamMap rows={rows} n={n} me={me} onPick={open} />
        ))}
    </ScrollView>
  )
}

function ColumnHead() {
  const t = useTheme()
  const label = { fontFamily: font.mono, fontSize: 12, letterSpacing: 0.96, textTransform: 'uppercase' as const, color: t.mute }
  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 6, borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.line }}>
      <Text style={[label, { width: 28 }]}>#</Text>
      <Text style={[label, { flex: 1 }]}>Team</Text>
      <Text style={[label, { width: 56, textAlign: 'center' }]}>Value</Text>
      <Text style={[label, { width: 56, textAlign: 'center' }]}>Start</Text>
    </View>
  )
}
function TeamLine({ i, r, n, mine, onPress }: { i: number; r: TeamRow; n: number; mine: boolean; onPress: () => void }) {
  const t = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 64,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderColor: t.line,
        backgroundColor: mine ? t.accTint : pressed ? t.card : 'transparent',
      })}
    >
      <T v="mono" c="mute" style={{ width: 28 }}>
        {i}
      </T>
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TeamSquare rid={r.team.roster_id} name={r.team.team_name} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T v="semi" size={16} lines={1}>
            {r.team.team_name}
            {mine ? ' · you' : ''}
          </T>
          <T v="small" c="mute" lines={1}>
            {record(r.team)}
            {r.tier ? ` · ${r.tier.name}` : ''}
          </T>
        </View>
      </View>
      <RankCell rank={r.ranks.overall} n={n} />
      <RankCell rank={r.ranks.starter} n={n} />
    </Pressable>
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
    // Keep dots and their names clear of the corner labels (top and bottom 28px).
    for (const p of out) p.y = Math.max(DOT / 2 + 30, Math.min(h - DOT / 2 - 48, p.y))
    return out
  }, [rows, w, h, n, span])
  const corner = { position: 'absolute' as const, fontFamily: font.mono, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' as const }
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      <View
        onLayout={e => setW(e.nativeEvent.layout.width)}
        style={{ height: h || 300, borderLeftWidth: 1, borderBottomWidth: 1, borderColor: t.line, backgroundColor: t.card2 }}
      >
        <View style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, borderLeftWidth: 1, borderStyle: 'dashed', borderColor: t.line }} />
        <View style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTopWidth: 1, borderStyle: 'dashed', borderColor: t.line }} />
        <Text style={[corner, { left: 8, top: 8, color: t.mute }]}>Rich later</Text>
        <Text style={[corner, { right: 8, top: 8, color: t.pos }]}>Strong both</Text>
        <Text style={[corner, { left: 8, bottom: 8, color: t.neg }]}>Stuck</Text>
        <Text style={[corner, { right: 8, bottom: 8, color: t.mute }]}>Win-now</Text>
        {w > 0 &&
          pts.map(({ r, x, y }) => {
            const mine = r.team.roster_id === me
            return (
              <Pressable
                key={r.team.roster_id}
                onPress={() => onPick(r)}
                style={{ position: 'absolute', left: x - 44, top: y - DOT / 2 - (mine ? 5 : 0), width: 88, alignItems: 'center', gap: 3 }}
                accessibilityLabel={r.team.team_name}
              >
                <TeamSquare rid={r.team.roster_id} name={r.team.team_name} size={mine ? DOT - 10 : DOT} round ring={mine} />
                <Text numberOfLines={1} style={{ maxWidth: 84, fontFamily: font.sans, fontSize: 12, color: t.ink, backgroundColor: t.card2, paddingHorizontal: 3 }}>
                  {r.team.team_name}
                </Text>
              </Pressable>
            )
          })}
      </View>
      <Row style={{ justifyContent: 'space-between', paddingTop: 8 }}>
        <T v="small" c="mute">
          ↑ Total roster value
        </T>
        <T v="small" c="mute">
          Starter strength →
        </T>
      </Row>
    </View>
  )
}
