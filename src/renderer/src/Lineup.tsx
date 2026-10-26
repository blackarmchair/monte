// Lineup: this week's lineup off Tyler's weekly boards. A projection card and the best swap on
// top, then starters (NFL-colour cards) beside the bench (surf cards). Click a player to select
// him, then a highlighted slot or player to swap; click him again to cancel. Set in Sleeper sends
// the lineup on screen.
import { useEffect, useMemo, useState } from 'react'
import type { Result, SSPlayer, StartSitData } from '@shared/types'
import { anonStartSit } from './names'
import { useApp } from './store'
import { ConnectModal } from './SleeperSend'
import { Btn, ErrorBox, GradCard, Headshot, Link, Loading, NeedsSheet, nflColor, Notice, num, RING, RING_THIN, Tag } from './ui'
import { benchOnly, ELIG, eligible, normCdf, tagOf, WIN_SD, type Swap } from './startsit.logic'

/** Seeded so the same lineup gives the same count when re-run. */
function simWins(diff: number, n: number): number {
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  let wins = 0
  for (let i = 0; i < n; i++) {
    const z = Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd())
    if (diff + z * WIN_SD > 0) wins++
  }
  return wins
}

/** What was last set in Sleeper from here. Sleeper's REST read is cached, so a Refresh right after
 *  a push can still show the old lineup; this is the baseline until the next load. */
type Sent = { lineup: Array<string | null>; starters: string[] }

export default function Lineup() {
  const { context, settings, settingsSaved, dataVersion, sheet, hide, showToast } = useApp()
  const leagueId = context?.league.league_id
  const [res, setRes] = useState<Result<StartSitData> | null>(null)
  const [busy, setBusy] = useState(false)
  const [lineup, setLineup] = useState<Array<string | null>>([])
  const [simOut, setSimOut] = useState<Record<string, boolean>>({})
  /** the player picked up for a swap */
  const [sel, setSel] = useState<string | null>(null)
  const [sim, setSim] = useState<{ busy: boolean; text: string | null }>({ busy: false, text: null })
  const [sent, setSent] = useState<Sent | null>(null)
  const [push, setPush] = useState<{ busy: boolean; error: string | null; note: string | null }>({ busy: false, error: null, note: null })
  const [connect, setConnect] = useState<{ error: string | null } | null>(null)

  const load = () => {
    if (!leagueId || !settings.userId || !sheet) return
    setBusy(true)
    void window.monte.startSit(leagueId, settings.userId).then(r => {
      setRes(r)
      setBusy(false)
      setSel(null)
      if (r.ok) {
        setLineup(r.value.slots.map(s => s.current?.id ?? null))
        setSimOut({})
        setSent(null)
        setPush({ busy: false, error: null, note: null })
      }
    })
  }
  useEffect(load, [leagueId, settings.userId, dataVersion, !!sheet]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = useMemo(() => (res?.ok ? (hide ? anonStartSit(res.value) : res.value) : null), [res, hide])
  const players = useMemo(() => {
    const m = new Map<string, SSPlayer>()
    for (const s of d?.slots ?? []) if (s.current) m.set(s.current.id, s.current)
    for (const p of d?.bench ?? []) m.set(p.id, p)
    return m
  }, [d])
  const readLineup = useMemo(() => d?.slots.map(s => s.current?.id ?? null) ?? [], [d])
  const sleeperLineup = sent?.lineup ?? readLineup

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
  const differs = lineup.some((id, i) => id !== sleeperLineup[i])
  const changed = differs || Object.values(simOut).some(Boolean)
  useEffect(() => setSim({ busy: false, text: null }), [total])

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

  const applySwap = (s: Swap) => {
    setSel(null)
    setLineup(L => {
      const n = [...L]
      if (s.hop) {
        n[s.hop.to] = n[s.hop.from]
        n[s.hop.from] = s.inId
      } else n[s.slot] = s.inId
      return n
    })
  }

  // ---- click to swap ----
  const selFrom = sel ? lineup.indexOf(sel) : -1
  const selP = sel ? players.get(sel) : undefined
  const starterOk = (i: number) => {
    if (!d || !sel || !selP || lineup[i] === sel || !movable(i)) return false
    if (!eligible(d.slots[i].slot, selP)) return false
    return selFrom < 0 || eligible(d.slots[selFrom].slot, at(i))
  }
  const benchOk = (p: SSPlayer) => !!d && selFrom >= 0 && !p.locked && !benchOnly(p) && eligible(d.slots[selFrom].slot, p)
  const tapStarter = (i: number) => {
    const p = at(i)
    if (sel && p?.id === sel) return setSel(null)
    if (sel && starterOk(i)) {
      setLineup(L => {
        const n = [...L]
        if (selFrom >= 0) n[selFrom] = n[i]
        n[i] = sel
        return n
      })
      return setSel(null)
    }
    // Locked players can still be selected to sim them out; they just can't move.
    if (p) setSel(p.id)
  }
  const tapBench = (p: SSPlayer) => {
    if (sel === p.id) return setSel(null)
    if (sel && benchOk(p)) {
      setLineup(L => {
        const n = [...L]
        n[selFrom] = p.id
        return n
      })
      return setSel(null)
    }
    if (!p.locked && !benchOnly(p)) setSel(p.id)
  }

  // Push the lineup on screen. Slots left as Sleeper had them keep Sleeper's own id, so a K / DEF /
  // IDP starter Monte can't name is never blanked.
  const sendLineup = async () => {
    if (!d || push.busy) return
    const expected = sent?.starters ?? d.starters
    const starters = lineup.map((id, i) => (id === sleeperLineup[i] ? expected[i] ?? '0' : id ?? '0'))
    setPush({ busy: true, error: null, note: null })
    const r = await window.monte.setLineup({ leagueId: leagueId!, rosterId: d.rosterId, week: d.week, expected, starters })
    if (r.ok) {
      setSent({ lineup: [...lineup], starters })
      setPush({ busy: false, error: null, note: r.value.mismatch })
      return showToast('Lineup set in Sleeper')
    }
    setPush({ busy: false, error: r.needsConnect ? null : r.error, note: null })
    if (r.needsConnect) {
      // a refused token was dropped in main; keep the app's settings in step
      settingsSaved(await window.monte.getSettings())
      setConnect({ error: r.error === 'Connect Sleeper first.' ? null : r.error })
    }
  }

  const runSim = () => {
    if (!opp || sim.busy) return
    setSim({ busy: true, text: null })
    const n = settings.sims ?? 1000
    window.setTimeout(() => setSim({ busy: false, text: `Won ${num(simWins(total - opp.total, n))} of ${num(n)} sims` }), 30)
  }

  if (!sheet)
    return (
      <div className="page">
        <NeedsSheet />
      </div>
    )

  const name = (id: string | null) => (id ? players.get(id)?.name ?? '' : 'an empty slot')
  const wpColor = winP == null ? 'var(--ink)' : winP > 0.6 ? 'var(--pos)' : winP < 0.4 ? 'var(--neg)' : 'var(--warn)'
  const selIsStarter = selFrom >= 0
  const hint = !sel
    ? 'Click a player, then click where they should go.'
    : selIsStarter
    ? movable(selFrom)
      ? `Swapping ${name(sel)}. Click a highlighted player.`
      : `${name(sel)} is locked for this week.`
    : `Moving ${name(sel)}. Click a highlighted slot.`
  const setLabel = push.busy ? 'Setting…' : 'Set in Sleeper'

  return (
    <div className="page stack" style={{ gap: 20 }}>
      {res && !res.ok && <ErrorBox message={res.error} onRetry={load} />}
      {!res && <Loading label="Reading this week's boards…" />}
      {connect && (
        <ConnectModal
          why="Monte sets your lineup with your Sleeper session. Connect once and Set in Sleeper sends the lineup on screen."
          error={connect.error}
          onClose={() => setConnect(null)}
          onDone={s => {
            settingsSaved(s)
            setConnect(null)
            void sendLineup()
          }}
        />
      )}

      {d && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16 }}>
            <div className="hero row" style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
              <div className="stack" style={{ gap: 4 }}>
                <span className="small mute">
                  Week {d.week}
                  {opp ? ` · vs ${opp.name}` : ''}
                </span>
                <span className="num" style={{ fontSize: 52, fontWeight: 700, lineHeight: 1, letterSpacing: '-.02em' }}>
                  {total.toFixed(1)}
                </span>
                <span className="sub">projected{opp ? ` · opp ${opp.total.toFixed(1)}` : ''}</span>
              </div>
              <div className="stack" style={{ alignItems: 'flex-end', gap: 8 }}>
                {winP != null && (
                  <span className="num" style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, color: wpColor }}>
                    {Math.round(winP * 100)}%
                  </span>
                )}
                {opp && <Btn size="sm" label={sim.busy ? 'Simulating…' : sim.text ?? `Run ${num(settings.sims ?? 1000)} sims`} onClick={runSim} />}
              </div>
            </div>
            <div className="hero" style={{ background: best || differs ? 'var(--acc-tint)' : 'var(--surf)', justifyContent: 'center', gap: 12 }}>
              <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3, textWrap: 'pretty' }}>
                {best
                  ? `Start ${name(best.inId)} over ${name(best.outId)} for +${best.gain.toFixed(1)} pts.`
                  : differs
                  ? "Your changes aren't in Sleeper yet."
                  : `Your lineup is optimal for this week.${opp && total < opp.total ? " You're the underdog on paper." : ''}`}
              </span>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {best && <Btn kind="primary" label="Apply swap" onClick={() => applySwap(best)} style={{ minHeight: 42 }} />}
                {differs && <Btn kind={best ? 'secondary' : 'primary'} label={setLabel} disabled={push.busy} onClick={sendLineup} style={{ minHeight: 42 }} />}
                {changed && (
                  <Link
                    label="Reset"
                    onClick={() => {
                      setLineup(sleeperLineup)
                      setSimOut({})
                      setSel(null)
                    }}
                  />
                )}
              </div>
            </div>
          </div>
          {push.error && <ErrorBox message={push.error} onRetry={sendLineup} />}
          {push.note && <Notice message={push.note} />}
          {d.warnings.map(w => (
            <Notice key={w} message={w} />
          ))}

          <div className="row" style={{ gap: 14, minHeight: 32 }}>
            <span style={{ fontSize: 14, color: sel ? 'var(--acc)' : 'var(--mute)' }}>{hint}</span>
            {sel && selIsStarter && <Link label={simOut[sel] ? 'Undo sim out' : 'Sim out'} onClick={() => setSimOut(m => ({ ...m, [sel]: !m[sel] }))} />}
            {sel && <Link label="Cancel" onClick={() => setSel(null)} />}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gap: 24, alignItems: 'start' }}>
            <div className="stack" style={{ gap: 8 }}>
              <span className="title-l" style={{ paddingBottom: 2 }}>
                Starters
              </span>
              {d.slots.map((s, i) => {
                const p = at(i)
                const on = !!p && p.id === sel
                const cand = !on && starterOk(i)
                return (
                  <PlayerCard
                    key={`s${i}`}
                    badge={s.label}
                    starter
                    p={p}
                    proj={p ? proj(p).toFixed(1) : '—'}
                    out={!!p && !!simOut[p.id]}
                    cue={cand ? (selIsStarter ? 'Swap in' : 'Put here') : ''}
                    state={on ? 'on' : cand ? 'cand' : sel ? 'dim' : 'idle'}
                    onClick={() => tapStarter(i)}
                  />
                )
              })}
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <span className="title-l" style={{ paddingBottom: 2 }}>
                Bench
              </span>
              {bench.map(p => {
                const on = p.id === sel
                const cand = !!sel && benchOk(p)
                return (
                  <PlayerCard
                    key={p.id}
                    badge={p.flag === 'Taxi' ? 'TX' : p.flag === 'IR' ? 'IR' : p.pos}
                    p={p}
                    proj={p.startable ? p.proj.toFixed(1) : '—'}
                    out={false}
                    cue={cand ? 'Swap in' : ''}
                    state={on ? 'on' : cand ? 'cand' : sel ? 'dim' : 'idle'}
                    onClick={() => tapBench(p)}
                  />
                )
              })}
            </div>
          </div>

          <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
            <span className="small mute" style={{ flex: 1, maxWidth: 820 }}>
              Ranks from {d.sheet.name} › Week {d.boardWeek ?? '?'}. Proj is Tyler's rank mapped to the points per game that rank scored last season in this league's
              scoring. The order is the signal; totals are approximate.
            </span>
            <Btn size="sm" label={busy ? 'Refreshing…' : 'Refresh'} disabled={busy} onClick={load} bg="var(--surf)" />
          </div>
        </>
      )}
    </div>
  )
}

/** A starter (NFL-colour card) or bench player (surf card), with the click-to-swap states. */
function PlayerCard(props: { badge: string; starter?: boolean; p: SSPlayer | null; proj: string; out: boolean; cue: string; state: 'idle' | 'on' | 'cand' | 'dim'; onClick: () => void }) {
  const { p, state } = props
  const tag = p && tagOf(p)
  const on = state === 'on'
  return (
    <GradCard
      color={props.starter && p ? nflColor(p.team) : null}
      ring={on ? RING : state === 'cand' ? RING_THIN : undefined}
      dim={state === 'dim'}
      minHeight={62}
      onClick={props.onClick}
      style={{ padding: '8px 16px 8px 10px' }}
      title={p ? p.flag || undefined : undefined}
    >
      <span
        style={{
          width: 46,
          height: 28,
          flex: 'none',
          borderRadius: 9,
          display: 'grid',
          placeItems: 'center',
          background: on ? 'var(--acc)' : 'var(--surf2)',
          color: on ? 'var(--acc-ink)' : props.starter ? 'var(--ink)' : 'var(--mute)',
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {props.badge.replace('SUPER_FLEX', 'SF')}
      </span>
      {p ? <Headshot id={p.id} name={p.name} size={40} /> : <span style={{ width: 40 }} />}
      <span className="stack" style={{ flex: 1, minWidth: 0 }}>
        {p ? (
          <>
            <span className="row" style={{ gap: 6, minWidth: 0 }}>
              <span className="trunc" style={{ fontWeight: props.starter ? 700 : 600, color: props.starter ? 'var(--ink)' : 'var(--ink2)' }}>
                {p.name}
              </span>
              {props.out ? <Tag label="Sim out" tone="bad" /> : tag && <Tag label={tag.label} tone={tag.tone} />}
            </span>
            <span className="small trunc" style={{ color: props.starter ? 'var(--ink2)' : 'var(--mute)' }}>
              {[[p.team, p.matchup].filter(Boolean).join(' '), p.rankLabel].filter(Boolean).join(' · ')}
            </span>
          </>
        ) : (
          <span className="mute">Empty</span>
        )}
      </span>
      {!!props.cue && <span style={{ fontSize: 12, color: 'var(--acc)', fontWeight: 700 }}>{props.cue}</span>}
      <span className="num" style={{ width: 48, textAlign: 'right', fontSize: props.starter ? 16 : 15, fontWeight: 700, color: props.starter ? 'var(--ink)' : 'var(--ink2)' }}>
        {props.proj}
      </span>
    </GradCard>
  )
}
