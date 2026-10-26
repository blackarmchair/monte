// Lineup: this week's lineup off Tyler's weekly boards. A hero with the projection and win odds,
// the best swap, then starter cards (NFL colour) and bench cards (surf). Tap a player to select
// him, then tap a highlighted slot or player to swap; tap him again to cancel. Set in Sleeper
// sends the lineup.
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import type { Result, SSPlayer, StartSitData } from '@monte/core/types'
import { anonStartSit } from '@monte/core/names'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { useOverlay } from '@/ui/overlay'
import SleeperConnect from './SleeperConnect'
import { Btn, ErrorBox, GradCard, Headshot, Hero, Loading, NeedsSheet, Notice, Row, Section, T, Tag, num, useTopOnFocus } from '@/ui/kit'
import { font, nflColor, useTheme } from '@/ui/theme'
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

export default function Lineup() {
  const t = useTheme()
  const { context, settings, dataVersion, sheet, hide } = useApp()
  const leagueId = context?.league.league_id
  const [res, setRes] = useState<Result<StartSitData> | null>(null)
  const [busy, setBusy] = useState(false)
  const [lineup, setLineup] = useState<Array<string | null>>([])
  const [simOut, setSimOut] = useState<Record<string, boolean>>({})
  /** the player picked up for a swap */
  const [sel, setSel] = useState<string | null>(null)
  const [sim, setSim] = useState<{ busy: boolean; text: string | null }>({ busy: false, text: null })
  const scroll = useTopOnFocus<ScrollView>()
  const { openSheet, closeSheet, showToast } = useOverlay()
  /** what was last set in Sleeper from here: the baseline until the next load (REST is cached) */
  const [sent, setSent] = useState<{ lineup: Array<string | null>; starters: string[] } | null>(null)
  const [push, setPush] = useState<{ busy: boolean; error: string | null; note: string | null }>({ busy: false, error: null, note: null })

  const load = () => {
    if (!leagueId || !settings?.userId || !sheet) return
    setBusy(true)
    void monte.startSit(leagueId, settings.userId).then(r => {
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
  useEffect(load, [leagueId, settings?.userId, dataVersion, !!sheet]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ---- tap to swap ----
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
    const r = await monte.setLineup({ leagueId: leagueId!, rosterId: d.rosterId, week: d.week, expected, starters })
    if (r.ok) {
      setSent({ lineup: [...lineup], starters })
      setPush({ busy: false, error: null, note: r.value.mismatch })
      return showToast('Lineup set in Sleeper')
    }
    setPush({ busy: false, error: r.error, note: null })
    if (r.needsConnect)
      openSheet(
        <View style={{ gap: 14 }}>
          <T v="title">Connect Sleeper</T>
          <SleeperConnect
            onDone={() => {
              closeSheet()
              void sendLineup()
            }}
          />
        </View>,
      )
  }

  const runSim = () => {
    if (!opp || sim.busy) return
    setSim({ busy: true, text: null })
    const n = settings?.sims ?? 1000
    setTimeout(() => setSim({ busy: false, text: `Won ${num(simWins(total - opp.total, n))} of ${num(n)}` }), 60)
  }

  if (!sheet) return <NeedsSheet />

  const name = (id: string | null) => (id ? players.get(id)?.name ?? '' : 'an empty slot')
  const wpColor = winP == null ? t.ink : winP > 0.6 ? t.pos : winP < 0.4 ? t.neg : t.warn
  const selIsStarter = selFrom >= 0
  const hint = !sel
    ? 'Tap a player, then tap where they should go.'
    : selIsStarter
    ? movable(selFrom)
      ? `Swapping ${name(sel)}. Tap a highlighted player.`
      : `${name(sel)} is locked for this week.`
    : `Moving ${name(sel)}. Tap a highlighted slot.`
  const setLabel = push.busy ? 'Setting…' : 'Set in Sleeper'

  return (
    <ScrollView ref={scroll} style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 28, gap: 12 }}>
      {res && !res.ok && <ErrorBox message={res.error} onRetry={load} />}
      {!res && <Loading label="Reading this week's boards…" />}

      {d && (
        <>
          <Hero gap={6}>
            <T v="small" c="mute">
              Week {d.week}
              {opp ? ` · vs ${opp.name}` : ''}
            </T>
            <Row style={{ alignItems: 'flex-end', justifyContent: 'space-between' }} gap={12}>
              <View>
                <T v="bold" size={44} num style={{ lineHeight: 46, letterSpacing: -0.88 }}>
                  {total.toFixed(1)}
                </T>
                <T v="small" c="ink2">
                  projected{opp ? ` · opp ${opp.total.toFixed(1)}` : ''}
                </T>
              </View>
              {winP != null && (
                <View style={{ alignItems: 'flex-end' }}>
                  <T v="bold" size={32} num color={wpColor} style={{ lineHeight: 34 }}>
                    {Math.round(winP * 100)}%
                  </T>
                  <T v="small" c="ink2">
                    to win
                  </T>
                </View>
              )}
            </Row>
            <Row gap={8} style={{ marginTop: 6 }}>
              {opp && <Btn size="sm" label={sim.busy ? 'Simulating…' : sim.text ?? `Run ${num(settings?.sims ?? 1000)} sims`} onPress={runSim} />}
              <View style={{ flex: 1 }} />
              {changed && (
                <Btn
                  kind="link"
                  label="Reset"
                  onPress={() => {
                    setLineup(sleeperLineup)
                    setSimOut({})
                    setSel(null)
                  }}
                />
              )}
            </Row>
          </Hero>

          {best ? (
            <Strip text={`Start ${name(best.inId)} over ${name(best.outId)} for +${best.gain.toFixed(1)}`} action="Apply" onPress={() => applySwap(best)} />
          ) : differs ? (
            <Strip text="Your changes aren't in Sleeper yet." action={setLabel} disabled={push.busy} onPress={sendLineup} />
          ) : (
            <Notice tone="pos" message={`Lineup is optimal for this week.${opp && total < opp.total ? " You're the underdog on paper." : ''}`} />
          )}
          {best && differs && (
            <Row style={{ paddingHorizontal: 4 }}>
              <T v="small" c="mute" style={{ flex: 1 }}>
                Your changes aren't in Sleeper yet.
              </T>
              <Btn kind="link" label={setLabel} disabled={push.busy} onPress={sendLineup} />
            </Row>
          )}
          {push.error && <ErrorBox message={push.error} onRetry={sendLineup} />}
          {push.note && <Notice message={push.note} />}
          {d.warnings.map(w => (
            <Notice key={w} message={w} />
          ))}

          <Row gap={10} style={{ paddingTop: 4, paddingHorizontal: 2, minHeight: 36 }}>
            <T size={14} color={sel ? t.acc : t.mute} style={{ flex: 1 }}>
              {hint}
            </T>
            {sel && selIsStarter && (
              <Btn kind="link" label={simOut[sel] ? 'Undo sim out' : 'Sim out'} onPress={() => setSimOut(m => ({ ...m, [sel]: !m[sel] }))} />
            )}
            {sel && <Btn kind="link" label="Cancel" onPress={() => setSel(null)} />}
          </Row>

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
                onPress={() => tapStarter(i)}
              />
            )
          })}
          <Section title="Bench" style={{ paddingTop: 12 }} />
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
                onPress={() => tapBench(p)}
              />
            )
          })}

          <T v="small" c="mute" style={{ paddingTop: 8 }}>
            Ranks from {d.sheet.name} › Week {d.boardWeek ?? '?'}. Proj is Tyler's rank mapped to the points per game that rank scored last season in this league's
            scoring. The order is the signal; totals are approximate.
          </T>
          <Btn label={busy ? 'Refreshing…' : 'Refresh'} disabled={busy} onPress={load} bg={t.surf} />
        </>
      )}
    </ScrollView>
  )
}

/** The suggestion strip: an acc-tint card with one line and one action. */
function Strip({ text, action, onPress, disabled }: { text: string; action: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingLeft: 18, paddingRight: 14, borderRadius: 18, backgroundColor: t.accTint }}>
      <T v="semi" style={{ flex: 1 }}>
        {text}
      </T>
      <Btn kind="primary" size="sm" label={action} onPress={onPress} disabled={disabled} style={{ minHeight: 40 }} />
    </View>
  )
}

/** A starter (NFL-colour card) or bench player (surf card), with the tap-to-swap states. */
function PlayerCard(props: {
  badge: string
  starter?: boolean
  p: SSPlayer | null
  proj: string
  out: boolean
  cue: string
  state: 'idle' | 'on' | 'cand' | 'dim'
  onPress: () => void
}) {
  const t = useTheme()
  const { p, state } = props
  const tag = p && tagOf(p)
  const on = state === 'on'
  return (
    <GradCard
      color={props.starter && p ? nflColor(t, p.team) : null}
      selected={on}
      candidate={state === 'cand'}
      dim={state === 'dim'}
      minHeight={props.starter ? 64 : 60}
      onPress={props.onPress}
      style={{ paddingVertical: 8, paddingLeft: 10 }}
      accessibilityLabel={p ? p.name : `Empty ${props.badge}`}
    >
      <View style={{ width: 44, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.acc : t.surf2 }}>
        <Text style={{ fontFamily: font.sansBold, fontSize: 12, color: on ? t.accInk : props.starter ? t.ink : t.mute }}>{props.badge.replace('SUPER_FLEX', 'SF')}</Text>
      </View>
      {p ? <Headshot id={p.id} name={p.name} size={40} /> : <View style={{ width: 40 }} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        {p ? (
          <>
            <Row gap={6}>
              <T v={props.starter ? 'bold' : 'semi'} c={props.starter ? 'ink' : 'ink2'} lines={1} style={{ flexShrink: 1 }}>
                {p.name}
              </T>
              {props.out ? <Tag label="Sim out" tone="bad" /> : tag && <Tag label={tag.label} tone={tag.tone} />}
            </Row>
            <T v="small" c={props.starter ? 'ink2' : 'mute'} lines={1}>
              {[[p.team, p.matchup].filter(Boolean).join(' '), p.rankLabel].filter(Boolean).join(' · ')}
            </T>
          </>
        ) : (
          <T c="mute">Empty</T>
        )}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <T v="bold" size={props.starter ? 16 : 15} c={props.starter ? 'ink' : 'ink2'} num>
          {props.proj}
        </T>
        {!!props.cue && (
          <T v="bold" size={12} c="acc">
            {props.cue}
          </T>
        )}
      </View>
    </GradCard>
  )
}
