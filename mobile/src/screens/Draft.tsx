// Draft: how the rookie draft went, round by round, and every team's grade. While a draft is
// live (or about to be) it also has the clock and a Board of who's left. Grades port draftPunk's
// sheet-order rule; Sleeper is polled while the draft can still change.
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { DraftData, DraftPickRow, DraftPlayer, DraftPool, DraftPoll, DraftStatus, Result } from '@monte/core/types'
import { buildPositionalRankIndex, gradePicks, gradeTeam, type GradeLetter, type PickGrade } from '@monte/core/draftGrade'
import { teamLabel } from '@monte/core/names'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { useOverlay } from '@/ui/overlay'
import { Btn, Chip, Empty, ErrorBox, Field, GradeBadge, Kicker, ListRow, Loading, NeedsSheet, Notice, Pills, PlayerAvatar, Row, Seg, Stack2, T } from '@/ui/kit'
import { RADIUS, useTheme } from '@/ui/theme'

const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
/** A new tier starts where 12+ players sit between two pool players on Tyler's overall board. */
const TIER_GAP = 12
/** How often Sleeper is asked for picks, by draft status. A finished draft is not polled. */
const POLL_MS: Record<DraftStatus, number | null> = { drafting: 5000, paused: 15000, pre_draft: 30000, complete: null }
const STATUS_LABEL: Record<DraftStatus, string> = { drafting: 'Live', paused: 'Paused', pre_draft: 'Not started', complete: 'Complete' }
const PAGE = 40
const LETTERS: GradeLetter[] = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F']
const gradeColor = (t: ReturnType<typeof useTheme>, g: string | null | undefined) => (!g ? t.mute : g[0] === 'A' ? t.pos : g[0] === 'B' ? t.ink2 : t.warn)

function whyOf(g: PickGrade): string {
  if (!g.graded) return g.reason === 'not-on-sheet' ? 'Not on the sheet, so not graded.' : 'Position not graded.'
  const diff = g.posPick - g.userRank
  if (diff > 0) return `Went ${diff} spot${diff === 1 ? '' : 's'} after his sheet rank at ${g.position}. Value pick.`
  if (diff < 0) return `Went ${-diff} spot${diff === -1 ? '' : 's'} before his sheet rank at ${g.position}. Reach.`
  return 'Went right at his sheet rank.'
}

export default function DraftPanel() {
  const t = useTheme()
  const { context, settings, hide, dataVersion, sheet } = useApp()
  const { openSheet } = useOverlay()
  const leagueId = context?.league.league_id
  const userId = settings?.userId
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
  // Players marked taken by hand: drafts held off Sleeper, or a pick Sleeper hasn't shown yet.
  const [manual, setManual] = useState<Set<string>>(new Set())

  const load = (id = draftId) => {
    if (!leagueId || !userId || !sheet) return
    setBusy(true)
    void monte.draft(leagueId, userId, id).then(r => {
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
    const timer = setInterval(() => {
      void monte.draftPicks(id).then(r => {
        if (!r.ok) return setPollError(r.error)
        setPollError(null)
        if (r.value.status !== d.draft.status && (r.value.status === 'complete' || d.draft.status === 'pre_draft')) load(id)
        else setPoll(r.value)
      })
    }, every)
    return () => clearInterval(timer)
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
  const isTaken = (id: string) => pickedBy.has(id) || manual.has(id)
  const available = poolPlayers.filter(p => !isTaken(p.id))

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

  const openPick = (p: DraftPickRow) => openSheet(<PickDetail p={p} g={grades.get(p.pickNo)} team={teamName(p.rosterId)} />)
  const openTeam = (x: (typeof teamGrades)[number]) =>
    openSheet(<TeamPicks name={teamName(x.rid)} letter={x.grade.letter} picks={x.picks} grades={grades} onPick={openPick} />)

  const toggleManual = (id: string) =>
    setManual(m => {
      const n = new Set(m)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <View>
      <View style={{ padding: 16, gap: 6 }}>
        <T v="serif">{head || 'Loading the draft…'}</T>
        {!!sub && (
          <T c="mute" size={14}>
            {sub}
          </T>
        )}
        {live && myNext.length > 0 && (
          <T c="mute" size={14}>
            Your picks: {myNext.map(s => s.label).join(', ')}
          </T>
        )}
      </View>

      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        {res && !res.ok && <ErrorBox message={res.error} onRetry={() => load()} />}
        {!res && busy && <Loading label="Loading the draft…" />}
        {pollError && <Notice message={`Sleeper didn't answer the last check (${pollError}). Still retrying.`} />}
        {d && d.order.every(s => s.rosterId == null) && d.draft.status === 'pre_draft' && (
          <Notice message="Sleeper hasn't set this draft's order yet. It fills in once the commissioner sets it." />
        )}
      </View>

      {d && (
        <>
          <View style={{ paddingHorizontal: 16, paddingBottom: 10, paddingTop: 4 }}>
            {segs.length <= 5 ? (
              <Seg fill value={cur} onChange={setSeg} options={segs.map(s => ({ value: s, label: s }))} />
            ) : (
              <Pills value={cur} onChange={setSeg} options={segs.map(s => ({ value: s, label: s }))} />
            )}
          </View>

          {cur === 'Board' && (
            <>
              <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
                <Pills value={pos} onChange={v => setPos(v)} options={(['All', ...POSITIONS] as const).map(v => ({ value: v, label: v }))} />
              </View>
              {available.length === 0 && <Empty message="The pool is empty." style={{ marginHorizontal: 16 }} />}
              {(() => {
                const shown = available.filter(p => pos === 'All' || p.pos === pos)
                return (
                  <>
                    {shown.slice(0, limit).map((p, i) => {
                      const tier = tierOf.get(p.id)!
                      const header = i === 0 || tierOf.get(shown[i - 1].id) !== tier
                      return (
                        <View key={p.id}>
                          {header && (
                            <View style={{ paddingHorizontal: 16, paddingVertical: 6, backgroundColor: t.card, borderBottomWidth: 1, borderColor: t.line }}>
                              <Kicker>Tier {tier}</Kicker>
                            </View>
                          )}
                          <ListRow>
                            <T v="mono" size={14} c="mute" style={{ width: 40 }}>
                              #{p.rank}
                            </T>
                            <PlayerAvatar id={p.id} name={p.name} />
                            <Stack2
                              title={p.name}
                              sub={`${p.pos}${rankIndex.get(p.pos)?.get(p.id) ?? ''} · ${p.team}${p.age != null ? ` · ${p.age.toFixed(0)}` : ''}${p.injury ? ` · ${p.injury}` : ''}`}
                            />
                            <Btn kind="link" label={manual.has(p.id) ? 'Undo' : 'Taken'} onPress={() => toggleManual(p.id)} />
                          </ListRow>
                        </View>
                      )
                    })}
                    {shown.length > limit && (
                      <View style={{ padding: 16 }}>
                        <Btn label={`Show more (${shown.length - limit} left)`} onPress={() => setLimit(l => l + PAGE)} />
                      </View>
                    )}
                  </>
                )
              })()}
            </>
          )}

          {cur.startsWith('Rd ') &&
            picks
              .filter(p => `Rd ${p.round}` === cur)
              .map(p => {
                const g = grades.get(p.pickNo)
                return (
                  <ListRow key={p.pickNo} onPress={() => openPick(p)} bg={p.rosterId === myRid ? t.accTint : undefined}>
                    <T v="mono" size={14} c="mute" style={{ width: 40 }}>
                      {p.label}
                    </T>
                    <PlayerAvatar id={p.playerId} name={p.name} />
                    <Stack2 title={p.name} sub={`${p.pos} · ${teamName(p.rosterId)}${g?.graded ? ` · sheet ${g.position}${g.userRank}` : ''}`} />
                    <GradeBadge g={g?.graded ? g.letter : null} />
                  </ListRow>
                )
              })}

          {cur === 'Teams' &&
            (teamGrades.length === 0 ? (
              <Empty message="Team grades appear once picks are made." style={{ marginHorizontal: 16 }} />
            ) : (
              teamGrades.map((x, i) => (
                <ListRow key={x.rid} onPress={() => openTeam(x)} bg={x.rid === myRid ? t.accTint : undefined}>
                  <T v="mono" size={14} c="mute" style={{ width: 40 }}>
                    #{i + 1}
                  </T>
                  <Stack2 title={teamName(x.rid)} sub={`${x.picks.length} pick${x.picks.length === 1 ? '' : 's'}`} />
                  <GradeBadge g={x.grade.letter} />
                </ListRow>
              ))
            ))}

          <View style={{ padding: 16, gap: 10 }}>
            <Row gap={10} wrap>
              <T c="mute" size={14}>
                Grade against
              </T>
              <Seg
                value={pool}
                onChange={setPool}
                options={[
                  { value: 'rookies', label: 'Rookies' },
                  { value: 'all', label: 'All players' },
                ]}
              />
            </Row>
            {d.drafts.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {d.drafts.map(x => {
                  const on = x.draft_id === d.draft.draft_id
                  return (
                    <Pressable
                      key={x.draft_id}
                      onPress={() => setDraftId(x.draft_id)}
                      style={{ minHeight: 36, justifyContent: 'center', borderWidth: 1, borderColor: on ? t.ink : t.line, borderRadius: RADIUS, paddingHorizontal: 10, backgroundColor: on ? t.ink : 'transparent' }}
                    >
                      <T size={14} color={on ? t.bg : t.ink2}>
                        {x.season}
                        {x.leagueId === leagueId ? '' : ' mock'} · {STATUS_LABEL[x.status].toLowerCase()}
                      </T>
                    </Pressable>
                  )
                })}
              </ScrollView>
            )}
            <Field
              value={otherId}
              onChangeText={setOtherId}
              onSubmitEditing={() => otherId.trim() && setDraftId(otherId.trim())}
              placeholder="Other draft ID (mocks)"
              autoCapitalize="none"
              returnKeyType="go"
            />
            <Row gap={10}>
              <Chip label={STATUS_LABEL[status]} tone={status === 'drafting' ? 'pos' : status === 'paused' ? 'warn' : 'chip'} mono />
              <T v="small" c="mute" style={{ flex: 1 }}>
                {d.sheet.name} · {POLL_MS[status] ? `checking every ${POLL_MS[status]! / 1000}s` : 'not polling'}
              </T>
              <Btn kind="link" label={busy ? 'Loading…' : 'Refresh'} onPress={() => load()} disabled={busy} />
            </Row>
            <T v="small" c="mute">
              Grades: how far a player went past (or ahead of) his position rank on the sheet, within the {pool === 'rookies' ? 'rookie' : 'whole-board'} pool.
            </T>
          </View>
        </>
      )}
    </View>
  )
}

function PickDetail({ p, g, team }: { p: DraftPickRow; g: PickGrade | undefined; team: string }) {
  const t = useTheme()
  const letter = g?.graded ? g.letter : null
  return (
    <View style={{ gap: 12 }}>
      <Row style={{ alignItems: 'baseline', justifyContent: 'space-between' }} gap={10}>
        <T v="title" style={{ flex: 1 }}>
          {p.label} {p.name}
        </T>
        <T v="serif" size={32} color={gradeColor(t, letter)}>
          {letter ?? '–'}
        </T>
      </Row>
      <T c="mute" size={14}>
        {p.pos} · {team}
        {g?.graded ? ` · went ${g.position}${g.posPick}, sheet ${g.position}${g.userRank}` : ''}
      </T>
      {g && <T>{whyOf(g)}</T>}
    </View>
  )
}

function TeamPicks(props: { name: string; letter: GradeLetter | null; picks: DraftPickRow[]; grades: Map<number, PickGrade>; onPick: (p: DraftPickRow) => void }) {
  const t = useTheme()
  return (
    <View style={{ gap: 12 }}>
      <Row style={{ alignItems: 'baseline', justifyContent: 'space-between' }} gap={10}>
        <T v="title" style={{ flex: 1 }}>
          {props.name}
        </T>
        <T v="serif" size={32} color={gradeColor(t, props.letter)}>
          {props.letter ?? '–'}
        </T>
      </Row>
      <T c="mute" size={14}>
        Rookie draft picks
      </T>
      <View>
        {props.picks.map(p => {
          const g = props.grades.get(p.pickNo)
          return (
            <Pressable
              key={p.pickNo}
              onPress={() => props.onPick(p)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderBottomWidth: 1, borderColor: t.line, backgroundColor: pressed ? t.card : 'transparent' })}
            >
              <T v="mono" size={14} c="mute" style={{ width: 40 }}>
                {p.label}
              </T>
              <T style={{ flex: 1 }} lines={1}>
                {p.name}{' '}
                <T v="small" c="mute">
                  {p.pos}
                  {g?.graded ? ` · sheet ${g.position}${g.userRank}` : ''}
                </T>
              </T>
              <T v="monoSemi" color={gradeColor(t, g?.graded ? g.letter : null)}>
                {g?.graded ? g.letter : '–'}
              </T>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

