// Draft (its own section): a toolbar to pick the draft (yours, or a mock by id) and the pool, then
// one of three views. Live (not started, running or paused): a strip of picks with the clock in
// it, then the Board, the sheet's whole list with drafted players greyed in place (draftPunk's
// layout), or Teams. Complete: pick cards with grade heat chips and every team's grade, the
// selected pick or team in the sticky right panel. Until Sleeper creates next season's draft, that
// season opens as a provisional order from Pick odds' projection, with traded picks applied.
// Grades port draftPunk's sheet-order rule; Sleeper is polled while the draft can change.
import { sheetName } from '@shared/names'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { DraftData, DraftPickRow, DraftPlayer, DraftPool, DraftPoll, DraftStatus, Result } from '@shared/types'
import { provisionalOrder, withMarks } from '@shared/draft'
import { projectedSlots } from '@shared/slots'
import { buildPositionalRankIndex, gradePicks, gradeTeam, type GradeLetter, type PickGrade } from '@shared/draftGrade'
import { teamLabel } from './names'
import { useApp } from './store'
import { quantileSlot } from './PickOdds'
import { Btn, Empty, ErrorBox, GradCard, grad, Headshot, HeatChip, Link, Loading, NeedsSheet, Notice, Pills, RING, RING_SOFT, Seg, Stack2, Tag, TeamAvatar, teamColor, useHeat } from './ui'

const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
/** A new tier starts where 12+ players sit between two pool players on the sheet's overall board. */
const TIER_GAP = 12
/** How often Sleeper is asked for picks, by draft status. A finished draft is not polled. */
const POLL_MS: Record<DraftStatus, number | null> = { drafting: 5000, paused: 15000, pre_draft: 30000, complete: null }
const STATUS_LABEL: Record<DraftStatus, string> = { drafting: 'Live', paused: 'Paused', pre_draft: 'Not started', complete: 'Complete' }
/** Board rows drawn at first, and per Show more. */
const PAGE = 150
/** Pick and team cards: every round on one page, so the cards stay compact. */
const CARDS: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }
const CARD_PAD: CSSProperties = { padding: '6px 12px' }
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

function GradeChip({ g, big, small }: { g: string | null | undefined; big?: boolean; small?: boolean }) {
  const { heat } = useHeat()
  return (
    <HeatChip
      label={g ?? '–'}
      colors={g ? heat((GPA[g] - 2) / 2.3) : { bg: 'var(--surf2)', fg: 'var(--mute)' }}
      minWidth={big ? 48 : small ? 32 : 38}
      height={big ? 40 : small ? 24 : 32}
      size={big ? 20 : small ? 13 : 15}
      style={{ padding: '0 6px' }}
    />
  )
}

export default function DraftPanel() {
  const { context, settings, hide, dataVersion, sheet, openPlayer, bb, runBB, go, setSettings } = useApp()
  const leagueId = context?.league.league_id
  const userId = settings.userId
  const [draftId, setDraftId] = useState<string | undefined>(undefined)
  /** show the provisional order for next season's draft while Sleeper has none */
  const [preferNext, setPreferNext] = useState(true)
  const [otherId, setOtherId] = useState('')
  const [res, setRes] = useState<Result<DraftData> | null>(null)
  const [busy, setBusy] = useState(false)
  const [poll, setPoll] = useState<DraftPoll | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [pool, setPool] = useState<DraftPool>('rookies')
  const [liveTab, setLiveTab] = useState<'board' | 'teams'>('board')
  const [pos, setPos] = useState<'All' | (typeof POSITIONS)[number]>('All')
  const [q, setQ] = useState('')
  const [hideTaken, setHideTaken] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const strip = useRef<HTMLDivElement>(null)
  const [selPick, setSelPick] = useState<number | null>(null)
  const [selTeam, setSelTeam] = useState<number | null>(null)
  // Players marked taken by hand: drafts held off Sleeper, or a pick Sleeper hasn't shown yet.
  // Saved per draft in settings, so leaving the screen (a player's page) or restarting keeps them.
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
      }
    })
  }
  useEffect(load, [leagueId, userId, draftId, dataVersion, !!sheet]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = res?.ok ? res.value : null
  const draftKey = d?.draft.draft_id
  useEffect(() => setManual(new Set(draftKey ? settings?.draftMarks?.[draftKey] ?? [] : [])), [draftKey]) // eslint-disable-line react-hooks/exhaustive-deps
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

  // The draft's own seats: a mock's slot numbers aren't the league's roster ids.
  const avatarOf = (rid: number | null) => (hide || rid == null ? null : d?.teams.find(t => t.roster_id === rid)?.avatar ?? null)

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

  const nextSeason = context?.draftSeason
  const nextMissing = !!d && !!nextSeason && !d.drafts.some(x => x.season === nextSeason && x.leagueId === leagueId)
  const provisional = nextMissing && preferNext && draftId === undefined
  const projected = bb.result
  useEffect(() => {
    if (provisional && !bb.result && !bb.busy && !bb.error) runBB()
  }, [provisional]) // eslint-disable-line react-hooks/exhaustive-deps
  const nextOrder = useMemo(() => {
    if (!provisional || !projected || !context) return []
    const slotOf = projectedSlots(projected.teams)
    const slots = [...slotOf.keys()].sort((a, b) => slotOf.get(a)! - slotOf.get(b)!)
    // Rookie drafts keep the league's last draft type; a startup (snake) doesn't count.
    const last = d!.drafts.find(x => x.leagueId === leagueId && x.rounds <= context.draftRounds)
    return provisionalOrder(slots, context.draftRounds, last?.type ?? 'linear', context.pickOwner ?? {})
  }, [provisional, projected, context, d, leagueId])
  const pickDraft = (id: string | undefined, next: boolean) => {
    setPreferNext(next)
    setDraftId(id)
  }

  const draftPills = () => (
    <>
      {d && (d.drafts.length > 1 || nextMissing) && (
        <div className="pills">
          {nextMissing && (
            <button className={`pill${provisional ? ' on' : ''}`} style={provisional ? undefined : { background: 'var(--surf2)' }} onClick={() => pickDraft(undefined, true)}>
              {nextSeason} · provisional
            </button>
          )}
          {d.drafts.map(x => {
            const on = !provisional && x.draft_id === d.draft.draft_id
            return (
              <button key={x.draft_id} className={`pill${on ? ' on' : ''}`} style={on ? undefined : { background: 'var(--surf2)' }} onClick={() => pickDraft(x.draft_id, false)}>
                {x.season}
                {x.leagueId === leagueId ? '' : ' mock'} · {STATUS_LABEL[on ? status : x.status].toLowerCase()}
              </button>
            )
          })}
        </div>
      )}
      <label className="field" style={{ width: 280 }}>
        <input
          value={otherId}
          onChange={e => setOtherId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && otherId.trim() && pickDraft(otherId.trim(), false)}
          placeholder="Other draft ID (mocks), then Enter"
        />
      </label>
    </>
  )

  const renderProvisional = () => {
    const rounds = [...new Set(nextOrder.map(s => s.round))]
    const myRid = d?.myRosterId ?? null
    const mine = nextOrder.filter(s => s.rosterId === myRid)
    const distOf = new Map(projected?.teams.map(t => [t.roster_id, t.slotDist]))
    const whatIfs = !!projected && Object.values(projected.forced ?? {}).some(w => w.length)
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 400px', gap: 24, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 14, minWidth: 0 }}>
          <div className="hero" style={{ gap: 8 }}>
            <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>{nextSeason} draft: provisional order.</div>
            {nextOrder.length > 0 && (
              <div className="sub" style={{ fontSize: 15 }}>
                {mine.length ? `Your picks: ${mine.map(s => s.label).join(', ')}.` : `You don't own a ${nextSeason} pick in this league.`}
              </div>
            )}
          </div>
          {bb.error && <ErrorBox message={bb.error} onRetry={() => runBB()} />}
          {!projected && !bb.error && <Loading label="Projecting the order…" />}
          {nextOrder.length > 0 && (
            <>
              {rounds.map(rd => (
              <div key={rd} className="stack" style={{ gap: 8 }}>
              <span className="label" style={{ paddingTop: 4 }}>Round {rd}</span>
              <div style={CARDS}>
                {nextOrder
                  .filter(s => s.round === rd)
                  .map(s => {
                    const dist = s.originalRosterId != null ? distOf.get(s.originalRosterId) : undefined
                    const [lo, hi] = dist ? [quantileSlot(dist, 0.1), quantileSlot(dist, 0.9)] : [0, 0]
                    const range = !dist ? '' : lo === hi ? `slot ${lo}` : `slots ${lo}–${hi}`
                    const via = s.originalRosterId != null && s.originalRosterId !== s.rosterId ? `via ${teamName(s.originalRosterId)}` : ''
                    return (
                      <GradCard
                        key={s.pickNo}
                        color={s.rosterId != null ? teamColor(s.rosterId) : null}
                        ring={s.rosterId === myRid ? 'inset 0 0 0 1px color-mix(in oklab, var(--acc) 50%, transparent)' : undefined}
                        minHeight={54}
                        style={CARD_PAD}
                      >
                        <span className="num mute" style={{ width: 34, fontSize: 14, fontWeight: 700 }}>
                          {s.label}
                        </span>
                        {s.rosterId != null && <TeamAvatar rid={s.rosterId} name={teamName(s.rosterId)} size={36} src={avatarOf(s.rosterId)} />}
                        <Stack2 title={`${teamName(s.rosterId)}${s.rosterId === myRid ? ' (you)' : ''}`} sub={[via, range].filter(Boolean).join(' · ') || undefined} />
                      </GradCard>
                    )
                  })}
              </div>
              </div>
              ))}
            </>
          )}
        </div>

        <div className="sticky stack" style={{ gap: 16 }}>
          <div className="hero" style={{ padding: 22, gap: 12 }}>
            <span className="small mute">
              Sleeper hasn't created the {nextSeason} draft yet. Slots follow the projected order on Pick odds{whatIfs ? ', including its what-ifs' : ''}, with traded picks
              applied, so they move as the season does. Ranges are where each pick lands in 80% of simulations.
            </span>
            <div>
              <Link label="Open Pick odds" onClick={() => go('picks')} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Keep the clock in view as picks come in.
  const made = new Set(picks.map(p => p.pickNo))
  useEffect(() => {
    const box = strip.current
    const el = box?.querySelector<HTMLElement>('[data-clock]') ?? (box?.lastElementChild as HTMLElement | null)
    if (box && el) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' })
  }, [picks.length, d?.draft.draft_id])

  if (!sheet) return <NeedsSheet />
  if (!context) return <Loading label="Loading league…" />

  const live = status === 'drafting' || status === 'paused'
  const open = status !== 'complete'
  const onClock = live ? d?.order.find(s => !made.has(s.pickNo)) : undefined
  const myRid = d?.myRosterId ?? null
  const myNext = d?.order.filter(s => s.rosterId === myRid && !made.has(s.pickNo)) ?? []
  const rounds = [...new Set(picks.map(p => p.round))].sort((a, b) => a - b)
  const graded = (no: number) => {
    const g = grades.get(no)
    return g?.graded ? g : null
  }

  // Headline: the clock while live, your grade and where it ranks once it's over.
  const myTeam = teamGrades.find(x => x.rid === myRid)
  const myBest = picks.filter(p => p.rosterId === myRid && graded(p.pickNo)).sort((a, b) => graded(b.pickNo)!.score - graded(a.pickNo)!.score)[0]
  let head = d ? `${d.draft.season} draft: ${STATUS_LABEL[status].toLowerCase()}.` : ''
  let sub = ''
  if (live && onClock) {
    if (onClock.rosterId === myRid) head = "You're on the clock."
    else if (myNext[0]) {
      const k = myNext[0].pickNo - onClock.pickNo
      head = `${k} pick${k === 1 ? '' : 's'} until you're up at ${myNext[0].label}.`
    } else head = `On the clock: ${onClock.label} ${teamName(onClock.rosterId)}.`
    if (onClock.rosterId !== myRid && myNext[0]) sub = `On the clock: ${onClock.label} ${teamName(onClock.rosterId)}.`
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

  const toggleManual = (id: string) => {
    if (!draftKey) return
    const n = new Set(manual)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setManual(n)
    void setSettings({ draftMarks: withMarks(settings?.draftMarks, draftKey, [...n]) })
  }

  const toolbar = (
    <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
      {draftPills()}
      <span style={{ flex: 1 }} />
      {d && !provisional && (
        <>
          <Tag label={STATUS_LABEL[status]} tone={status === 'drafting' ? 'acc' : status === 'paused' ? 'warn' : 'mid'} />
          <span className="small mute">{POLL_MS[status] ? `checking every ${POLL_MS[status]! / 1000}s` : sheetName(d.sheet.name, hide)}</span>
          <Link label={busy ? 'Loading…' : 'Refresh'} onClick={() => load()} disabled={busy} />
          <Seg
            value={pool}
            onChange={setPool}
            options={[
              { value: 'rookies', label: 'Rookies' },
              { value: 'all', label: 'All players' },
            ]}
          />
        </>
      )}
    </div>
  )

  let body: React.ReactNode
  if (provisional && d) body = renderProvisional()
  else if (!d) body = res && !res.ok ? <ErrorBox message={res.error} onRetry={() => load()} /> : <Loading label="Loading the draft…" />
  else body = open ? renderLive() : renderDone()

  return (
    <div className="page wide stack" style={{ gap: 20 }}>
      {toolbar}
      {pollError && <Notice message={`Sleeper didn't answer the last check (${pollError}). Still retrying.`} />}
      {body}
    </div>
  )

  // ---- live: the pick strip, then the Board (or Teams) ------------------------------------
  function renderLive() {
    const dd = d!
    const upcoming = dd.order.filter(s => !made.has(s.pickNo)).slice(0, Math.max(dd.draft.teams, 6))
    const needle = q.trim().toLowerCase()
    const isTaken = (id: string) => pickedBy.has(id) || manual.has(id)
    const rows = poolPlayers.filter(p => {
      if (pos !== 'All' && p.pos !== pos) return false
      if (needle && !p.name.toLowerCase().includes(needle)) return false
      if (hideTaken && isTaken(p.id)) return false
      return true
    })
    const takenCount = poolPlayers.filter(p => isTaken(p.id)).length
    const shown = rows.slice(0, limit)
    const firstOpen = shown.find(p => !isTaken(p.id))?.id
    return (
      <>
        <div className="hero" style={{ padding: '18px 22px', gap: 6 }}>
          <div className="row" style={{ gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2, flex: 1 }}>{head}</span>
            {myNext.length > 0 && <span className="sub">Your picks: {myNext.map(s => s.label).join(', ')}</span>}
          </div>
          {!!sub && <div className="sub">{sub}</div>}
        </div>
        {dd.order.every(s => s.rosterId == null) && status === 'pre_draft' && (
          <Notice message="Sleeper hasn't set this draft's order yet. It fills in once the commissioner sets it." />
        )}

        <div ref={strip} style={{ position: 'relative', display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
          {picks.map(p => {
            const g = graded(p.pickNo)
            return (
              <button
                key={p.pickNo}
                onClick={() => openPlayer(p.playerId, p.name)}
                title={grades.get(p.pickNo) ? whyOf(grades.get(p.pickNo)!) : undefined}
                style={{
                  flex: 'none',
                  width: 176,
                  padding: '10px 12px',
                  borderRadius: 14,
                  textAlign: 'left',
                  background: p.rosterId != null ? grad(teamColor(p.rosterId)) : 'var(--surf)',
                  boxShadow: p.rosterId === myRid ? RING_SOFT : undefined,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                <span className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                  <span className="num mute" style={{ fontSize: 13, fontWeight: 700 }}>
                    {p.label}
                  </span>
                  <GradeChip g={g?.letter ?? null} small />
                </span>
                <span className="trunc" style={{ fontWeight: 700, fontSize: 14 }}>
                  {p.name}
                </span>
                <span className="trunc small mute">{[p.pos, p.team, p.rosterId === myRid ? 'you' : teamName(p.rosterId)].filter(Boolean).join(' · ')}</span>
              </button>
            )
          })}
          {upcoming.map((s, i) => {
            const clock = live && i === 0
            const who = s.rosterId === myRid ? 'You' : teamName(s.rosterId)
            return (
              <div
                key={s.pickNo}
                data-clock={clock || undefined}
                style={{
                  flex: 'none',
                  width: 176,
                  padding: '10px 12px',
                  borderRadius: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  border: clock ? 'none' : '1px dashed color-mix(in oklab, var(--ink) 18%, transparent)',
                  boxShadow: clock ? RING : undefined,
                  background: clock ? 'var(--surf)' : 'transparent',
                }}
              >
                <span className="num mute" style={{ fontSize: 13, fontWeight: 700 }}>
                  {s.label}
                </span>
                <span className="trunc" style={{ fontWeight: 700, fontSize: 14, color: clock ? 'var(--acc)' : s.rosterId === myRid ? 'var(--ink)' : 'var(--ink2)' }}>
                  {clock ? 'On the clock' : who}
                </span>
                <span className="trunc small mute">{clock ? who : s.rosterId === myRid ? 'your pick' : 'up next'}</span>
              </div>
            )
          })}
          {picks.length === 0 && upcoming.length === 0 && <Empty message="No picks yet." />}
        </div>

        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <Seg
            lg
            value={liveTab}
            onChange={setLiveTab}
            options={[
              { value: 'board', label: 'Board' },
              { value: 'teams', label: 'Teams' },
            ]}
          />
          {liveTab === 'board' && (
            <>
              <label className="field" style={{ width: 240 }}>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the board" />
              </label>
              <Pills value={pos} onChange={v => setPos(v)} options={(['All', ...POSITIONS] as const).map(v => ({ value: v, label: v }))} />
              <button className={`pill${hideTaken ? ' on' : ''}`} onClick={() => setHideTaken(h => !h)}>
                Hide taken
              </button>
              <span className="small mute" style={{ marginLeft: 'auto' }}>
                {poolPlayers.length - takenCount} available · {takenCount} taken
              </span>
            </>
          )}
        </div>

        {liveTab === 'board' ? (
          <div className="card" style={{ padding: '4px 0' }}>
            {shown.length === 0 && (
              <div style={{ padding: 16 }}>
                <Empty message={needle ? 'No one on the board matches.' : 'The pool is empty.'} />
              </div>
            )}
            {shown.map((p, i) => {
              const by = pickedBy.get(p.id)
              const marked = manual.has(p.id)
              const taken = !!by || marked
              const fade = { opacity: taken ? 0.45 : 1 }
              const tier = tierOf.get(p.id)!
              const newTier = i === 0 || tierOf.get(shown[i - 1].id) !== tier
              const g = by ? graded(by.pickNo) : null
              return (
                <div key={p.id}>
                  {newTier && (
                    <div className="label" style={{ padding: '12px 16px 4px' }}>
                      Tier {tier}
                    </div>
                  )}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '48px minmax(0,2fr) 64px 56px 44px minmax(0,1.6fr)',
                      alignItems: 'center',
                      gap: 10,
                      minHeight: 44,
                      padding: '0 16px',
                      borderTop: '1px solid color-mix(in oklab, var(--ink) 6%, transparent)',
                      boxShadow: p.id === firstOpen ? 'inset 3px 0 0 var(--acc)' : undefined,
                    }}
                  >
                    <span className="num mute" style={{ fontSize: 13, fontWeight: 700, ...fade }}>
                      #{p.rank}
                    </span>
                    <button className="row" onClick={() => openPlayer(p.id, p.name)} style={{ gap: 10, minWidth: 0, textAlign: 'left', ...fade }}>
                      <Headshot id={p.id} name={p.name} size={28} />
                      <span className="trunc" style={{ fontWeight: 600, textDecoration: taken ? 'line-through' : undefined }}>
                        {p.name}
                      </span>
                      {p.injury && !taken && <Tag label={p.injury} tone="warn" />}
                    </button>
                    <span style={{ fontWeight: 700, fontSize: 14, ...fade }}>
                      {p.pos}
                      {rankIndex.get(p.pos)?.get(p.id) ?? ''}
                    </span>
                    <span className="small mute" style={fade}>
                      {p.team}
                    </span>
                    <span className="small mute num" style={fade}>
                      {p.age != null ? p.age.toFixed(0) : '–'}
                    </span>
                    <span className="row" style={{ gap: 8, justifyContent: 'flex-end', minWidth: 0 }}>
                      {by ? (
                        <>
                          <span className="trunc small" style={{ color: by.rosterId === myRid ? 'var(--acc)' : 'var(--ink2)' }}>
                            {by.label} · {by.rosterId === myRid ? 'you' : teamName(by.rosterId)}
                          </span>
                          <GradeChip g={g?.letter ?? null} small />
                        </>
                      ) : marked ? (
                        <>
                          <span className="small mute">Marked taken</span>
                          <Link label="Undo" onClick={() => toggleManual(p.id)} />
                        </>
                      ) : (
                        <Link label="Mark taken" onClick={() => toggleManual(p.id)} style={{ color: 'var(--mute)', fontSize: 13 }} />
                      )}
                    </span>
                  </div>
                </div>
              )
            })}
            {rows.length > limit && (
              <div style={{ padding: 12 }}>
                <Btn label={`Show more (${rows.length - limit} left)`} onClick={() => setLimit(l => l + PAGE)} bg="var(--surf2)" />
              </div>
            )}
          </div>
        ) : (
          renderTeams()
        )}
        <span className="small mute">
          The Board is the sheet's list in its order ({pool === 'rookies' ? 'rookies only' : 'every player'}). Drafted players stay in place, greyed, with who took them and the
          grade; the accent bar marks the best player left. Mark taken covers someone by hand, for a pick Sleeper hasn't shown yet or a draft held elsewhere, and is kept per draft.
        </span>
      </>
    )
  }

  /** Every team, yours first then in draft order: its picks so far with grades, and its next pick. */
  function renderTeams() {
    const dd = d!
    const firstSlot = new Map<number, number>()
    for (const s of dd.order) if (s.rosterId != null && !firstSlot.has(s.rosterId)) firstSlot.set(s.rosterId, s.pickNo)
    const rids = [...new Set([...dd.teams.map(t => t.roster_id), ...picks.map(p => p.rosterId).filter((x): x is number => x != null)])].sort(
      (a, b) => Number(b === myRid) - Number(a === myRid) || (firstSlot.get(a) ?? 999) - (firstSlot.get(b) ?? 999),
    )
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12, alignItems: 'start' }}>
        {rids.map(rid => {
          const theirs = picks.filter(p => p.rosterId === rid)
          const grade = teamGrades.find(x => x.rid === rid)?.grade.letter ?? null
          const next = dd.order.find(s => s.rosterId === rid && !made.has(s.pickNo))
          const counts = POSITIONS.map(p => [p, theirs.filter(x => x.pos === p).length] as const).filter(([, n]) => n)
          const line = [counts.map(([p, n]) => `${p} ${n}`).join(' · '), next ? `next ${next.label}` : ''].filter(Boolean).join(' · ')
          return (
            <div key={rid} className="card stack" style={{ gap: 10, background: grad(teamColor(rid)), boxShadow: rid === myRid ? RING_SOFT : undefined }}>
              <div className="row" style={{ gap: 10 }}>
                <TeamAvatar rid={rid} name={teamName(rid)} size={34} src={avatarOf(rid)} />
                <Stack2 title={`${teamName(rid)}${rid === myRid ? ' (you)' : ''}`} sub={line || 'No picks yet'} size={15} />
                <GradeChip g={grade} />
              </div>
              {theirs.map(p => {
                const g = graded(p.pickNo)
                return (
                  <button key={p.pickNo} className="row" onClick={() => openPlayer(p.playerId, p.name)} style={{ gap: 10, textAlign: 'left' }}>
                    <span className="num mute" style={{ width: 36, fontSize: 13, fontWeight: 700 }}>
                      {p.label}
                    </span>
                    <span className="trunc" style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>
                      {p.name}
                    </span>
                    <span className="small mute">{p.pos}</span>
                    <GradeChip g={g?.letter ?? null} small />
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    )
  }

  // ---- complete: every pick and team grade, the selection in the right panel --------------
  function renderDone() {
    const shownPick = picks.find(p => p.pickNo === selPick) ?? myBest ?? picks.find(p => p.rosterId === myRid) ?? picks[0]
    const shownTeam = selTeam != null ? teamGrades.find(x => x.rid === selTeam) : undefined
    const pickCard = (p: DraftPickRow, ring: boolean) => {
      const g = grades.get(p.pickNo)
      return (
        <GradCard
          key={p.pickNo}
          color={p.rosterId != null ? teamColor(p.rosterId) : null}
          ring={ring ? RING : p.rosterId === myRid ? RING_SOFT : undefined}
          onClick={() => {
            setSelPick(p.pickNo)
            setSelTeam(null)
          }}
          minHeight={54}
          style={CARD_PAD}
        >
          <span className="num mute" style={{ width: 34, fontSize: 14, fontWeight: 700 }}>
            {p.label}
          </span>
          <Headshot id={p.playerId} name={p.name} size={36} />
          <Stack2 title={p.name} sub={`${p.pos} · ${teamName(p.rosterId)}`} />
          <GradeChip g={g?.graded ? g.letter : null} />
        </GradCard>
      )
    }
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 400px', gap: 24, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 14, minWidth: 0 }}>
          <div className="hero" style={{ gap: 8 }}>
            <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>{head}</div>
            {!!sub && (
              <div className="sub" style={{ fontSize: 15 }}>
                {sub}
              </div>
            )}
          </div>
          {rounds.map(rd => (
            <div key={rd} className="stack" style={{ gap: 8 }}>
              <span className="label" style={{ paddingTop: 4 }}>
                Round {rd}
              </span>
              <div style={CARDS}>{picks.filter(p => p.round === rd).map(p => pickCard(p, !shownTeam && p.pickNo === shownPick?.pickNo))}</div>
            </div>
          ))}
          <div className="stack" style={{ gap: 8 }}>
            <span className="label" style={{ paddingTop: 4 }}>
              Team grades
            </span>
            {teamGrades.length === 0 ? (
              <Empty message="No picks were made in this draft." />
            ) : (
              <div style={CARDS}>
                {teamGrades.map((x, i) => (
                  <GradCard
                    key={x.rid}
                    color={teamColor(x.rid)}
                    ring={x.rid === shownTeam?.rid ? RING : undefined}
                    onClick={() => setSelTeam(x.rid === selTeam ? null : x.rid)}
                    minHeight={54}
                    style={CARD_PAD}
                  >
                    <span className="num mute" style={{ width: 22, fontSize: 14, fontWeight: 700 }}>
                      {i + 1}
                    </span>
                    <TeamAvatar rid={x.rid} name={teamName(x.rid)} size={36} src={avatarOf(x.rid)} />
                    <Stack2 title={teamName(x.rid)} sub={`${x.picks.length} pick${x.picks.length === 1 ? '' : 's'}${x.rid === myRid ? ' · you' : ''}`} />
                    <GradeChip g={x.grade.letter} />
                  </GradCard>
                ))}
              </div>
            )}
          </div>
          <span className="small mute">
            Grades: how far a player went past (or ahead of) his position rank on the sheet, within the {pool === 'rookies' ? 'rookie' : 'whole-board'} pool.
          </span>
        </div>

        <div className="sticky stack" style={{ gap: 16 }}>
          {shownTeam ? (
            <div className="hero" style={{ padding: 22 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.15 }}>{teamName(shownTeam.rid)}</span>
                <GradeChip g={shownTeam.grade.letter} big />
              </div>
              <div className="sub" style={{ fontSize: 14 }}>
                Draft picks
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
        </div>
      </div>
    )
  }
}
