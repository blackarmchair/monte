// The league schedule. League › Matchups › Season: one week's pairs at a time (this week first),
// final scores for weeks played and the pick-odds sim's win chance for the rest. Team's Schedule
// pill: one team's season, opponent by opponent. Tap a team for its page.
import { useEffect, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { teamLabel } from '@monte/core/names'
import { simWinPct, teamSchedule, type LeagueSchedule, type SchedSide, type TeamGame } from '@monte/core/schedule'
import type { Result } from '@monte/core/types'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { ErrorBox, Loading, Pills, Row, T, TeamAvatar } from '@/ui/kit'
import { R, ring, useTheme } from '@/ui/theme'

// The last schedule loaded per league, so switching tabs or teams doesn't fetch again.
const cache = new Map<string, Result<LeagueSchedule>>()

export function useSchedule() {
  const { context, bbBase, runBB, hide, sheet } = useApp()
  const leagueId = context?.league.league_id
  const [tick, setTick] = useState(0)
  const [res, setRes] = useState<Result<LeagueSchedule> | null>(() => (leagueId ? cache.get(leagueId) ?? null : null))
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!leagueId) return
    const hit = cache.get(leagueId)
    if (!tick && hit?.ok) return setRes(hit)
    let live = true
    setBusy(true)
    void monte.leagueSchedule(leagueId).then(r => {
      cache.set(leagueId, r)
      if (!live) return
      setRes(r)
      setBusy(false)
    })
    return () => {
      live = false
    }
  }, [leagueId, tick])
  // The odds for games not yet played come from the sim; start it if this league has none yet.
  useEffect(() => {
    if (leagueId && sheet && !bbBase.result && !bbBase.busy && !bbBase.error) runBB()
  }, [leagueId, !!sheet]) // eslint-disable-line react-hooks/exhaustive-deps
  const s = res?.ok ? res.value : null
  const name = (rid: number) => (hide ? teamLabel(rid) : s?.teams[rid]?.name ?? teamLabel(rid))
  const avatar = (rid: number) => (hide ? null : s?.teams[rid]?.avatar ?? null)
  const winPct = (week: number, rid: number) => simWinPct(bbBase.result?.weekWinPct, week, rid)
  return { res, s, busy, load: () => setTick(x => x + 1), name, avatar, winPct, simBusy: !!bbBase.busy }
}

const fmt = (x: number) => x.toFixed(2)
const pct = (p: number) => `${Math.round(p * 100)}%`

/** League › Matchups › Season. */
export function Schedule({ onMatchups }: { onMatchups: () => void }) {
  const t = useTheme()
  const { context, openTeam } = useApp()
  const me = context?.myRosterId ?? null
  const { res, s, busy, load, name, avatar, winPct, simBusy } = useSchedule()
  const [pick, setPick] = useState<number | null>(null)
  const week = pick ?? (s?.currentWeek && s.weeks.some(w => w.week === s.currentWeek) ? s.currentWeek : s?.weeks.find(w => w.state !== 'final')?.week ?? s?.weeks.at(-1)?.week ?? null)
  const w = s?.weeks.find(x => x.week === week) ?? null
  // Yours first, on top.
  const games = useMemo(
    () =>
      (w?.games ?? [])
        .map(g => (g.sides[1].rosterId === me ? { ...g, sides: [g.sides[1], g.sides[0]] as [SchedSide, SchedSide] } : g))
        .sort((a, b) => Number(b.sides[0].rosterId === me) - Number(a.sides[0].rosterId === me)),
    [w, me],
  )

  if (res && !res.ok) return <ErrorBox message={res.error} onRetry={load} />
  if (!s) return <Loading label="Reading the schedule…" />
  if (!s.weeks.length) return <T c="mute">This league has no regular-season weeks.</T>
  const sub = w?.state === 'final' ? 'Final' : w?.state === 'current' ? 'This week' : 'Upcoming'
  return (
    <View style={{ gap: 12 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <T v="bold" size={17}>
          Week {week}{' '}
          <T c="mute" size={15}>
            · {sub}
          </T>
        </T>
        <T c="acc" size={14} onPress={load}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </T>
      </Row>
      <Pills small value={String(week)} onChange={v => setPick(Number(v))} options={s.weeks.map(x => ({ value: String(x.week), label: x.week === s.currentWeek ? `${x.week} •` : String(x.week) }))} />
      {w?.state === 'current' && (
        <T c="acc" size={14} onPress={onMatchups}>
          Live scores ›
        </T>
      )}
      {games.length === 0 && <T c="mute">No head-to-head games this week.</T>}
      {games.map(g => {
        const final = w!.state === 'final'
        const [a] = g.sides
        const pa = final ? null : winPct(w!.week, a.rosterId)
        return (
          <View key={g.id} style={[{ backgroundColor: t.surf, borderRadius: R.card, paddingVertical: 6, paddingHorizontal: 14 }, a.rosterId === me ? ring(t, true) : null]}>
            {g.sides.map((x, i) => {
              const other = g.sides[1 - i]
              const won = final && x.points != null && other.points != null && x.points > other.points
              const p = pa == null ? null : i === 0 ? pa : 1 - pa
              return (
                <Pressable key={x.rosterId} onPress={() => openTeam(x.rosterId)} accessibilityLabel={name(x.rosterId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
                  <TeamAvatar rid={x.rosterId} name={name(x.rosterId)} size={32} src={avatar(x.rosterId)} />
                  <T v={final && !won ? 'body' : 'bold'} c={final && !won ? 'ink2' : 'ink'} lines={1} style={{ flex: 1, minWidth: 0 }}>
                    {name(x.rosterId)}
                  </T>
                  {final ? (
                    <T v="bold" num size={16} c={won ? 'ink' : 'mute'}>
                      {x.points == null ? '—' : fmt(x.points)}
                    </T>
                  ) : (
                    <T v="bold" num c={p != null && p > 0.5 ? 'pos' : 'mute'}>
                      {p == null ? (simBusy ? '…' : '—') : pct(p)}
                    </T>
                  )}
                </Pressable>
              )
            })}
          </View>
        )
      })}
      <T v="small" c="mute">
        Win % for games not yet final is the share of Pick odds simulations each team won that week{w?.state === 'current' ? '; This week has the live in-game estimate' : ''}. Tap a team for
        its page.
      </T>
    </View>
  )
}

/** Team › Schedule: one team's regular season. */
export function TeamSchedule({ rid }: { rid: number }) {
  const { openTeam } = useApp()
  const { res, s, load, name, avatar, winPct, simBusy } = useSchedule()
  if (res && !res.ok) return <ErrorBox message={res.error} onRetry={load} />
  if (!s) return <Loading label="Reading the schedule…" />
  const games = teamSchedule(s, rid)
  if (!games.length) return <T c="mute">No regular-season games on Sleeper’s schedule.</T>
  const done = games.filter(g => g.result)
  const rec = ['W', 'L', 'T'].map(r => done.filter(g => g.result === r).length)
  return (
    <View style={{ gap: 8 }}>
      {games.map(g => (
        <TeamGameRow key={g.week} g={g} name={name(g.opp)} avatar={avatar(g.opp)} p={g.state === 'final' ? null : winPct(g.week, rid)} simBusy={simBusy} onOpen={() => openTeam(g.opp)} />
      ))}
      <T v="small" c="mute" style={{ paddingTop: 4 }}>
        {done.length ? `${rec[0]}-${rec[1]}${rec[2] ? `-${rec[2]}` : ''} in ${done.length} final game${done.length === 1 ? '' : 's'}. ` : ''}Win % for games not yet final is the share of Pick odds
        simulations this team won that week.
      </T>
    </View>
  )
}

function TeamGameRow({ g, name, avatar, p, simBusy, onOpen }: { g: TeamGame; name: string; avatar: string | null; p: number | null; simBusy: boolean; onOpen: () => void }) {
  const t = useTheme()
  return (
    <Pressable
      onPress={onOpen}
      accessibilityLabel={`Week ${g.week}, ${name}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 56,
        paddingHorizontal: 14,
        borderRadius: R.card,
        backgroundColor: g.state === 'current' ? t.surf2 : t.surf,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <T v="bold" c="mute" size={13} num style={{ width: 30 }}>
        W{g.week}
      </T>
      <TeamAvatar rid={g.opp} name={name} size={30} src={avatar} />
      <T v="bold" lines={1} style={{ flex: 1, minWidth: 0 }}>
        {name}
      </T>
      {g.result ? (
        <T v="bold" num>
          <T v="bold" c={g.result === 'W' ? 'pos' : g.result === 'L' ? 'neg' : 'ink2'}>
            {g.result}
          </T>{' '}
          {fmt(g.me ?? 0)}–{fmt(g.them ?? 0)}
        </T>
      ) : (
        <T v="bold" num c={p != null && p > 0.5 ? 'pos' : 'mute'}>
          {g.state === 'current' ? 'Now · ' : ''}
          {p == null ? (simBusy ? '…' : '—') : pct(p)}
        </T>
      )}
    </Pressable>
  )
}
