// Pick odds: on the left your 1st, a card per pick you own, and the projected order with a heat
// strip per team; on the right (sticky) the selected team's distribution above next week's
// what-if (click winners, projection error, model, seed). Every control reruns the sim (what-if
// clicks debounced); the old result stays on screen, dimmed, while a new one computes.
import { useEffect, useState } from 'react'
import type { BBResult, LeagueContext } from '@shared/types'
import { newSeed, sameRunParams } from '@shared/seed'
import { useApp, type Forced } from './store'
import { Btn, DistBars, Empty, ErrorBox, grad, Histogram, Link, Loading, num, pad2, RING, RING_SOFT, Seg, teamColor } from './ui'

const DEBOUNCE_MS = 350

/** Slot at which the cumulative distribution first reaches q (1-based). */
export function quantileSlot(d: number[], q: number): number {
  let c = 0
  for (let k = 0; k < d.length; k++) {
    c += d[k]
    if (c >= q - 1e-9) return k + 1
  }
  return d.length
}

/** Projected slot = rank of the mean draft slot, earliest first. */
const slotsOf = (r: BBResult | undefined) => new Map([...(r?.teams ?? [])].sort((a, b) => a.meanDraftSlot - b.meanDraftSlot).map((t, i) => [t.roster_id, i + 1]))
const top3 = (d: number[] | undefined) => (d ? (d[0] ?? 0) + (d[1] ?? 0) + (d[2] ?? 0) : 0)

type RunOpts = { err?: number; forced?: Forced; seed?: number; model?: 'A' | 'B' }
let timer: number | undefined

/** Your own 1st if you have it, else your best 1st: what the headline and the live readout track. */
function leadFirst(context: LeagueContext, result: BBResult | undefined) {
  const slotOf = slotsOf(result)
  const firsts = context.myPicks.filter(p => p.round === 1)
  const own = firsts.find(p => p.originalRosterId === context.myRosterId)
  const lead = own ?? [...firsts].sort((a, b) => (slotOf.get(a.originalRosterId) ?? 99) - (slotOf.get(b.originalRosterId) ?? 99))[0]
  const team = lead && result?.teams.find(x => x.roster_id === lead.originalRosterId)
  return { lead, team, slot: lead ? slotOf.get(lead.originalRosterId) ?? 0 : 0 }
}

export default function PickOdds() {
  const { context, settings, setSettings, bb: run, runBB, forced, setForced } = useApp()
  const result = run.result
  // The baseline only counts when it differs from the run on screen by its what-ifs alone.
  const base = run.base && (!result || sameRunParams(run.base, result)) ? run.base : result
  const sims = settings.sims
  const cur = { err: Math.max(0.02, settings.strengthCV ?? 0.04), seed: settings.seed ?? 1, model: settings.model ?? ('B' as const) }
  const [err, setErr] = useState(cur.err)
  /** the selected team (its distribution shows on the right), and which of your pick cards was clicked */
  const [sel, setSel] = useState<number | null>(null)
  const [selCard, setSelCard] = useState<string | null>(null)

  const runNow = (o: RunOpts) => {
    window.clearTimeout(timer)
    runBB({ sims, strengthCV: o.err ?? cur.err, forced: o.forced ?? forced, seed: o.seed ?? cur.seed, model: o.model ?? cur.model })
  }
  const runSoon = (o: RunOpts) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => runNow(o), DEBOUNCE_MS)
  }
  useEffect(() => () => window.clearTimeout(timer), [])
  useEffect(() => {
    if (context && !result && !run.busy && !run.error) runNow({})
    // A run made with what-ifs before this screen mounted: show them as set.
    if (result?.forced && Object.values(result.forced).some(w => w.length) && !Object.keys(forced).length) setForced(result.forced)
  }, [context?.league.league_id]) // eslint-disable-line react-hooks/exhaustive-deps
  // A sims change in Settings reruns once the run on screen used a different count.
  useEffect(() => {
    if (result && result.simulations !== sims && !run.busy) runNow({})
  }, [sims]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!context) return <Loading label="Loading league…" />

  const byId = new Map(result?.teams.map(x => [x.roster_id, x]))
  const baseById = new Map(base?.teams.map(x => [x.roster_id, x]))
  const order = result ? [...result.teams].sort((a, b) => a.meanDraftSlot - b.meanDraftSlot) : []
  const slotOf = slotsOf(result)
  const picks = [...context.myPicks].sort((a, b) => a.round - b.round || (slotOf.get(a.originalRosterId) ?? 99) - (slotOf.get(b.originalRosterId) ?? 99))
  const firsts = picks.filter(p => p.round === 1)
  const top3Firsts = firsts.reduce((s, p) => s + top3(byId.get(p.originalRosterId)?.slotDist), 0)
  const top3Delta = top3Firsts - firsts.reduce((s, p) => s + top3(baseById.get(p.originalRosterId)?.slotDist), 0)
  const whatIf = result?.whatIf ?? base?.whatIf ?? null
  const winners = whatIf ? forced[whatIf.week] ?? [] : []
  const nameOf = new Map(context.rosters.map(r => [r.roster_id, r.display_name]))
  const me = context.myRosterId

  const { lead, team: leadTeam, slot: leadSlot } = leadFirst(context, result)
  const leadLo = leadTeam ? quantileSlot(leadTeam.slotDist, 0.1) : 0
  const leadHi = leadTeam ? quantileSlot(leadTeam.slotDist, 0.9) : 0
  const head =
    lead && leadTeam
      ? `Your ${lead.originalRosterId === me ? 'own' : `${lead.originalName}'s`} 1st ${
          leadLo === leadHi ? `is all but locked at 1.${pad2(leadLo)}` : `projects at 1.${pad2(leadSlot)}, likely ${leadLo}–${leadHi}`
        }.`
      : result
      ? `You don't own a ${context.draftSeason} 1st in this league.`
      : 'Simulating the season…'
  const dim = run.busy && !!result
  const selId = sel ?? lead?.originalRosterId ?? me ?? order[0]?.roster_id
  const selTeam = selId != null ? byId.get(selId) : undefined

  const pickWinner = (rid: number, opp: number) => {
    if (!whatIf) return
    const w = winners.filter(x => x !== rid && x !== opp)
    const next = { ...forced, [whatIf.week]: winners.includes(rid) ? w : [...w, rid] }
    setForced(next)
    runSoon({ forced: next })
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 400px', gap: 24, alignItems: 'start' }}>
      <div className="stack" style={{ gap: 16, minWidth: 0 }}>
        <div className="hero" style={{ gap: 8 }}>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2, textWrap: 'pretty' }}>{head}</div>
          {result && (
            <div className="sub" style={{ fontSize: 15 }}>
              You own {firsts.length} first{firsts.length === 1 ? '' : 's'} in {context.draftSeason}.
              {firsts.length ? ` Expected top-3 picks: ${top3Firsts.toFixed(2)}` : ''}
              {firsts.length > 0 && Math.abs(top3Delta) >= 0.005 && (
                <span style={{ color: top3Delta > 0 ? 'var(--pos)' : 'var(--neg)' }}>
                  {' '}
                  ({top3Delta > 0 ? '+' : '−'}
                  {Math.abs(top3Delta).toFixed(2)} with your what-ifs)
                </span>
              )}
              {firsts.length ? '.' : ''}
            </div>
          )}
        </div>
        {run.error && <ErrorBox message={`Simulation failed: ${run.error}`} onRetry={() => runNow({})} />}
        {!result && run.busy && <Loading label={`Simulating ${num(sims)} seasons…`} />}

        <div className="stack" style={{ gap: 16, opacity: dim ? 0.5 : 1, transition: 'opacity .15s' }}>
          {picks.length === 0 ? (
            <Empty message={`You don't own any ${context.draftSeason} picks in this league.`} />
          ) : result ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
              {picks.map(p => {
                const team = byId.get(p.originalRosterId)
                if (!team) return null
                const key = `${p.round}:${p.originalRosterId}`
                const ringed = selCard ? selCard === key : p === picks.find(q => q.originalRosterId === selId)
                return (
                  <button
                    key={key}
                    className="gcard"
                    onClick={() => {
                      setSel(p.originalRosterId)
                      setSelCard(key)
                    }}
                    style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, padding: 14, background: grad(teamColor(p.originalRosterId)), boxShadow: ringed ? RING : undefined }}
                  >
                    <span className="trunc" style={{ fontSize: 12, color: 'var(--ink2)' }}>
                      Rd {p.round} · {p.originalRosterId === me ? 'own' : `via ${p.originalName}`}
                    </span>
                    <span className="num" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
                      {p.round}.{pad2(slotOf.get(p.originalRosterId) ?? 0)}
                    </span>
                    <Histogram dist={team.slotDist} at={slotOf.get(p.originalRosterId) ?? 0} height={26} />
                  </button>
                )
              })}
            </div>
          ) : null}

          {result && (
            <div className="stack" style={{ gap: 8 }}>
              <span className="title-l" style={{ paddingTop: 4 }}>
                Projected order
              </span>
              {order.map((x, i) => {
                const yours = x.roster_id === me
                const yourPick = (context.firstOwner[x.roster_id] ?? x.roster_id) === me
                return (
                  <button
                    key={x.roster_id}
                    className="gcard"
                    onClick={() => {
                      setSel(x.roster_id)
                      setSelCard(null)
                    }}
                    style={{ gap: 14, minHeight: 58, padding: '8px 16px', background: grad(teamColor(x.roster_id)), boxShadow: selId === x.roster_id ? RING : yourPick ? RING_SOFT : undefined }}
                  >
                    <span className="num mute" style={{ width: 20, fontWeight: 700 }}>
                      {i + 1}
                    </span>
                    <span className="row" style={{ width: 220, flex: 'none', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
                      <span className="trunc" style={{ fontWeight: 700 }}>
                        {x.team}
                      </span>
                      {yourPick && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--acc)', whiteSpace: 'nowrap' }}>{yours ? 'YOURS' : 'YOUR PICK'}</span>}
                    </span>
                    <span style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${x.slotDist.length}, 1fr)`, gap: 4 }}>
                      {x.slotDist.map((d, k) => (
                        <span key={k} title={`Pick ${k + 1}: ${Math.round(d * 100)}%`} style={{ height: 12, borderRadius: 4, background: d < 0.02 ? 'var(--surf2)' : `color-mix(in oklab, var(--good) ${Math.round(Math.min(1, d * 2.2) * 100)}%, var(--surf2))` }} />
                      ))}
                    </span>
                    <span className="num" style={{ width: 40, textAlign: 'right', fontSize: 17, fontWeight: 700 }}>
                      {x.meanDraftSlot.toFixed(1)}
                    </span>
                  </button>
                )
              })}
              <div className="small mute" style={{ paddingTop: 4 }}>
                The strip shows how often each team lands at picks 1–{context.rosters.length} across sims; the number is the average slot. Draft order: non-playoff
                teams by reverse max points for, then playoff teams the same way. {num(result.simulations)} sims{result.model === 'B' ? ' · availability' : ''} · seed{' '}
                {result.seed} · {result.inProgressWeek ? `week ${result.inProgressWeek} in progress` : `through week ${result.lastScoredWeek}`}.
                {result.zeroed.length > 0 ? ` ${result.zeroed.length} injured players are held out of projections.` : ''}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="sticky stack" style={{ gap: 16 }}>
        {selTeam && (
          <div className="hero" style={{ padding: 22, gap: 12 }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{selTeam.team}</div>
            <div className="sub" style={{ fontSize: 14, textWrap: 'pretty' }}>
              Projects at {slotOf.get(selTeam.roster_id) ? `1.${pad2(slotOf.get(selTeam.roster_id)!)}` : '—'}: average slot {selTeam.meanDraftSlot.toFixed(1)}, likely{' '}
              {quantileSlot(selTeam.slotDist, 0.1)}–{quantileSlot(selTeam.slotDist, 0.9)}. {selTeam.wins}-{selTeam.losses}, projected {selTeam.projWins.toFixed(1)} wins,{' '}
              {Math.round(selTeam.playoffPct)}% playoff odds.
              {(() => {
                const mine = context.myPicks.filter(p => p.originalRosterId === selTeam.roster_id).map(p => `Rd ${p.round}`)
                return mine.length ? ` You own their ${mine.join(', ')}.` : ''
              })()}
            </div>
            <DistBars dist={selTeam.slotDist} at={slotOf.get(selTeam.roster_id) ?? 0} />
          </div>
        )}
        <div className="hero" style={{ padding: 22 }}>
          {whatIf && whatIf.pairs.length > 0 ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: 18 }}>Week {whatIf.week} what-if</span>
                {winners.length > 0 && (
                  <Link
                    label="Reset"
                    onClick={() => {
                      setForced({})
                      runNow({ forced: {} })
                    }}
                  />
                )}
              </div>
              <div className="sub" style={{ fontSize: 14 }}>
                Click who you think wins.
                {lead && (
                  <>
                    {' '}
                    Your 1st: <b style={{ color: 'var(--ink)' }}>{run.busy ? '…' : `1.${pad2(leadSlot)}`}</b>
                  </>
                )}
              </div>
              {whatIf.pairs.map(([a, b]) => (
                <div key={`${a}:${b}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[a, b].map((rid, i) => {
                    const won = winners.includes(rid)
                    const lost = !won && winners.includes(i === 0 ? b : a)
                    return (
                      <button
                        key={rid}
                        className="trunc"
                        onClick={() => pickWinner(rid, i === 0 ? b : a)}
                        style={{ minHeight: 42, padding: '0 12px', borderRadius: 12, background: won ? 'var(--acc)' : 'var(--surf2)', color: won ? 'var(--acc-ink)' : lost ? 'var(--mute)' : 'var(--ink)', fontSize: 13, fontWeight: 600, textAlign: 'center' }}
                      >
                        {nameOf.get(rid) ?? `Roster ${rid}`}
                      </button>
                    )
                  })}
                </div>
              ))}
            </>
          ) : (
            <span style={{ fontWeight: 700, fontSize: 18 }}>Simulation</span>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 40px', gap: 10, alignItems: 'center', paddingTop: 4 }}>
            <span className="sub" style={{ fontSize: 14 }}>
              Projection error
            </span>
            <input
              type="range"
              min={0.02}
              max={0.2}
              step={0.01}
              value={err}
              onChange={e => setErr(Number(e.target.value))}
              onPointerUp={() => {
                void setSettings({ strengthCV: err })
                runSoon({ err })
              }}
              onKeyUp={() => {
                void setSettings({ strengthCV: err })
                runSoon({ err })
              }}
            />
            <span className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>
              {err.toFixed(2)}
            </span>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <span className="sub" style={{ fontSize: 14, flex: 1 }}>
              Model
            </span>
            <Seg
              onSurf
              value={cur.model}
              onChange={v => {
                void setSettings({ model: v })
                runNow({ model: v })
              }}
              options={[
                { value: 'A', label: 'Classic' },
                { value: 'B', label: 'Availability' },
              ]}
            />
          </div>
          <div className="row" style={{ gap: 10 }}>
            <span className="small mute" style={{ flex: 1 }}>
              {num(sims)} sims · seed {result?.seed ?? cur.seed}
              {run.busy ? ' · simulating…' : ''}
            </span>
            <Btn
              size="sm"
              label="New seed"
              disabled={run.busy}
              onClick={() => {
                const s = newSeed()
                void setSettings({ seed: s })
                runNow({ seed: s })
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
