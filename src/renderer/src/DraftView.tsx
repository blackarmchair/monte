import { useEffect, useMemo, useRef, useState } from 'react'
import type { DraftData, DraftPlayer, DraftPool, DraftPoll, DraftStatus, LeagueContext, Result } from '@shared/types'
import { buildPositionalRankIndex, gradeExplanation, gradePicks, gradeTeam, type GradeLetter, type PickGrade } from '@shared/draftGrade'
import { InlineError, NextMove, PlayerAvatar, Segmented, SkeletonRows, TeamAvatar } from './ui'
import { teamLabel } from './names'
import './DraftView.css'

const GRID = '52px minmax(210px,2fr) 64px 64px 72px minmax(170px,1.2fr)'
const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
type PosFilter = 'All' | (typeof POSITIONS)[number]
/** A new tier starts where 12+ players sit between two pool players on Tyler's overall board:
 *  a 16% value drop at 10000·e^(−rank/70). In the all-players pool nobody is skipped, so it is one list. */
const TIER_GAP = 12
/** How often Sleeper is asked for picks, by draft status. A finished draft is not polled. */
const POLL_MS: Record<DraftStatus, number | null> = { drafting: 5000, paused: 15000, pre_draft: 30000, complete: null }
const STATUS_LABEL: Record<DraftStatus, string> = { drafting: 'Live', paused: 'Paused', pre_draft: 'Not started', complete: 'Complete' }

const fmtAge = (a: number | null) => (a == null ? '' : a.toFixed(0))
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`

const LETTERS: GradeLetter[] = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F']
/** Chip color by letter: A green, B neutral, C amber, D/F red. */
const toneOf = (l: GradeLetter) => (l[0] === 'A' ? 'a' : l[0] === 'B' ? 'b' : l[0] === 'C' ? 'c' : 'f')

function whyOf(g: PickGrade): string {
  if (!g.graded) return g.reason === 'not-on-sheet' ? 'Not on the sheet, so not graded.' : 'Position not graded.'
  const diff = g.posPick - g.userRank
  if (diff > 0) return `Went ${diff} spot${diff === 1 ? '' : 's'} after his sheet rank at ${g.position}. Value pick.`
  if (diff < 0) return `Taken ${-diff} spot${diff === -1 ? '' : 's'} ahead of his sheet rank at ${g.position}. Reach.`
  return 'Taken right at his sheet rank.'
}

function GradeChip({ g, small }: { g: PickGrade | undefined; small?: boolean }) {
  if (!g) return null
  const cls = `dr2-g ${small ? 'sm' : ''}`
  if (!g.graded)
    return (
      <span className={`${cls} none`} title={g.reason === 'not-on-sheet' ? 'Not on the sheet' : 'Position not graded'}>
        –
      </span>
    )
  return (
    <span className={`${cls} ${toneOf(g.letter)}`} title={gradeExplanation(g)}>
      {g.letter}
    </span>
  )
}

export default function DraftView(props: { context: LeagueContext; userId: string; sheetVersion: string | undefined; hideNames: boolean }) {
  const leagueId = props.context.league.league_id
  const [draftId, setDraftId] = useState<string | undefined>(undefined)
  const [otherId, setOtherId] = useState('')
  const [res, setRes] = useState<Result<DraftData> | null>(null)
  const [busy, setBusy] = useState(false)
  const [poll, setPoll] = useState<DraftPoll | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [pool, setPool] = useState<DraftPool>('rookies')
  const [pos, setPos] = useState<PosFilter>('All')
  const [query, setQuery] = useState('')
  const [showTaken, setShowTaken] = useState(false)
  const [view, setView] = useState<'board' | 'teams'>('board')
  /** once the user picks Board/Teams, a reload doesn't switch it back */
  const viewPicked = useRef(false)
  const [selTeam, setSelTeam] = useState<number | null>(null)
  const [hoverTeam, setHoverTeam] = useState<number | null>(null)
  const [selPick, setSelPick] = useState<number | null>(null)
  // Players marked taken by hand: drafts held off Sleeper, or a pick Sleeper hasn't shown yet.
  const [manual, setManual] = useState<Set<string>>(new Set())

  const load = (id = draftId) => {
    setBusy(true)
    void window.monte.draft(leagueId, props.userId, id).then(r => {
      setRes(r)
      setBusy(false)
      if (r.ok) {
        setPoll(r.value.initial)
        setPollError(null)
        setPool(r.value.defaultPool)
        setManual(new Set())
        if (!viewPicked.current) setView(r.value.initial.status === 'complete' && r.value.initial.picks.length ? 'teams' : 'board')
      }
    })
  }
  useEffect(load, [leagueId, draftId, props.sheetVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = res?.ok ? res.value : null
  const status = poll?.status ?? d?.draft.status ?? 'complete'

  // Poll while the draft can still change. A status change (the draft starting, or finishing)
  // reloads everything, since Sleeper may only fix the draft order when it starts.
  useEffect(() => {
    if (!d) return
    const every = POLL_MS[status]
    if (every == null) return
    const id = d.draft.draft_id
    const t = window.setInterval(() => {
      void window.monte.draftPicks(id).then(r => {
        if (!r.ok) return setPollError(r.error)
        setPollError(null)
        if (r.value.status !== d.draft.status && (r.value.status === 'complete' || d.draft.status === 'pre_draft')) load(id)
        else setPoll(r.value)
      })
    }, every)
    return () => window.clearInterval(t)
  }, [d, status]) // eslint-disable-line react-hooks/exhaustive-deps

  const picks = poll?.picks ?? []
  const pickedBy = useMemo(() => new Map(picks.map(p => [p.playerId, p])), [picks])
  const teamName = useMemo(() => {
    const m = new Map(d?.teams.map(t => [t.roster_id, t.name]))
    return (rid: number | null) => (rid == null ? 'Unknown' : props.hideNames ? teamLabel(rid) : (m.get(rid) ?? `Roster ${rid}`))
  }, [d, props.hideNames])
  /** a photo identifies a manager as well as a name, so Hide names drops these too */
  const avatarOf = useMemo(() => {
    const m = new Map(d?.teams.map(t => [t.roster_id, t.avatar]))
    return (rid: number | null) => (rid == null || props.hideNames ? null : (m.get(rid) ?? null))
  }, [d, props.hideNames])

  const inPool = (p: DraftPlayer) => pool === 'all' || p.rookie || pickedBy.has(p.id)
  const poolPlayers = useMemo(() => (d ? d.players.filter(inPool) : []), [d, pool, pickedBy]) // eslint-disable-line react-hooks/exhaustive-deps

  const rankIndex = useMemo(() => buildPositionalRankIndex(poolPlayers, () => true), [poolPlayers])
  const grades = useMemo(() => gradePicks(picks, rankIndex), [picks, rankIndex])

  // Tiers and pool ranks are fixed by the sheet, so they don't move as players come off the board.
  const tierOf = useMemo(() => {
    const m = new Map<string, number>()
    let tier = 1
    poolPlayers.forEach((p, i) => {
      if (i > 0 && p.rank - poolPlayers[i - 1].rank >= TIER_GAP) tier++
      m.set(p.id, tier)
    })
    return m
  }, [poolPlayers])
  const poolRank = useMemo(() => new Map(poolPlayers.map((p, i) => [p.id, i + 1])), [poolPlayers])
  const tierCount = poolPlayers.length ? tierOf.get(poolPlayers[poolPlayers.length - 1].id)! : 0

  const isTaken = (id: string) => pickedBy.has(id) || manual.has(id)
  const available = poolPlayers.filter(p => !isTaken(p.id))
  const remainingInTier = new Map<number, number>()
  for (const p of available) remainingInTier.set(tierOf.get(p.id)!, (remainingInTier.get(tierOf.get(p.id)!) ?? 0) + 1)

  const q = query.trim().toLowerCase()
  const shown = poolPlayers.filter(p => (pos === 'All' || p.pos === pos) && (!q || p.name.toLowerCase().includes(q)) && (showTaken || !isTaken(p.id)))

  // ---- the clock and your picks ---------------------------------------------------------
  const made = new Set(picks.map(p => p.pickNo))
  const live = status === 'drafting' || status === 'paused'
  const onClock = live ? d?.order.find(s => !made.has(s.pickNo)) : undefined
  const myRid = d?.myRosterId ?? null
  const myNext = d?.order.filter(s => s.rosterId === myRid && !made.has(s.pickNo)) ?? []
  const bpa = POSITIONS.map(p => [p, available.find(x => x.pos === p)] as const)

  // ---- rooms: starter-depth value per position, including picks made so far ----------------
  const rooms = useMemo(() => {
    if (!d) return null
    const byRoster = new Map<number, DraftPlayer[]>()
    for (const p of d.players) {
      // Sleeper adds drafted players to rosters when the draft ends; until then the pick says whose.
      const owner = p.rosteredBy ?? pickedBy.get(p.id)?.rosterId ?? null
      if (owner == null) continue
      if (!byRoster.has(owner)) byRoster.set(owner, [])
      byRoster.get(owner)!.push(p)
    }
    const out: Record<string, { value: number; rank: number; of: number; top: DraftPlayer[] }> = {}
    for (const position of POSITIONS) {
      const depth = d.starterDepth[position] || 1
      const totals = d.teams.map(t => {
        const top = (byRoster.get(t.roster_id) ?? []).filter(p => p.pos === position).slice(0, depth)
        return { rid: t.roster_id, value: top.reduce((s, p) => s + p.value, 0), top }
      })
      const sorted = [...totals].sort((a, b) => b.value - a.value)
      const mine = totals.find(t => t.rid === myRid)
      if (mine) out[position] = { value: mine.value, rank: sorted.findIndex(t => t.rid === myRid) + 1, of: totals.length, top: mine.top }
    }
    return out
  }, [d, pickedBy, myRid])

  const teamGrades = useMemo(() => {
    if (!d) return []
    const ids = new Set([...d.teams.map(t => t.roster_id), ...picks.map(p => p.rosterId).filter((x): x is number => x != null)])
    return [...ids]
      .map(rid => {
        const mine = picks.filter(p => p.rosterId === rid)
        return { rid, picks: mine, grade: gradeTeam(mine.map(p => p.pickNo), grades) }
      })
      .filter(t => t.picks.length)
      .sort((a, b) => (b.grade.averageScore ?? -99) - (a.grade.averageScore ?? -99))
  }, [d, picks, grades, myRid])

  const ticker = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // A live draft keeps the newest pick in view; a finished one starts at 1.01.
    if (ticker.current && live) ticker.current.scrollLeft = ticker.current.scrollWidth
  }, [picks.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleManual = (id: string) =>
    setManual(m => {
      const n = new Set(m)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const draftLabel = (x: DraftData['drafts'][number]) => `${x.season} ${x.leagueId === leagueId ? '' : 'mock '}· ${STATUS_LABEL[x.status].toLowerCase()} · ${x.rounds} rd ${x.type}`

  // ---- selection: a team (cards / ticker highlight) and one pick (the detail card) ----------
  const hl = hoverTeam ?? selTeam
  const graded = (no: number) => {
    const g = grades.get(no)
    return g?.graded ? g : null
  }
  const myBest = picks
    .filter(p => p.rosterId === myRid && graded(p.pickNo))
    .sort((a, b) => graded(b.pickNo)!.score - graded(a.pickNo)!.score)[0]
  const shownPick = picks.find(p => p.pickNo === (selPick ?? myBest?.pickNo)) ?? picks[0]
  const shownGrade = shownPick ? grades.get(shownPick.pickNo) : undefined
  const selectTeam = (rid: number | null) => {
    setSelTeam(rid)
    if (rid != null) {
      viewPicked.current = true
      setView('teams')
    }
  }

  // ---- next move ----------------------------------------------------------------------------
  const myTeam = teamGrades.find(t => t.rid === myRid)
  const move = (() => {
    if (!d) return null
    if (live && onClock) {
      const bpaText = `Best available: ${bpa
        .filter(([, p]) => p)
        .map(([position, p]) => `${position} ${p!.name}`)
        .join(' · ')}`
      if (onClock.rosterId === myRid) return { head: 'You’re on the clock.', sub: bpaText, actions: [] }
      if (myNext[0]) {
        const k = myNext[0].pickNo - onClock.pickNo
        return { head: `${k} pick${k === 1 ? '' : 's'} until you’re up at ${myNext[0].label}.`, sub: bpaText, actions: [] }
      }
    }
    if (!myTeam?.grade.letter) return null
    const mine = LETTERS.indexOf(myTeam.grade.letter)
    const others = teamGrades.filter(t => t.rid !== myRid && t.grade.letter).map(t => LETTERS.indexOf(t.grade.letter!))
    const better = others.filter(x => x < mine).length
    const rank = better === 0 ? (others.includes(mine) ? ', tied for best in the room' : ', best in the room') : `, #${better + 1} of ${others.length + 1}`
    const g = myBest && graded(myBest.pickNo)
    return {
      head: `You graded ${myTeam.grade.letter}${rank}.`,
      sub: myBest && g ? `Best value: ${myBest.name} at ${myBest.label}, ranked ${g.position}${g.userRank} on the sheet.` : undefined,
      actions: [
        selTeam === myRid
          ? { label: 'Show all teams', primary: true, onClick: () => selectTeam(null) }
          : { label: 'Show my picks', primary: true, onClick: () => selectTeam(myRid) },
      ],
    }
  })()

  return (
    <div className="page dr2-page">
      {move && <NextMove head={move.head} sub={move.sub} actions={move.actions} />}
      <div className="toolbar">
        <div className="dr2-title">
          {d ? `${d.draft.season} draft` : 'Draft'}
          {d && <span className={`dr2-status ${status}`}>{STATUS_LABEL[status]}</span>}
        </div>
        <Segmented<DraftPool>
          value={pool}
          onChange={setPool}
          options={[
            { value: 'rookies', label: 'Rookies' },
            { value: 'all', label: 'All players' },
          ]}
        />
        {d && d.drafts.length > 1 && (
          <select className="search dr-select" value={d.draft.draft_id} onChange={e => setDraftId(e.target.value)}>
            {d.drafts.map(x => (
              <option key={x.draft_id} value={x.draft_id}>
                {draftLabel(x)}
              </option>
            ))}
          </select>
        )}
        <form
          className="dr-other"
          onSubmit={e => {
            e.preventDefault()
            if (otherId.trim()) setDraftId(otherId.trim())
          }}
        >
          <input className="search" placeholder="Other draft ID (mocks)" value={otherId} onChange={e => setOtherId(e.target.value)} />
        </form>
        <button className="btn-outline" onClick={() => load()} disabled={busy}>
          {busy ? 'Loading…' : 'Refresh'}
        </button>
        {d && (
          <span className="right">
            {d.sheet.name} · {POLL_MS[status] ? `polling every ${POLL_MS[status]! / 1000}s` : 'not polling'}
            {poll && ` · ${new Date(poll.polledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`}
          </span>
        )}
      </div>

      {res && !res.ok && <InlineError message={res.error} onRetry={() => load()} />}
      {pollError && <div className="ss-warning">Sleeper didn’t answer the last poll ({pollError}). Showing the picks from before; still retrying.</div>}
      {d && d.order.every(s => s.rosterId == null) && d.draft.status === 'pre_draft' && (
        <div className="ss-warning">Sleeper hasn’t set this draft’s order yet, so whose pick is whose isn’t known. It fills in once the commissioner sets it.</div>
      )}

      {d && picks.length > 0 && (
        <div className="dr2-ticker" ref={ticker}>
          {picks.map(p => {
            const g = grades.get(p.pickNo)
            return (
              <button
                key={p.pickNo}
                className={`dr2-tile ${shownPick?.pickNo === p.pickNo ? 'sel' : ''} ${hl != null && hl !== p.rosterId ? 'fade' : ''}`}
                title={teamName(p.rosterId)}
                onClick={() => setSelPick(p.pickNo)}
              >
                <span className="top">
                  <span>{p.label}</span>
                  <GradeChip g={g} />
                </span>
                <span className="nm">{p.name}</span>
                <span className="tm">{teamName(p.rosterId)}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="dr2-layout">
        <div className="dr-main">
          <div className="toolbar dr-filters">
            <Segmented<'board' | 'teams'>
              value={view}
              onChange={v => {
                viewPicked.current = true
                setView(v)
              }}
              options={[
                { value: 'board', label: 'Board' },
                { value: 'teams', label: 'Teams' },
              ]}
            />
            {view === 'board' && (
              <>
                <Segmented<PosFilter> value={pos} onChange={setPos} options={(['All', ...POSITIONS] as PosFilter[]).map(v => ({ value: v, label: v }))} />
                <input className="search" placeholder="Search players" value={query} onChange={e => setQuery(e.target.value)} />
                <Segmented<'avail' | 'all'>
                  value={showTaken ? 'all' : 'avail'}
                  onChange={v => setShowTaken(v === 'all')}
                  options={[
                    { value: 'avail', label: `Available ${available.length}` },
                    { value: 'all', label: 'Show taken' },
                  ]}
                />
              </>
            )}
          </div>

          {view === 'board' && (
            <div className="gtable dr-table">
              <div className="inner" style={{ minWidth: 760 }}>
                <div className="head" style={{ gridTemplateColumns: GRID }}>
                  <div className="r" style={{ padding: '0 10px' }} title="Rank within this pool">
                    #
                  </div>
                  <div style={{ padding: '0 10px' }}>Player</div>
                  <div style={{ padding: '0 10px' }} title="Rank at his position within this pool">
                    Pos
                  </div>
                  <div className="r" style={{ padding: '0 10px' }} title="Tyler's overall dynasty rank (TE-prem board)">
                    Sheet
                  </div>
                  <div className="r" style={{ padding: '0 10px' }} title="10000·e^(−rank/70), the same scale as Overview">
                    Value
                  </div>
                  <div style={{ padding: '0 10px' }}>Status</div>
                </div>
                {!d && !(res && !res.ok) && <SkeletonRows n={12} />}
                {d && shown.length === 0 && <div className="empty dr-empty">No players match. {available.length === 0 ? 'The pool is empty.' : ''}</div>}
                {shown.map((p, i) => {
                  const tier = tierOf.get(p.id)!
                  const header = tierCount > 1 && (i === 0 || tierOf.get(shown[i - 1].id) !== tier)
                  const pick = pickedBy.get(p.id)
                  const left = remainingInTier.get(tier) ?? 0
                  return (
                    <div key={p.id}>
                      {header && (
                        <div className="dr-tier">
                          <span className="eyebrow">Tier {tier}</span>
                          <span className={`dr-left ${left > 0 && left <= 2 ? 'low' : ''}`}>{left === 0 ? 'gone' : `${left} left`}</span>
                        </div>
                      )}
                      <div className={`row dr-row ${isTaken(p.id) ? 'taken' : ''}`} style={{ gridTemplateColumns: GRID }}>
                        <div className="r faint" style={{ padding: '0 10px' }}>
                          {poolRank.get(p.id)}
                        </div>
                        <div className="ss-player">
                          <PlayerAvatar id={p.id} name={p.name} />
                          <span className="nm">{p.name}</span>
                          <span className="pt">
                            {p.team}
                            {p.age != null && ` · ${fmtAge(p.age)}`}
                          </span>
                          {p.injury && <span className="status warn">{p.injury}</span>}
                          {!pick && p.rosteredBy != null && pool === 'all' && (
                            <span className="status muted" title={`On ${teamName(p.rosteredBy)}`}>
                              Rostered
                            </span>
                          )}
                        </div>
                        <div style={{ padding: '0 10px' }}>
                          {p.pos}
                          {rankIndex.get(p.pos)?.get(p.id)}
                        </div>
                        <div className="r ink3" style={{ padding: '0 10px' }}>
                          {p.rank}
                        </div>
                        <div className="r" style={{ padding: '0 10px' }}>
                          {p.value.toLocaleString()}
                        </div>
                        <div className="dr-state">
                          {pick ? (
                            <>
                              <span className="mono">{pick.label}</span>
                              <span className={`dr-by ${pick.rosterId === myRid ? 'mine' : ''}`}>{teamName(pick.rosterId)}</span>
                              <GradeChip g={grades.get(pick.pickNo)} />
                            </>
                          ) : manual.has(p.id) ? (
                            <button className="link" onClick={() => toggleManual(p.id)}>
                              Marked taken · undo
                            </button>
                          ) : (
                            <button className="btn-secondary dr-mark" onClick={() => toggleManual(p.id)} title="For drafts held off Sleeper, or a pick Sleeper hasn't shown yet">
                              Mark taken
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {view === 'teams' && d && (
            <div className="dr2-teams">
              {teamGrades.length === 0 && <div className="empty">Team cards appear once picks are made.</div>}
              {teamGrades.map(t => (
                <div
                  key={t.rid}
                  className={`dr2-team ${selTeam === t.rid ? 'sel' : ''}`}
                  onClick={() => setSelTeam(s => (s === t.rid ? null : t.rid))}
                  onMouseEnter={() => setHoverTeam(t.rid)}
                  onMouseLeave={() => setHoverTeam(null)}
                >
                  <div className="dr2-team-head">
                    <TeamAvatar src={avatarOf(t.rid)} name={teamName(t.rid)} size={30} />
                    <span className="nm">
                      {teamName(t.rid)}
                      {t.rid === myRid && <span className="you"> you</span>}
                    </span>
                    {t.grade.letter ? (
                      <span className={`dr2-g ${toneOf(t.grade.letter)}`} title={`Average of ${t.grade.gradedCount} of ${t.grade.totalCount} picks graded`}>
                        {t.grade.letter}
                      </span>
                    ) : (
                      <span className="dr2-g none">–</span>
                    )}
                  </div>
                  {t.picks.map(p => {
                    const g = grades.get(p.pickNo)
                    return (
                      <div
                        key={p.pickNo}
                        className="dr2-team-pick"
                        onClick={e => {
                          e.stopPropagation()
                          setSelPick(p.pickNo)
                        }}
                      >
                        <span className="pk">{p.label}</span>
                        <span className="nm">{p.name}</span>
                        <span className="rk">{g?.graded ? `${g.position}${g.posPick} · sheet ${g.position}${g.userRank}` : p.pos}</span>
                        <GradeChip g={g} small />
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {d && (
          <aside className="dr2-side">
            {status !== 'complete' && (
              <div className="panel dr2-card">
                <div className="eyebrow">{live ? 'On the clock' : 'Draft not started'}</div>
                {onClock ? (
                  <div className="dr-clock">
                    <span className="mono big">{onClock.label}</span>
                    <span className={onClock.rosterId === myRid ? 'dr-you' : ''}>{onClock.rosterId === myRid ? 'You' : teamName(onClock.rosterId)}</span>
                  </div>
                ) : (
                  d.draft.startTime && <div className="dr2-why">Starts {new Date(d.draft.startTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>
                )}
                {myRid != null && (
                  <div className="dr-mine">
                    {myNext.length === 0 ? (
                      <span className="faint">You have no picks left in this draft.</span>
                    ) : (
                      <>
                        <span className="faint">Your picks: </span>
                        {myNext.map((s, i) => (
                          <span key={s.pickNo} className="mono" title={s.originalRosterId !== s.rosterId ? `Originally ${teamName(s.originalRosterId)}’s` : undefined}>
                            {i > 0 && ', '}
                            {s.label}
                            {s.originalRosterId !== s.rosterId && '*'}
                          </span>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {status !== 'complete' && (
              <div className="panel dr2-card">
                <div className="eyebrow">Best available</div>
                {bpa.map(([position, p]) => (
                  <div key={position} className="dr-bpa">
                    <span className="mono faint">{position}</span>
                    <span className="nm">
                      {p ? (
                        <>
                          <PlayerAvatar id={p.id} name={p.name} size={18} />
                          {p.name}
                        </>
                      ) : (
                        <span className="faint">none left</span>
                      )}
                    </span>
                    {p && <span className="mono faint">#{p.rank}</span>}
                  </div>
                ))}
              </div>
            )}

            {shownPick && (
              <div className="panel dr2-card">
                <div className="eyebrow">Selected pick</div>
                <div className="dr2-sel">
                  <span className="nm">
                    {shownPick.label} {shownPick.name}
                  </span>
                  {shownGrade?.graded ? <span className={`big ${toneOf(shownGrade.letter)}`}>{shownGrade.letter}</span> : <span className="big none">–</span>}
                </div>
                <div className="dr2-meta">
                  {shownPick.pos} · {teamName(shownPick.rosterId)}
                  {shownGrade?.graded && ` · went ${shownGrade.position}${shownGrade.posPick}, sheet ${shownGrade.position}${shownGrade.userRank}`}
                </div>
                <div className="dr2-why">{shownGrade ? whyOf(shownGrade) : ''}</div>
              </div>
            )}

            {rooms && myRid != null && (
              <div className="panel dr2-card">
                <div className="eyebrow">Your room</div>
                {POSITIONS.map(position => {
                  const r = rooms[position]
                  if (!r) return null
                  const weak = r.rank > Math.ceil((r.of * 2) / 3)
                  const strong = r.rank <= Math.ceil(r.of / 3)
                  return (
                    <div key={position} className="dr2-room" title={r.top.map(p => p.name).join(', ') || 'Nobody ranked'}>
                      <span className="k">{position}</span>
                      <span>{r.value.toLocaleString()}</span>
                      <span className={weak ? 'neg' : strong ? 'pos' : 'ink3'}>
                        {ordinal(r.rank)} of {r.of}
                      </span>
                    </div>
                  )
                })}
                <div className="dr2-foot">
                  Value of your top {POSITIONS.map(p => `${d.starterDepth[p]} ${p}`).join(', ')}, ranked against every team. Includes picks made in this draft.
                </div>
              </div>
            )}

            <div className="dr2-foot">
              Grades port draftPunk’s sheet-order rule: how far a player went past (or ahead of) his position rank on the sheet, within the {pool === 'rookies' ? 'rookie' : 'whole-board'} pool, rescaled for pool depth. Tiers break where 12+ players sit between two pool players on Tyler’s overall board.
              {d.sheet.unmatched > 0 && ` ${d.sheet.unmatched} sheet names didn’t match a Sleeper player.`}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
