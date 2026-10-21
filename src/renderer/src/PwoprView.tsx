import { useEffect, useMemo, useRef, useState } from 'react'
import type { LeagueContext, PWOPRResult, PWOPRRow } from '@shared/types'
import type { Run } from './App'
import { InlineError, NextMove, PlayerAvatar, Segmented, SkeletonRows } from './ui'
import './PwoprView.css'

type Basis = 'proj' | 'actual'
type Pos = 'All' | 'WR' | 'TE'
type Owner = 'Everyone' | 'Mine' | 'Others' | 'FA'
type View = 'Table' | 'Chart'
type SortKey = 'usage' | 'x' | 'delta'
type Tone = 'pos' | 'neg' | 'mute'

/** Δ bar full width = ±12 PPG; detail bars full width = 25 PPG. */
const DELTA_SCALE = 12
const PPG_SCALE = 25

/** The two readings of the same usage number. Copy lives here so table, chart and meta agree. */
const BASIS = {
  proj: {
    col: 'Sleeper',
    meta: 'Δ = usage PPG − Sleeper',
    head: 'Δ usage − proj',
    axis: 'Sleeper projection →',
    ahead: 'projection',
    buy: 'Role ahead of projection · start / buy',
    sell: 'Projection ahead of role · fade',
  },
  actual: {
    col: 'Actual',
    meta: 'Δ = usage PPG − actual PPG',
    head: 'Δ usage − actual',
    axis: 'Actual PPG →',
    ahead: 'scoring',
    buy: 'Usage ahead of scoring · buy',
    sell: 'Scoring ahead of usage · sell',
  },
} as const

const n1 = (x: number | null) => (x == null ? '—' : x.toFixed(1))
const p0 = (x: number) => `${Math.round(100 * x)}%`
const signed = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(1)
const lastName = (n: string) => n.replace(/ (Jr\.|Sr\.|II|III|IV)$/, '').split(' ').slice(-1)[0]
const toneColor = (t: Tone) => (t === 'mute' ? 'var(--mute)' : `var(--${t})`)

export default function PwoprView(props: {
  context: LeagueContext
  run: Run<PWOPRResult>
  onRun: () => void
  /** add him to a trade's Get side, his owner as partner */
  onTarget: (assetId: string, owner: number) => void
  onLineup: () => void
  onViewTeam: (rid: number) => void
}) {
  const { context, run } = props
  const result = run.result
  const [basis, setBasis] = useState<Basis>('proj')
  const [pos, setPos] = useState<Pos>('All')
  const [owner, setOwner] = useState<Owner>('Everyone')
  const [thr, setThr] = useState(3)
  const [q, setQ] = useState('')
  const [view, setView] = useState<View>('Table')
  const [sort, setSort] = useState<SortKey>('delta')
  const [selId, setSelId] = useState<string | null>(null)

  useEffect(() => {
    if (!result && !run.busy && !run.error) props.onRun()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ownerOf = useMemo(() => {
    const m = new Map<string, { id: number; name: string }>()
    for (const r of context.rosters) for (const p of r.players) m.set(p, { id: r.roster_id, name: r.display_name })
    return m
  }, [context])

  const deltaOf = (r: PWOPRRow) => (basis === 'proj' ? r.delta : r.actualDelta)
  const xOf = (r: PWOPRRow) => (basis === 'proj' ? r.sleeperPPG : r.actualPPG)
  const isMine = (r: PWOPRRow) => ownerOf.get(r.player_id)?.id === context.myRosterId
  const ownName = (r: PWOPRRow) => (isMine(r) ? 'you' : ownerOf.get(r.player_id)?.name ?? 'FA')
  /** Buy/Fade once |Δ| reaches the threshold; never on a gap under half a point. */
  const toneOf = (r: PWOPRRow): Tone => {
    const d = deltaOf(r)
    const t = Math.max(thr, 0.5)
    return d == null ? 'mute' : d >= t ? 'pos' : d <= -t ? 'neg' : 'mute'
  }
  const sigLabel = (r: PWOPRRow) => {
    const t = toneOf(r)
    return t === 'pos' ? (isMine(r) ? 'Start' : 'Buy') : t === 'neg' ? (isMine(r) ? 'Sell' : 'Fade') : 'Neutral'
  }

  const inFilter = (r: PWOPRRow, o: Owner = owner) => {
    if (pos !== 'All' && r.pos !== pos) return false
    const who = ownerOf.get(r.player_id)
    if (o === 'Mine' && who?.id !== context.myRosterId) return false
    if (o === 'Others' && (!who || who.id === context.myRosterId)) return false
    if (o === 'FA' && who) return false
    const needle = q.trim().toLowerCase()
    return !needle || r.name.toLowerCase().includes(needle)
  }

  const rows = useMemo(() => {
    if (!result) return []
    const val = (r: PWOPRRow) => (sort === 'usage' ? r.usagePPG : sort === 'x' ? xOf(r) : deltaOf(r))
    // Descending; missing values always sink.
    return result.rows
      .filter(r => inFilter(r))
      .sort((a, b) => {
        const x = val(a)
        const y = val(b)
        if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1
        return y - x
      })
  }, [result, pos, owner, q, sort, basis, ownerOf, context.myRosterId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Next move, from the whole board (not the filter): best buy elsewhere, biggest gap at home.
  const withDelta = result?.rows.filter(r => deltaOf(r) != null) ?? []
  const topBuy = withDelta.filter(r => ownerOf.has(r.player_id) && !isMine(r)).sort((a, b) => deltaOf(b)! - deltaOf(a)!)[0]
  const myGap = withDelta.filter(isMine).sort((a, b) => Math.abs(deltaOf(b)!) - Math.abs(deltaOf(a)!))[0]
  const sel = result?.rows.find(r => r.player_id === selId) ?? topBuy ?? rows[0]

  const heads: Array<[SortKey | null, string]> = [
    [null, 'Player'],
    [null, 'Owner'],
    ['usage', 'Usage'],
    ['x', BASIS[basis].col],
    ['delta', BASIS[basis].head],
    [null, 'Signal'],
  ]

  return (
    <div className="pw2-page">
      {result && topBuy && (
        <NextMove
          head={`Biggest buy gap: ${topBuy.name} (${signed(deltaOf(topBuy)!)}) on ${ownName(topBuy)}.`}
          sub={myGap ? `Biggest gap on your roster: ${myGap.name} (${signed(deltaOf(myGap)!)}).` : undefined}
          actions={[
            {
              label: 'Show buy gaps',
              primary: true,
              onClick: () => {
                setOwner('Others')
                setThr(4)
              },
            },
            {
              label: 'Show my players',
              onClick: () => {
                setOwner('Mine')
                setThr(0)
              },
            },
          ]}
        />
      )}
      <div className="pw2-filters">
        <span className="pw2-ctl">
          <span className="lbl">Position</span>
          <Segmented<Pos> value={pos} onChange={setPos} options={['All', 'WR', 'TE'].map(v => ({ value: v as Pos, label: v }))} />
        </span>
        <span className="pw2-ctl">
          <span className="lbl">Owner</span>
          <Segmented<Owner> value={owner} onChange={setOwner} options={['Everyone', 'Mine', 'Others', 'FA'].map(v => ({ value: v as Owner, label: v }))} />
        </span>
        <span className="pw2-ctl">
          <span className="lbl" title="The size of gap, in PPG, at which a player counts as Buy or Fade instead of Neutral">
            Signal at ≥
          </span>
          <input type="range" min={0} max={8} step={0.5} value={thr} onChange={e => setThr(Number(e.target.value))} style={{ width: 140 }} />
          <span className="mono">{thr.toFixed(1)}</span>
        </span>
        <div className="grow" />
        <span className="pw2-count">
          {result ? `${rows.length} players · ${BASIS[basis].meta}` : run.busy ? 'Building the usage board…' : ''}
        </span>
      </div>
      <div className="pw2-filters">
        <input className="search" placeholder="Search players" value={q} onChange={e => setQ(e.target.value)} />
        <span className="pw2-ctl">
          <span className="lbl">Δ vs</span>
          <Segmented<Basis>
            value={basis}
            onChange={setBasis}
            options={[
              { value: 'proj', label: 'Projection' },
              { value: 'actual', label: 'Actual' },
            ]}
          />
        </span>
        <Segmented<View> value={view} onChange={setView} options={['Table', 'Chart'].map(v => ({ value: v as View, label: v }))} />
        <div className="grow" />
        {result && (
          <span className="pw2-count">
            Week {result.targetWeek} · usage from weeks {result.usageWeeks[0]}–{result.usageWeeks[result.usageWeeks.length - 1]}
          </span>
        )}
      </div>

      {run.error && <InlineError message={`PWOPR failed: ${run.error}`} onRetry={props.onRun} />}

      <div className="pw2-layout">
        <div className="pw2-main">
          {view === 'Table' ? (
            <div className="pw2-table">
              <div className="pw2-inner">
                <div className="pw2-head">
                  {heads.map(([key, label]) =>
                    key ? (
                      <button key={label} className={key === sort ? 'on' : ''} onClick={() => setSort(key)}>
                        {label}
                        {key === sort ? ' ↓' : ''}
                      </button>
                    ) : (
                      <span key={label}>{label}</span>
                    ),
                  )}
                </div>
                {!result && <SkeletonRows n={10} />}
                {rows.map(r => {
                  const d = deltaOf(r)
                  const tone = toneOf(r)
                  const w = d == null ? 0 : Math.min(Math.abs(d) / DELTA_SCALE, 1) * 50
                  const mine = isMine(r)
                  return (
                    <div
                      key={r.player_id}
                      className={`pw2-row ${r.player_id === sel?.player_id ? 'sel' : mine ? 'mine' : ''}`}
                     
                      onClick={() => setSelId(r.player_id)}
                    >
                      <span className="pw2-player">
                        <PlayerAvatar id={r.player_id} name={r.name} />
                        <b>{r.name}</b>{' '}
                        <span className="pt">
                          {r.pos} · {r.team}
                        </span>
                      </span>
                      <span className="pw2-owner">{ownName(r)}</span>
                      <span className="mono">{n1(r.usagePPG)}</span>
                      <span className="mono dim">{n1(xOf(r))}</span>
                      <div className="pw2-dbar">
                        <div className="track">
                          <div className="zero" />
                          {d != null && (
                            <div className="fill" style={{ left: d >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: toneColor(tone) }} />
                          )}
                        </div>
                        <span className="val" style={{ color: toneColor(tone) }}>
                          {d == null ? '—' : signed(d)}
                        </span>
                      </div>
                      <span className={`pw2-sig ${tone}`}>{sigLabel(r)}</span>
                    </div>
                  )
                })}
                {result && rows.length === 0 && <div className="pw2-empty">No players match these filters.</div>}
              </div>
            </div>
          ) : (
            <Chart
              rows={rows.filter(r => deltaOf(r) != null && xOf(r) != null)}
              basis={basis}
              xOf={xOf}
              deltaOf={deltaOf}
              toneOf={toneOf}
              isMine={isMine}
              ownName={ownName}
              sel={sel?.player_id ?? null}
              onSelect={setSelId}
            />
          )}
        </div>

        {sel && (
          <Detail
            r={sel}
            basis={basis}
            delta={deltaOf(sel)}
            x={xOf(sel)}
            mine={isMine(sel)}
            owner={ownerOf.get(sel.player_id) ?? null}
            onLineup={props.onLineup}
            onTarget={props.onTarget}
            onViewTeam={props.onViewTeam}
          />
        )}
      </div>
    </div>
  )
}

function Detail(props: {
  r: PWOPRRow
  basis: Basis
  delta: number | null
  x: number | null
  mine: boolean
  owner: { id: number; name: string } | null
  onLineup: () => void
  onTarget: (assetId: string, owner: number) => void
  onViewTeam: (rid: number) => void
}) {
  const { r, delta: d, mine, owner } = props
  const ahead = BASIS[props.basis].ahead
  const say =
    d == null
      ? 'No usage read for him yet.'
      : d > 3
      ? `Role is ahead of the ${ahead}. ${mine ? 'Start him.' : 'Buy.'}`
      : d < -3
      ? `${ahead.charAt(0).toUpperCase()}${ahead.slice(1)} is ahead of the role. ${mine ? 'Sell while the name holds.' : 'Fade.'}`
      : 'Role and projection agree.'
  const bar = (v: number | null) => `${Math.min(1, Math.max(0, (v ?? 0) / PPG_SCALE)) * 100}%`
  const stats: Array<[string, string]> = [
    ['G', String(r.games)],
    ['Tgt/G', r.tgtPerGame.toFixed(1)],
    ['Tgt%', p0(r.tgtShare)],
    ['Air%', p0(r.airShare)],
    ['WOPR', r.wopr.toFixed(2)],
    ['xTgt', r.expTargets.toFixed(1)],
    ['Actual', n1(r.actualPPG)],
    ['Proj', r.proj.toFixed(1)],
  ]
  return (
    <aside className="pw2-panel">
      <div className="pw2-pmeta">
        {r.pos} · {r.team} · {mine ? 'you' : owner?.name ?? 'FA'}
        {r.status ? ` · ${r.status}` : ''}
      </div>
      <div className="pw2-pname">{r.name}</div>
      <div className="pw2-pdelta" style={{ color: d == null ? 'var(--ink2)' : d > 1 ? 'var(--pos)' : d < -1 ? 'var(--neg)' : 'var(--ink2)' }}>
        {d == null ? '—' : signed(d)}
      </div>
      <div className="pw2-bars">
        <span>Usage</span>
        <div className="track">
          <div style={{ width: bar(r.usagePPG), background: 'var(--ink)' }} />
        </div>
        <span className="mono">{n1(r.usagePPG)}</span>
        <span>{BASIS[props.basis].col}</span>
        <div className="track">
          <div style={{ width: bar(props.x), background: 'var(--mute)' }} />
        </div>
        <span className="mono">{n1(props.x)}</span>
      </div>
      <div className="pw2-say">{say}</div>
      <div className="pw2-actions">
        {mine ? (
          <button className="btn-primary" onClick={props.onLineup}>
            Open lineup
          </button>
        ) : owner ? (
          <>
            <button className="btn-primary" onClick={() => props.onTarget(r.player_id, owner.id)}>
              Add to trade
            </button>
            <button className="btn-outline" onClick={() => props.onViewTeam(owner.id)}>
              View {owner.name}
            </button>
          </>
        ) : (
          <button className="btn-primary" disabled>
            Free agent
          </button>
        )}
      </div>
      <div className="pw2-stats">
        {stats.map(([k, v]) => (
          <div key={k}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}

function Chart(props: {
  rows: PWOPRRow[]
  basis: Basis
  xOf: (r: PWOPRRow) => number | null
  deltaOf: (r: PWOPRRow) => number | null
  toneOf: (r: PWOPRRow) => Tone
  isMine: (r: PWOPRRow) => boolean
  ownName: (r: PWOPRRow) => string
  sel: string | null
  onSelect: (id: string) => void
}) {
  const b = BASIS[props.basis]
  const [hov, setHov] = useState<string | null>(null)
  // 4–26 by default; widen either end only if a real player would otherwise be pinned to it.
  const vals = props.rows.flatMap(r => [props.xOf(r) ?? 0, r.usagePPG ?? 0])
  const lo = Math.max(0, Math.min(4, Math.floor(Math.min(4, ...vals)) - 1))
  const hi = Math.max(26, Math.ceil(Math.max(0, ...vals)) + 1)
  const frac = (v: number) => (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)
  const sc = (v: number) => `${frac(v) * 100}%`
  const ticks: number[] = []
  for (let t = 5; t < hi; t += 5) ticks.push(t)

  // Labels: only signal players with real volume (or yours, or the selected one), and a label
  // that would overlap one already placed is dropped. Biggest gaps claim space first.
  const plotRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 900, h: 500 })
  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const labelled = useMemo(() => {
    const placed: Array<[number, number, number, number]> = []
    const out = new Set<string>()
    const cands = props.rows
      .filter(r => r.player_id === props.sel || props.isMine(r) || (props.toneOf(r) !== 'mute' && Math.max(r.usagePPG ?? 0, props.xOf(r) ?? 0) >= 10))
      .sort(
        (a, b) =>
          Number(b.player_id === props.sel) - Number(a.player_id === props.sel) ||
          Number(props.isMine(b)) - Number(props.isMine(a)) ||
          Math.abs(props.deltaOf(b)!) - Math.abs(props.deltaOf(a)!),
      )
    for (const r of cands) {
      const x = frac(props.xOf(r)!) * size.w + 12
      const y = (1 - frac(r.usagePPG ?? 0)) * size.h - 8
      const box: [number, number, number, number] = [x, y, x + lastName(r.name).length * 7 + 4, y + 16]
      if (placed.some(p => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue
      placed.push(box)
      out.add(r.player_id)
    }
    return out
  }, [props.rows, props.basis, props.sel, props.toneOf, size, hi]) // eslint-disable-line react-hooks/exhaustive-deps

  const hp = props.rows.find(r => r.player_id === hov)
  const withD = props.rows.filter(r => props.deltaOf(r) != null)
  const buys = withD.filter(r => props.deltaOf(r)! > 0).sort((a, c) => props.deltaOf(c)! - props.deltaOf(a)!).slice(0, 5)
  const sells = withD.filter(r => props.deltaOf(r)! < 0).sort((a, c) => props.deltaOf(a)! - props.deltaOf(c)!).slice(0, 5)

  // y = x in data space is the plot's corner-to-corner diagonal only because both axes share lo/hi.
  return (
    <div className="pw2-chart">
      <div className="pw2-scatter">
        <div className="pw2-plot" ref={plotRef}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <line x1="0" y1="100" x2="100" y2="0" stroke="var(--line)" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="cap" style={{ left: 12, top: 10, color: 'var(--pos)' }}>
            {b.buy}
          </div>
          <div className="cap" style={{ right: 12, bottom: 10, color: 'var(--neg)' }}>
            {b.sell}
          </div>
          {ticks.map(t => (
            <div key={t}>
              <div className="tick" style={{ bottom: -22, left: sc(t), transform: 'translateX(-50%)' }}>
                {t}
              </div>
              <div className="tick" style={{ left: -30, bottom: sc(t), transform: 'translateY(50%)' }}>
                {t}
              </div>
            </div>
          ))}
          {props.rows.map(r => {
            const tone = props.toneOf(r)
            const mine = props.isMine(r)
            const on = r.player_id === props.sel || r.player_id === hov
            const size = mine ? 14 : 11
            return (
              <button
                key={r.player_id}
                className="pw2-dot"
                style={{ left: sc(props.xOf(r)!), bottom: sc(r.usagePPG ?? 0), zIndex: on ? 5 : 1, opacity: tone === 'mute' && !on ? 0.4 : 1 }}
                onMouseEnter={() => setHov(r.player_id)}
                onMouseLeave={() => setHov(h => (h === r.player_id ? null : h))}
                onClick={() => props.onSelect(r.player_id)}
              >
                <i
                  style={{
                    width: size,
                    height: size,
                    background: toneColor(tone),
                    boxShadow: on
                      ? '0 0 0 3px var(--card2), 0 0 0 5px var(--ink)'
                      : mine
                      ? '0 0 0 2px var(--card2), 0 0 0 3px var(--ink2)'
                      : '0 0 0 2px var(--card2)',
                  }}
                />
                {labelled.has(r.player_id) && <span>{lastName(r.name)}</span>}
              </button>
            )
          })}
          {hp && (
            <div className="pw2-tip" style={{ left: sc(props.xOf(hp)!), bottom: sc(hp.usagePPG ?? 0) }}>
              <div className="n">{hp.name}</div>
              <div className="mono">
                usage {n1(hp.usagePPG)} · {props.basis === 'proj' ? 'proj' : 'actual'} {n1(props.xOf(hp))} · {signed(props.deltaOf(hp)!)}
              </div>
            </div>
          )}
        </div>
        <div className="pw2-axes">
          <span>↑ Usage PPG</span>
          <span>{b.axis}</span>
        </div>
      </div>
      <div className="pw2-gaps">
        <GapList {...props} title="Biggest buy gaps" color="var(--pos)" rows={buys} />
        <GapList {...props} title="Biggest sell gaps" color="var(--neg)" rows={sells} />
      </div>
    </div>
  )
}

function GapList(props: {
  title: string
  color: string
  rows: PWOPRRow[]
  deltaOf: (r: PWOPRRow) => number | null
  ownName: (r: PWOPRRow) => string
  onSelect: (id: string) => void
}) {
  return (
    <div className="pw2-gap">
      <div className="eyebrow" style={{ color: props.color }}>
        {props.title}
      </div>
      {props.rows.length === 0 && <div className="pw2-none">None in this filter.</div>}
      {props.rows.map(r => (
        <button key={r.player_id} className="pw2-gaprow" onClick={() => props.onSelect(r.player_id)}>
          <span>
            {r.name} <span className="own">{props.ownName(r)}</span>
          </span>
          <span className="mono" style={{ color: props.color }}>
            {signed(props.deltaOf(r)!)}
          </span>
        </button>
      ))}
    </div>
  )
}
