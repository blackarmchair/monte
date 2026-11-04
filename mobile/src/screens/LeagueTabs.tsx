// League's Matchups and Trades tabs, phone-sized. Matchups: this week's pairs, yours first and open,
// each team on its own row with Monte's win chance under them; tap for the starters slot by slot.
// Trades: your open offers when Sleeper is connected, then the league's completed trades this
// season, newest first, each side stacked ("You get" first).
import { useFocusEffect, router } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppState, Linking, Pressable, View } from 'react-native'
import { connectionItems, lineupItems, offerItems, orderInbox, waiverItems, type InboxAction } from '@monte/core/inbox'
import { matchupPollMs, type LeagueTrades, type LeagueWeek, type MatchPlayer, type MatchSide, type TradeTx } from '@monte/core/leagueWeek'
import { offerRole } from '@monte/core/offers'
import { moveText, type WaiverDesk } from '@monte/core/waivers'
import { teamLabel } from '@monte/core/names'
import { basisLabel, compareBases, matchupBasis } from '@monte/core/projBasis'
import type { Result, StartSitData } from '@monte/core/types'
import { useAppUpdate } from '@/lib/appUpdate'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { mineOf, useTrade } from '@/lib/trade'
import { Btn, Card, ErrorBox, GradCard, Headshot, kfmt, Loading, Notice, ORD, Row, Section, Stack2, T, TeamAvatar } from '@/ui/kit'
import { useOverlay } from '@/ui/overlay'
import { nflColor, R, ring, teamColor, useTheme } from '@/ui/theme'
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

/** What needs you this week in this league: offers to answer, lineup problems, then what's worth knowing. */
export function ThisWeek({ onTrades }: { onTrades: () => void }) {
  const t = useTheme()
  const { context, sheet, settings, openPlayer } = useApp()
  const x = useTrade()
  const update = useAppUpdate()
  const me = context?.myRosterId ?? null
  const trades = useLoad(id => monte.leagueTrades(id))
  const lineup = useLoad(id => (sheet && settings?.userId ? monte.startSit(id, settings.userId) : Promise.resolve(SHEET_NEEDED)))
  const waivers = useLoad(id => monte.waiverDesk(id, settings?.userId ?? ''))
  const desk = waivers.res?.ok ? waivers.res.value : null
  const lt = trades.res?.ok ? trades.res.value : null
  const received = (lt?.pending ?? []).filter(tx => offerRole(tx, me) === 'received')
  const items = orderInbox([
    ...offerItems(received.map(tx => ({ tx, from: x.teamName(tx.creator) || 'another team', verdict: x.readOffer(tx).label }))),
    ...(lineup.res?.ok ? lineupItems(lineup.res.value) : []),
    ...connectionItems(settings?.sleeperLink, lt?.pendingNote ?? null),
    ...(update ? [{ id: 'app-update', tone: 'note' as const, title: `Monte ${update.version} is ready`, detail: 'Download it from Settings.', action: { kind: 'settings' as const } }] : []),
    ...(x.d ? waiverItems(x.d.freeAgents, x.mine, x.d.ranks, desk?.likelyOnWaivers) : []),
  ])
  const act = items.filter(i => i.tone === 'act').length
  const loading = !trades.res || !lineup.res
  const run = (a: InboxAction) => {
    if (a.kind === 'trades') onTrades()
    else if (a.kind === 'lineup') router.navigate('/lineup')
    else if (a.kind === 'player') openPlayer(a.id, a.name)
    else router.navigate('/settings')
  }
  const refreshAll = () => {
    trades.load()
    lineup.load()
    waivers.load()
  }
  return (
    <View style={{ gap: 10 }}>
      <Head title={context && context.week > 0 ? `Week ${context.week}${loading ? '' : act ? ` · ${act} to deal with` : ''}` : 'This week'} busy={trades.busy || lineup.busy} onRefresh={refreshAll} />
      {trades.res && !trades.res.ok && <ErrorBox message={trades.res.error} onRetry={trades.load} />}
      {lineup.res && !lineup.res.ok && (
        <T v="small" c="mute">
          Lineup check unavailable: {lineup.res.error}
        </T>
      )}
      {items.map(i => (
        <Pressable key={i.id} onPress={() => run(i.action)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: R.card, backgroundColor: t.card }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i.tone === 'act' ? t.acc : t.mute }} />
          <View style={{ flex: 1, gap: 2 }}>
            <T v="bold" size={15}>
              {i.title}
            </T>
            <T v="small" c="mute">
              {i.detail}
            </T>
          </View>
        </Pressable>
      ))}
      {loading && <Loading label="Checking your league…" />}
      {!loading && items.length === 0 && (
        <T c="mute" size={14}>
          All clear. Nothing needs you in this league right now.
        </T>
      )}
      {waivers.res && !waivers.res.ok && (
        <T v="small" c="mute">
          Waivers unavailable: {waivers.res.error}
        </T>
      )}
      {desk && <WaiverBlock desk={desk} />}
    </View>
  )
}

const shortDate = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** The league's waivers at a glance. Read-only: claims are still made in Sleeper. */
function WaiverBlock({ desk }: { desk: WaiverDesk }) {
  const x = useTrade()
  const facts = [
    desk.faab ? `FAAB: $${desk.faab.left} of $${desk.faab.budget} left` : desk.priority != null ? `Waiver priority: #${desk.priority}` : null,
    `Waivers run ${desk.cadence}${desk.lastRun ? `, last on ${shortDate(desk.lastRun)}` : ''}`,
    desk.bids ? `Winning bids this season: ${desk.bids.count} paid, median $${desk.bids.median}, high $${desk.bids.high}` : null,
  ].filter(Boolean)
  return (
    <View style={{ gap: 8, paddingTop: 12 }}>
      <T v="label">Waivers</T>
      <Card gap={4}>
        {facts.map(f => (
          <T key={f} v="semi" size={14}>
            {f}
          </T>
        ))}
        {!!desk.pendingNote && (
          <T v="small" c="mute">
            {desk.pendingNote}
          </T>
        )}
        {desk.pending?.map(c => (
          <T key={c.id} v="small">
            Your claim: {moveText(c)}
            {c.bid != null && desk.faab ? ` · $${c.bid}` : ''}
          </T>
        ))}
        {desk.pending?.length === 0 && (
          <T v="small" c="mute">
            You have no pending claims.
          </T>
        )}
      </Card>
      {desk.recent.length > 0 && (
        <T v="small" c="mute">
          Recent moves
        </T>
      )}
      {desk.recent.map(m => (
        <Card key={m.id} gap={2}>
          <T v="small">
            {m.rosterId != null ? x.teamName(m.rosterId) : 'A team'}: {moveText(m)}
          </T>
          <T v="small" c="mute">
            {m.kind === 'waiver' ? (desk.faab ? `$${m.bid}` : 'waiver') : 'free agent'}
          </T>
        </Card>
      ))}
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
