// The trade being built, valued: shared by the Trade tab, its sticky verdict bar and review sheet,
// the tab badge, and every "add to trade" elsewhere (Players long-press, team and player sheets).
// Same valuation as the desktop TradesView: your side on Tyler's sheet (raw or within position),
// their side on the market blended by Market influence, picks priced over the sim's slot odds.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Result, TradeData } from '@monte/core/types'
import { ET_NOISE, evaluate, findPackages, pickValues, positionRatios, type Asset, type Package, type Verdict } from '@monte/core/tradeMath'
import { anonTrades } from '@monte/core/names'
import { monte } from './monte'
import { EMPTY_TRADE, useApp, type TradeUi } from './store'
import { useOverlay } from '@/ui/overlay'
import { ORD } from '@/ui/kit'

export const POS_GROUPS = ['QB', 'RB', 'WR', 'TE', 'Picks'] as const
/** How many of your assets the deal ideas shop one at a time. */
const SHOP_TOP = 6

export type VerdictTone = 'pos' | 'warn' | 'neg' | 'mute'
export type Deal = Package & { partner: number; give: Asset[] }
export const mineOf = (a: Asset) => a.mine ?? a.sheet

/** Your-value-vs-market read on one asset, from your side of the table. */
export function marketTag(a: Asset): { label: string; tone: 'acc' | 'pos' | 'mute' } {
  const m = mineOf(a)
  const d = m - a.val
  if (a.market == null) return { label: 'No market', tone: 'mute' }
  if (d <= -Math.max(250, 0.1 * m)) return { label: 'Sell high', tone: 'acc' }
  if (d >= Math.max(250, 0.1 * a.val)) return { label: 'Undervalued', tone: 'pos' }
  return { label: 'Fair', tone: 'mute' }
}

export const assetMeta = (a: Asset) =>
  a.kind === 'pick' ? (a.slot ? `projected ${a.slot}` : 'future pick') : `${a.pos} · ${a.team}${a.age ? ` · ${a.age}` : ''}`

export function verdictText(v: Verdict | null): { label: string; tone: VerdictTone } {
  if (!v) return { label: 'Build a trade', tone: 'mute' }
  if (v.em > 0 && v.et > ET_NOISE) return { label: 'Both sides win', tone: 'pos' }
  if (v.em > 0 && v.et > 0) return { label: 'Coin flip for them', tone: 'warn' }
  if (v.em > 0) return { label: 'They say no', tone: 'neg' }
  return { label: 'You lose value', tone: 'neg' }
}

type Trade = {
  res: Result<TradeData> | null
  d: TradeData | null
  load: () => void
  assets: Asset[]
  byId: Map<string, Asset>
  me: number | null
  mine: Asset[]
  teamName: (rid: number | null | undefined) => string
  give: Asset[]
  get: Asset[]
  partner: number | null
  count: number
  beta: number
  setBeta: (v: number) => void
  commitBeta: (v: number) => void
  verdict: Verdict | null
  label: string
  tone: VerdictTone
  /** bodies you take on past a full roster */
  extra: number
  fitWarnings: string[]
  groups: Array<{ g: string; before: number; after: number }>
  toggle: (id: string) => void
  remove: (id: string) => void
  clear: () => void
  setPartner: (rid: number) => void
  loadDeal: (x: Deal) => void
  /** packages where both sides win, best for you first (empty give = shop your top assets) */
  findDeals: (give: Asset[], perTeam: number, limit: number) => Deal[]
}

const Ctx = createContext<Trade | null>(null)

export function useTrade(): Trade {
  const x = useContext(Ctx)
  if (!x) throw new Error('useTrade outside TradeProvider')
  return x
}

export function TradeProvider({ children }: { children: ReactNode }) {
  const { context, settings, setSettings, bbBase: bb, runBB, trade, setTrade, dataVersion, sheet, hide } = useApp()
  const leagueId = context?.league.league_id ?? ''
  const [res, setRes] = useState<Result<TradeData> | null>(null)
  // Market influence re-blends live; the saved setting follows when the slider is released.
  const [beta, setBeta] = useState(settings?.marketBeta?.[leagueId] ?? 1)
  const mode = settings?.tradeDelta ?? 'relative'

  const load = () => {
    if (!leagueId || !settings?.userId || !sheet) return
    setRes(null)
    void monte.trades(leagueId, settings.userId).then(setRes)
  }
  useEffect(load, [leagueId, settings?.userId, dataVersion, !!sheet]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setBeta(settings?.marketBeta?.[leagueId] ?? 1), [leagueId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Picks are priced over the sim's slot odds; start it once per league if nothing has.
  useEffect(() => {
    if (leagueId && sheet && !bb.result && !bb.busy && !bb.error) runBB()
  }, [leagueId, !!sheet]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = useMemo(() => (res?.ok ? (hide ? anonTrades(res.value) : res.value) : null), [res, hide])
  const names = useMemo(() => new Map(d?.teams.map(x => [x.roster_id, x.name])), [d])
  const teamName = (rid: number | null | undefined) => (rid == null ? '' : names.get(rid) ?? `Team #${rid}`)

  // Every asset at this market influence; picks: next draft over the sim, later at round average.
  const assets = useMemo(() => {
    if (!d) return [] as Asset[]
    const blend = (s: number, m: number | null) => (m == null ? s : s + beta * (m - s))
    const dist = new Map(bb.result?.teams.map(x => [x.roster_id, x.slotDist]))
    const slotOf = new Map([...(bb.result?.teams ?? [])].sort((a, b) => a.meanDraftSlot - b.meanDraftSlot).map((x, i) => [x.roster_id, i + 1]))
    const picks: Asset[] = d.picks.map(p => {
      const v = pickValues(d.pickInputs, p.season, p.round, dist.get(p.originalOwner) ?? null)
      const own = p.originalOwner === p.owner
      const slot = p.season === d.pickInputs.season && slotOf.has(p.originalOwner) ? `${p.round}.${String(slotOf.get(p.originalOwner)).padStart(2, '0')}` : null
      return {
        id: `pick:${p.season}:${p.round}:${p.originalOwner}`,
        kind: 'pick',
        name: `${p.season} ${ORD[p.round] ?? `R${p.round}`}${own ? '' : ` · via ${names.get(p.originalOwner) ?? '?'}`}`,
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
    return base.map(a => ({ ...a, mine: mode === 'relative' ? a.sheet * (ratios[a.pos] ?? 1) : a.sheet }))
  }, [d, bb.result, names, mode, beta])
  const byId = useMemo(() => new Map(assets.map(a => [a.id, a])), [assets])

  const me = d?.myRosterId ?? null
  const mine = useMemo(() => assets.filter(a => a.owner === me).sort((a, b) => mineOf(b) - mineOf(a)), [assets, me])
  const give = trade.give.map(id => byId.get(id)).filter(Boolean) as Asset[]
  const get = trade.get.map(id => byId.get(id)).filter(Boolean) as Asset[]
  const partner = trade.partner
  const meFull = !!d?.teams.find(x => x.roster_id === me)?.full
  const params = d && { gamma: d.gamma, spotCost: d.spotCost, meFull, themFull: !!d.teams.find(x => x.roster_id === partner)?.full }
  const verdict = params && give.length && get.length ? evaluate(give, get, params) : null
  const { label, tone } = verdictText(verdict)

  // Roster value by position, before and after, in your valuation.
  const groups = POS_GROUPS.map(g => {
    const before = mine.filter(a => a.pos === g).reduce((s, a) => s + mineOf(a), 0)
    const after = before - give.filter(a => a.pos === g).reduce((s, a) => s + mineOf(a), 0) + get.filter(a => a.pos === g).reduce((s, a) => s + mineOf(a), 0)
    return { g, before, after }
  })

  // Fit, warned not filtered: adding to a position where you already rank top 2.
  const posRank = useMemo(() => {
    const out: Record<string, number> = {}
    if (!d) return out
    for (const g of POS_GROUPS) {
      const totals = d.teams.map(x => ({ id: x.roster_id, v: assets.filter(a => a.owner === x.roster_id && a.pos === g).reduce((s, a) => s + mineOf(a), 0) }))
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
  }).map(g => `Adds ${g}; you're already #${posRank[g]} at ${g}.`)
  const extra = verdict && meFull ? Math.max(0, verdict.bodyDelta) : 0

  const remove = (id: string) => setTrade(x => ({ ...x, give: x.give.filter(y => y !== id), get: x.get.filter(y => y !== id) }))
  const toggle = (id: string) => {
    const a = byId.get(id)
    if (!a) return
    if (trade.give.includes(id) || trade.get.includes(id)) return remove(id)
    if (a.owner === me) setTrade(x => ({ ...x, give: [...x.give, id] }))
    else setTrade(x => (x.partner !== a.owner ? { ...x, partner: a.owner, get: [id] } : { ...x, get: [...x.get, id] }))
  }

  const findDeals = (gv: Asset[], perTeam: number, limit: number): Deal[] => {
    if (!d || me == null) return []
    const gives = gv.length ? [gv] : mine.filter(a => mineOf(a) > 0).slice(0, SHOP_TOP).map(a => [a])
    const out: Deal[] = []
    for (const g of gives)
      for (const team of d.teams) {
        if (team.roster_id === me) continue
        const p = { gamma: d.gamma, spotCost: d.spotCost, meFull, themFull: team.full }
        const pool = assets.filter(a => a.owner === team.roster_id)
        out.push(...findPackages(g, pool, p, perTeam).map(pk => ({ ...pk, partner: team.roster_id, give: g })))
      }
    return out.sort((a, b) => b.verdict.em - a.verdict.em).slice(0, limit)
  }

  const value: Trade = {
    res,
    d,
    load,
    assets,
    byId,
    me,
    mine,
    teamName,
    give,
    get,
    partner,
    count: trade.give.length + trade.get.length,
    beta,
    setBeta,
    commitBeta: v => void setSettings({ marketBeta: { ...(settings?.marketBeta ?? {}), [leagueId]: v } }),
    verdict,
    label,
    tone,
    extra,
    fitWarnings,
    groups,
    toggle,
    remove,
    clear: () => setTrade(() => EMPTY_TRADE),
    setPartner: rid => setTrade(x => ({ ...x, partner: rid, get: x.partner === rid ? x.get : [] })),
    loadDeal: x => setTrade(() => ({ partner: x.partner, give: x.give.map(a => a.id), get: x.get.map(a => a.id) })),
    findDeals,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Add a player or pick to the trade from anywhere, then say so: "X added to trade" with an Open
 * action that jumps to the Trade tab on the right list.
 */
export function useAddToTrade() {
  const { addToTrade, openTrade, context } = useApp()
  const { showToast, closeSheet } = useOverlay()
  const me = context?.myRosterId ?? null
  return (assetId: string, owner: number, name: string) => {
    addToTrade(assetId, owner)
    closeSheet()
    const list: TradeUi['list'] = owner === me ? 'mine' : 'theirs'
    showToast(`${name} added to trade`, { label: 'Open', onPress: () => openTrade(list) })
  }
}
