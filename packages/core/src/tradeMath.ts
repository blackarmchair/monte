// Trade math, a port of dynasty_model.py without the user-specific conviction layer.
//
// Two valuations of every asset:
//   sheet   Tyler's rank -> value curve, translated into this league's scoring. What YOU judge on.
//   val     what this league's managers pay: sheet + beta·(market − sheet), where market is
//           FantasyCalc's trade-derived rank through the SAME curve (so no scale calibration is
//           assumed). What THEY judge on, and therefore what drives acceptance.
// gap = sheet − val. Positive: the room underprices him relative to Tyler — a buy. Negative: the
// room overpays — a sell.
//
// A trade is scored in EFFECTIVE space, where "four quarters don't equal a dollar": eff() is
// convex, so consolidating into one premium asset beats a bundle of the same raw total. Both
// sides must come out positive for a deal to be worth sending: em (you, on sheet) and et (them,
// on val). Each side also pays a roster-spot cost for every extra body it receives.

export const value = (rank: number | null | undefined) => (rank == null ? 0 : 10000 * Math.exp(-rank / 70))

/** Scoring a value published at (srcTe, srcPassTd) into this league's (te, passTd). */
export function scoringAdj(pos: string, v: number, src: { te: number; passTd: number }, lg: { te: number; passTd: number }) {
  if (pos === 'TE') return v * (1 + 0.25 * (lg.te - src.te)) // TE_SENS
  if (pos === 'QB') return v * (1 + 0.04 * (lg.passTd - src.passTd)) // QB_SENS
  return v
}
export const SHEET_SCORING = { te: 0.75, passTd: 4 } // Tyler's TE-prem column, standard pass TD
export const MARKET_SCORING = { te: 0, passTd: 4 } // FantasyCalc: plain PPR

export type LeagueShape = {
  /** starters */
  nStart: number
  /** starters + bench; taxi and IR excluded */
  rosterCap: number
}
export const gammaFor = (s: LeagueShape) => Math.round(1.5 * Math.sqrt(9 / s.nStart) * 1000) / 1000
export const spotCostFor = (s: LeagueShape) => Math.round(450 * (9 / s.nStart) * (19 / s.rosterCap))

export const eff = (v: number, gamma: number) => 10000 * (Math.max(v, 0) / 10000) ** gamma

export type Asset = {
  id: string
  kind: 'player' | 'pick'
  name: string
  pos: string
  team: string
  age: number | null
  owner: number
  sheet: number
  /** YOUR value for scoring: the sheet, or (within-position mode) the sheet rescaled to the
   *  market's level for this position. Defaults to `sheet`. */
  mine?: number
  /** market-blended value this league pays */
  val: number
  /** raw market value before the beta blend (null = FantasyCalc has no row) */
  market: number | null
  /** pick metadata */
  season?: string
  round?: number
  originalOwner?: number
  slot?: string | null
}

export type Verdict = {
  em: number
  et: number
  giveSheet: number
  getSheet: number
  giveVal: number
  getVal: number
  bodyDelta: number
}

/**
 * Score one trade. `give` leaves your roster, `get` arrives. A side only pays the spot cost if
 * its roster is full (receiving an extra body there means cutting someone).
 */
export function evaluate(
  give: Asset[],
  get: Asset[],
  p: { gamma: number; spotCost: number; meFull: boolean; themFull: boolean },
): Verdict {
  const sum = (xs: Asset[], k: 'mine' | 'val') => xs.reduce((s, a) => s + eff(k === 'mine' ? a.mine ?? a.sheet : a.val, p.gamma), 0)
  const bodyDelta = get.length - give.length
  const spotMe = p.meFull ? p.spotCost * Math.max(0, bodyDelta) : 0
  const spotThem = p.themFull ? p.spotCost * Math.max(0, -bodyDelta) : 0
  return {
    em: sum(get, 'mine') - sum(give, 'mine') - spotMe,
    et: sum(give, 'val') - sum(get, 'val') - spotThem,
    giveSheet: give.reduce((s, a) => s + (a.mine ?? a.sheet), 0),
    getSheet: get.reduce((s, a) => s + (a.mine ?? a.sheet), 0),
    giveVal: give.reduce((s, a) => s + a.val, 0),
    getVal: get.reduce((s, a) => s + a.val, 0),
    bodyDelta,
  }
}

/** Their side under ~200 effective is inside the model's error bar: a coin flip, not a yes. */
export const ET_NOISE = 200

export type Package = { get: Asset[]; verdict: Verdict }

/**
 * "Find the other side": for a fixed give basket, every 1- or 2-asset package from one partner
 * where BOTH sides win, best for you first. Capped at two legs deliberately: three-leg sweeps
 * explode the count (11 → 2,071 in one test) with mostly filler.
 */
export function findPackages(
  give: Asset[],
  partnerAssets: Asset[],
  p: { gamma: number; spotCost: number; meFull: boolean; themFull: boolean },
  limit = 12,
): Package[] {
  const out: Package[] = []
  const pool = partnerAssets.filter(a => (a.mine ?? a.sheet) > 0 || a.val > 0)
  const consider = (get: Asset[]) => {
    const v = evaluate(give, get, p)
    if (v.em > 0 && v.et > 0) out.push({ get, verdict: v })
  }
  for (let i = 0; i < pool.length; i++) {
    consider([pool[i]])
    for (let j = i + 1; j < pool.length; j++) consider([pool[i], pool[j]])
  }
  return out.sort((a, b) => b.verdict.em - a.verdict.em).slice(0, limit)
}

/**
 * Within-position mode. Most raw sheet-vs-market gap is a disagreement about WHOLE POSITIONS
 * (Hamilton wk6: market/sheet median QB 0.85, WR 0.85, TE 1.10, RB 1.22 — 25 of 30 QBs read as a
 * buy). That is a real arbitrage, but it buries player-specific mispricing and ignores demand.
 * This returns, per position group, the median val/sheet ratio, so YOUR side can be rescaled to
 * the market's level for the position: you keep Tyler's order within a position and accept the
 * market's price for it. Their side stays on the real market — what they will actually pay.
 */
export function positionRatios(assets: Asset[], minSheet = 1000): Record<string, number> {
  const by = new Map<string, number[]>()
  for (const a of assets) {
    if (a.market == null || a.sheet < minSheet) continue
    if (!by.has(a.pos)) by.set(a.pos, [])
    by.get(a.pos)!.push(a.val / a.sheet)
  }
  const out: Record<string, number> = {}
  for (const [pos, xs] of by) {
    if (xs.length < 3) continue
    const s = [...xs].sort((x, y) => x - y)
    out[pos] = s[Math.floor(s.length / 2)]
  }
  return out
}

// --------------------------------------------------------------------------- picks
export type PickInputs = {
  /** next rookie draft season */
  season: string
  teams: number
  /** sheet value at overall rookie index (round−1)·teams + slot−1, before discount */
  sheetCurve: number[]
  /** discount by draft: index 0 = `season` */
  discount: number[]
  /** FantasyCalc pick values (already through value() on the players-only scale), by key
   *  "2027:1:early" / "2027:1:mid" / "2027:1:late" / "2028:1" (generic) */
  market: Record<string, number>
}

const tranche = (slot: number, teams: number) => (slot <= Math.round(teams / 3) ? 'early' : slot > teams - Math.round(teams / 3) ? 'late' : 'mid')

/**
 * Sheet and market value of one pick. The next draft is priced over the sim's slot
 * distribution when there is one; later drafts (or no sim yet) use the round average.
 */
export function pickValues(inp: PickInputs, season: string, round: number, dist: number[] | null) {
  const n = inp.teams
  const di = Math.max(0, Number(season) - Number(inp.season))
  const disc = inp.discount[di] ?? inp.discount[inp.discount.length - 1]
  const sheetAt = (slot: number) => inp.sheetCurve[(round - 1) * n + slot - 1] ?? 0
  const marketAt = (slot: number) =>
    inp.market[`${season}:${round}:${tranche(slot, n)}`] ?? inp.market[`${season}:${round}`] ?? null
  const w = dist && season === inp.season ? dist : Array(n).fill(1 / n)
  let sheet = 0
  let market = 0
  let haveMarket = true
  w.forEach((p, k) => {
    sheet += p * sheetAt(k + 1)
    const m = season === inp.season ? marketAt(k + 1) : inp.market[`${season}:${round}`] ?? null
    if (m == null) haveMarket = false
    else market += p * m
  })
  return { sheet: sheet * disc, market: haveMarket ? market : null }
}
