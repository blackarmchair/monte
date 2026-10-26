import { useEffect, useRef, useState } from 'react'
import type { BBResult, BBTeam, LeagueContext, PickOddsOpts, Settings } from '@shared/types'
import { newSeed, sameRunParams } from '@shared/seed'
import type { Run } from './App'
import { InlineError, NextMove, pct, Segmented, SkeletonRows, TeamAvatar } from './ui'
import './PicksView.css'

const pad = (n: number) => String(n).padStart(2, '0')
const DEBOUNCE_MS = 350

/** Slot at which the cumulative distribution first reaches q (1-based). */
function quantileSlot(d: number[], q: number): number {
  let c = 0
  for (let k = 0; k < d.length; k++) {
    c += d[k]
    if (c >= q - 1e-9) return k + 1
  }
  return d.length
}

/** Projected slot = rank of the mean draft slot, earliest first. */
const slotsOf = (r: BBResult | undefined) =>
  new Map([...(r?.teams ?? [])].sort((a, b) => a.meanDraftSlot - b.meanDraftSlot).map((t, i) => [t.roster_id, i + 1]))

const top3 = (d: number[] | undefined) => (d ? (d[0] ?? 0) + (d[1] ?? 0) + (d[2] ?? 0) : 0)

export default function PicksView(props: {
  context: LeagueContext
  settings: Settings
  run: Run<BBResult>
  onRun: (opts: PickOddsOpts) => void
  onSettings: (p: Partial<Settings>) => void
  onShop: (assetId: string) => void
}) {
  const { context, settings, run } = props
  const result = run.result
  // The baseline only counts when it differs from the run on screen by its what-ifs alone.
  const base = run.base && (!result || sameRunParams(run.base, result)) ? run.base : result
  const [sims, setSims] = useState(settings.sims)
  const [err, setErr] = useState(Math.max(0.02, settings.strengthCV))
  const [seed, setSeed] = useState(settings.seed)
  const [model, setModel] = useState<'A' | 'B'>(settings.model ?? 'B')
  const [forced, setForced] = useState<Record<number, number[]>>(() => result?.forced ?? {})
  const [hover, setHover] = useState<number | null>(null)
  const timer = useRef<number | undefined>(undefined)

  type RunOpts = { sims?: number; err?: number; forced?: Record<number, number[]>; seed?: number; model?: 'A' | 'B' }
  const runNow = (o: RunOpts) => {
    window.clearTimeout(timer.current)
    props.onRun({
      sims: o.sims ?? sims,
      strengthCV: o.err ?? err,
      forced: o.forced ?? forced,
      seed: o.seed ?? seed,
      model: o.model ?? model,
    })
  }
  // The real sim takes seconds: slider steps and what-if clicks settle before it runs.
  const runSoon = (o: RunOpts) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => runNow(o), DEBOUNCE_MS)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    if (!result && !run.busy && !run.error) runNow({})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const n = context.rosters.length
  const byId = new Map(result?.teams.map(t => [t.roster_id, t]))
  const baseById = new Map(base?.teams.map(t => [t.roster_id, t]))
  const order = result ? [...result.teams].sort((a, b) => a.meanDraftSlot - b.meanDraftSlot) : []
  const slotOf = slotsOf(result)
  const baseSlotOf = slotsOf(base)
  const picks = [...context.myPicks].sort(
    (a, b) => a.round - b.round || (slotOf.get(a.originalRosterId) ?? 99) - (slotOf.get(b.originalRosterId) ?? 99),
  )
  const firsts = picks.filter(p => p.round === 1)
  const top3Firsts = firsts.reduce((s, p) => s + top3(byId.get(p.originalRosterId)?.slotDist), 0)
  const top3Base = firsts.reduce((s, p) => s + top3(baseById.get(p.originalRosterId)?.slotDist), 0)
  const top3Delta = top3Firsts - top3Base
  const nameOf = new Map(context.rosters.map(r => [r.roster_id, r.display_name]))
  const avatarOf = new Map(context.rosters.map(r => [r.roster_id, r.avatar]))
  const whatIf = result?.whatIf ?? base?.whatIf ?? null
  const winners = whatIf ? forced[whatIf.week] ?? [] : []

  const pickWinner = (rid: number, opp: number) => {
    if (!whatIf) return
    const w = winners.filter(x => x !== rid && x !== opp)
    const next = { ...forced, [whatIf.week]: winners.includes(rid) ? w : [...w, rid] }
    setForced(next)
    runSoon({ forced: next })
  }
  const resetWhatIf = () => {
    setForced({})
    runNow({ forced: {} })
  }

  // Next move: your best 1st by mean slot.
  const best = [...firsts].sort((a, b) => (byId.get(a.originalRosterId)?.meanDraftSlot ?? 99) - (byId.get(b.originalRosterId)?.meanDraftSlot ?? 99))[0]
  const bestTeam = best && byId.get(best.originalRosterId)
  const bestSlot = best ? slotOf.get(best.originalRosterId) ?? 0 : 0
  const move = !result ? null : !best || !bestTeam ? (
    <NextMove head={`You don’t own a ${context.draftSeason} 1st in this league.`} sub="Your later picks are below." />
  ) : (
    <NextMove
      head={`Your ${best.originalRosterId === context.myRosterId ? 'own' : `${best.originalName}’s`} 1st lands at 1.01 in ${Math.round(
        100 * (bestTeam.slotDist[0] ?? 0),
      )}% of sims.`}
      sub={whatIf ? `Pick week ${whatIf.week} winners below to see every pick move.` : 'Projected from the rest of the season.'}
      actions={[
        {
          label: `Shop the 1.${pad(bestSlot)}`,
          primary: true,
          onClick: () => props.onShop(`pick:${best.season}:1:${best.originalRosterId}`),
        },
      ]}
    />
  )

  const cardCols = { gridTemplateColumns: `repeat(${Math.max(1, picks.length)}, minmax(150px, 1fr))` }
  const tableCols = { gridTemplateColumns: `32px minmax(150px,1.2fr) 50px 56px 64px 50px minmax(${n * 22}px,3fr)` }
  const strip = { gridTemplateColumns: `repeat(${n}, 1fr)` }

  return (
    <div className={`pk2 ${run.busy && result ? 'busy' : ''}`}>
      {move}
      <div className="pk2-controls">
        <span className="pk2-live">Live</span>
        <span className="pk2-k">Simulations</span>
        <Segmented
          value={sims}
          options={[
            { value: 1000, label: '1k' },
            { value: 3000, label: '3k' },
            { value: 10000, label: '10k' },
          ]}
          onChange={v => {
            setSims(v)
            props.onSettings({ sims: v })
            runNow({ sims: v })
          }}
        />
        <span
          className="pk2-k"
          title="How unsure we are about each roster's true strength. Low values treat projections as exact, which overstates how predictable the standings are."
        >
          Projection error
        </span>
        <input
          type="range"
          min={0.02}
          max={0.2}
          step={0.01}
          value={err}
          style={{ width: 170 }}
          onChange={e => {
            const v = Number(e.target.value)
            setErr(v)
            props.onSettings({ strengthCV: v })
            runSoon({ err: v })
          }}
        />
        <span className="mono">{err.toFixed(2)}</span>
        <span className="pk2-k" title={'Classic: every projected player plays every remaining week. Availability (default): whether each player plays is drawn from injury tags and history, so absences and dud weeks count.'}>
          Model
        </span>
        <Segmented
          value={model}
          options={[
            { value: 'A', label: 'Classic' },
            { value: 'B', label: 'Availability' },
          ]}
          onChange={v => {
            setModel(v)
            props.onSettings({ model: v })
            runNow({ model: v })
          }}
        />
        <span className="grow" />
        <span className="pk2-meta">
          {result
            ? `${result.simulations.toLocaleString()} sims at ${result.strengthCV.toFixed(2)}${
                result.model === 'B' ? ' · availability' : ''
              } · seed ${result.seed} · ${
                result.inProgressWeek ? `week ${result.inProgressWeek} in progress` : `through week ${result.lastScoredWeek}`
              }`
            : ''}
          {run.busy ? `${result ? ' · ' : ''}updating…` : ''}
        </span>
        <button
          className="link"
          title="Odds are reproducible: the same data and seed always give the same numbers. A new seed reruns with fresh random draws."
          onClick={() => {
            const s = newSeed()
            setSeed(s)
            props.onSettings({ seed: s })
            runNow({ seed: s })
          }}
        >
          New seed
        </button>
      </div>

      {run.error && <InlineError message={`Simulation failed: ${run.error}`} onRetry={() => runNow({})} />}

      <div className="pk2-heading">
        <span className="pk2-label">Your {context.draftSeason} picks</span>
        {result && firsts.length > 0 && (
          <span className="pk2-top3">
            expected top-3 firsts <b className="mono">{top3Firsts.toFixed(2)}</b>{' '}
            {Math.abs(top3Delta) >= 0.005 && (
              <span className="mono" style={{ color: top3Delta > 0 ? 'var(--pos)' : 'var(--neg)' }}>
                {top3Delta > 0 ? '+' : '−'}
                {Math.abs(top3Delta).toFixed(2)}
              </span>
            )}
          </span>
        )}
      </div>

      {picks.length === 0 ? (
        <div className="empty">You don’t own any {context.draftSeason} picks in this league.</div>
      ) : result ? (
        <div className="pk2-cards" style={cardCols}>
          {picks.map(p => {
            const team = byId.get(p.originalRosterId)
            if (!team) return <div key={`${p.round}:${p.originalRosterId}`} />
            return (
              <PickCard
                key={`${p.round}:${p.originalRosterId}`}
                via={`Rd ${p.round} · ${p.originalRosterId === context.myRosterId ? 'own' : `via ${p.originalName}`}`}
                round={p.round}
                team={team}
                slot={slotOf.get(p.originalRosterId) ?? 0}
                baseSlot={baseSlotOf.get(p.originalRosterId) ?? 0}
                hovered={hover === p.originalRosterId}
                onEnter={() => setHover(p.originalRosterId)}
                onLeave={() => setHover(null)}
              />
            )
          })}
        </div>
      ) : (
        <div className="pk2-cards" style={cardCols}>
          {picks.map(p => (
            <div key={`${p.round}:${p.originalRosterId}`} className="pk2-card" style={{ height: 150 }}>
              <SkeletonRows n={1} />
            </div>
          ))}
        </div>
      )}

      {whatIf && whatIf.pairs.length > 0 && (
        <div className="pk2-whatif">
          <span className="pk2-label">Week {whatIf.week} what-if</span>
          {whatIf.pairs.map(([a, b]) => (
            <div key={`${a}:${b}`} className="pk2-pill">
              {[a, b].map((rid, i) => (
                <button
                  key={rid}
                  className={winners.includes(rid) ? 'on' : ''}
                  onClick={() => pickWinner(rid, i === 0 ? b : a)}
                  title={winners.includes(rid) ? 'Click again to clear' : `${nameOf.get(rid)} wins`}
                >
                  {nameOf.get(rid) ?? `Roster ${rid}`}
                </button>
              ))}
            </div>
          ))}
          {winners.length > 0 && (
            <button className="link" onClick={resetWhatIf}>
              Reset
            </button>
          )}
        </div>
      )}

      <div className="pk2-table">
        <div className="pk2-row head" style={tableCols}>
          <span>#</span>
          <span>Team</span>
          <span>W-L</span>
          <span>Proj W</span>
          <span>Playoff</span>
          <span>Mean</span>
          <div className="pk2-strip" style={strip}>
            {Array.from({ length: n }, (_, i) => (
              <span key={i} className="c">
                {i + 1}
              </span>
            ))}
          </div>
        </div>
        {!result && <SkeletonRows n={n} />}
        {order.map((t, i) => {
          const owner = context.firstOwner[t.roster_id] ?? t.roster_id
          const mine = owner === context.myRosterId
          return (
            <div key={t.roster_id} className="pk2-row" style={{ ...tableCols, background: hover === t.roster_id ? 'var(--acc-tint)' : undefined }}>
              <span className="mute">{i + 1}</span>
              <div className="pk2-team">
                <TeamAvatar src={avatarOf.get(t.roster_id)} name={t.team} size={22} />
                <span className="nm">{t.team}</span>
                {mine && <span className="pk2-yours">yours</span>}
              </div>
              <span>
                {t.wins}-{t.losses}
              </span>
              <span>{t.projWins.toFixed(1)}</span>
              <span>{pct(t.playoffPct)}</span>
              <span style={{ fontWeight: 600 }}>{t.meanDraftSlot.toFixed(1)}</span>
              <div className="pk2-strip" style={strip}>
                {t.slotDist.map((p, k) => {
                  const a = Math.round(Math.min(1, p * 1.5) * (mine ? 90 : 55))
                  return (
                    <div
                      key={k}
                      className="cell"
                      title={`${k + 1}: ${(100 * p).toFixed(1)}%`}
                      style={{
                        background: `color-mix(in oklab, ${mine ? 'var(--acc)' : 'var(--ink)'} ${a}%, var(--card))`,
                        color: a > 45 ? 'var(--bg)' : 'var(--ink2)',
                      }}
                    >
                      {p >= 0.05 ? Math.round(p * 100) : ''}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {result && (
        <div className="footnote">
          Draft order rule: non-playoff teams by reverse max points for, then playoff teams the same way; later rounds repeat round 1. Check
          this matches your league before trusting a slot. Owners of other teams’ 1sts are in Overview.
          {result.zeroed.length > 0 && (
            <details>
              <summary>{result.zeroed.length} injured players held out of projections</summary>
              {result.zeroed.map(z => (
                <div key={`${z.team}:${z.player}`}>
                  {z.player} ({z.team}) — {z.status}, weeks {z.weeks}
                </div>
              ))}
            </details>
          )}
          {!result.scheduleLive && <div>Live NFL schedule unavailable: byes come from a static table.</div>}
        </div>
      )}
    </div>
  )
}

function PickCard(props: {
  via: string
  round: number
  team: BBTeam
  slot: number
  baseSlot: number
  hovered: boolean
  onEnter: () => void
  onLeave: () => void
}) {
  const d = props.team.slotDist
  const mx = Math.max(...d, 1e-9)
  const lo = quantileSlot(d, 0.1)
  const hi = quantileSlot(d, 0.9)
  const mode = d.indexOf(mx)
  const mv = props.baseSlot && props.slot ? props.baseSlot - props.slot : 0
  return (
    <div className={`pk2-card ${props.hovered ? 'on' : ''}`} onMouseEnter={props.onEnter} onMouseLeave={props.onLeave}>
      <div className="via">{props.via}</div>
      <div className="slotline">
        <span className="slot">
          {props.round}.{pad(props.slot)}
        </span>
        {mv !== 0 && (
          <span className="mv" style={{ color: mv > 0 ? 'var(--pos)' : 'var(--neg)' }}>
            {mv > 0 ? `▲ ${mv}` : `▼ ${-mv}`}
          </span>
        )}
      </div>
      <div className="hist">
        {d.map((p, i) => (
          <div
            key={i}
            title={`${props.round}.${pad(i + 1)}: ${(100 * p).toFixed(1)}%`}
            style={{ height: `${Math.max(2, (p / mx) * 40)}px`, background: i === mode ? 'var(--acc)' : 'var(--acc-soft)' }}
          />
        ))}
      </div>
      <div className="range">{lo === hi ? `locked at ${lo}` : `likely ${lo}–${hi}`}</div>
    </div>
  )
}
