// Pick odds: where your picks land. Every control reruns the sim (what-if taps debounced); the
// sim runs in-process, so the old result stays on screen, dimmed, while a new one computes.
import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type { BBResult, BBTeam, LeagueContext } from '@monte/core/types'
import { newSeed, sameRunParams } from '@monte/core/seed'
import { useApp } from '@/lib/store'
import { useOverlay } from '@/ui/overlay'
import { Btn, Empty, ErrorBox, Kicker, Loading, Row, Slider, T, TeamSquare, num, pad2 } from '@/ui/kit'
import { font, mix, RADIUS, useTheme } from '@/ui/theme'

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
const slotsOf = (r: BBResult | undefined) =>
  new Map([...(r?.teams ?? [])].sort((a, b) => a.meanDraftSlot - b.meanDraftSlot).map((t, i) => [t.roster_id, i + 1]))
const top3 = (d: number[] | undefined) => (d ? (d[0] ?? 0) + (d[1] ?? 0) + (d[2] ?? 0) : 0)

type Forced = Record<number, number[]>

export default function PickOdds() {
  const t = useTheme()
  const { context, settings, setSettings, bb: run, runBB } = useApp()
  const { openSheet } = useOverlay()
  const result = run.result
  // The baseline only counts when it differs from the run on screen by its what-ifs alone.
  const base = run.base && (!result || sameRunParams(run.base, result)) ? run.base : result
  const [err, setErr] = useState(Math.max(0.02, settings?.strengthCV ?? 0.08))
  const [seed, setSeed] = useState(settings?.seed ?? 1)
  const [forced, setForced] = useState<Forced>(() => result?.forced ?? {})
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sims = settings?.sims ?? 1000

  type RunOpts = { err?: number; forced?: Forced; seed?: number }
  const runNow = (o: RunOpts) => {
    clearTimeout(timer.current)
    runBB({ sims, strengthCV: o.err ?? err, forced: o.forced ?? forced, seed: o.seed ?? seed })
  }
  const runSoon = (o: RunOpts) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => runNow(o), DEBOUNCE_MS)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (context && !result && !run.busy && !run.error) runNow({})
  }, [context?.league.league_id]) // eslint-disable-line react-hooks/exhaustive-deps
  // A sims change in Settings reruns once the run on screen used a different count.
  useEffect(() => {
    if (result && result.simulations !== sims && !run.busy) runNow({})
  }, [sims]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!context) return <Loading label="Loading league…" />

  const n = context.rosters.length
  const byId = new Map(result?.teams.map(x => [x.roster_id, x]))
  const baseById = new Map(base?.teams.map(x => [x.roster_id, x]))
  const order = result ? [...result.teams].sort((a, b) => a.meanDraftSlot - b.meanDraftSlot) : []
  const slotOf = slotsOf(result)
  const picks = [...context.myPicks].sort((a, b) => a.round - b.round || (slotOf.get(a.originalRosterId) ?? 99) - (slotOf.get(b.originalRosterId) ?? 99))
  const firsts = picks.filter(p => p.round === 1)
  const top3Firsts = firsts.reduce((s, p) => s + top3(byId.get(p.originalRosterId)?.slotDist), 0)
  const top3Delta = top3Firsts - firsts.reduce((s, p) => s + top3(baseById.get(p.originalRosterId)?.slotDist), 0)
  const nameOf = new Map(context.rosters.map(r => [r.roster_id, r.display_name]))
  const whatIf = result?.whatIf ?? base?.whatIf ?? null
  const winners = whatIf ? forced[whatIf.week] ?? [] : []
  const me = context.myRosterId

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

  // Headline: your own 1st if you have it, else your best 1st.
  const own = firsts.find(p => p.originalRosterId === me)
  const lead = own ?? [...firsts].sort((a, b) => (slotOf.get(a.originalRosterId) ?? 99) - (slotOf.get(b.originalRosterId) ?? 99))[0]
  const leadTeam = lead && byId.get(lead.originalRosterId)
  const leadLo = leadTeam ? quantileSlot(leadTeam.slotDist, 0.1) : 0
  const leadHi = leadTeam ? quantileSlot(leadTeam.slotDist, 0.9) : 0
  const head =
    lead && leadTeam
      ? `Your ${lead.originalRosterId === me ? 'own' : `${lead.originalName}'s`} 1st ${
          leadLo === leadHi ? `is all but locked at 1.${pad2(leadLo)}` : `projects at 1.${pad2(slotOf.get(lead.originalRosterId) ?? 0)}, likely ${leadLo}–${leadHi}`
        }.`
      : result
      ? `You don't own a ${context.draftSeason} 1st in this league.`
      : 'Simulating the season…'
  const dim = run.busy && !!result
  const open = (rid: number) => byId.get(rid) && openSheet(<PickSheet team={byId.get(rid)!} slot={slotOf.get(rid) ?? 0} context={context} />)

  return (
    <View>
      <View style={{ padding: 16, gap: 6 }}>
        <T v="serif">{head}</T>
        {result && firsts.length > 0 && (
          <T c="mute" size={14}>
            Expected top-3 firsts:{' '}
            <Text style={{ fontFamily: font.mono, color: t.ink }}>{top3Firsts.toFixed(2)}</Text>
            {Math.abs(top3Delta) >= 0.005 && (
              <Text style={{ fontFamily: font.mono, color: top3Delta > 0 ? t.pos : t.neg }}>
                {' '}
                {top3Delta > 0 ? '+' : '−'}
                {Math.abs(top3Delta).toFixed(2)}
              </Text>
            )}
          </T>
        )}
      </View>

      {run.error && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <ErrorBox message={`Simulation failed: ${run.error}`} onRetry={() => runNow({})} />
        </View>
      )}
      {!result && run.busy && <Loading label={`Simulating ${num(sims)} seasons…`} />}

      <View style={{ opacity: dim ? 0.5 : 1 }}>
        {picks.length === 0 ? (
          <Empty message={`You don't own any ${context.draftSeason} picks in this league.`} style={{ marginHorizontal: 16, marginBottom: 16 }} />
        ) : result ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 16 }}>
            {picks.map(p => {
              const team = byId.get(p.originalRosterId)
              if (!team) return null
              return (
                <PickCard
                  key={`${p.round}:${p.originalRosterId}`}
                  via={`Rd ${p.round} · ${p.originalRosterId === me ? 'own' : `via ${p.originalName}`}`}
                  label={`${p.round}.${pad2(slotOf.get(p.originalRosterId) ?? 0)}`}
                  dist={team.slotDist}
                  slot={slotOf.get(p.originalRosterId) ?? 0}
                  onPress={() => open(p.originalRosterId)}
                />
              )
            })}
          </ScrollView>
        ) : null}

        {whatIf && whatIf.pairs.length > 0 && (
          <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10, borderTopWidth: 1, borderColor: t.line }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T v="semi">Week {whatIf.week} what-if</T>
              {winners.length > 0 && <Btn kind="link" label="Reset" onPress={resetWhatIf} />}
            </Row>
            <T c="mute" size={14}>
              Tap the team you think wins. Tap again to clear.
            </T>
            {whatIf.pairs.map(([a, b]) => (
              <View key={`${a}:${b}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {[a, b].map((rid, i) => {
                  const on = winners.includes(rid)
                  const off = !on && winners.includes(i === 0 ? b : a)
                  const btn = (
                    <Pressable
                      key={rid}
                      onPress={() => pickWinner(rid, i === 0 ? b : a)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        minHeight: 44,
                        paddingHorizontal: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1,
                        borderColor: on ? t.ink : t.line,
                        borderRadius: RADIUS,
                        backgroundColor: on ? t.ink : 'transparent',
                      }}
                    >
                      <Text numberOfLines={1} style={{ fontFamily: font.sans, fontSize: 14, color: on ? t.bg : off ? t.mute : t.ink }}>
                        {nameOf.get(rid) ?? `Roster ${rid}`}
                      </Text>
                    </Pressable>
                  )
                  return i === 0 ? (
                    [
                      btn,
                      <T key="vs" v="small" c="mute" size={12} style={{ width: 24, textAlign: 'center' }}>
                        vs
                      </T>,
                    ]
                  ) : (
                    btn
                  )
                })}
              </View>
            ))}
          </View>
        )}

        <Row gap={10} style={{ paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: whatIf ? 0 : 1, borderColor: t.line }}>
          <T c="mute" size={14}>
            Projection error
          </T>
          <Slider
            value={err}
            min={0.02}
            max={0.2}
            step={0.01}
            onChange={v => setErr(Math.round(v * 100) / 100)}
            onDone={v => {
              const x = Math.round(v * 100) / 100
              setErr(x)
              void setSettings({ strengthCV: x })
              runSoon({ err: x })
            }}
          />
          <T v="mono" size={14} style={{ width: 44, textAlign: 'right' }}>
            {err.toFixed(2)}
          </T>
        </Row>
        <Row gap={10} style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <T v="small" c="mute" style={{ flex: 1 }}>
            {result
              ? `${num(result.simulations)} sims · seed ${result.seed} · ${result.inProgressWeek ? `week ${result.inProgressWeek} in progress` : `through week ${result.lastScoredWeek}`}`
              : ''}
            {run.busy ? `${result ? ' · ' : ''}simulating…` : ''}
          </T>
          <Btn
            kind="link"
            label="New seed"
            disabled={run.busy}
            onPress={() => {
              const s = newSeed()
              setSeed(s)
              void setSettings({ seed: s })
              runNow({ seed: s })
            }}
          />
        </Row>

        {result && (
          <>
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, borderTopWidth: 1, borderColor: t.line }}>
              <Kicker>Projected draft order</Kicker>
            </View>
            {order.map((x, i) => {
              const owner = context.firstOwner[x.roster_id] ?? x.roster_id
              const yours = x.roster_id === me
              const yourPick = !yours && owner === me
              return (
                <Pressable
                  key={x.roster_id}
                  onPress={() => open(x.roster_id)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 68,
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderColor: t.line,
                    backgroundColor: yours || yourPick ? t.accTint : pressed ? t.card : 'transparent',
                  })}
                >
                  <T v="mono" c="mute" style={{ width: 24 }}>
                    {i + 1}
                  </T>
                  <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                    <Row gap={8}>
                      <T v="semi" size={16} lines={1} style={{ flexShrink: 1 }}>
                        {x.team}
                      </T>
                      {(yours || yourPick) && (
                        <T v="monoSemi" size={11} c="acc">
                          {yours ? 'YOURS' : 'YOUR PICK'}
                        </T>
                      )}
                    </Row>
                    <View style={{ flexDirection: 'row', gap: 2 }}>
                      {x.slotDist.map((d, k) => (
                        <View key={k} style={{ flex: 1, height: 10, backgroundColor: d < 0.02 ? t.chip : mix(t.acc, t.chip, Math.round(Math.min(1, d * 2) * 100)) }} />
                      ))}
                    </View>
                  </View>
                  <T v="monoSemi" size={17} style={{ width: 44, textAlign: 'right' }}>
                    {x.meanDraftSlot.toFixed(1)}
                  </T>
                </Pressable>
              )
            })}
            <T v="small" c="mute" style={{ padding: 16 }}>
              Strip shows how often each team lands at picks 1–{n} across sims; the number is the average slot. Draft order: non-playoff teams by reverse max
              points for, then playoff teams the same way.
              {result.zeroed.length > 0 ? ` ${result.zeroed.length} injured players are held out of projections.` : ''}
            </T>
          </>
        )}
      </View>
    </View>
  )
}

function PickCard(props: { via: string; label: string; dist: number[]; slot: number; onPress: () => void }) {
  const t = useTheme()
  const d = props.dist
  const mx = Math.max(...d, 1e-9)
  const lo = quantileSlot(d, 0.1)
  const hi = quantileSlot(d, 0.9)
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({ width: 124, gap: 4, padding: 10, borderWidth: 1, borderColor: t.line, borderRadius: RADIUS, backgroundColor: pressed ? t.card : t.card2 })}
    >
      <T v="small" c="mute" size={12} lines={1}>
        {props.via}
      </T>
      <T v="mono" size={26} style={{ fontFamily: font.monoMed, lineHeight: 30 }}>
        {props.label}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 28 }}>
        {d.map((p, i) => (
          <View key={i} style={{ flex: 1, height: Math.max(2, (p / mx) * 28), backgroundColor: i + 1 === props.slot ? t.acc : t.mute }} />
        ))}
      </View>
      <T v="small" c="mute" size={12}>
        {lo === hi ? `locked at ${lo}` : `likely ${lo}–${hi}`}
      </T>
    </Pressable>
  )
}

/** One team's full slot distribution, with the picks of theirs you own. */
function PickSheet({ team, slot, context }: { team: BBTeam; slot: number; context: LeagueContext }) {
  const t = useTheme()
  const d = team.slotDist
  const mx = Math.max(...d, 1e-9)
  const lo = quantileSlot(d, 0.1)
  const hi = quantileSlot(d, 0.9)
  const mine = context.myPicks.filter(p => p.originalRosterId === team.roster_id).map(p => `Rd ${p.round}`)
  return (
    <View style={{ gap: 14 }}>
      <Row gap={12}>
        <TeamSquare rid={team.roster_id} name={team.team} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T v="serif" size={24} lines={1}>
            {team.team}
          </T>
          <T c="mute" size={14}>
            {team.wins}-{team.losses} · proj {team.projWins.toFixed(1)} W · playoffs {Math.round(team.playoffPct)}%
          </T>
        </View>
      </Row>
      <T>
        Projects at {slot ? `1.${pad2(slot)}` : '—'}: average slot {team.meanDraftSlot.toFixed(1)}, likely {lo}–{hi}.{mine.length ? ` You own their ${mine.join(', ')}.` : ''}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 120, paddingTop: 16 }}>
        {d.map((p, i) => (
          <View key={i} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 3 }}>
            <T v="mono" size={11} c="mute">
              {p >= 0.01 ? Math.round(p * 100) : ''}
            </T>
            <View style={{ width: '100%', height: Math.max(2, (p / mx) * 86), backgroundColor: i + 1 === slot ? t.acc : t.mute }} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {d.map((_, i) => (
          <T key={i} v="mono" size={12} c="mute" style={{ flex: 1, textAlign: 'center' }}>
            {i + 1}
          </T>
        ))}
      </View>
      <T v="small" c="mute">
        Share of sims at each draft slot.
      </T>
    </View>
  )
}
