// The league schedule. League's Schedule tab: one week's pairs at a time (this week first), final
// scores for weeks played and the pick-odds sim's win chance for the rest. Team's Schedule pill: one
// team's season, opponent by opponent. Click a team for its page.
import { useEffect, useMemo, useState } from 'react'
import { simWinPct, teamSchedule, type LeagueSchedule, type SchedSide, type TeamGame } from '@shared/schedule'
import type { Result } from '@shared/types'
import { teamLabel } from './names'
import { useApp } from './store'
import { ErrorBox, Link, Loading, Pills, RING_SOFT, TeamAvatar } from './ui'

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
    void window.monte.leagueSchedule(leagueId).then(r => {
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

/** League › Schedule. */
export function Schedule({ onMatchups }: { onMatchups: () => void }) {
  const { context, openTeam } = useApp()
  const me = context?.myRosterId ?? null
  const { res, s, busy, load, name, avatar, winPct, simBusy } = useSchedule()
  const [pick, setPick] = useState<number | null>(null)
  const week = pick ?? (s?.currentWeek && s.weeks.some(w => w.week === s.currentWeek) ? s.currentWeek : s?.weeks.find(w => w.state !== 'final')?.week ?? s?.weeks.at(-1)?.week ?? null)
  const w = s?.weeks.find(x => x.week === week) ?? null
  // Yours first, on the left.
  const games = useMemo(
    () =>
      (w?.games ?? [])
        .map(g => (g.sides[1].rosterId === me ? { ...g, sides: [g.sides[1], g.sides[0]] as [SchedSide, SchedSide] } : g))
        .sort((a, b) => Number(b.sides[0].rosterId === me) - Number(a.sides[0].rosterId === me)),
    [w, me],
  )

  if (res && !res.ok) return <ErrorBox message={res.error} onRetry={load} />
  if (!s) return <Loading label="Reading the schedule…" />
  if (!s.weeks.length) return <div className="mute">This league has no regular-season weeks.</div>
  const sub = w?.state === 'final' ? 'Final' : w?.state === 'current' ? 'This week' : 'Upcoming'
  return (
    <div className="stack" style={{ gap: 14, maxWidth: 980 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="title-l">
          {s.season} week {week} <span className="mute" style={{ fontWeight: 500 }}>· {sub}</span>
        </span>
        <span className="row" style={{ gap: 12 }}>
          {w?.state === 'current' && <Link label="Live scores in Matchups" onClick={onMatchups} />}
          <Link label={busy ? 'Refreshing…' : 'Refresh'} onClick={load} />
        </span>
      </div>
      <Pills value={String(week)} onChange={v => setPick(Number(v))} options={s.weeks.map(x => ({ value: String(x.week), label: x.week === s.currentWeek ? `${x.week} •` : String(x.week) }))} />
      {games.length === 0 && <div className="mute">No head-to-head games this week.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 10 }}>
        {games.map(g => {
          const final = w!.state === 'final'
          const [a, b] = g.sides
          const pa = final ? null : winPct(w!.week, a.rosterId)
          return (
            <div key={g.id} className="stack" style={{ gap: 4, padding: '10px 14px', borderRadius: 18, background: 'var(--card)', boxShadow: a.rosterId === me ? RING_SOFT : undefined }}>
              {g.sides.map((x, i) => {
                const other = g.sides[1 - i]
                const won = final && x.points != null && other.points != null && x.points > other.points
                const p = pa == null ? null : i === 0 ? pa : 1 - pa
                return (
                  <button key={x.rosterId} className="row" onClick={() => openTeam(x.rosterId, name(x.rosterId))} style={{ gap: 12, padding: '4px 0', textAlign: 'left' }}>
                    <TeamAvatar rid={x.rosterId} name={name(x.rosterId)} size={34} src={avatar(x.rosterId)} />
                    <span className="trunc" style={{ flex: 1, minWidth: 0, fontWeight: final && !won ? 500 : 700, color: final && !won ? 'var(--ink2)' : 'var(--ink)' }}>
                      {name(x.rosterId)}
                    </span>
                    {final ? (
                      <span className="num" style={{ fontSize: 17, fontWeight: 700, color: won ? 'var(--ink)' : 'var(--mute)' }}>
                        {x.points == null ? '—' : fmt(x.points)}
                      </span>
                    ) : (
                      <span className="num" style={{ fontWeight: 700, color: p != null && p > 0.5 ? 'var(--pos)' : 'var(--mute)' }}>
                        {p == null ? (simBusy ? '…' : '—') : pct(p)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
      <div className="small mute">
        Win % for games not yet final is the share of Pick odds simulations each team won that week{w?.state === 'current' ? '; Matchups has the live in-game estimate' : ''}. Click a team for its
        page.
      </div>
    </div>
  )
}

/** Team › Schedule: one team's regular season. */
export function TeamSchedule({ rid }: { rid: number }) {
  const { openTeam } = useApp()
  const { res, s, load, name, avatar, winPct, simBusy } = useSchedule()
  if (res && !res.ok) return <ErrorBox message={res.error} onRetry={load} />
  if (!s) return <Loading label="Reading the schedule…" />
  const games = teamSchedule(s, rid)
  if (!games.length) return <div className="mute">No regular-season games on Sleeper’s schedule.</div>
  const done = games.filter(g => g.result)
  const rec = ['W', 'L', 'T'].map(r => done.filter(g => g.result === r).length)
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 8 }}>
        {games.map(g => (
          <TeamGameRow key={g.week} g={g} name={name(g.opp)} avatar={avatar(g.opp)} p={g.state === 'final' ? null : winPct(g.week, rid)} simBusy={simBusy} onOpen={() => openTeam(g.opp, name(g.opp))} />
        ))}
      </div>
      <div className="small mute">
        {done.length ? `${rec[0]}-${rec[1]}${rec[2] ? `-${rec[2]}` : ''} in ${done.length} final game${done.length === 1 ? '' : 's'}. ` : ''}Win % for games not yet final is the share of Pick odds
        simulations this team won that week.
      </div>
    </div>
  )
}

function TeamGameRow({ g, name, avatar, p, simBusy, onOpen }: { g: TeamGame; name: string; avatar: string | null; p: number | null; simBusy: boolean; onOpen: () => void }) {
  const tone = g.result === 'W' ? 'var(--pos)' : g.result === 'L' ? 'var(--neg)' : 'var(--ink2)'
  return (
    <button className="gcard" onClick={onOpen} style={{ minHeight: 56, padding: '8px 14px', gap: 12, background: g.state === 'current' ? 'var(--surf2)' : 'var(--surf)' }}>
      <span className="num mute" style={{ width: 30, fontWeight: 700, fontSize: 13 }}>
        W{g.week}
      </span>
      <TeamAvatar rid={g.opp} name={name} size={32} src={avatar} />
      <span className="trunc" style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>
        {name}
      </span>
      {g.result ? (
        <span className="num" style={{ fontWeight: 700 }}>
          <span style={{ color: tone }}>{g.result}</span> {fmt(g.me ?? 0)}–{fmt(g.them ?? 0)}
        </span>
      ) : (
        <span className="num" style={{ fontWeight: 700, color: p != null && p > 0.5 ? 'var(--pos)' : 'var(--mute)' }}>
          {g.state === 'current' ? 'This week · ' : ''}
          {p == null ? (simBusy ? '…' : '—') : pct(p)}
        </span>
      )}
    </button>
  )
}
