// Lineup: this week's lineup off Tyler's weekly boards. Tap a player to select him, then tap a
// highlighted slot or player to swap; tap him again to cancel.
import { useEffect, useMemo, useState } from 'react'
import { Linking, Pressable, ScrollView, View } from 'react-native'
import type { Result, SSPlayer, StartSitData } from '@monte/core/types'
import { anonStartSit } from '@monte/core/names'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { Band, Bar, Btn, Chip, ErrorBox, Kicker, Loading, NeedsSheet, Notice, PlayerAvatar, Row, T, num, useTopOnFocus } from '@/ui/kit'
import { useTheme } from '@/ui/theme'
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
  const sleeperLineup = useMemo(() => d?.slots.map(s => s.current?.id ?? null) ?? [], [d])

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
  const changed = lineup.some((id, i) => id !== sleeperLineup[i]) || Object.values(simOut).some(Boolean)
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

  const runSim = () => {
    if (!opp || sim.busy) return
    setSim({ busy: true, text: null })
    const n = settings?.sims ?? 1000
    setTimeout(() => setSim({ busy: false, text: `Won ${num(simWins(total - opp.total, n))} of ${num(n)}` }), 60)
  }

  if (!sheet) return <NeedsSheet />

  const name = (id: string | null) => (id ? players.get(id)?.name ?? '' : 'an empty slot')
  const barMax = Math.max(total, opp?.total ?? 0, 1) * 1.15
  const wpColor = winP == null ? t.ink : winP > 0.6 ? t.pos : winP < 0.4 ? t.neg : t.warn
  const selIsStarter = selFrom >= 0
  const hint = !sel
    ? 'Tap any player, then where they should go.'
    : selIsStarter
    ? movable(selFrom)
      ? `Swapping ${name(sel)}. Tap a highlighted player.`
      : `${name(sel)} is locked for this week.`
    : `Moving ${name(sel)}. Tap a highlighted slot.`

  return (
    <ScrollView ref={scroll} style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      {res && !res.ok && (
        <View style={{ padding: 16 }}>
          <ErrorBox message={res.error} onRetry={load} />
        </View>
      )}
      {!res && <Loading label="Reading this week's boards…" />}

      {d && (
        <>
          <Band>
            <Kicker>
              Week {d.week}
              {opp ? ` · vs ${opp.name}` : ''}
            </Kicker>
            <Row style={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
              <T v="serif" size={52} style={{ lineHeight: 56 }}>
                {total.toFixed(1)}
              </T>
              {winP != null && (
                <T v="serif" size={30} color={wpColor}>
                  {Math.round(winP * 100)}%
                </T>
              )}
            </Row>
            <View style={{ gap: 8 }}>
              <Row gap={8}>
                <T v="small" c="mute" style={{ width: 40 }}>
                  You
                </T>
                <Bar frac={total / barMax} color={t.acc} />
                <T v="mono" size={13} style={{ width: 52, textAlign: 'right' }}>
                  {total.toFixed(1)}
                </T>
              </Row>
              {opp && (
                <Row gap={8}>
                  <T v="small" c="mute" style={{ width: 40 }}>
                    Opp
                  </T>
                  <Bar frac={opp.total / barMax} color={t.mute} />
                  <T v="mono" size={13} style={{ width: 52, textAlign: 'right' }}>
                    {opp.total.toFixed(1)}
                  </T>
                </Row>
              )}
            </View>
            <Row wrap gap={8}>
              {opp && <Btn kind="quiet" label={sim.busy ? 'Simulating…' : `Run ${num(settings?.sims ?? 1000)} sims`} onPress={runSim} />}
              {!!sim.text && (
                <T c="mute" size={14}>
                  {sim.text}
                </T>
              )}
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
          </Band>

          <Row gap={10} style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: best ? t.accTint : t.posTint, borderBottomWidth: 1, borderColor: t.line }}>
            <T size={14} style={{ flex: 1 }}>
              {best
                ? `Start ${name(best.inId)} over ${name(best.outId)}: +${best.gain.toFixed(1)} pts.`
                : `Lineup is optimal for this week.${opp && total < opp.total ? " You're the underdog on paper." : ''}`}
            </T>
            {best && <Btn kind="primary" label="Apply" onPress={() => applySwap(best)} />}
            {!best && changed && <Btn label="Set in Sleeper ↗" onPress={() => void Linking.openURL(d.leagueUrl)} />}
          </Row>
          {best && changed && (
            <Row style={{ paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderColor: t.line }}>
              <T v="small" c="mute" style={{ flex: 1 }}>
                Changes here don't reach Sleeper on their own.
              </T>
              <Btn kind="link" label="Set in Sleeper ↗" onPress={() => void Linking.openURL(d.leagueUrl)} />
            </Row>
          )}
          {d.warnings.map(w => (
            <Notice key={w} message={w} style={{ borderBottomWidth: 1, borderColor: t.line }} />
          ))}

          <Row gap={10} style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, minHeight: 44 }}>
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
            const dim = !!sel && !on && !cand
            return (
              <PlayerLine
                key={`s${i}`}
                badge={s.label}
                starter
                p={p}
                proj={p ? proj(p).toFixed(1) : '—'}
                out={!!p && !!simOut[p.id]}
                cue={cand ? (selIsStarter ? 'Swap in' : 'Put here') : ''}
                state={on ? 'on' : cand ? 'cand' : dim ? 'dim' : 'idle'}
                onPress={() => tapStarter(i)}
              />
            )
          })}
          <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 }}>
            <Kicker>Bench</Kicker>
          </View>
          {bench.map(p => {
            const on = p.id === sel
            const cand = !!sel && benchOk(p)
            const dim = !!sel && !on && !cand
            return (
              <PlayerLine
                key={p.id}
                badge={p.flag === 'Taxi' ? 'TX' : p.flag === 'IR' ? 'IR' : p.pos}
                p={p}
                proj={p.startable ? p.proj.toFixed(1) : '—'}
                out={false}
                cue={cand ? 'Swap in' : ''}
                state={on ? 'on' : cand ? 'cand' : dim ? 'dim' : 'idle'}
                onPress={() => tapBench(p)}
              />
            )
          })}

          <T v="small" c="mute" style={{ padding: 16 }}>
            Ranks from {d.sheet.name} › Week {d.boardWeek ?? '?'}. Proj is Tyler's rank mapped to the points per game that rank scored last season in this league's
            scoring. The order is the signal; totals are approximate.
          </T>
          <View style={{ paddingHorizontal: 16 }}>
            <Btn label={busy ? 'Refreshing…' : 'Refresh'} disabled={busy} onPress={load} />
          </View>
        </>
      )}
    </ScrollView>
  )
}

function PlayerLine(props: {
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
  const badgeBg = props.starter ? (on ? t.acc : t.ink) : t.chip
  const badgeFg = props.starter ? (on ? '#fff' : t.bg) : t.mute
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: props.starter ? 60 : 56,
        paddingVertical: 6,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderColor: t.line,
        backgroundColor: on ? t.accTint : state === 'cand' || pressed ? t.card : 'transparent',
        opacity: state === 'dim' ? (props.starter ? 0.4 : 0.35) : 1,
      })}
    >
      {on && <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: t.acc }} />}
      <View style={{ width: 46, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: badgeBg }}>
        <T v="monoSemi" size={12} color={badgeFg}>
          {props.badge.replace('SUPER_FLEX', 'SF')}
        </T>
      </View>
      {p ? <PlayerAvatar id={p.id} name={p.name} size={30} /> : <View style={{ width: 30 }} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        {p ? (
          <>
            <Row gap={6}>
              <T v={props.starter ? 'semi' : 'body'} c={props.starter ? 'ink' : 'ink2'} size={16} lines={1} style={{ flexShrink: 1 }}>
                {p.name}
              </T>
              {props.out ? <Chip label="Sim out" tone="neg" /> : tag && <Chip label={tag.label} tone={tag.tone} />}
            </Row>
            <T v="small" c="mute" lines={1}>
              {[props.starter ? p.pos : null, [p.team, p.matchup].filter(Boolean).join(' '), p.rankLabel].filter(Boolean).join(' · ')}
            </T>
          </>
        ) : (
          <T c="mute">Empty</T>
        )}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <T v={props.starter ? 'monoSemi' : 'mono'} c={props.starter ? 'ink' : 'ink2'} size={props.starter ? 17 : 16}>
          {props.proj}
        </T>
        {!!props.cue && (
          <T v="smallSemi" size={12} c="acc">
            {props.cue}
          </T>
        )}
      </View>
    </Pressable>
  )
}
