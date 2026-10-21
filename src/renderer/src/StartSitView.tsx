import { useEffect, useMemo, useState } from 'react'
import type { LeagueContext, Result, SSPlayer, StartSitData } from '@shared/types'
import { InlineError, NextMove, PlayerAvatar, SkeletonRows, type MoveAction } from './ui'
import { anonStartSit } from './names'
import './StartSitView.css'

/** Positions each Sleeper slot code accepts; a slot missing here (K, DEF, IDP…) is pinned. */
const ELIG: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
}
const eligible = (slot: string, p: SSPlayer | null | undefined) => !p || (ELIG[slot] ?? []).includes(p.pos)
/** Win-probability spread: the prototype's points SD for a head-to-head week. */
const WIN_SD = 22

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf). */
function normCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

/** Short tag for a player's availability: neg when he can't play, warn when he's listed. */
function tagOf(p: SSPlayer): { label: string; tone: 'neg' | 'warn' | 'muted' } | null {
  if (p.locked) return { label: 'Locked', tone: 'muted' }
  if (!p.flag) return null
  const short = p.flag.split(' — ')[0].replace(/^Questionable$/i, 'Q').replace(/^Doubtful$/i, 'D')
  return { label: short, tone: p.startable ? 'warn' : p.flag === 'Taxi' ? 'muted' : 'neg' }
}

/** Taxi and IR players can't be started in Sleeper, so they never move into the lineup. */
const benchOnly = (p: SSPlayer) => p.flag === 'Taxi' || p.flag === 'IR'

type Swap = { slot: number; inId: string; outId: string | null; hop: { from: number; to: number } | null; gain: number }

export default function StartSitView(props: { context: LeagueContext; userId: string; sheetVersion: string | undefined; hideNames: boolean }) {
  const [res, setRes] = useState<Result<StartSitData> | null>(null)
  const [busy, setBusy] = useState(false)
  const [lineup, setLineup] = useState<Array<string | null>>([])
  const [simOut, setSimOut] = useState<Record<string, boolean>>({})
  const [drag, setDrag] = useState<string | null>(null)

  const load = () => {
    setBusy(true)
    void window.monte.startSit(props.context.league.league_id, props.userId).then(r => {
      setRes(r)
      setBusy(false)
      if (r.ok) {
        setLineup(r.value.slots.map(s => s.current?.id ?? null))
        setSimOut({})
      }
    })
  }
  useEffect(load, [props.context.league.league_id, props.sheetVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = useMemo(() => (res?.ok ? (props.hideNames ? anonStartSit(res.value) : res.value) : null), [res, props.hideNames])
  const players = useMemo(() => {
    const m = new Map<string, SSPlayer>()
    for (const s of d?.slots ?? []) if (s.current) m.set(s.current.id, s.current)
    for (const p of d?.bench ?? []) m.set(p.id, p)
    return m
  }, [d])
  const sleeperLineup = useMemo(() => d?.slots.map(s => s.current?.id ?? null) ?? [], [d])
  const synced = d ? new Date(d.builtAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''

  const proj = (p: SSPlayer | null | undefined) => (!p || simOut[p.id] || !p.startable ? 0 : p.proj)
  const at = (i: number) => (lineup[i] ? players.get(lineup[i]!) ?? null : null)
  /** A slot can change hands only if Sleeper supports it, it isn't locked, and its player isn't. */
  const movable = (i: number) => {
    const s = d?.slots[i]
    return !!s && s.supported && !!ELIG[s.slot] && !s.locked && !at(i)?.locked
  }
  const bench = [...players.values()].filter(p => !lineup.includes(p.id))
  const total = lineup.reduce((sum, _, i) => sum + proj(at(i)), 0)
  const opp = d?.opponent ?? null
  const winP = opp ? normCdf((total - opp.total) / WIN_SD) : null
  const changed = lineup.some((id, i) => id !== sleeperLineup[i])

  // Best single swap: a bench player into slot i, directly or by moving slot j's starter to i.
  const best = useMemo((): Swap | null => {
    if (!d) return null
    let top: Swap | null = null
    const consider = (s: Swap) => {
      if (s.gain >= d.minGain && (!top || s.gain > top.gain)) top = s
    }
    for (const b of bench) {
      if (b.locked || benchOnly(b) || proj(b) <= 0) continue
      lineup.forEach((_, i) => {
        if (!movable(i)) return
        const out = at(i)
        const gain = proj(b) - proj(out)
        if (eligible(d.slots[i].slot, b)) consider({ slot: i, inId: b.id, outId: out?.id ?? null, hop: null, gain })
        lineup.forEach((_, j) => {
          const mover = at(j)
          if (j === i || !movable(j) || !mover || !eligible(d.slots[j].slot, b) || !eligible(d.slots[i].slot, mover)) return
          consider({ slot: i, inId: b.id, outId: out?.id ?? null, hop: { from: j, to: i }, gain })
        })
      })
    }
    return top as Swap | null
  }, [d, lineup, simOut]) // eslint-disable-line react-hooks/exhaustive-deps

  const applySwap = (s: Swap) =>
    setLineup(L => {
      const n = [...L]
      if (s.hop) {
        n[s.hop.to] = n[s.hop.from]
        n[s.hop.from] = s.inId
      } else n[s.slot] = s.inId
      return n
    })

  // ---- drag and drop ----
  const dragFrom = drag ? lineup.indexOf(drag) : -1
  const dragP = drag ? players.get(drag) : undefined
  const starterOk = (i: number) => {
    if (!d || !drag || !dragP || lineup[i] === drag || !movable(i)) return false
    if (!eligible(d.slots[i].slot, dragP)) return false
    return dragFrom < 0 || eligible(d.slots[dragFrom].slot, at(i))
  }
  const benchOk = (p: SSPlayer) => !!d && dragFrom >= 0 && !p.locked && !benchOnly(p) && eligible(d.slots[dragFrom].slot, p)
  const dropOnStarter = (i: number) => {
    if (!drag || !starterOk(i)) return
    setLineup(L => {
      const n = [...L]
      if (dragFrom >= 0) n[dragFrom] = n[i]
      n[i] = drag
      return n
    })
    setDrag(null)
  }
  const dropOnBench = (p: SSPlayer) => {
    if (!benchOk(p)) return
    setLineup(L => {
      const n = [...L]
      n[dragFrom] = p.id
      return n
    })
    setDrag(null)
  }
  const dragProps = (p: SSPlayer | null, canDrag: boolean) => ({
    draggable: canDrag,
    onDragStart: (e: React.DragEvent) => {
      if (!p) return
      e.dataTransfer.setData('text/plain', p.id)
      e.dataTransfer.effectAllowed = 'move'
      setDrag(p.id)
    },
    onDragEnd: () => setDrag(null),
  })

  // ---- next move ----
  const name = (id: string | null) => (id ? players.get(id)?.name ?? '' : 'an empty slot')
  const vs = opp ? `You ${total.toFixed(1)} vs ${opp.name} ${opp.total.toFixed(1)}.` : `You ${total.toFixed(1)}.`
  const sleeperAction: MoveAction[] = changed && d ? [{ label: 'Set it in Sleeper ↗', onClick: () => window.open(d.leagueUrl, '_blank') }] : []
  const move = !d
    ? null
    : best
    ? {
        head: `Start ${name(best.inId)} over ${name(best.outId)} for +${best.gain.toFixed(1)}.`,
        sub: vs,
        actions: [{ label: 'Make the swap', primary: true, onClick: () => applySwap(best!) }, ...sleeperAction],
      }
    : {
        head: winP != null ? `Lineup is optimal. ${Math.round(winP * 100)}% to win.` : 'Lineup is optimal.',
        sub: opp && total < opp.total ? `${vs} You're the underdog on paper.` : vs,
        actions: sleeperAction,
      }

  const barMax = Math.max(total, opp?.total ?? 0, 1) * 1.15

  const row = (i: number) => {
    const s = d!.slots[i]
    const p = at(i)
    const ok = starterOk(i)
    const flex = s.label !== s.slot || s.slot === 'FLEX'
    const tag = p && tagOf(p)
    const out = p ? !!simOut[p.id] : false
    return (
      <div
        key={`s${i}`}
        className={`ss2-row ${drag ? (ok ? 'target' : lineup[i] === drag ? '' : 'dim') : ''}`}
        {...dragProps(p, !!p && movable(i))}
        onDragOver={e => ok && e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          dropOnStarter(i)
        }}
      >
        <span className={`ss2-slot ${flex ? 'flex' : ''}`}>{s.label}</span>
        <div className="ss2-player" title={p?.flag || undefined}>
          {p ? (
            <>
              <PlayerAvatar id={p.id} name={p.name} />
              <span className="nm">{p.name}</span>
              <span className="pt">
                {p.pos} · {p.team}
              </span>
              {tag && <span className={`status ${tag.tone}`}>{tag.label}</span>}
            </>
          ) : (
            <span className="faint">Empty</span>
          )}
        </div>
        <span className="ss2-mono">{p?.matchup || '—'}</span>
        <span className="ss2-mono" title={p?.flexRank ? `Tyler Flex #${Math.round(p.flexRank)}` : undefined}>
          {p?.rankLabel ?? ''}
        </span>
        <span className="ss2-proj">{p ? proj(p).toFixed(1) : '—'}</span>
        {p ? (
          <button
            className={`ss2-out ${out ? 'on' : ''}`}
            title="Simulate him not playing: his projection drops to 0"
            onClick={() => setSimOut(m => ({ ...m, [p.id]: !m[p.id] }))}
          >
            {out ? 'Out' : 'Sim out'}
          </button>
        ) : (
          <span />
        )}
      </div>
    )
  }

  return (
    <div className="page ss2-page">
      {move && <NextMove head={move.head} sub={move.sub} actions={move.actions} />}
      <div className="toolbar">
        <button className="btn-outline" onClick={load} disabled={busy}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
        {d && (
          <span className="right">
            Ranks from {d.sheet.name} › Week {d.boardWeek ?? '?'} · synced {synced}
          </span>
        )}
      </div>

      {res && !res.ok && <InlineError message={res.error} onRetry={load} />}
      {d?.warnings.map(w => (
        <div key={w} className="ss-warning">
          {w}
        </div>
      ))}

      <div className="ss2-layout">
        <div className="ss2-table">
          <div className="ss2-inner">
            <div className="ss2-row head">
              <span>Slot</span>
              <span>Player · drag to swap</span>
              <span>Matchup</span>
              <span title="Tyler's positional rank for this week">Sheet</span>
              <span title="Rank mapped to last season's points per game at that rank, in this league's scoring">Proj</span>
              <span />
            </div>
            {!d && !(res && !res.ok) && <SkeletonRows n={10} />}
            {d && d.slots.map((_, i) => row(i))}
            {d && (
              <>
                <div className="ss2-benchhead">Bench</div>
                {bench.map(p => {
                  const ok = benchOk(p)
                  const tag = tagOf(p)
                  return (
                    <div
                      key={p.id}
                      className={`ss2-row bench ${drag ? (ok ? 'target' : p.id === drag ? '' : 'dim') : ''}`}
                      {...dragProps(p, !p.locked && !benchOnly(p))}
                      onDragOver={e => ok && e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault()
                        dropOnBench(p)
                      }}
                    >
                      <span className="ss2-slot">{p.flag === 'Taxi' ? 'TX' : p.flag === 'IR' ? 'IR' : 'BN'}</span>
                      <div className="ss2-player" title={p.flag || undefined}>
                        <PlayerAvatar id={p.id} name={p.name} />
                        <span className="nm">{p.name}</span>
                        <span className="pt">
                          {p.pos} · {p.team}
                        </span>
                        {tag && <span className={`status ${tag.tone}`}>{tag.label}</span>}
                      </div>
                      <span className="ss2-mono">{p.matchup || '—'}</span>
                      <span className="ss2-mono">{p.rankLabel}</span>
                      <span className="ss2-mono">{p.startable ? p.proj.toFixed(1) : '—'}</span>
                      <span />
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>

        {d && (
          <aside className="ss2-side">
            <div className="panel ss2-card">
              <div className="eyebrow">
                Week {d.week}
                {opp && ` · vs ${opp.name}`}
              </div>
              <div className="ss2-big">
                <span className="you">{total.toFixed(1)}</span>
                {winP != null && <span className="prob">{Math.round(winP * 100)}%</span>}
              </div>
              <div className="ss2-bars">
                <span>You</span>
                <div className="track">
                  <div className="fill you" style={{ width: `${(total / barMax) * 100}%` }} />
                </div>
                <span className="r">{total.toFixed(1)}</span>
                {opp && (
                  <>
                    <span title={opp.name}>Opp</span>
                    <div className="track">
                      <div className="fill opp" style={{ width: `${(opp.total / barMax) * 100}%` }} />
                    </div>
                    <span className="r">{opp.total.toFixed(1)}</span>
                  </>
                )}
              </div>
              {opp && <div className="ss2-note">Your opponent's total is from the lineup they have set now.</div>}
              <button
                className="btn-outline"
                style={{ alignSelf: 'flex-start' }}
                disabled={!changed && !Object.values(simOut).some(Boolean)}
                onClick={() => {
                  setLineup(sleeperLineup)
                  setSimOut({})
                }}
              >
                Reset lineup
              </button>
            </div>
            <div className="ss2-foot">
              Proj is Tyler’s rank mapped to the points per game that rank scored last season in this league’s scoring (
              {Object.entries(d.columns)
                .map(([k, v]) => `${k} ${v}`)
                .join(', ')}
              ). The order is the signal; totals are approximate. Players Tyler leaves off the board are treated as not playing.
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
