// Pick odds: where your picks land. A hero with your 1st and the what-if sheet (tap next week's
// winners, projection error, model, seed), cards for each pick you own, then the projected order
// with a heat strip per team. Every control reruns the sim (what-if taps debounced); the sim runs
// in-process, so the old result stays on screen, dimmed, while a new one computes.
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type { BBResult, BBTeam, LeagueContext } from '@monte/core/types'
import { newSeed, sameRunParams } from '@monte/core/seed'
import { useApp, type Forced } from '@/lib/store'
import { useOverlay } from '@/ui/overlay'
import { Btn, Empty, ErrorBox, GradCard, Hero, Histogram, Loading, Row, Section, Seg, Slider, T, num, pad2 } from '@/ui/kit'
import { alpha, font, grad, mix, R, teamColor, useTheme } from '@/ui/theme'

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

type RunOpts = { err?: number; forced?: Forced; seed?: number; model?: 'A' | 'B' }
let timer: ReturnType<typeof setTimeout> | undefined

/** The sim's controls, shared by the tab and its what-if sheet: settings hold error, seed and
 *  model; the store holds the what-if results. */
function useOddsRun() {
  const { settings, setSettings, runBB, forced, setForced } = useApp()
  const sims = settings?.sims ?? 1000
  const cur = { err: Math.max(0.02, settings?.strengthCV ?? 0.04), seed: settings?.seed ?? 1, model: settings?.model ?? ('B' as const) }
  const runNow = (o: RunOpts) => {
    clearTimeout(timer)
    runBB({ sims, strengthCV: o.err ?? cur.err, forced: o.forced ?? forced, seed: o.seed ?? cur.seed, model: o.model ?? cur.model })
  }
  const runSoon = (o: RunOpts) => {
    clearTimeout(timer)
    timer = setTimeout(() => runNow(o), DEBOUNCE_MS)
  }
  return { sims, ...cur, forced, setForced, setSettings, runNow, runSoon }
}

/** Your own 1st if you have it, else your best 1st: what the headline and the what-if readout track. */
function leadFirst(context: LeagueContext, result: BBResult | undefined) {
  const slotOf = slotsOf(result)
  const firsts = context.myPicks.filter(p => p.round === 1)
  const own = firsts.find(p => p.originalRosterId === context.myRosterId)
  const lead = own ?? [...firsts].sort((a, b) => (slotOf.get(a.originalRosterId) ?? 99) - (slotOf.get(b.originalRosterId) ?? 99))[0]
  const team = lead && result?.teams.find(x => x.roster_id === lead.originalRosterId)
  return { lead, team, slot: lead ? slotOf.get(lead.originalRosterId) ?? 0 : 0 }
}

export default function PickOdds() {
  const t = useTheme()
  const { context, bb: run } = useApp()
  const { openSheet } = useOverlay()
  const o = useOddsRun()
  const result = run.result
  // The baseline only counts when it differs from the run on screen by its what-ifs alone.
  const base = run.base && (!result || sameRunParams(run.base, result)) ? run.base : result

  useEffect(() => () => clearTimeout(timer), [])
  useEffect(() => {
    if (context && !result && !run.busy && !run.error) o.runNow({})
    // A run made with what-ifs before this screen mounted: show them as set.
    if (result?.forced && Object.values(result.forced).some(w => w.length) && !Object.keys(o.forced).length) o.setForced(result.forced)
  }, [context?.league.league_id]) // eslint-disable-line react-hooks/exhaustive-deps
  // A sims change in Settings reruns once the run on screen used a different count.
  useEffect(() => {
    if (result && result.simulations !== o.sims && !run.busy) o.runNow({})
  }, [o.sims]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const nSet = whatIf ? (o.forced[whatIf.week] ?? []).length : 0
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
  const open = (rid: number) => byId.get(rid) && openSheet(<PickSheet team={byId.get(rid)!} slot={slotOf.get(rid) ?? 0} context={context} />)

  return (
    <>
      <Hero>
        <T v="head">{head}</T>
        {result && (
          <T c="ink2">
            You own {firsts.length} first{firsts.length === 1 ? '' : 's'} in {context.draftSeason}.{firsts.length ? ` Expected top-3 picks: ${top3Firsts.toFixed(2)}` : ''}
            {firsts.length && Math.abs(top3Delta) >= 0.005 ? (
              <Text style={{ color: top3Delta > 0 ? t.pos : t.neg }}>
                {' '}
                ({top3Delta > 0 ? '+' : '−'}
                {Math.abs(top3Delta).toFixed(2)})
              </Text>
            ) : null}
            {firsts.length ? '.' : ''}
          </T>
        )}
        <Btn
          label={whatIf && whatIf.pairs.length ? (nSet ? `What-if: ${nSet} result${nSet === 1 ? '' : 's'} set` : `Try week ${whatIf.week} what-ifs`) : 'Simulation settings'}
          onPress={() => openSheet(<WhatIfSheet />)}
          style={{ marginTop: 6 }}
        />
      </Hero>

      {run.error && <ErrorBox message={`Simulation failed: ${run.error}`} onRetry={() => o.runNow({})} />}
      {!result && run.busy && <Loading label={`Simulating ${num(o.sims)} seasons…`} />}

      <View style={{ gap: 8, opacity: dim ? 0.5 : 1 }}>
        {picks.length === 0 ? (
          <Empty message={`You don't own any ${context.draftSeason} picks in this league.`} />
        ) : result ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
            {picks.map(p => {
              const team = byId.get(p.originalRosterId)
              if (!team) return null
              return (
                <Pressable
                  key={`${p.round}:${p.originalRosterId}`}
                  onPress={() => open(p.originalRosterId)}
                  style={({ pressed }) => [{ width: 128, gap: 6, padding: 14, borderRadius: R.card, opacity: pressed ? 0.8 : 1 }, grad(t, teamColor(p.originalRosterId))]}
                >
                  <T v="small" size={12} c="ink2" lines={1}>
                    Rd {p.round} · {p.originalRosterId === me ? 'own' : `via ${p.originalName}`}
                  </T>
                  <T v="bold" size={28} num style={{ lineHeight: 30 }}>
                    {p.round}.{pad2(slotOf.get(p.originalRosterId) ?? 0)}
                  </T>
                  <Histogram dist={team.slotDist} at={slotOf.get(p.originalRosterId) ?? 0} height={26} dim={alpha(t.ink, 0.3)} />
                </Pressable>
              )
            })}
          </ScrollView>
        ) : null}

        {result && (
          <>
            <Section title="Projected order" style={{ paddingTop: 12 }} />
            {order.map((x, i) => {
              const owner = context.firstOwner[x.roster_id] ?? x.roster_id
              const yours = x.roster_id === me
              const yourPick = owner === me
              return (
                <GradCard key={x.roster_id} color={teamColor(x.roster_id)} selected={yourPick} minHeight={64} onPress={() => open(x.roster_id)} accessibilityLabel={x.team}>
                  <T v="bold" c="mute" num style={{ width: 20 }}>
                    {i + 1}
                  </T>
                  <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                    <Row gap={8} align="baseline">
                      <T v="bold" lines={1} style={{ flexShrink: 1 }}>
                        {x.team}
                      </T>
                      {yourPick && (
                        <Text style={{ fontFamily: font.sansBold, fontSize: 11, color: t.acc }}>{yours ? 'YOURS' : 'YOUR PICK'}</Text>
                      )}
                    </Row>
                    <View style={{ flexDirection: 'row', gap: 3 }}>
                      {x.slotDist.map((d, k) => (
                        <View key={k} style={{ flex: 1, height: 8, borderRadius: 3, backgroundColor: d < 0.02 ? t.surf2 : mix(t.good, t.surf2, Math.min(1, d * 2.2) * 100) }} />
                      ))}
                    </View>
                  </View>
                  <T v="bold" size={17} num style={{ width: 40, textAlign: 'right' }}>
                    {x.meanDraftSlot.toFixed(1)}
                  </T>
                </GradCard>
              )
            })}
            <T v="small" c="mute" style={{ paddingTop: 4 }}>
              The strip shows how often each team lands at picks 1–{context.rosters.length} across sims; the number is the average slot. Draft order: non-playoff teams by
              reverse max points for, then playoff teams the same way. {num(result.simulations)} sims{result.model === 'B' ? ' · availability' : ''} · seed{' '}
              {result.seed} · {result.inProgressWeek ? `week ${result.inProgressWeek} in progress` : `through week ${result.lastScoredWeek}`}.
              {result.zeroed.length > 0 ? ` ${result.zeroed.length} injured players are held out of projections.` : ''}
            </T>
          </>
        )}
      </View>
    </>
  )
}

/** Next week's matchups to call, plus projection error, model and seed. Your 1st updates live. */
function WhatIfSheet() {
  const t = useTheme()
  const { context, bb: run } = useApp()
  const o = useOddsRun()
  const [err, setErr] = useState(o.err)
  const result = run.result
  const whatIf = result?.whatIf ?? run.base?.whatIf ?? null
  if (!context) return null
  const winners = whatIf ? o.forced[whatIf.week] ?? [] : []
  const nameOf = new Map(context.rosters.map(r => [r.roster_id, r.display_name]))
  const { lead, slot } = leadFirst(context, result)

  const pickWinner = (rid: number, opp: number) => {
    if (!whatIf) return
    const w = winners.filter(x => x !== rid && x !== opp)
    const next = { ...o.forced, [whatIf.week]: winners.includes(rid) ? w : [...w, rid] }
    o.setForced(next)
    o.runSoon({ forced: next })
  }

  return (
    <View style={{ gap: 10 }}>
      {whatIf && whatIf.pairs.length > 0 ? (
        <>
          <Row style={{ justifyContent: 'space-between' }}>
            <T v="bold" size={20}>
              Week {whatIf.week} what-if
            </T>
            {winners.length > 0 && (
              <Btn
                kind="link"
                label="Reset"
                onPress={() => {
                  o.setForced({})
                  o.runNow({ forced: {} })
                }}
              />
            )}
          </Row>
          <T size={14} c="ink2">
            Tap who you think wins.{lead ? ' Your 1st updates live: ' : ''}
            {lead && (
              <Text style={{ fontFamily: font.sansBold, color: t.ink }}>
                {run.busy ? '…' : `1.${pad2(slot)}`}
              </Text>
            )}
          </T>
          {whatIf.pairs.map(([a, b]) => (
            <View key={`${a}:${b}`} style={{ flexDirection: 'row', gap: 6 }}>
              {[a, b].map((rid, i) => {
                const on = winners.includes(rid)
                const off = !on && winners.includes(i === 0 ? b : a)
                return (
                  <Pressable
                    key={rid}
                    onPress={() => pickWinner(rid, i === 0 ? b : a)}
                    style={{ flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.acc : t.surf }}
                  >
                    <Text numberOfLines={1} style={{ fontFamily: font.sansSemi, fontSize: 14, color: on ? t.accInk : off ? t.mute : t.ink }}>
                      {nameOf.get(rid) ?? `Roster ${rid}`}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          ))}
        </>
      ) : (
        <T v="bold" size={20}>
          Simulation
        </T>
      )}
      <Row gap={10} style={{ paddingTop: 6 }}>
        <T size={14} c="ink2">
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
            void o.setSettings({ strengthCV: x })
            o.runSoon({ err: x })
          }}
        />
        <T v="bold" size={14} num style={{ width: 40, textAlign: 'right' }}>
          {err.toFixed(2)}
        </T>
      </Row>
      <Row gap={10}>
        <T size={14} c="ink2" style={{ flex: 1 }}>
          Model
        </T>
        <Seg
          value={o.model}
          onChange={v => {
            void o.setSettings({ model: v })
            o.runNow({ model: v })
          }}
          options={[
            { value: 'A', label: 'Classic' },
            { value: 'B', label: 'Availability' },
          ]}
        />
      </Row>
      <Row gap={10}>
        <T v="small" c="mute" style={{ flex: 1 }}>
          {num(o.sims)} sims · seed {result?.seed ?? o.seed}
          {run.busy ? ' · simulating…' : ''}
        </T>
        <Btn
          kind="link"
          label="New seed"
          disabled={run.busy}
          onPress={() => {
            const s = newSeed()
            void o.setSettings({ seed: s })
            o.runNow({ seed: s })
          }}
        />
      </Row>
    </View>
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
      <T v="bold" size={24}>
        {team.team}
      </T>
      <T c="ink2">
        Projects at {slot ? `1.${pad2(slot)}` : '—'}: average slot {team.meanDraftSlot.toFixed(1)}, likely {lo}–{hi}. {team.wins}-{team.losses}, projected{' '}
        {team.projWins.toFixed(1)} wins, {Math.round(team.playoffPct)}% playoff odds.{mine.length ? ` You own their ${mine.join(', ')}.` : ''}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 130 }}>
        {d.map((p, i) => (
          <View key={i} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontFamily: font.sans, fontSize: 11, color: t.mute }}>{p >= 0.01 ? `${Math.round(p * 100)}%` : ''}</Text>
            <View style={[{ width: '100%', height: Math.max(3, (p / mx) * 90), borderTopLeftRadius: 5, borderTopRightRadius: 5, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: i + 1 === slot ? t.acc : t.surf2 }]} />
            <Text style={{ fontFamily: font.sansSemi, fontSize: 12, color: t.mute }}>{i + 1}</Text>
          </View>
        ))}
      </View>
      <T v="small" c="mute">
        Share of sims at each draft slot.
      </T>
    </View>
  )
}
