// League's Matchups and Trades tabs, phone-sized. Matchups: this week's pairs, yours first and open,
// each team on its own row with Monte's win chance under them; tap for the starters slot by slot.
// Trades: your open offers when Sleeper is connected, then the league's completed trades this
// season, newest first, each side stacked ("You get" first).
import { useFocusEffect, router } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppState, Linking, Pressable, View } from 'react-native'
import { connectionItems, irItems, lineupItems, lowestNote, offerItems, orderInbox, waiverItems, type InboxAction, type InboxItem } from '@monte/core/inbox'
import { matchupPollMs, type LeagueTrades, type LeagueWeek, type MatchPlayer, type MatchSide, type TradeTx } from '@monte/core/leagueWeek'
import { offerRole } from '@monte/core/offers'
import { bidProblem } from '@monte/core/sleeperWaivers'
import { moveDrop, moveTitle, type WaiverDesk, type WaiverMove } from '@monte/core/waivers'
import { teamLabel } from '@monte/core/names'
import { basisLabel, compareBases, matchupBasis } from '@monte/core/projBasis'
import type { Result, StartSitData } from '@monte/core/types'
import { useAppUpdate } from '@/lib/appUpdate'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { mineOf, useTrade } from '@/lib/trade'
import { Btn, Card, ErrorBox, Field, GradCard, Headshot, HeatChip, Hero, kfmt, Loading, Notice, ORD, Row, Section, Stack2, StatTile, T, Tag, TeamAvatar } from '@/ui/kit'
import { useOverlay } from '@/ui/overlay'
import { nflColor, R, rankHeat, ring, teamColor, useTheme } from '@/ui/theme'
import { BasisLine, ProjCompare } from './ProjCompare'
import { normCdf, WIN_SD } from '@monte/core/startSitLogic'

/** Load once per league, with a manual refresh. */
function useLoad<T>(fetcher: (leagueId: string) => Promise<Result<T>>) {
  const { context } = useApp()
  const leagueId = context?.league.league_id
  const [res, setRes] = useState<Result<T> | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => {
    if (!leagueId) return
    setBusy(true)
    void fetcher(leagueId).then(r => {
      setRes(r)
      setBusy(false)
    })
  }
  // A quiet re-read for polling: no spinner, and a failure keeps what's on screen.
  const current = useRef(leagueId)
  useEffect(() => {
    current.current = leagueId
  }, [leagueId])
  const refresh = () => {
    if (!leagueId) return
    void fetcher(leagueId).then(r => {
      if (r.ok && current.current === leagueId) setRes(r)
    })
  }
  useEffect(load, [leagueId]) // eslint-disable-line react-hooks/exhaustive-deps
  return { res, busy, load, refresh }
}

function Head({ title, busy, onRefresh }: { title: string; busy: boolean; onRefresh: () => void }) {
  return (
    <Section
      title={title}
      right={
        <T v="smallSemi" c="acc" onPress={busy ? undefined : onRefresh}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </T>
      }
    />
  )
}

const SHEET_NEEDED: Result<StartSitData> = { ok: false, error: 'Add your rankings sheet to check your lineup.' }
/** Sheet ranks run about this deep, for colouring a rank chip. */
const RANK_SPAN = 350
const shortDate = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })

/** What needs you this week in this league: the top thing first, then the rest, then waivers. */
export function ThisWeek({ onTrades }: { onTrades: () => void }) {
  const t = useTheme()
  const { context, sheet, settings, setSettings, openPlayer } = useApp()
  const { showToast } = useOverlay()
  const x = useTrade()
  const update = useAppUpdate()
  const [irBusy, setIrBusy] = useState<string | null>(null)
  const me = context?.myRosterId ?? null
  const trades = useLoad(id => monte.leagueTrades(id))
  const lineup = useLoad(id => (sheet && settings?.userId ? monte.startSit(id, settings.userId) : Promise.resolve(SHEET_NEEDED)))
  const waivers = useLoad(id => monte.waiverDesk(id, settings?.userId ?? ''))
  const desk = waivers.res?.ok ? waivers.res.value : null
  const lt = trades.res?.ok ? trades.res.value : null
  const received = (lt?.pending ?? []).filter(tx => offerRole(tx, me) === 'received')
  const offers = offerItems(received.map(tx => ({ tx, from: x.teamName(tx.creator) || 'Another team', verdict: x.readOffer(tx).label })))
  const fixes = lineup.res?.ok ? lineupItems(lineup.res.value) : []
  const ir = irItems(desk?.ir ?? null)
  const items = orderInbox([
    ...ir.filter(i => i.id.startsWith('ir-off')),
    ...offers,
    ...fixes,
    ...ir.filter(i => !i.id.startsWith('ir-off')),
    ...connectionItems(settings?.sleeperLink, lt?.pendingNote ?? null),
    ...(update ? [{ id: 'app-update', tone: 'note' as const, title: `Monte ${update.version} is ready`, detail: 'Download it from Settings', action: { kind: 'settings' as const } }] : []),
  ])
  const acts = items.filter(i => i.tone === 'act')
  const notes = items.filter(i => i.tone === 'note')
  const worth = x.d ? waiverItems(x.d.freeAgents, x.mine, x.d.ranks, desk?.likelyOnWaivers) : []
  const [top, ...rest] = acts
  const loading = !trades.res || !lineup.res
  const mine = context?.rosters.find(r => r.roster_id === me)
  const kicker = [context && context.week > 0 ? `Week ${context.week}` : null, mine ? `${mine.wins}-${mine.losses}` : null].filter(Boolean).join(' · ')
  const fixCount = fixes.filter(i => i.tone === 'act').length
  const summary = [offers.length ? `${offers.length} offer${offers.length === 1 ? '' : 's'} to answer` : '', fixCount ? `${fixCount} lineup fix${fixCount === 1 ? '' : 'es'}` : ''].filter(Boolean).join(' · ')
  const run = (a: InboxAction) => {
    if (a.kind === 'trades') onTrades()
    else if (a.kind === 'lineup') router.navigate('/lineup')
    // Only unrostered suggestions land here, so open where he can be claimed.
    else if (a.kind === 'player') openPlayer(a.id, a.name, 'trade')
    else if (a.kind === 'ir') void moveIr(a)
    else router.navigate('/settings')
  }
  const moveIr = async (a: Extract<InboxAction, { kind: 'ir' }>) => {
    const leagueId = context?.league.league_id
    if (!leagueId || me == null || irBusy) return
    setIrBusy(a.id)
    const r = await monte.moveIr({ leagueId, rosterId: me, playerId: a.id, to: a.to })
    setIrBusy(null)
    if (!r.ok) {
      showToast(r.error)
      if (r.needsConnect) void setSettings({ sleeperLink: undefined })
      return
    }
    showToast(r.value.mismatch ?? `${a.name} ${a.to === 'ir' ? 'moved to IR' : 'moved off IR'}`)
    waivers.load()
    lineup.load()
  }
  const ctaOf = (i: InboxItem) => (i.action.kind === 'ir' && irBusy === i.action.id ? 'Moving…' : i.cta ?? 'Open')
  const refreshAll = () => {
    trades.load()
    lineup.load()
    waivers.load()
  }
  const busy = trades.busy || lineup.busy || waivers.busy
  return (
    <View style={{ gap: 18 }}>
      <Hero>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="small" c="mute">
            {kicker}
          </T>
          <T v="smallSemi" c="acc" onPress={busy ? undefined : refreshAll}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </T>
        </Row>
        <T v="head" size={26}>
          {loading ? 'Checking your league…' : acts.length ? `${acts.length} thing${acts.length === 1 ? ' needs' : 's need'} you this week.` : "You're all set this week."}
        </T>
        {!loading && <T c="ink2">{summary || 'No offers waiting and no lineup fixes.'}</T>}
      </Hero>
      {top && (
        <View style={{ gap: 12, padding: 18, borderRadius: R.hero, backgroundColor: t.accTint }}>
          <T v="bold" size={18}>
            {top.lead ?? top.title}
          </T>
          <Btn kind="primary" label={ctaOf(top)} disabled={!!irBusy} onPress={() => run(top.action)} style={{ alignSelf: 'flex-start' }} />
        </View>
      )}
      {trades.res && !trades.res.ok && <ErrorBox message={trades.res.error} onRetry={trades.load} />}
      {lineup.res && !lineup.res.ok && <Notice tone="mute" message={`Lineup check unavailable: ${lineup.res.error}`} />}
      {waivers.res && !waivers.res.ok && <Notice tone="mute" message={`Waivers unavailable: ${waivers.res.error}`} />}
      {notes.map(n => (
        <Pressable key={n.id} onPress={() => run(n.action)} accessibilityRole="button">
          <Notice message={n.detail ? `${n.title}. ${n.detail}.` : n.title} />
        </Pressable>
      ))}
      {rest.length > 0 && (
        <View style={{ gap: 8 }}>
          <Section title="Also needs you" />
          {rest.map(i => (
            <WeekCard
              key={i.id}
              item={i}
              onPress={() => (i.action.kind === 'ir' ? openPlayer(i.action.id, i.action.name) : run(i.action))}
              button={i.action.kind === 'ir' ? <Btn size="sm" label={ctaOf(i)} disabled={!!irBusy} onPress={() => run(i.action)} /> : null}
            />
          ))}
        </View>
      )}
      {worth.length > 0 && x.d && (
        <View style={{ gap: 8 }}>
          <Section title="Worth a look" />
          <T v="small" c="ink2">
            Unrostered. {lowestNote(x.mine, x.d.ranks)}
          </T>
          {worth.map(i => (
            <WeekCard key={i.id} item={i} onPress={() => run(i.action)} />
          ))}
        </View>
      )}
      {desk && <WaiverBlock desk={desk} onChanged={waivers.load} />}
    </View>
  )
}

/** One thing on This week, on the same tinted card as the rest of the app. */
function WeekCard({ item, onPress, button }: { item: InboxItem; onPress: () => void; button?: ReactNode }) {
  const t = useTheme()
  const f = item.face
  const color = f?.kind === 'player' ? nflColor(t, f.team) : f?.kind === 'team' ? teamColor(f.rid) : null
  return (
    <GradCard color={color} minHeight={66} onPress={onPress} accessibilityLabel={item.title}>
      {f?.kind === 'player' && <Headshot id={f.id} name={f.name} size={42} />}
      {f?.kind === 'team' && <TeamAvatar rid={f.rid} name={f.name} size={42} />}
      <Stack2 title={item.title} sub={item.detail} size={15} right={item.tag && <Tag label={item.tag.label} tone={item.tag.tone} />} />
      {item.rank != null && <HeatChip label={`#${item.rank}`} colors={rankHeat(t, item.rank, RANK_SPAN)} />}
      {button}
    </GradCard>
  )
}

const MOVE_FACE = 38
const MOVE_FACE_OVERLAP = 10
const MOVE_FACE_RING = 2

/** A move's team, with the player it's about overlapping on top. */
function MoveFaces({ move, teamName }: { move: WaiverMove; teamName: string }) {
  const t = useTheme()
  const player = move.adds[0] ?? move.drops[0]
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {move.rosterId != null && <TeamAvatar rid={move.rosterId} name={teamName} size={MOVE_FACE} />}
      {player && (
        <View style={{ marginLeft: move.rosterId != null ? -MOVE_FACE_OVERLAP : 0, padding: MOVE_FACE_RING, borderRadius: MOVE_FACE, backgroundColor: t.card }}>
          <Headshot id={player.id} name={player.name} size={MOVE_FACE} />
        </View>
      )}
    </View>
  )
}

/** The league's waivers at a glance, with your pending claims to change or cancel. */
function WaiverBlock({ desk, onChanged }: { desk: WaiverDesk; onChanged: () => void }) {
  const t = useTheme()
  const { openPlayer } = useApp()
  const x = useTrade()
  const neutral = { bg: t.surf2, fg: t.ink }
  const bidOf = (m: WaiverMove) => (m.kind === 'free_agent' ? 'FA' : desk.faab ? `$${m.bid}` : 'Claim')
  return (
    <View style={{ gap: 8 }}>
      <Section title="Waivers" />
      <Row gap={8} style={{ alignItems: 'stretch' }}>
        {desk.faab ? <StatTile k="FAAB left" v={`$${desk.faab.left}`} sub={`of $${desk.faab.budget}`} size={22} /> : <StatTile k="Your priority" v={desk.priority != null ? `#${desk.priority}` : '—'} sub="waiver order" size={22} />}
        <StatTile k="Median bid" v={desk.bids ? `$${desk.bids.median}` : '—'} sub={desk.bids ? `high $${desk.bids.high}` : 'none paid'} size={22} />
        <StatTile k="Last run" v={desk.lastRun ? shortDate(desk.lastRun) : '—'} sub={desk.cadence} size={22} />
      </Row>
      {!!desk.pendingNote && <Notice tone="mute" message={desk.pendingNote} />}
      {desk.pending && (
        <View style={{ gap: 8, paddingTop: 8 }}>
          <T v="label">Your claims</T>
          {desk.pending.length === 0 && (
            <T v="small" c="ink2">
              You have no pending claims.
            </T>
          )}
          {desk.pending.map(m => (
            <ClaimCard key={m.id} m={m} desk={desk} onChanged={onChanged} />
          ))}
        </View>
      )}
      {desk.recent.length > 0 && (
        <View style={{ gap: 8, paddingTop: 8 }}>
          <T v="label">Recent moves</T>
          {desk.recent.map(m => (
            <GradCard key={m.id} color={m.rosterId != null ? teamColor(m.rosterId) : null} minHeight={58} onPress={m.adds[0] ? () => openPlayer(m.adds[0].id, m.adds[0].name) : undefined} accessibilityLabel={moveTitle(m)}>
              <MoveFaces move={m} teamName={m.rosterId != null ? x.teamName(m.rosterId) : ''} />
              <Stack2 title={moveTitle(m)} sub={[m.rosterId != null ? x.teamName(m.rosterId) : '', moveDrop(m)].filter(Boolean).join(' · ')} size={15} />
              <HeatChip label={bidOf(m)} colors={neutral} height={30} size={14} minWidth={48} />
            </GradCard>
          ))}
        </View>
      )}
    </View>
  )
}

export function Matchups() {
  const t = useTheme()
  const { context, hide, settings, sheet } = useApp()
  const { res, busy, load, refresh } = useLoad(id => monte.leagueWeek(id))
  const me = context?.myRosterId ?? null
  // Lineup's read, fetched only when the comparison opens: it needs the sheet.
  const [cmpOpen, setCmpOpen] = useState(false)
  const [ss, setSs] = useState<Result<StartSitData> | null>(null)
  // Polling replaces `res` every minute; the comparison only goes stale with a new week or league.
  const shownWeek = res?.ok ? res.value.week : null
  useEffect(() => setSs(null), [shownWeek, context?.league.league_id])
  useEffect(() => {
    const leagueId = context?.league.league_id
    if (!cmpOpen || ss || !sheet || !leagueId || !settings?.userId) return
    void monte.startSit(leagueId, settings.userId).then(setSs)
  }, [cmpOpen, ss, sheet, context, settings?.userId])
  const lw: LeagueWeek | null = res?.ok ? res.value : null
  const pollMs = matchupPollMs(lw)
  // Only while this screen is showing and the app is in front.
  useFocusEffect(
    useCallback(() => {
      if (!pollMs) return
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') refresh()
      }, pollMs)
      return () => clearInterval(timer)
    }, [pollMs, context?.league.league_id]), // eslint-disable-line react-hooks/exhaustive-deps
  )
  // Yours first; within each pair, yours on top.
  const pairs = useMemo(() => {
    if (!lw) return []
    return lw.matchups
      .map(m => (m.sides[1].rosterId === me ? { ...m, sides: [m.sides[1], m.sides[0]] as [MatchSide, MatchSide] } : m))
      .sort((a, b) => Number(b.sides[0].rosterId === me) - Number(a.sides[0].rosterId === me))
  }, [lw, me])
  const [open, setOpen] = useState<number | null>(null)
  const shownOpen = open ?? pairs[0]?.id ?? null
  const label = (s: MatchSide) => (hide ? teamLabel(s.rosterId) : s.team)

  return (
    <View style={{ gap: 12 }}>
      <Head title={lw ? `Week ${lw.week} ${lw.playoffs ? 'playoffs' : 'matchups'}` : 'Matchups'} busy={busy} onRefresh={load} />
      {res && !res.ok && <ErrorBox message={res.error} onRetry={load} />}
      {!res && <Loading label="Reading this week’s matchups…" />}
      {lw && pairs.length === 0 && (
        <T c="mute" size={14}>
          {lw.playoffs ? 'No playoff games this week: the bracket is done.' : 'No head-to-head matchups this week.'}
        </T>
      )}
      {pairs.map(m => {
        const [a, b] = m.sides
        const isOpen = shownOpen === m.id
        return (
          <View key={m.id} style={[{ borderRadius: R.card, backgroundColor: t.surf, overflow: 'hidden' }, a.rosterId === me && ring(t, true)]}>
            <Pressable onPress={() => setOpen(isOpen ? -1 : m.id)} style={({ pressed }) => [{ padding: 14, gap: 10 }, pressed && { opacity: 0.8 }]}>
              <SideRow s={a} name={label(a)} lead={a.winPct >= b.winPct} />
              <SideRow s={b} name={label(b)} lead={b.winPct > a.winPct} />
              <WinBar a={a} b={b} />
            </Pressable>
            {a.rosterId === me && (
              <View style={{ gap: 10, paddingHorizontal: 14, paddingBottom: 12 }}>
                <BasisLine label={basisLabel(matchupBasis(a, b))} open={cmpOpen} onToggle={() => setCmpOpen(o => !o)} other="Lineup" />
                {cmpOpen && (
                  <ProjCompare
                    here="matchups"
                    c={!sheet || ss ? compareBases({ me: a, opp: b, d: ss?.ok ? ss.value : null, win: x => normCdf(x / WIN_SD) }) : null}
                    note={!sheet ? 'Lineup needs the sheet, so only this screen’s numbers are shown.' : ss && !ss.ok ? `Couldn’t read Lineup: ${ss.error}` : null}
                  />
                )}
              </View>
            )}
            {isOpen && <StarterRows a={a} b={b} />}
          </View>
        )
      })}
      {lw && (
        <T v="small" c="mute">
          Win % is Monte’s estimate (Sleeper doesn’t publish one): finished games count as scored, the rest as Sleeper’s projection in your league’s scoring, with a typical
          week’s spread around it. Tap a matchup for its starters.
        </T>
      )}
    </View>
  )
}

function SideRow({ s, name, lead }: { s: MatchSide; name: string; lead: boolean }) {
  const { hide } = useApp()
  return (
    <Row gap={12}>
      <TeamAvatar rid={s.rosterId} name={name} size={38} src={hide ? null : s.avatar} />
      <Stack2 title={name} sub={`proj ${s.projected.toFixed(1)} · ${Math.round(s.winPct * 100)}% to win`} subC={lead ? 'pos' : 'mute'} size={15} />
      <T v="bold" size={24} num>
        {s.points.toFixed(1)}
      </T>
    </Row>
  )
}

function WinBar({ a, b }: { a: MatchSide; b: MatchSide }) {
  const t = useTheme()
  const pa = Math.round(a.winPct * 100)
  const lead = a.winPct >= b.winPct
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: t.surf2, overflow: 'hidden', flexDirection: 'row' }}>
      <View style={{ width: `${pa}%`, backgroundColor: lead ? t.pos : t.mute }} />
    </View>
  )
}

const STATE_LABEL: Record<MatchPlayer['state'], string> = { pre: '', live: 'Live', done: 'Final', bye: 'Bye', empty: '' }

function StarterRows({ a, b }: { a: MatchSide; b: MatchSide }) {
  const t = useTheme()
  const { openPlayer } = useApp()
  const n = Math.max(a.starters.length, b.starters.length)
  const cell = (p: MatchPlayer | undefined, right: boolean) => {
    if (!p) return <View style={{ flex: 1 }} />
    const empty = p.state === 'empty'
    const score = (
      <View style={{ alignItems: right ? 'flex-start' : 'flex-end', minWidth: 40 }}>
        <T v="bold" size={14} num c={p.state === 'pre' ? 'mute' : 'ink'}>
          {p.state === 'pre' ? '–' : p.points.toFixed(1)}
        </T>
        <T v="small" c="mute" num>
          {p.proj.toFixed(1)}
        </T>
      </View>
    )
    return (
      <Pressable
        disabled={empty}
        onPress={() => openPlayer(p.id, p.name)}
        style={({ pressed }) => [
          { flex: 1, minWidth: 0, flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 10, backgroundColor: t.bg },
          pressed && { opacity: 0.8 },
        ]}
      >
        <View style={{ flex: 1, minWidth: 0, alignItems: right ? 'flex-end' : 'flex-start' }}>
          <T v="semi" size={13} lines={1} color={empty ? t.bad : undefined}>
            {p.name}
          </T>
          <T v="small" c="mute" lines={1} size={11}>
            {[p.pos, p.team, STATE_LABEL[p.state]].filter(Boolean).join(' · ')}
          </T>
        </View>
        {score}
      </Pressable>
    )
  }
  return (
    <View style={{ gap: 5, paddingHorizontal: 10, paddingBottom: 12 }}>
      {Array.from({ length: n }, (_, i) => (
        <Row key={i} gap={5} align="stretch">
          {cell(a.starters[i], false)}
          {cell(b.starters[i], true)}
        </Row>
      ))}
    </View>
  )
}

const ago = (ms: number) => {
  const d = Math.round((Date.now() - ms) / 86400000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function Trades() {
  const { context } = useApp()
  const { res, busy, load } = useLoad(id => monte.leagueTrades(id))
  const lt: LeagueTrades | null = res?.ok ? res.value : null
  const me = context?.myRosterId ?? null
  const open = (lt?.pending ?? []).filter(t => me == null || t.sides.some(s => s.rosterId === me))
  return (
    <View style={{ gap: 20 }}>
      <Head title="Trades" busy={busy} onRefresh={load} />
      {res && !res.ok && <ErrorBox message={res.error} onRetry={load} />}
      {!res && <Loading label="Reading the league’s trades…" />}
      {lt && (
        <Block title={`Your open offers${open.length ? ` · ${open.length}` : ''}`}>
          {lt.pendingNote ? (
            <T c="mute" size={14}>
              {lt.pendingNote}
            </T>
          ) : open.length === 0 ? (
            <T c="mute" size={14}>
              No open offers.
            </T>
          ) : (
            open.map(t => <TradeCard key={t.id} t={t} onAnswered={load} />)
          )}
        </Block>
      )}
      {lt && (
        <Block title={`Completed this season${lt.recent.length ? ` · ${lt.recent.length}` : ''}`}>
          {lt.recent.length === 0 ? (
            <T c="mute" size={14}>
              No trades yet this season.
            </T>
          ) : (
            lt.recent.map(t => <TradeCard key={t.id} t={t} />)
          )}
        </Block>
      )}
    </View>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <T v="label">{title}</T>
      {children}
    </View>
  )
}

/** Your answer to an offer: Monte's read, then Accept / Reject (each confirmed) or Counter. */
function OfferActions({ t: tx, onAnswered }: { t: TradeTx; onAnswered: () => void }) {
  const t = useTheme()
  const { context, setSettings, sheet } = useApp()
  const { showToast } = useOverlay()
  const x = useTrade()
  const [ask, setAsk] = useState<'accept' | 'reject' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const role = offerRole(tx, context?.myRosterId ?? null)
  if (role === 'accepted')
    return (
      <T v="small" c="mute">
        You accepted this. It's waiting on the other team or the league's review.
      </T>
    )
  if (role !== 'received' || !context || context.myRosterId == null) return null

  const read = x.readOffer(tx)
  const closed = !!x.d?.deadline.closed
  const canCounter = read.partner != null && !closed && !read.missing.length
  const answer = async (action: 'accept' | 'reject') => {
    setBusy(true)
    setError(null)
    const r = await monte.answerOffer({ leagueId: context.league.league_id, transactionId: tx.id, leg: tx.week, myRosterId: context.myRosterId!, action })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      if (r.needsConnect) void setSettings({ sleeperLink: undefined })
      return
    }
    setAsk(null)
    showToast(r.value.mismatch ?? (action === 'accept' ? 'Offer accepted' : 'Offer rejected'))
    onAnswered()
  }
  const toneColor = read.tone === 'pos' ? t.pos : read.tone === 'warn' ? t.warn : read.tone === 'neg' ? t.neg : t.ink2
  return (
    <View style={{ gap: 10 }}>
      {read.verdict ? (
        <T v="bold" color={toneColor}>
          {read.label}{' '}
          <T v="small" c="mute">
            ({read.verdict.em > 0 ? '+' : ''}
            {Math.round(read.verdict.em)} effective value to you)
          </T>
        </T>
      ) : (
        <T v="small" c="mute">
          {read.missing.length ? `Monte has no value for ${read.missing.join(', ')}, so no verdict.` : read.partner == null ? "A three-team trade: Monte doesn't value these." : !sheet ? 'Add your rankings sheet for a verdict.' : ''}
        </T>
      )}
      {ask && <Notice message={ask === 'accept' ? "Accept this offer? If your league has no trade review period, the trade completes right away. Monte can't undo it." : "Reject this offer? Monte can't undo it."} />}
      {error && <ErrorBox message={error} />}
      {ask ? (
        <Row gap={8}>
          <Btn kind="primary" label={busy ? 'Sending…' : ask === 'accept' ? 'Yes, accept' : 'Yes, reject'} disabled={busy} style={{ flex: 1 }} onPress={() => void answer(ask)} />
          <Btn label="Back" disabled={busy} style={{ flex: 1 }} onPress={() => setAsk(null)} />
        </Row>
      ) : (
        <Row gap={8}>
          <Btn kind="primary" label="Accept" disabled={closed} style={{ flex: 1 }} onPress={() => setAsk('accept')} />
          <Btn label="Reject" style={{ flex: 1 }} onPress={() => setAsk('reject')} />
          <Btn label="Counter" disabled={!canCounter} style={{ flex: 1 }} onPress={() => x.counterOffer(tx)} />
        </Row>
      )}
    </View>
  )
}

function TradeCard({ t: tx, onAnswered }: { t: TradeTx; onAnswered?: () => void }) {
  const t = useTheme()
  const { context, openPlayer } = useApp()
  const { byId, teamName } = useTrade()
  const me = context?.myRosterId ?? null
  const sides = [...tx.sides].sort((a, b) => Number(b.rosterId === me) - Number(a.rosterId === me))
  const status =
    tx.status === 'complete'
      ? `Week ${tx.week} · ${ago(tx.created)}`
      : `${tx.creator === me ? 'You sent this' : tx.creator != null ? `From ${teamName(tx.creator)}` : 'Open'} · ${ago(tx.created)}`
  return (
    <Card gap={12}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="small" c="mute" lines={1} style={{ flexShrink: 1 }}>
          {status}
        </T>
        {tx.status === 'proposed' && context && (
          <T v="smallSemi" c="acc" onPress={() => void Linking.openURL(`https://sleeper.com/leagues/${context.league.league_id}/trades`)}>
            Open in Sleeper ↗
          </T>
        )}
      </Row>
      {sides.map(s => (
        <View key={s.rosterId} style={{ gap: 6 }}>
          <Row gap={10}>
            <TeamAvatar rid={s.rosterId} name={teamName(s.rosterId)} size={28} />
            <T v="bold" size={15} lines={1} style={{ flexShrink: 1 }}>
              {s.rosterId === me ? 'You get' : `${teamName(s.rosterId)} gets`}
            </T>
          </Row>
          {s.players.map(p => {
            const a = byId.get(p.id)
            return (
              <GradCard key={p.id} color={nflColor(t, p.team)} minHeight={52} onPress={() => openPlayer(p.id, p.name)} style={{ paddingVertical: 6 }} accessibilityLabel={p.name}>
                <Headshot id={p.id} name={p.name} size={34} />
                <Stack2 title={p.name} sub={[p.pos, p.team].filter(Boolean).join(' · ')} size={15} />
                {a && (
                  <T v="bold" size={14} num>
                    {kfmt(mineOf(a))}
                  </T>
                )}
              </GradCard>
            )
          })}
          {s.picks.map((p, i) => (
            <GradCard key={i} color={teamColor(p.orig)} minHeight={46} style={{ paddingVertical: 6 }}>
              <Stack2 title={`${p.season} ${ORD[p.round] ?? `R${p.round}`}`} sub={p.orig === s.rosterId ? 'own' : `via ${teamName(p.orig)}`} size={15} />
            </GradCard>
          ))}
          {s.players.length === 0 && s.picks.length === 0 && (
            <T v="small" c="mute">
              Nothing
            </T>
          )}
        </View>
      ))}
      {tx.status === 'proposed' && onAnswered && <OfferActions t={tx} onAnswered={onAnswered} />}
    </Card>
  )
}

/** One of your pending claims, with its bid to change and a cancel that asks first. */
function ClaimCard({ m, desk, onChanged }: { m: WaiverMove; desk: WaiverDesk; onChanged: () => void }) {
  const t = useTheme()
  const { context, openPlayer, setSettings } = useApp()
  const { showToast } = useOverlay()
  const [mode, setMode] = useState<'view' | 'bid' | 'cancel' | 'busy'>('view')
  const [bidText, setBidText] = useState(String(m.bid ?? 0))
  const [error, setError] = useState<string | null>(null)
  const leagueId = context?.league.league_id
  const rosterId = context?.myRosterId ?? null
  const faab = desk.faab
  const bid = bidText.trim() === '' ? null : Number(bidText)
  const bad = faab ? bidProblem(bid, faab) : null
  const ref = leagueId && rosterId != null ? { leagueId, rosterId, transactionId: m.id } : null
  const finish = (r: Awaited<ReturnType<typeof monte.cancelWaiverClaim>>, done: string) => {
    setMode('view')
    if (r.ok) {
      showToast(r.value.mismatch ?? done)
      return onChanged()
    }
    setError(r.error)
    if (r.needsConnect) void setSettings({ sleeperLink: undefined })
  }
  const cancel = async () => {
    if (!ref) return
    setMode('busy')
    setError(null)
    finish(await monte.cancelWaiverClaim(ref), `Claim on ${m.adds[0]?.name ?? 'him'} cancelled`)
  }
  const saveBid = async () => {
    if (!ref || bid == null) return
    setMode('busy')
    setError(null)
    finish(await monte.updateWaiverBid(ref, bid), `Bid changed to $${bid}`)
  }
  return (
    <View style={{ gap: 6 }}>
      <GradCard color={t.acc} minHeight={58} onPress={m.adds[0] ? () => openPlayer(m.adds[0].id, m.adds[0].name) : undefined} accessibilityLabel={moveTitle(m)}>
        {m.adds[0] && <Headshot id={m.adds[0].id} name={m.adds[0].name} size={36} />}
        <Stack2 title={moveTitle(m)} sub={moveDrop(m)} size={15} />
        {mode === 'busy' ? (
          <T v="small" c="mute">
            Sending…
          </T>
        ) : (
          mode === 'view' && (
            <Row gap={6}>
              {faab && <Btn size="sm" label={`$${m.bid ?? 0}`} onPress={() => setMode('bid')} />}
              <Btn size="sm" label="Cancel" onPress={() => setMode('cancel')} />
            </Row>
          )
        )}
      </GradCard>
      {mode === 'bid' && (
        <View style={{ gap: 6 }}>
          <Row gap={8}>
            <Field value={bidText} onChangeText={setBidText} keyboardType="number-pad" accessibilityLabel="New bid in dollars" autoFocus boxStyle={{ flex: 1 }} />
            <Btn kind="primary" label="Save" disabled={!!bad} onPress={() => void saveBid()} />
            <Btn label="Back" onPress={() => setMode('view')} />
          </Row>
          {!!bad && bidText.trim() !== '' && (
            <T v="small" color={t.neg}>
              {bad}
            </T>
          )}
        </View>
      )}
      {mode === 'cancel' && (
        <View style={{ gap: 6 }}>
          <T v="small" c="ink2">
            Cancel this claim in Sleeper? You can claim him again afterwards.
          </T>
          <Row gap={8}>
            <Btn kind="primary" label="Cancel claim" onPress={() => void cancel()} />
            <Btn label="Keep it" onPress={() => setMode('view')} />
          </Row>
        </View>
      )}
      {error && <ErrorBox message={error} />}
    </View>
  )
}
