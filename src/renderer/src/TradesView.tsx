import { useEffect, useMemo, useRef, useState } from 'react'
import type { BBResult, LeagueContext, Result, Settings, TradeData } from '@shared/types'
import { ET_NOISE, evaluate, findPackages, pickValues, positionRatios, type Asset, type Package } from '@shared/tradeMath'
import type { Run } from './App'
import { InlineError, NextMove, Segmented, SkeletonRows, TeamAvatar } from './ui'
import { anonTrades } from './names'
import './TradesView.css'

export type TradeState = { give: string[]; get: string[]; partner: number | null }
export type TradeUi = { right: 'deals' | 'roster'; pos: string; load?: boolean }
export const EMPTY_TRADE: TradeState = { give: [], get: [], partner: null }

const ORD = ['', '1st', '2nd', '3rd', '4th', '5th']
const num = (v: number) => Math.round(v).toLocaleString()
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v)).toLocaleString()}`
const POS_GROUPS = ['QB', 'RB', 'WR', 'TE', 'Picks'] as const
/** Verdict bars run from −BAR_SCALE to +BAR_SCALE effective value. */
const BAR_SCALE = 6000
/** How many of your assets "Find a deal" shops one at a time when nothing is in Give yet. */
const SHOP_TOP = 8
const SAVE_MS = 400

const mineOf = (a: Asset) => a.mine ?? a.sheet

/** Your-value-vs-market read on one asset, from your side of the table. */
function gapTag(a: Asset): { label: string; color: string } {
  const m = mineOf(a)
  const d = m - a.val
  if (a.market == null) return { label: 'No market', color: 'var(--mute)' }
  if (d <= -Math.max(250, 0.1 * m)) return { label: 'Sell high', color: 'var(--acc)' }
  if (d >= Math.max(250, 0.1 * a.val)) return { label: 'Undervalued', color: 'var(--pos)' }
  return { label: 'Fair', color: 'var(--mute)' }
}

const subOf = (a: Asset) =>
  a.kind === 'pick' ? (a.slot ? `projected ${a.slot}` : 'future pick') : `${a.pos} · ${a.team}${a.age ? ` · age ${a.age}` : ''}`

const DRAG_TYPE = 'text/plain'

function AssetRow(props: { a: Asset; inTrade: boolean; onAdd: () => void }) {
  const { a } = props
  const tag = gapTag(a)
  return (
    <div
      className="tr2-asset"
      draggable
      style={{ opacity: props.inTrade ? 0.35 : 1 }}
      onDragStart={e => e.dataTransfer.setData(DRAG_TYPE, a.id)}
      onClick={props.onAdd}
      title={`Your value ${num(mineOf(a))} · sheet ${num(a.sheet)} · market ${a.market == null ? '—' : num(a.val)}`}
    >
      <div style={{ minWidth: 0 }}>
        <div className="nm">{a.name}</div>
        <div className="sub">{subOf(a)}</div>
      </div>
      <span className="tag" style={{ color: tag.color }}>
        {tag.label}
      </span>
      <span className="v">{num(mineOf(a))}</span>
    </div>
  )
}

/** Diverging bar: centre is zero, full width is ±BAR_SCALE. */
function Meter({ label, v }: { label: string; v: number }) {
  const w = Math.min(50, (Math.abs(v) / BAR_SCALE) * 50)
  const c = v >= 0 ? 'var(--pos)' : 'var(--neg)'
  return (
    <>
      <span className="k">{label}</span>
      <div className="tr2-track">
        <div className="zero" />
        <div className="fill" style={{ left: v >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: c }} />
      </div>
      <span className="mono r" style={{ color: c }}>
        {signed(v)}
      </span>
    </>
  )
}

type Deal = Package & { partner: number; give: Asset[] }
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))

export default function TradesView(props: {
  context: LeagueContext
  settings: Settings
  bb: Run<BBResult>
  runBB: () => void
  trade: TradeState
  setTrade: (f: (t: TradeState) => TradeState) => void
  ui: TradeUi
  setUi: (f: (u: TradeUi) => TradeUi) => void
  onSettings: (p: Partial<Settings>) => void
  sheetVersion: string | undefined
  hideNames: boolean
}) {
  const { context, trade, setTrade, ui, setUi, bb } = props
  const leagueId = context.league.league_id
  const [res, setRes] = useState<Result<TradeData> | null>(null)
  // Market influence re-blends live here; the saved setting only follows, debounced.
  const [beta, setBeta] = useState(props.settings.marketBeta?.[leagueId] ?? 1)
  const saveTimer = useRef<number | undefined>(undefined)
  const [over, setOver] = useState<'give' | 'get' | null>(null)
  const mode = props.settings.tradeDelta ?? 'relative'

  const load = () => {
    setRes(null)
    void window.monte.trades(leagueId, props.settings.userId!).then(setRes)
  }
  useEffect(load, [leagueId, props.sheetVersion]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!bb.result && !bb.busy && !bb.error) props.runBB()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  const changeBeta = (v: number) => {
    setBeta(v)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(
      () => props.onSettings({ marketBeta: { ...(props.settings.marketBeta ?? {}), [leagueId]: v } }),
      SAVE_MS,
    )
  }

  const d = useMemo(() => (res?.ok ? (props.hideNames ? anonTrades(res.value) : res.value) : null), [res, props.hideNames])
  const teamName = useMemo(() => new Map(d?.teams.map(t => [t.roster_id, t.name])), [d])
  const avatarOf = useMemo(() => new Map(context.rosters.map(r => [r.roster_id, r.avatar])), [context])

  // Every asset at this market influence. Picks are priced here: the next draft over the sim's
  // slot odds, later ones at the round average.
  const priced = useMemo(() => {
    if (!d) return { ratios: {} as Record<string, number>, list: [] as Asset[] }
    const blend = (sheet: number, market: number | null) => (market == null ? sheet : sheet + beta * (market - sheet))
    const dist = new Map(bb.result?.teams.map(t => [t.roster_id, t.slotDist]))
    const slotOf = new Map(
      [...(bb.result?.teams ?? [])].sort((a, b) => a.meanDraftSlot - b.meanDraftSlot).map((t, i) => [t.roster_id, i + 1]),
    )
    const picks: Asset[] = d.picks.map(p => {
      const v = pickValues(d.pickInputs, p.season, p.round, dist.get(p.originalOwner) ?? null)
      const own = p.originalOwner === p.owner
      const slot = p.season === d.pickInputs.season && slotOf.has(p.originalOwner) ? `${p.round}.${String(slotOf.get(p.originalOwner)).padStart(2, '0')}` : null
      return {
        id: `pick:${p.season}:${p.round}:${p.originalOwner}`,
        kind: 'pick',
        name: `${p.season} ${ORD[p.round] ?? `R${p.round}`}${own ? '' : ` · via ${teamName.get(p.originalOwner) ?? '?'}`}`,
        pos: 'Picks',
        team: '',
        age: null,
        owner: p.owner,
        sheet: v.sheet,
        val: blend(v.sheet, v.market),
        market: v.market,
        season: p.season,
        round: p.round,
        originalOwner: p.originalOwner,
        slot,
      }
    })
    const base = [...d.assets.map(a => ({ ...a, val: blend(a.sheet, a.market) })), ...picks]
    // Within position: keep Tyler's order inside a position, at the market's level for it.
    const ratios = positionRatios(base)
    return { ratios, list: base.map(a => ({ ...a, mine: mode === 'relative' ? a.sheet * (ratios[a.pos] ?? 1) : a.sheet })) }
  }, [d, bb.result, teamName, mode, beta])
  const assets = priced.list
  const byId = useMemo(() => new Map(assets.map(a => [a.id, a])), [assets])

  const me = d?.myRosterId ?? null
  const mine = useMemo(() => assets.filter(a => a.owner === me).sort((a, b) => mineOf(b) - mineOf(a)), [assets, me])
  const give = trade.give.map(id => byId.get(id)).filter(Boolean) as Asset[]
  const get = trade.get.map(id => byId.get(id)).filter(Boolean) as Asset[]
  const partner = trade.partner
  const meFull = !!d?.teams.find(t => t.roster_id === me)?.full
  const params = d && { gamma: d.gamma, spotCost: d.spotCost, meFull, themFull: !!d.teams.find(t => t.roster_id === partner)?.full }
  const verdict = params && give.length && get.length ? evaluate(give, get, params) : null

  /** Your items always go to Give; a partner's go to Get, and a new partner replaces the Get list. */
  const add = (id: string) => {
    const a = byId.get(id)
    if (!a) return
    if (a.owner === me) setTrade(t => (t.give.includes(id) ? t : { ...t, give: [...t.give, id] }))
    else
      setTrade(t => (t.partner !== a.owner ? { ...t, partner: a.owner, get: [id] } : t.get.includes(id) ? t : { ...t, get: [...t.get, id] }))
  }
  const remove = (id: string) => setTrade(t => ({ ...t, give: t.give.filter(x => x !== id), get: t.get.filter(x => x !== id) }))
  const toggle = (id: string) => (trade.give.includes(id) || trade.get.includes(id) ? remove(id) : add(id))
  const clear = () => setTrade(() => EMPTY_TRADE)
  const drop = (e: React.DragEvent) => {
    e.preventDefault()
    setOver(null)
    add(e.dataTransfer.getData(DRAG_TYPE))
  }

  // Suggested deals, best for you first: packages for what's in Give, or with Give empty, each of
  // your top assets shopped on its own. Both sides must win (findPackages' rule).
  const deals = useMemo(() => {
    if (!d || me == null) return [] as Deal[]
    const gives = give.length ? [give] : mine.filter(a => mineOf(a) > 0).slice(0, SHOP_TOP).map(a => [a])
    const out: Deal[] = []
    for (const gv of gives)
      for (const t of d.teams) {
        if (t.roster_id === me) continue
        const p = { gamma: d.gamma, spotCost: d.spotCost, meFull, themFull: t.full }
        const pool = assets.filter(a => a.owner === t.roster_id)
        let n = 0
        for (const pk of findPackages(gv, pool, p, 60)) {
          if (ui.pos !== 'All' && !pk.get.some(a => a.pos === ui.pos)) continue
          out.push({ ...pk, partner: t.roster_id, give: gv })
          if (++n >= (give.length ? 6 : 3)) break
        }
      }
    return out.sort((a, b) => b.verdict.em - a.verdict.em).slice(0, 25)
  }, [d, me, assets, mine, trade.give.join(','), ui.pos, meFull]) // eslint-disable-line react-hooks/exhaustive-deps
  const loadDeal = (x: Deal) => setTrade(() => ({ partner: x.partner, give: x.give.map(a => a.id), get: x.get.map(a => a.id) }))

  // A click-through asked for the best deal to be loaded (Overview's "Find TE targets", Shop).
  useEffect(() => {
    if (!ui.load || !d) return
    if (deals[0]) loadDeal(deals[0])
    setUi(u => ({ ...u, right: 'deals', load: false }))
  }, [ui.load, d, deals]) // eslint-disable-line react-hooks/exhaustive-deps

  // Roster value by position, before and after, in your valuation.
  const groups = POS_GROUPS.map(g => {
    const before = mine.filter(a => a.pos === g).reduce((s, a) => s + mineOf(a), 0)
    const after =
      before - give.filter(a => a.pos === g).reduce((s, a) => s + mineOf(a), 0) + get.filter(a => a.pos === g).reduce((s, a) => s + mineOf(a), 0)
    return { g, before, after }
  })
  const gmax = Math.max(1, ...groups.flatMap(x => [x.before, x.after]))

  // Fit, warned not filtered: adding to a position where you already rank top 2.
  const posRank = useMemo(() => {
    const out: Record<string, number> = {}
    if (!d) return out
    for (const g of POS_GROUPS) {
      const totals = d.teams.map(t => ({ id: t.roster_id, v: assets.filter(a => a.owner === t.roster_id && a.pos === g).reduce((s, a) => s + mineOf(a), 0) }))
      totals.sort((a, b) => b.v - a.v)
      out[g] = totals.findIndex(x => x.id === me) + 1
    }
    return out
  }, [assets, d, me])
  const fitWarnings = POS_GROUPS.filter(g => {
    if (g === 'Picks') return false
    const inV = get.filter(a => a.pos === g).reduce((s, a) => s + mineOf(a), 0)
    const outV = give.filter(a => a.pos === g).reduce((s, a) => s + mineOf(a), 0)
    return inV > outV && posRank[g] && posRank[g] <= 2
  }).map(g => `Adds ${g}; you are already #${posRank[g]} at ${g}.`)
  const extra = verdict && meFull ? Math.max(0, verdict.bodyDelta) : 0

  let vText = 'Build a trade'
  let vTone = 'mute'
  if (verdict) {
    const { em, et } = verdict
    if (em > 0 && et > ET_NOISE) [vText, vTone] = ['Both sides win', 'pos']
    else if (em > 0 && et > 0) [vText, vTone] = ['Coin flip for them', 'warn']
    else if (em > 0) [vText, vTone] = ['They say no', 'neg']
    else [vText, vTone] = ['You lose value', 'neg']
  }
  const partnerAssets = assets.filter(a => a.owner === partner).sort((a, b) => mineOf(b) - mineOf(a))
  const asOf = d?.market.asOf ? new Date(d.market.asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'
  const inTrade = (id: string) => trade.give.includes(id) || trade.get.includes(id)

  const zone = (k: 'give' | 'get', xs: Asset[], empty: string) => (
    <div
      className="tr2-zone"
      style={{ background: over === k ? 'var(--acc-tint)' : undefined }}
      onDragOver={e => {
        e.preventDefault()
        if (over !== k) setOver(k)
      }}
      onDragLeave={() => setOver(null)}
      onDrop={drop}
    >
      <div className="tr2-zhead">
        <span>
          {k === 'give' ? 'You give' : 'You get'}
          {k === 'get' && partner != null ? ` · ${teamName.get(partner) ?? ''}` : ''}
        </span>
        <span>{num(xs.reduce((s, a) => s + mineOf(a), 0))}</span>
      </div>
      {xs.length === 0 && <div className="tr2-empty">{empty}</div>}
      {xs.map(a => (
        <div key={a.id} className="tr2-chip" title={`${subOf(a)} · market ${a.market == null ? '—' : num(a.val)}`}>
          <span className="nm">{a.name}</span>
          <span className="mono">{num(mineOf(a))}</span>
          <button onClick={() => remove(a.id)} aria-label="Remove">
            ×
          </button>
        </div>
      ))}
    </div>
  )

  return (
    <div className="tr2">
      <NextMove
        head={verdict ? `${vText}: you ${signed(verdict.em)}, them ${signed(verdict.et)}.` : 'Drag assets into the middle to build a trade.'}
        sub={
          extra > 0
            ? 'Taking back more bodies than you send means someone gets cut.'
            : 'Values blend Tyler’s sheet with FantasyCalc at the market influence you set.'
        }
        actions={[
          {
            label: 'Send in Sleeper ↗',
            primary: true,
            disabled: !verdict,
            title: 'Opens the league in Sleeper, where offers are sent',
            onClick: () => window.open(`https://sleeper.com/leagues/${leagueId}/trades`, '_blank'),
          },
          { label: 'Clear', onClick: clear },
        ]}
      />
      <div className="tr2-controls">
        <span
          className="k"
          title="How much your league's managers trade like the market (FantasyCalc) versus reading Tyler. Their side of every trade is judged on this blend."
        >
          Market influence
        </span>
        <input type="range" min={0} max={100} step={5} value={Math.round(beta * 100)} style={{ width: 180 }} onChange={e => changeBeta(Number(e.target.value) / 100)} />
        <span className="mono">{Math.round(beta * 100)}%</span>
        <span
          className="k"
          title="Within position: a player is a buy only if he is cheap relative to others at his position (Tyler's order, the market's price level). Raw: Tyler vs market as-is, which is mostly a position-wide disagreement."
        >
          Delta
        </span>
        <Segmented<'relative' | 'raw'>
          value={mode}
          onChange={v => props.onSettings({ tradeDelta: v })}
          options={[
            { value: 'relative', label: 'Within position' },
            { value: 'raw', label: 'Raw' },
          ]}
        />
        <span className="grow" />
        {d && (
          <span className="meta">
            Sheet {d.sheet.name} · market {d.market.source} {d.market.stale ? `(stale, ${asOf})` : asOf}
          </span>
        )}
      </div>
      {res && !res.ok && <InlineError message={res.error} onRetry={load} />}

      <div className="tr2-cols">
        <div className="panel tr2-mine">
          <div className="tr2-phead">
            <b>Your assets</b>
            <span className="hint">drag into the builder</span>
          </div>
          <div className="tr2-list">
            {!d && <SkeletonRows n={10} />}
            {mine.map(a => (
              <AssetRow key={a.id} a={a} inTrade={inTrade(a.id)} onAdd={() => toggle(a.id)} />
            ))}
          </div>
        </div>

        <div className="tr2-mid">
          <div className="panel">
            <div className="tr2-phead">
              <b>Trade builder</b>
              <button className="link" onClick={clear}>
                Clear
              </button>
            </div>
            <div className="tr2-zones">
              {zone('give', give, 'Drag or click your assets.')}
              {zone('get', get, 'Drag from their roster, or load a deal.')}
            </div>
            <div className="tr2-verdict">
              <div className={`tr2-vtext ${vTone}`}>{vText}</div>
              <div className="tr2-meters">
                <Meter label="You" v={verdict?.em ?? 0} />
                <Meter label="Them" v={verdict?.et ?? 0} />
              </div>
              {extra > 0 && d && (
                <div className="tr2-warn">
                  Adds {extra} bod{extra === 1 ? 'y' : 'ies'} to a full roster: someone gets cut (−{num(d.spotCost)} each).
                </div>
              )}
              {fitWarnings.map(w => (
                <div key={w} className="tr2-warn">
                  {w}
                </div>
              ))}
            </div>
          </div>

          <div className="panel tr2-impact">
            <b>Roster value after trade</b>
            {groups.map(x => {
              const delta = x.after - x.before
              return (
                <div key={x.g} className="tr2-irow">
                  <span>{x.g}</span>
                  <div className="bars">
                    <div className="b" style={{ width: `${(x.before / gmax) * 100}%` }} />
                    <div className="a" style={{ width: `${(Math.max(0, x.after) / gmax) * 100}%` }} />
                  </div>
                  <span className="mono r" style={{ color: Math.round(delta) > 0 ? 'var(--pos)' : Math.round(delta) < 0 ? 'var(--neg)' : 'var(--mute)' }}>
                    {Math.round(delta) === 0 ? '—' : signed(delta)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="panel tr2-right">
          <div className="tr2-tabs">
            {[
              { k: 'deals' as const, l: 'Find a deal' },
              { k: 'roster' as const, l: 'Their roster' },
            ].map(t => (
              <button key={t.k} className={ui.right === t.k ? 'on' : ''} onClick={() => setUi(u => ({ ...u, right: t.k }))}>
                {t.l}
              </button>
            ))}
          </div>

          {ui.right === 'deals' && (
            <>
              <div className="tr2-sub">
                <Segmented<string>
                  value={ui.pos}
                  onChange={v => setUi(u => ({ ...u, pos: v }))}
                  options={['All', ...POS_GROUPS].map(v => ({ value: v, label: v }))}
                />
                <span className="hint">{give.length ? 'For what you’re giving.' : `Your top ${SHOP_TOP} assets, shopped one at a time.`}</span>
              </div>
              <div className="tr2-list">
                {d && deals.length === 0 && <div className="tr2-empty pad">No deal where both sides win in this filter.</div>}
                {deals.map((x, i) => {
                  const loaded = x.partner === partner && sameSet(x.get.map(a => a.id), trade.get) && sameSet(x.give.map(a => a.id), trade.give)
                  return (
                    <button key={i} className="tr2-deal" style={{ borderLeftColor: loaded ? 'var(--acc)' : 'transparent' }} onClick={() => loadDeal(x)}>
                      <span className="nm">{x.get.map(a => a.name).join(' + ')}</span>
                      <span className="sub">
                        {teamName.get(x.partner)} · for {x.give.map(a => (a.kind === 'pick' && a.slot ? a.slot : a.name)).join(' + ')}
                      </span>
                      <span className="em mono">
                        <span style={{ color: 'var(--pos)' }}>you {signed(x.verdict.em)}</span>
                        <span style={{ color: x.verdict.et < ET_NOISE ? 'var(--warn)' : 'var(--ink2)' }}>
                          them {signed(x.verdict.et)}
                          {x.verdict.et < ET_NOISE ? ' · coin flip' : ''}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {ui.right === 'roster' && (
            <>
              <div className="tr2-sub wrap">
                {d?.teams
                  .filter(t => t.roster_id !== me)
                  .map(t => (
                    <button
                      key={t.roster_id}
                      className={`tr2-partner ${t.roster_id === partner ? 'on' : ''}`}
                      onClick={() => setTrade(x => ({ ...x, partner: t.roster_id, get: x.partner === t.roster_id ? x.get : [] }))}
                    >
                      <TeamAvatar src={avatarOf.get(t.roster_id)} name={t.name} size={18} />
                      {t.name}
                    </button>
                  ))}
              </div>
              <div className="tr2-list">
                {partner == null && <div className="tr2-empty pad">Pick a partner.</div>}
                {partnerAssets.map(a => (
                  <AssetRow key={a.id} a={a} inTrade={inTrade(a.id)} onAdd={() => toggle(a.id)} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="footnote" style={{ marginTop: 0 }}>
        Sheet = Tyler's .75 TE-prem board in this league's scoring. Market = FantasyCalc's trade-derived rank through the same curve, blended by
        Market influence. Your value is the sheet (Raw) or the sheet at the market's level for the position (Within position); their side is
        always the market. Verdicts use effective value: one star beats a bundle of the same raw total, and their side under {ET_NOISE} is a coin
        flip.
      </div>
    </div>
  )
}
