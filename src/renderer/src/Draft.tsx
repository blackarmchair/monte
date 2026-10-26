// Draft: how the rookie draft went, as team-coloured pick cards with a grade heat chip, and every
// team's grade; the sticky right panel holds the selected pick (your best-value pick by default)
// and the draft's controls. While a draft is live (or about to be) there is also a Board of who's
// left. Grades port draftPunk's sheet-order rule; Sleeper is polled while the draft can change.
import { useEffect, useMemo, useState } from 'react'
import type { DraftData, DraftPickRow, DraftPlayer, DraftPool, DraftPoll, DraftStatus, Result } from '@shared/types'
import { buildPositionalRankIndex, gradePicks, gradeTeam, type GradeLetter, type PickGrade } from '@shared/draftGrade'
import { teamLabel } from './names'
import { useApp } from './store'
import { Btn, Empty, ErrorBox, GradCard, Headshot, HeatChip, Link, Loading, NeedsSheet, nflColor, Notice, Pills, RING, Seg, Stack2, Tag, TeamAvatar, teamColor, useHeat } from './ui'

const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
/** A new tier starts where 12+ players sit between two pool players on Tyler's overall board. */
const TIER_GAP = 12
/** How often Sleeper is asked for picks, by draft status. A finished draft is not polled. */
const POLL_MS: Record<DraftStatus, number | null> = { drafting: 5000, paused: 15000, pre_draft: 30000, complete: null }
const STATUS_LABEL: Record<DraftStatus, string> = { drafting: 'Live', paused: 'Paused', pre_draft: 'Not started', complete: 'Complete' }
const PAGE = 60
const LETTERS: GradeLetter[] = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F']
/** Grade points for the heat scale: C and below read as bad, A+ as fully good. */
const GPA: Record<string, number> = { 'A+': 4.3, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, D: 1, F: 0 }

function whyOf(g: PickGrade): string {
  if (!g.graded) return g.reason === 'not-on-sheet' ? 'Not on the sheet, so not graded.' : 'Position not graded.'
  const diff = g.posPick - g.userRank
  if (diff > 0) return `Went ${diff} spot${diff === 1 ? '' : 's'} after his sheet rank at ${g.position}. Value pick.`
  if (diff < 0) return `Went ${-diff} spot${diff === -1 ? '' : 's'} before his sheet rank at ${g.position}. Reach.`
  return 'Went right at his sheet rank.'
}

function GradeChip({ g, big }: { g: string | null | undefined; big?: boolean }) {
  const { heat } = useHeat()
  return (
    <HeatChip
      label={g ?? '–'}
      colors={g ? heat((GPA[g] - 2) / 2.3) : { bg: 'var(--surf2)', fg: 'var(--mute)' }}
      minWidth={big ? 48 : 38}
      height={big ? 40 : 32}
      size={big ? 20 : 15}
      style={{ padding: '0 6px' }}
    />
  )
}

export default function DraftPanel() {
  const { context, settings, hide, dataVersion, sheet, openPlayer } = useApp()
  const leagueId = context?.league.league_id
  const userId = settings.userId
  const [draftId, setDraftId] = useState<string | undefined>(undefined)
  const [otherId, setOtherId] = useState('')
  const [res, setRes] = useState<Result<DraftData> | null>(null)
  const [busy, setBusy] = useState(false)
  const [poll, setPoll] = useState<DraftPoll | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [pool, setPool] = useState<DraftPool>('rookies')
  const [seg, setSeg] = useState<string | null>(null)
  const [pos, setPos] = useState<'All' | (typeof POSITIONS)[number]>('All')
  const [limit, setLimit] = useState(PAGE)
  const [selPick, setSelPick] = useState<number | null>(null)
  const [selTeam, setSelTeam] = useState<number | null>(null)
  // Players marked taken by hand: drafts held off Sleeper, or a pick Sleeper hasn't shown yet.
  const [manual, setManual] = useState<Set<string>>(new Set())

  const load = (id = draftId) => {
    if (!leagueId || !userId || !sheet) return
    setBusy(true)
    void window.monte.draft(leagueId, userId, id).then(r => {
      setRes(r)
      setBusy(false)
      if (r.ok) {
        setPoll(r.value.initial)
        setPollError(null)
        setPool(r.value.defaultPool)
        setManual(new Set())
      }
    })
  }
  useEffect(load, [leagueId, userId, draftId, dataVersion, !!sheet]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = res?.ok ? res.value : null
  const status = poll?.status ?? d?.draft.status ?? 'complete'

  // Poll while the draft can still change; a status change reloads everything.
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
    const m = new Map(d?.teams.map(x => [x.roster_id, x.name]))
    return (rid: number | null) => (rid == null ? 'Unknown' : hide ? teamLabel(rid) : m.get(rid) ?? `Roster ${rid}`)
  }, [d, hide])

  const inPool = (p: DraftPlayer) => pool === 'all' || p.rookie || pickedBy.has(p.id)
  const poolPlayers = useMemo(() => (d ? d.players.filter(inPool) : []), [d, pool, pickedBy]) // eslint-disable-line react-hooks/exhaustive-deps
  const rankIndex = useMemo(() => buildPositionalRankIndex(poolPlayers, () => true), [poolPlayers])
  const grades = useMemo(() => gradePicks(picks, rankIndex), [picks, rankIndex])
  const tierOf = useMemo(() => {
    const m = new Map<string, number>()
    let tier = 1
    poolPlayers.forEach((p, i) => {
      if (i > 0 && p.rank - poolPlayers[i - 1].rank >= TIER_GAP) tier++
      m.set(p.id, tier)
    })
    return m
  }, [poolPlayers])
  const teamGrades = useMemo(() => {
    if (!d) return []
    const ids = new Set([...d.teams.map(x => x.roster_id), ...picks.map(p => p.rosterId).filter((x): x is number => x != null)])
    return [...ids]
      .map(rid => {
        const mine = picks.filter(p => p.rosterId === rid)
        return { rid, picks: mine, grade: gradeTeam(mine.map(p => p.pickNo), grades) }
      })
      .filter(x => x.picks.length)
      .sort((a, b) => (b.grade.averageScore ?? -99) - (a.grade.averageScore ?? -99))
  }, [d, picks, grades])

  if (!sheet) return <NeedsSheet />
  if (!context) return <Loading label="Loading league…" />

  const made = new Set(picks.map(p => p.pickNo))
  const live = status === 'drafting' || status === 'paused'
  const open = status !== 'complete'
  const onClock = live ? d?.order.find(s => !made.has(s.pickNo)) : undefined
  const myRid = d?.myRosterId ?? null
  const myNext = d?.order.filter(s => s.rosterId === myRid && !made.has(s.pickNo)) ?? []
  const available = poolPlayers.filter(p => !pickedBy.has(p.id) && !manual.has(p.id))
  const rounds = [...new Set(picks.map(p => p.round))].sort((a, b) => a - b)
  const segs = [...(open ? ['Board'] : []), ...rounds.map(r => `Rd ${r}`), 'Teams']
  const cur = seg && segs.includes(seg) ? seg : segs[0]
  const graded = (no: number) => {
    const g = grades.get(no)
    return g?.graded ? g : null
  }

  // Headline: your grade and where it ranks, or the clock while live.
  const myTeam = teamGrades.find(x => x.rid === myRid)
  const myBest = picks.filter(p => p.rosterId === myRid && graded(p.pickNo)).sort((a, b) => graded(b.pickNo)!.score - graded(a.pickNo)!.score)[0]
  let head = d ? `${d.draft.season} draft: ${STATUS_LABEL[status].toLowerCase()}.` : ''
  let sub = ''
  if (live && onClock) {
    if (onClock.rosterId === myRid) head = "You're on the clock."
    else if (myNext[0]) {
      const k = myNext[0].pickNo - onClock.pickNo
      head = `${k} pick${k === 1 ? '' : 's'} until you're up at ${myNext[0].label}.`
    }
    sub = `On the clock: ${onClock.label} ${onClock.rosterId === myRid ? 'you' : teamName(onClock.rosterId)}.`
  } else if (myTeam?.grade.letter) {
    const mine = LETTERS.indexOf(myTeam.grade.letter)
    const others = teamGrades.filter(x => x.rid !== myRid && x.grade.letter)
    const better = others.filter(x => LETTERS.indexOf(x.grade.letter!) < mine).length
    const tied = others.some(x => LETTERS.indexOf(x.grade.letter!) === mine)
    head = `You graded ${myTeam.grade.letter}, ${tied ? 'tied for ' : ''}#${better + 1} of ${teamGrades.length}.`
    const g = myBest && graded(myBest.pickNo)
    if (myBest && g) sub = `Best value: ${myBest.name} at ${myBest.label}, sheet ${g.position}${g.userRank}.`
  } else if (status === 'pre_draft' && d?.draft.startTime) {
    sub = `Starts ${new Date(d.draft.startTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`
  }

  const shownPick = picks.find(p => p.pickNo === selPick) ?? myBest ?? picks.find(p => p.rosterId === myRid) ?? picks[0]
  const shownTeam = cur === 'Teams' ? teamGrades.find(x => x.rid === selTeam) ?? myTeam ?? teamGrades[0] : undefined
  const toggleManual = (id: string) =>
    setManual(m => {
      const n = new Set(m)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const pickCard = (p: DraftPickRow, ring: boolean) => {
    const g = grades.get(p.pickNo)
    return (
      <GradCard
        key={p.pickNo}
        color={p.rosterId != null ? teamColor(p.rosterId) : null}
        ring={ring ? RING : p.rosterId === myRid ? 'inset 0 0 0 1px color-mix(in oklab, var(--acc) 50%, transparent)' : undefined}
        onClick={() => setSelPick(p.pickNo)}
        style={{ padding: '8px 14px' }}
      >
        <span className="num mute" style={{ width: 34, fontSize: 14, fontWeight: 700 }}>
          {p.label}
        </span>
        <Headshot id={p.playerId} name={p.name} size={40} />
        <Stack2 title={p.name} sub={`${p.pos} · ${teamName(p.rosterId)}`} />
        <GradeChip g={g?.graded ? g.letter : null} />
      </GradCard>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 400px', gap: 24, alignItems: 'start' }}>
      <div className="stack" style={{ gap: 14, minWidth: 0 }}>
        <div className="hero" style={{ gap: 8 }}>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>{head || 'Loading the draft…'}</div>
          {!!sub && <div className="sub" style={{ fontSize: 15 }}>{sub}</div>}
          {live && myNext.length > 0 && <div className="sub" style={{ fontSize: 15 }}>Your picks: {myNext.map(s => s.label).join(', ')}</div>}
        </div>
        {res && !res.ok && <ErrorBox message={res.error} onRetry={() => load()} />}
        {!res && busy && <Loading label="Loading the draft…" />}
        {pollError && <Notice message={`Sleeper didn't answer the last check (${pollError}). Still retrying.`} />}
        {d && d.order.every(s => s.rosterId == null) && d.draft.status === 'pre_draft' && (
          <Notice message="Sleeper hasn't set this draft's order yet. It fills in once the commissioner sets it." />
        )}

        {d && (
          <>
            <Pills value={cur} onChange={setSeg} options={segs.map(s => ({ value: s, label: s.replace(/^Rd /, 'Round ') }))} />

            {cur === 'Board' && (
              <>
                <Pills value={pos} onChange={v => setPos(v)} options={(['All', ...POSITIONS] as const).map(v => ({ value: v, label: v }))} />
                {available.length === 0 && <Empty message="The pool is empty." />}
                {(() => {
                  const shown = available.filter(p => pos === 'All' || p.pos === pos)
                  const tiers = [...new Set(shown.slice(0, limit).map(p => tierOf.get(p.id)!))]
                  return (
                    <>
                      {tiers.map(tier => (
                        <div key={tier} className="stack" style={{ gap: 8 }}>
                          <span className="label" style={{ paddingTop: 4 }}>
                            Tier {tier}
                          </span>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
                            {shown
                              .slice(0, limit)
                              .filter(p => tierOf.get(p.id) === tier)
                              .map(p => (
                                <GradCard key={p.id} color={nflColor(p.team)} style={{ padding: '8px 14px' }}>
                                  <span className="num mute" style={{ width: 34, fontSize: 14, fontWeight: 700 }}>
                                    #{p.rank}
                                  </span>
                                  <Headshot id={p.id} name={p.name} size={40} />
                                  <Stack2
                                    title={p.name}
                                    sub={`${p.pos}${rankIndex.get(p.pos)?.get(p.id) ?? ''} · ${p.team}${p.age != null ? ` · ${p.age.toFixed(0)}` : ''}${p.injury ? ` · ${p.injury}` : ''}`}
                                  />
                                  <Link label={manual.has(p.id) ? 'Undo' : 'Taken'} onClick={() => toggleManual(p.id)} />
                                </GradCard>
                              ))}
                          </div>
                        </div>
                      ))}
                      {shown.length > limit && <Btn label={`Show more (${shown.length - limit} left)`} onClick={() => setLimit(l => l + PAGE)} bg="var(--surf)" />}
                    </>
                  )
                })()}
              </>
            )}

            {cur.startsWith('Rd ') && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
                {picks.filter(p => `Rd ${p.round}` === cur).map(p => pickCard(p, p.pickNo === shownPick?.pickNo))}
              </div>
            )}

            {cur === 'Teams' &&
              (teamGrades.length === 0 ? (
                <Empty message="Team grades appear once picks are made." />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
                  {teamGrades.map((x, i) => (
                    <GradCard key={x.rid} color={teamColor(x.rid)} ring={x.rid === shownTeam?.rid ? RING : undefined} onClick={() => setSelTeam(x.rid)} style={{ padding: '8px 14px' }}>
                      <span className="num mute" style={{ width: 22, fontSize: 14, fontWeight: 700 }}>
                        {i + 1}
                      </span>
                      <TeamAvatar rid={x.rid} name={teamName(x.rid)} size={40} />
                      <Stack2 title={teamName(x.rid)} sub={`${x.picks.length} pick${x.picks.length === 1 ? '' : 's'}${x.rid === myRid ? ' · you' : ''}`} />
                      <GradeChip g={x.grade.letter} />
                    </GradCard>
                  ))}
                </div>
              ))}
          </>
        )}
      </div>

      <div className="sticky stack" style={{ gap: 16 }}>
        {shownTeam ? (
          <div className="hero" style={{ padding: 22 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.15 }}>{teamName(shownTeam.rid)}</span>
              <GradeChip g={shownTeam.grade.letter} big />
            </div>
            <div className="sub" style={{ fontSize: 14 }}>
              Rookie draft picks
            </div>
            {shownTeam.picks.map(p => {
              const g = grades.get(p.pickNo)
              return (
                <GradCard key={p.pickNo} color={teamColor(shownTeam.rid)} minHeight={56} onClick={() => openPlayer(p.playerId, p.name)} style={{ padding: '6px 12px', background: 'var(--surf2)' }}>
                  <span className="num mute" style={{ width: 34, fontSize: 13, fontWeight: 700 }}>
                    {p.label}
                  </span>
                  <Stack2 title={p.name} size={14} sub={`${p.pos}${g?.graded ? ` · sheet ${g.position}${g.userRank}` : ''}`} />
                  <GradeChip g={g?.graded ? g.letter : null} />
                </GradCard>
              )
            })}
          </div>
        ) : (
          shownPick && (
            <div className="hero" style={{ padding: 22 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.15 }}>
                  {shownPick.label} {shownPick.name}
                </span>
                <GradeChip g={graded(shownPick.pickNo)?.letter ?? null} big />
              </div>
              <div className="sub" style={{ fontSize: 14 }}>
                {shownPick.pos} · {teamName(shownPick.rosterId)}
                {(() => {
                  const g = graded(shownPick.pickNo)
                  return g ? ` · went ${g.position}${g.posPick}, sheet ${g.position}${g.userRank}` : ''
                })()}
              </div>
              {grades.get(shownPick.pickNo) && <div style={{ fontSize: 17, fontWeight: 600, textWrap: 'pretty' }}>{whyOf(grades.get(shownPick.pickNo)!)}</div>}
              <div>
                <Btn label="Open player" onClick={() => openPlayer(shownPick.playerId, shownPick.name)} style={{ minHeight: 42 }} />
              </div>
            </div>
          )
        )}

        {d && (
          <div className="hero" style={{ padding: 22, gap: 12 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="sub" style={{ fontSize: 14, flex: 1 }}>
                Grade against
              </span>
              <Seg
                onSurf
                value={pool}
                onChange={setPool}
                options={[
                  { value: 'rookies', label: 'Rookies' },
                  { value: 'all', label: 'All players' },
                ]}
              />
            </div>
            {d.drafts.length > 1 && (
              <div className="pills">
                {d.drafts.map(x => (
                  <button key={x.draft_id} className={`pill${x.draft_id === d.draft.draft_id ? ' on' : ''}`} style={x.draft_id === d.draft.draft_id ? undefined : { background: 'var(--surf2)' }} onClick={() => setDraftId(x.draft_id)}>
                    {x.season}
                    {x.leagueId === leagueId ? '' : ' mock'} · {STATUS_LABEL[x.status].toLowerCase()}
                  </button>
                ))}
              </div>
            )}
            <label className="field on-surf">
              <input
                value={otherId}
                onChange={e => setOtherId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && otherId.trim() && setDraftId(otherId.trim())}
                placeholder="Other draft ID (mocks), then Enter"
              />
            </label>
            <div className="row" style={{ gap: 10 }}>
              <Tag label={STATUS_LABEL[status]} tone={status === 'drafting' ? 'acc' : status === 'paused' ? 'warn' : 'mid'} />
              <span className="small mute" style={{ flex: 1 }}>
                {d.sheet.name} · {POLL_MS[status] ? `checking every ${POLL_MS[status]! / 1000}s` : 'not polling'}
              </span>
              <Link label={busy ? 'Loading…' : 'Refresh'} onClick={() => load()} disabled={busy} />
            </div>
            <span className="small mute">
              Grades: how far a player went past (or ahead of) his position rank on the sheet, within the {pool === 'rookies' ? 'rookie' : 'whole-board'} pool.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
