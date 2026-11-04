// League's Matchups and Trades tabs. Matchups: this week's pairs, yours first and open, each with
// Monte's win chance and (click) the starters side by side. Trades: your open offers when Sleeper is
// connected, then the league's completed trades this season, newest first.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { connectionItems, lineupItems, offerItems, orderInbox, waiverItems, type InboxAction } from '@shared/inbox'
import { matchupPollMs, type LeagueTrades, type LeagueWeek, type MatchPlayer, type MatchSide, type TradeTx } from '@shared/leagueWeek'
import { offerRole } from '@shared/offers'
import { basisLabel, compareBases, matchupBasis } from '@shared/projBasis'
import type { Result, StartSitData } from '@shared/types'
import { teamLabel } from './names'
import { BasisLine, ProjCompare } from './ProjCompare'
import { normCdf, WIN_SD } from './startsit.logic'
import { useApp } from './store'
import { mineOf, useTrade } from './tradeModel'
import { Btn, ErrorBox, GradCard, Headshot, kfmt, Link, Loading, nflColor, Notice, ORD, RING_SOFT, Stack2, TeamAvatar, teamColor } from './ui'

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

function TabHead({ title, sub, busy, onRefresh }: { title: string; sub?: string; busy: boolean; onRefresh: () => void }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
      <span className="title-l">{title}</span>
      <span className="row" style={{ gap: 12 }}>
        {sub && <span className="small mute">{sub}</span>}
        <Link label={busy ? 'Refreshing…' : 'Refresh'} onClick={onRefresh} />
      </span>
    </div>
  )
}

const SHEET_NEEDED: Result<StartSitData> = { ok: false, error: 'Add your rankings sheet to check your lineup.' }

/** What needs you this week in this league: offers to answer, lineup problems, then what's worth knowing. */
export function ThisWeek({ onTrades }: { onTrades: () => void }) {
  const { context, sheet, settings, go, openPlayer, openSettings } = useApp()
  const x = useTrade()
  const me = context?.myRosterId ?? null
  const trades = useLoad(id => window.monte.leagueTrades(id))
  const lineup = useLoad(id => (sheet && settings.userId ? window.monte.startSit(id, settings.userId) : Promise.resolve(SHEET_NEEDED)))
  const lt = trades.res?.ok ? trades.res.value : null
  const received = (lt?.pending ?? []).filter(t => offerRole(t, me) === 'received')
  const items = orderInbox([
    ...offerItems(received.map(tx => ({ tx, from: x.teamName(tx.creator) || 'another team', verdict: x.readOffer(tx).label }))),
    ...(lineup.res?.ok ? lineupItems(lineup.res.value) : []),
    ...connectionItems(settings.sleeperLink, lt?.pendingNote ?? null),
    ...(x.d ? waiverItems(x.d.freeAgents, x.mine, x.d.ranks) : []),
  ])
  const act = items.filter(i => i.tone === 'act').length
  const loading = !trades.res || !lineup.res
  const run = (a: InboxAction) => {
    if (a.kind === 'trades') onTrades()
    else if (a.kind === 'lineup') go('lineup')
    else if (a.kind === 'player') openPlayer(a.id, a.name)
    else openSettings()
  }
  const refreshAll = () => {
    trades.load()
    lineup.load()
  }
  return (
    <div className="stack" style={{ gap: 12, maxWidth: 860 }}>
      <TabHead
        title={context && context.week > 0 ? `Week ${context.week}` : 'This week'}
        sub={loading ? undefined : act ? `${act} to deal with` : 'Nothing needs you'}
        busy={trades.busy || lineup.busy}
        onRefresh={refreshAll}
      />
      {trades.res && !trades.res.ok && <ErrorBox message={trades.res.error} onRetry={trades.load} />}
      {lineup.res && !lineup.res.ok && <div className="small mute">Lineup check unavailable: {lineup.res.error}</div>}
      {items.map(i => (
        <button key={i.id} className="row" onClick={() => run(i.action)} style={{ gap: 14, padding: '14px 18px', borderRadius: 18, background: 'var(--card)', textAlign: 'left', width: '100%' }}>
          <span style={{ width: 10, height: 10, flexShrink: 0, borderRadius: 5, background: i.tone === 'act' ? 'var(--acc)' : 'var(--mute)' }} />
          <span className="stack" style={{ gap: 2, minWidth: 0 }}>
            <span style={{ fontWeight: 700 }}>{i.title}</span>
            <span className="small mute">{i.detail}</span>
          </span>
        </button>
      ))}
      {loading && <Loading label="Checking your league…" />}
      {!loading && items.length === 0 && <div className="mute">All clear. Nothing needs you in this league right now.</div>}
    </div>
  )
}

export function Matchups() {
  const { context, hide, settings, sheet } = useApp()
  const { res, busy, load, refresh } = useLoad(id => window.monte.leagueWeek(id))
  const me = context?.myRosterId ?? null
  // Lineup's read, fetched only when the comparison opens: it needs the sheet.
  const [cmpOpen, setCmpOpen] = useState(false)
  const [ss, setSs] = useState<Result<StartSitData> | null>(null)
  // Polling replaces `res` every minute; the comparison only goes stale with a new week or league.
  const shownWeek = res?.ok ? res.value.week : null
  useEffect(() => setSs(null), [shownWeek, context?.league.league_id])
  useEffect(() => {
    const leagueId = context?.league.league_id
    if (!cmpOpen || ss || !sheet || !leagueId || !settings.userId) return
    void window.monte.startSit(leagueId, settings.userId).then(setSs)
  }, [cmpOpen, ss, sheet, context, settings.userId])
  const lw: LeagueWeek | null = res?.ok ? res.value : null
  const pollMs = matchupPollMs(lw)
  useEffect(() => {
    if (!pollMs) return
    const timer = window.setInterval(() => {
      if (!document.hidden) refresh()
    }, pollMs)
    return () => window.clearInterval(timer)
  }, [pollMs, context?.league.league_id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Yours first; within each pair, yours on the left.
  const pairs = useMemo(() => {
    if (!lw) return []
    return lw.matchups
      .map(m => (m.sides[1].rosterId === me ? { ...m, sides: [m.sides[1], m.sides[0]] as [MatchSide, MatchSide] } : m))
      .sort((a, b) => Number(b.sides[0].rosterId === me) - Number(a.sides[0].rosterId === me))
  }, [lw, me])
  const [open, setOpen] = useState<number | null>(null)
  const shownOpen = open ?? pairs[0]?.id ?? null
  const label = (s: MatchSide) => (hide ? teamLabel(s.rosterId) : s.team)
  const updated = lw ? `updated ${new Date(lw.builtAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : undefined

  return (
    <div className="stack" style={{ gap: 12, maxWidth: 980 }}>
      <TabHead title={lw ? `Week ${lw.week} ${lw.playoffs ? 'playoffs' : 'matchups'}` : 'Matchups'} sub={updated} busy={busy} onRefresh={load} />
      {res && !res.ok && <ErrorBox message={res.error} onRetry={load} />}
      {!res && <Loading label="Reading this week’s matchups…" />}
      {lw && pairs.length === 0 && <div className="mute">{lw.playoffs ? 'No playoff games this week: the bracket is done.' : 'No head-to-head matchups this week.'}</div>}
      {pairs.map(m => {
        const [a, b] = m.sides
        const isOpen = shownOpen === m.id
        return (
          <div key={m.id} className="stack" style={{ borderRadius: 20, background: 'var(--card)', overflow: 'hidden', boxShadow: a.rosterId === me ? RING_SOFT : undefined }}>
            <button
              className="gcard"
              onClick={() => setOpen(isOpen ? -1 : m.id)}
              style={{ background: 'transparent', padding: '16px 18px', flexDirection: 'column', alignItems: 'stretch', gap: 12, borderRadius: 0 }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 16, alignItems: 'center' }}>
                <SideHead s={a} name={label(a)} />
                <span className="small mute">vs</span>
                <SideHead s={b} name={label(b)} right />
              </div>
              <WinBar a={a} b={b} />
            </button>
            {a.rosterId === me && (
              <div className="stack" style={{ gap: 10, padding: '0 18px 12px' }}>
                <BasisLine label={basisLabel(matchupBasis(a, b))} open={cmpOpen} onToggle={() => setCmpOpen(o => !o)} other="Lineup" />
                {cmpOpen && (
                  <ProjCompare
                    here="matchups"
                    c={!sheet || ss ? compareBases({ me: a, opp: b, d: ss?.ok ? ss.value : null, win: x => normCdf(x / WIN_SD) }) : null}
                    note={!sheet ? 'Lineup needs the sheet, so only this screen’s numbers are shown.' : ss && !ss.ok ? `Couldn’t read Lineup: ${ss.error}` : null}
                  />
                )}
              </div>
            )}
            {isOpen && <StarterRows a={a} b={b} />}
          </div>
        )
      })}
      {lw && (
        <div className="small mute">
          Win % is Monte’s estimate (Sleeper doesn’t publish one): finished games count as scored, the rest as Sleeper’s projection in your league’s scoring, with a typical week’s
          spread around it. Click a matchup for its starters.
        </div>
      )}
    </div>
  )
}

function SideHead({ s, name, right }: { s: MatchSide; name: string; right?: boolean }) {
  const { hide } = useApp()
  return (
    <div className="row" style={{ gap: 12, minWidth: 0, flexDirection: right ? 'row-reverse' : 'row', textAlign: right ? 'right' : 'left' }}>
      <TeamAvatar rid={s.rosterId} name={name} size={44} src={hide ? null : s.avatar} />
      <div className="stack" style={{ minWidth: 0, flex: 1, alignItems: right ? 'flex-end' : 'flex-start' }}>
        <span className="trunc" style={{ fontWeight: 700, fontSize: 16, maxWidth: '100%' }}>
          {name}
        </span>
        <span className="small mute num">proj {s.projected.toFixed(1)}</span>
      </div>
      <span className="num" style={{ fontSize: 28, fontWeight: 700 }}>
        {s.points.toFixed(1)}
      </span>
    </div>
  )
}

function WinBar({ a, b }: { a: MatchSide; b: MatchSide }) {
  const pa = Math.round(a.winPct * 100)
  const lead = a.winPct >= b.winPct
  const pct = (x: number, on: boolean, right?: boolean) => (
    <span className="num" style={{ width: 44, textAlign: right ? 'right' : 'left', fontWeight: 700, color: on ? 'var(--pos)' : 'var(--mute)' }}>
      {x}%
    </span>
  )
  return (
    <div className="row" style={{ gap: 10 }}>
      {pct(pa, lead)}
      <span style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--surf2)', overflow: 'hidden', display: 'flex' }}>
        <span style={{ width: `${pa}%`, background: lead ? 'var(--pos)' : 'color-mix(in oklab, var(--ink) 35%, transparent)' }} />
      </span>
      {pct(100 - pa, !lead, true)}
    </div>
  )
}

const STATE_LABEL: Record<MatchPlayer['state'], string> = { pre: '', live: 'Live', done: 'Final', bye: 'Bye', empty: '' }

function StarterRows({ a, b }: { a: MatchSide; b: MatchSide }) {
  const { openPlayer } = useApp()
  const n = Math.max(a.starters.length, b.starters.length)
  const cell = (p: MatchPlayer | undefined, right: boolean) => {
    if (!p) return <span />
    const empty = p.state === 'empty'
    return (
      <button
        className="row"
        disabled={empty}
        onClick={() => openPlayer(p.id, p.name)}
        style={{
          width: '100%',
          gap: 12,
          minWidth: 0,
          padding: '8px 10px',
          borderRadius: 12,
          background: 'var(--surf)',
          border: 0,
          color: 'inherit',
          font: 'inherit',
          cursor: empty ? 'default' : 'pointer',
          flexDirection: right ? 'row-reverse' : 'row',
          textAlign: right ? 'right' : 'left',
        }}
      >
        <Headshot id={empty ? null : p.id} name={p.name} size={34} />
        <span className="stack" style={{ minWidth: 0, flex: 1, alignItems: right ? 'flex-end' : 'flex-start' }}>
          <span className="trunc" style={{ fontWeight: 600, maxWidth: '100%', color: empty ? 'var(--bad)' : undefined }}>
            {p.name}
          </span>
          <span className="small mute">{[p.pos, p.team, STATE_LABEL[p.state]].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="stack num" style={{ alignItems: right ? 'flex-start' : 'flex-end', minWidth: 52 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: p.state === 'pre' ? 'var(--mute)' : 'var(--ink)' }}>{p.state === 'pre' ? '–' : p.points.toFixed(1)}</span>
          <span className="small mute">{p.proj.toFixed(1)}</span>
        </span>
      </button>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 6, padding: '0 18px 18px' }}>
      {Array.from({ length: n }, (_, i) => [<span key={`a${i}`}>{cell(a.starters[i], false)}</span>, <span key={`b${i}`}>{cell(b.starters[i], true)}</span>])}
    </div>
  )
}

const ago = (ms: number) => {
  const d = Math.round((Date.now() - ms) / 86400000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function Trades() {
  const { context } = useApp()
  const { res, busy, load } = useLoad(id => window.monte.leagueTrades(id))
  const lt: LeagueTrades | null = res?.ok ? res.value : null
  const me = context?.myRosterId ?? null
  const open = (lt?.pending ?? []).filter(t => me == null || t.sides.some(s => s.rosterId === me))
  return (
    <div className="stack" style={{ gap: 24, maxWidth: 980 }}>
      <TabHead title="Trades" busy={busy} onRefresh={load} />
      {res && !res.ok && <ErrorBox message={res.error} onRetry={load} />}
      {!res && <Loading label="Reading the league’s trades…" />}
      {lt && (
        <Block title={`Your open offers${open.length ? ` · ${open.length}` : ''}`}>
          {lt.pendingNote ? <div className="mute">{lt.pendingNote}</div> : open.length === 0 ? <div className="mute">No open offers.</div> : open.map(t => <TradeCard key={t.id} t={t} onAnswered={load} />)}
        </Block>
      )}
      {lt && (
        <Block title={`Completed this season${lt.recent.length ? ` · ${lt.recent.length}` : ''}`}>
          {lt.recent.length === 0 ? <div className="mute">No trades yet this season.</div> : lt.recent.map(t => <TradeCard key={t.id} t={t} />)}
        </Block>
      )}
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="stack" style={{ gap: 10 }}>
      <span className="label">{title}</span>
      {children}
    </section>
  )
}

/** Your answer to an offer: Monte's read, then Accept / Reject (each confirmed) or Counter. */
function OfferActions({ t, onAnswered }: { t: TradeTx; onAnswered: () => void }) {
  const { context, showToast, settingsSaved, sheet } = useApp()
  const x = useTrade()
  const [ask, setAsk] = useState<'accept' | 'reject' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const role = offerRole(t, context?.myRosterId ?? null)
  if (role === 'accepted') return <span className="small mute">You accepted this. It's waiting on the other team or the league's review.</span>
  if (role !== 'received' || !context || context.myRosterId == null) return null

  const read = x.readOffer(t)
  const closed = !!x.d?.deadline.closed
  const canCounter = read.partner != null && !closed && !read.missing.length
  const answer = async (action: 'accept' | 'reject') => {
    setBusy(true)
    setError(null)
    const r = await window.monte.answerOffer({ leagueId: context.league.league_id, transactionId: t.id, leg: t.week, myRosterId: context.myRosterId!, action })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      if (r.needsConnect) settingsSaved(await window.monte.getSettings())
      return
    }
    setAsk(null)
    showToast(r.value.mismatch ?? (action === 'accept' ? 'Offer accepted' : 'Offer rejected'))
    onAnswered()
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      {read.verdict ? (
        <span style={{ fontWeight: 700, color: `var(--${read.tone === 'mute' ? 'ink2' : read.tone})` }}>
          {read.label} <span className="small mute">({read.verdict.em > 0 ? '+' : ''}{Math.round(read.verdict.em)} effective value to you)</span>
        </span>
      ) : read.missing.length ? (
        <span className="small mute">Monte has no value for {read.missing.join(', ')}, so no verdict.</span>
      ) : read.partner == null ? (
        <span className="small mute">A three-team trade: Monte doesn't value these.</span>
      ) : !sheet ? (
        <span className="small mute">Add your rankings sheet for a verdict.</span>
      ) : null}
      {ask && <Notice message={ask === 'accept' ? "Accept this offer? If your league has no trade review period, the trade completes right away. Monte can't undo it." : "Reject this offer? Monte can't undo it."} />}
      {error && <ErrorBox message={error} />}
      {ask ? (
        <div className="row" style={{ gap: 8 }}>
          <Btn kind="primary" label={busy ? 'Sending…' : ask === 'accept' ? 'Yes, accept' : 'Yes, reject'} disabled={busy} onClick={() => void answer(ask)} />
          <Btn label="Back" disabled={busy} onClick={() => setAsk(null)} />
        </div>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          <Btn kind="primary" label="Accept" disabled={closed} title={closed ? 'The trade deadline has passed' : undefined} onClick={() => setAsk('accept')} />
          <Btn label="Reject" onClick={() => setAsk('reject')} />
          <Btn label="Counter" disabled={!canCounter} onClick={() => x.counterOffer(t)} />
        </div>
      )}
    </div>
  )
}

function TradeCard({ t, onAnswered }: { t: TradeTx; onAnswered?: () => void }) {
  const { context, openPlayer } = useApp()
  const { byId, teamName } = useTrade()
  const me = context?.myRosterId ?? null
  const sides = [...t.sides].sort((a, b) => Number(b.rosterId === me) - Number(a.rosterId === me))
  const status =
    t.status === 'complete'
      ? `Week ${t.week} · ${ago(t.created)}`
      : `${t.creator === me ? 'You sent this' : t.creator != null ? `From ${teamName(t.creator)}` : 'Open'} · ${ago(t.created)}`
  return (
    <div className="stack" style={{ gap: 12, padding: '16px 18px', borderRadius: 20, background: 'var(--card)' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
        <span className="small mute">{status}</span>
        {t.status === 'proposed' && context && <Link label="Open in Sleeper ↗" onClick={() => window.open(`https://sleeper.com/leagues/${context.league.league_id}/trades`, '_blank')} />}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, sides.length)}, minmax(0,1fr))`, gap: 12 }}>
        {sides.map(s => (
          <div key={s.rosterId} className="stack" style={{ gap: 6, minWidth: 0 }}>
            <div className="row" style={{ gap: 10, minWidth: 0 }}>
              <TeamAvatar rid={s.rosterId} name={teamName(s.rosterId)} size={30} />
              <span className="trunc" style={{ fontWeight: 700 }}>
                {s.rosterId === me ? 'You get' : `${teamName(s.rosterId)} gets`}
              </span>
            </div>
            {s.players.map(p => {
              const a = byId.get(p.id)
              return (
                <GradCard key={p.id} color={nflColor(p.team)} minHeight={48} onClick={() => openPlayer(p.id, p.name)} style={{ padding: '6px 12px' }}>
                  <Headshot id={p.id} name={p.name} size={32} />
                  <Stack2 title={p.name} sub={[p.pos, p.team].filter(Boolean).join(' · ')} size={14} />
                  {a && (
                    <span className="num" style={{ fontWeight: 700, fontSize: 13 }}>
                      {kfmt(mineOf(a))}
                    </span>
                  )}
                </GradCard>
              )
            })}
            {s.picks.map((p, i) => (
              <GradCard key={i} color={teamColor(p.orig)} minHeight={44} style={{ padding: '6px 12px' }}>
                <Stack2 title={`${p.season} ${ORD[p.round] ?? `R${p.round}`}`} sub={p.orig === s.rosterId ? 'own' : `via ${teamName(p.orig)}`} size={14} />
              </GradCard>
            ))}
            {s.players.length === 0 && s.picks.length === 0 && <span className="small mute">Nothing</span>}
          </div>
        ))}
      </div>
      {t.status === 'proposed' && onAnswered && <OfferActions t={t} onAnswered={onAnswered} />}
    </div>
  )
}
