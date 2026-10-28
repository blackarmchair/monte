// Tyler's dynasty strategy as trade ideas. The board already holds his player opinions, so nothing
// here changes a value: these rules decide which assets are worth shopping or chasing, which
// assets never move, which partners to aim at, and how high the bar is. Every idea carries the
// rule behind it.
//
// The math is tradeMath's: your side on the sheet, theirs on the market, effective value, both
// sides must win. Their side is THIS manager's market, not the average one: demandModel() moves an
// asset's price for a team by its direction (contenders pay for veterans, rebuilders for picks and
// youth), its depth at the position, and starters it is missing this week. Ideas sell one asset at a time ("simplify, especially when selling") and buy one
// target at a time, each with an ask (the most you can take while they still say yes) and a
// settle (the most you can take while they clearly say yes).
import { ET_NOISE, eff, evaluate, findPackages, type Asset, type EvalParams, type Package } from './tradeMath'

export type Phase = 'offseason' | 'drafting' | 'inSeason'
export type Mode = 'contend' | 'rebuild' | 'middle'

/** Tyler's one dated rule: no 1st of this draft leaves without clearing it with him. */
export const HOLD_FIRST_SEASON = '2027'
/** Past these ages a sliding player is a falling knife. RB efficiency dies at 29. */
export const CLIFF: Record<string, number> = { QB: 34, RB: 28, WR: 30, TE: 30 }
/** RBs to sell while the market still pays, before the wall. */
export const RB_SELL_AGE = 26
/** Rebuilding: veterans at these ages go to contenders for picks. */
export const VET_AGE: Record<string, number> = { QB: 30, RB: 25, WR: 27, TE: 28 }
/** Sleeper statuses that mean "currently injured": stay away, value keeps sliding. */
const INJURED = new Set(['IR', 'PUP', 'NFI'])
/** Contend at or above this playoff chance, rebuild at or below. */
const CONTEND_PCT = 0.6
const REBUILD_PCT = 0.25
/** Giving a future pick needs an obvious win: this much effective value, or this share of it. */
const FUTURE_BAR = 500
const FUTURE_SHARE = 0.3
/** An idea must gain you at least this much effective value: the same size as the model's error bar. */
const MIN_GAIN = ET_NOISE
/** Rebuilding, a sell that brings back picks ranks ahead by this. */
const PICKS_BONUS = 250
/**
 * Demand multipliers on the market price, by a team's situation. Deliberately modest: the market
 * already prices the average manager, these are the lean of one. A team's total is capped to
 * DEMAND_CAP either way.
 */
export const DEMAND = {
  /** contender: veterans (VET_AGE) */
  contendVet: 1.08,
  /** contender: picks, which score nothing this year */
  contendPick: 0.92,
  /** rebuilder: veterans */
  rebuildVet: 0.9,
  /** rebuilder: young players (24 and under) */
  rebuildYouth: 1.05,
  /** rebuilder: picks */
  rebuildPick: 1.08,
  /** starters at the position under THIN of the league median */
  thin: 1.08,
  /** over STACKED of the median */
  stacked: 0.93,
  /** a starter at the position out this week (contenders and in-betweens) */
  hole: 1.06,
}
const DEMAND_CAP = 0.2
const THIN = 0.8
const STACKED = 1.25
const YOUTH_AGE = 24
/** The same "sell high / undervalued" threshold as the trade screen's market tag. */
const gapOf = (a: number, b: number) => a - b >= Math.max(250, 0.1 * b)

export type Reason = { rule: string; text: string }
export type StrategyTeam = {
  roster_id: number
  name: string
  wins: number
  losses: number
  full: boolean
  playoffPct: number | null
  /** starters out this week, by position */
  holes: Array<{ pos: string; name: string; status: string }>
}
export type StrategyCtx = {
  assets: Asset[]
  me: number
  teams: StrategyTeam[]
  phase: Phase
  /** your mode after any override */
  mode: Mode
  /** the next rookie draft's season */
  nextSeason: string
  teamCount: number
  gamma: number
  spotCost: number
  /** in-season positional PPG rank a player must beat to be a weekly starter in this league */
  starterLine: Record<string, number>
}
export type IdeaDeal = Package & { partner: number; give: Asset[] }
export type Idea = {
  kind: 'sell' | 'buy'
  asset: Asset
  reasons: Reason[]
  /** the most you can take and still get a yes */
  ask: IdeaDeal
  /** the most you can take and get a clear yes; null when it is the ask */
  settle: IdeaDeal | null
  /** why this partner */
  partnerWhy: string[]
  notes: string[]
}

const mineOf = (a: Asset) => a.mine ?? a.sheet

export const MODE_LABEL: Record<Mode, string> = { contend: 'Contend', middle: 'In between', rebuild: 'Rebuild' }
/** What the calendar means for trades right now. */
export const PHASE_LINE: Record<Phase, string> = {
  inSeason: 'In season: buy picks ahead of the rookie draft, sell into contenders’ temporary holes, and don’t panic.',
  drafting: 'Rookie draft: sell picks into rookie fever, and trade out for veterans while they’re cheapest.',
  offseason: 'Offseason: buy picks now, ahead of the rookie draft and ideally before the NFL Draft.',
}

// --------------------------------------------------------------------------- direction
export function teamMode(t: { wins: number; losses: number; playoffPct: number | null }, phase: Phase): { mode: Mode; why: string } {
  if (phase === 'inSeason') {
    if (t.wins === 0 && t.losses >= 4) return { mode: 'rebuild', why: `0-${t.losses}: time to pivot hard` }
    if (t.playoffPct != null) {
      const pct = `${Math.round(t.playoffPct * 100)}% to make the playoffs`
      if (t.playoffPct >= CONTEND_PCT) return { mode: 'contend', why: pct }
      if (t.playoffPct <= REBUILD_PCT) return { mode: 'rebuild', why: pct }
      return { mode: 'middle', why: pct }
    }
    return { mode: 'middle', why: 'no pick-odds run yet' }
  }
  return { mode: 'middle', why: 'offseason: set it yourself' }
}

// --------------------------------------------------------------------------- hard rules
/** Why this pick never leaves in an idea (and draws a warning in the builder), or null. */
export function heldPick(a: Asset, me: number, nextSeason: string): string | null {
  if (a.kind !== 'pick' || a.round !== 1) return null
  if (a.season === HOLD_FIRST_SEASON) return `Tyler: no ${HOLD_FIRST_SEASON} 1st leaves without clearing it with him.`
  if (a.originalOwner === me) return 'Tyler: never trade your own future 1st without clearing it with him.'
  if (Number(a.season) > Number(nextSeason)) return 'Tyler: 1sts this far out almost never return fair value. He doesn’t try.'
  return null
}

/** The bar a deal giving away future picks must clear, in effective value (0 when it gives none). */
export function futureBar(give: Asset[], gamma: number): number {
  const picks = give.filter(a => a.kind === 'pick')
  if (!picks.length) return 0
  return Math.max(FUTURE_BAR, FUTURE_SHARE * picks.reduce((s, a) => s + eff(mineOf(a), gamma), 0))
}

/** Every warning the builder shows for a give basket. */
export function giveWarnings(give: Asset[], me: number, nextSeason: string): string[] {
  const out = give.map(a => heldPick(a, me, nextSeason)).filter((w): w is string => !!w)
  if (give.some(a => a.kind === 'pick' && !heldPick(a, me, nextSeason)))
    out.push('Future picks out: Tyler wants an obvious, clear win for these, not “meh” or “just okay.”')
  return [...new Set(out)]
}

// --------------------------------------------------------------------------- signals
/** Why NOT to take this player on, or null. */
export function avoid(a: Asset, mode: Mode): string | null {
  if (a.kind !== 'player') return null
  if (a.injury && INJURED.has(a.injury)) return 'Currently injured: return to play isn’t return to performance, and the value tends to keep sliding.'
  if (a.age != null && a.age >= (CLIFF[a.pos] ?? 99) && (a.trend ?? 0) <= 0) return `${a.pos} at ${a.age}, past the age cliff: don’t catch a falling knife.`
  if (mode === 'rebuild' && a.pos === 'RB') return 'Rebuilding: don’t target RBs. Their value is the most fickle and the wall comes earliest.'
  if (mode === 'rebuild' && a.age != null && a.age >= (VET_AGE[a.pos] ?? 99)) return 'Rebuilding: don’t pay for veterans. Their value won’t last until you’re contending.'
  return null
}

export function sellReasons(a: Asset, c: StrategyCtx): Reason[] {
  const out: Reason[] = []
  const m = mineOf(a)
  if (a.market != null && gapOf(a.val, m))
    out.push({ rule: 'Sell high', text: `The market pays ${Math.round((a.val / Math.max(m, 1) - 1) * 100)}% more than Tyler’s value.` })
  if (a.kind === 'player') {
    const knife = avoid(a, 'middle')
    if (knife && a.market != null) out.push({ rule: 'Someone else’s problem', text: knife.replace(': don’t catch a falling knife.', '. Sell before it falls further.') })
    if (a.pos === 'RB' && a.age != null && a.age >= RB_SELL_AGE && a.val >= 0.9 * m && !knife)
      out.push({ rule: 'RB age wall', text: `RB at ${a.age}: sell while the market still pays. Rushing efficiency dies at 29.` })
    if (c.mode === 'rebuild' && a.age != null && a.age >= (VET_AGE[a.pos] ?? 99) && !out.some(r => r.rule === 'RB age wall'))
      out.push({ rule: 'Rebuild', text: 'Rebuilding: turn veterans into future picks, aimed at teams off to strong starts.' })
  }
  if (a.kind === 'pick' && c.phase === 'drafting' && a.season === c.nextSeason)
    out.push({ rule: 'Rookie fever', text: 'Picks are never worth more than during the rookie draft. Sell into it, or trade out for a veteran.' })
  return out
}

export function buyReasons(a: Asset, c: StrategyCtx): Reason[] {
  const out: Reason[] = []
  const m = mineOf(a)
  if (a.market != null && gapOf(m, a.val))
    out.push({ rule: 'Undervalued', text: `The market is ${Math.round((1 - a.val / Math.max(m, 1)) * 100)}% below Tyler’s value.` })
  if (a.kind === 'pick') {
    if (c.phase !== 'drafting' && m >= 0.9 * a.val) {
      out.push(
        Number(a.season) > Number(c.nextSeason)
          ? { rule: 'Future picks', text: 'Future picks are often given away for nothing. Buy them a year or two early.' }
          : { rule: 'Picks before the draft', text: 'Buy picks before the rookie draft (ideally before the NFL Draft); flip them during it.' },
      )
      if (c.teamCount < 12 && m > a.val)
        out.push({ rule: 'League size', text: `In a ${c.teamCount}-team league a ${a.round === 1 ? '1st' : 'pick'} is a higher pick than the market's 12-team price assumes.` })
    }
  } else {
    if (c.phase === 'inSeason' && a.yearsExp === 0 && (a.pos === 'WR' || a.pos === 'TE') && m >= a.val) {
      const line = c.starterLine[a.pos]
      if (a.ppgRank == null || (line && a.ppgRank > line))
        out.push({ rule: 'Slow-start rookie', text: 'Rookie WRs and TEs mostly break out in the second half. Buy before he’s a weekly starter.' })
    }
    if (c.phase === 'drafting' && (a.yearsExp ?? 0) >= 2 && m > a.val)
      out.push({ rule: 'Trade out for veterans', text: 'Rookie fever: productive veterans are cheaper during the rookie draft than at any other time.' })
  }
  return out
}

// --------------------------------------------------------------------------- search
/** Every 1- or 2-asset give from `pool` for a fixed get, both sides winning, best for you first. */
export function findGives(get: Asset[], pool: Asset[], p: EvalParams, limit = 12): Array<Package & { give: Asset[] }> {
  const out: Array<Package & { give: Asset[] }> = []
  const consider = (give: Asset[]) => {
    const v = evaluate(give, get, p)
    if (v.em > 0 && v.et > 0) out.push({ get, give, verdict: v })
  }
  for (let i = 0; i < pool.length; i++) {
    consider([pool[i]])
    for (let j = i + 1; j < pool.length; j++) consider([pool[i], pool[j]])
  }
  return out.sort((a, b) => b.verdict.em - a.verdict.em).slice(0, limit)
}

/** Ask and settle out of one partner's candidates (sorted best for you first), past the minimum gain
 *  and the future-pick bar. */
function askSettle(cands: IdeaDeal[], gamma: number): { ask: IdeaDeal; settle: IdeaDeal | null } | null {
  const ok = cands.filter(d => d.verdict.em > Math.max(MIN_GAIN, futureBar(d.give, gamma)))
  if (!ok.length) return null
  const ask = ok[0]
  const settle = ok.find(d => d.verdict.et > ET_NOISE) ?? null
  return { ask, settle: settle === ask ? null : settle }
}

/** `parts` are the factors behind `mult`, each with its own multiple; `why` is them as text. */
export type Demand = { mult: number; why: string[]; parts: Array<{ text: string; x: number }> }

/**
 * How much more (or less) than the market each team pays for an asset, with the reasons. Strength
 * at a position is the market value of a team's would-be starters there (as many as the league
 * starts per team), against the league median.
 */
export function demandModel(c: { assets: Asset[]; teams: StrategyTeam[]; phase: Phase; starterLine: Record<string, number>; teamCount: number }) {
  const POS = ['QB', 'RB', 'WR', 'TE']
  const modes = new Map(c.teams.map(t => [t.roster_id, teamMode(t, c.phase)]))
  const strength = new Map<string, number>()
  for (const pos of POS) {
    const k = Math.max(1, Math.round((c.starterLine[pos] ?? 0) / Math.max(1, c.teamCount)))
    const tot = c.teams.map(t => {
      const v = c.assets
        .filter(a => a.owner === t.roster_id && a.pos === pos)
        .map(a => a.val)
        .sort((x, y) => y - x)
        .slice(0, k)
        .reduce((s, v) => s + v, 0)
      return [t.roster_id, v] as const
    })
    const sorted = tot.map(([, v]) => v).sort((x, y) => x - y)
    const median = sorted[Math.floor(sorted.length / 2)] || 1
    for (const [rid, v] of tot) strength.set(`${rid}:${pos}`, v / median)
  }
  const names = new Map(c.teams.map(t => [t.roster_id, t]))
  const cache = new Map<string, Demand>()
  return (a: Asset, rid: number): Demand => {
    const key = `${a.id}|${rid}`
    const hit = cache.get(key)
    if (hit) return hit
    const t = names.get(rid)
    const mode = modes.get(rid)?.mode ?? 'middle'
    let m = 1
    const parts: Demand['parts'] = []
    const pct = (x: number) => `${x > 1 ? '+' : '−'}${Math.round(Math.abs(x - 1) * 100)}%`
    const add = (x: number, text: string) => {
      m *= x
      parts.push({ text: `${text} (${pct(x)})`, x })
    }
    const nm = t?.name ?? 'They'
    if (a.kind === 'pick') {
      if (mode === 'contend') add(DEMAND.contendPick, `${nm} is contending: picks score nothing for them this year`)
      if (mode === 'rebuild') add(DEMAND.rebuildPick, `${nm} is rebuilding: picks are what they want`)
    } else {
      const vet = a.age != null && a.age >= (VET_AGE[a.pos] ?? 99)
      const young = a.age != null && a.age <= YOUTH_AGE
      if (mode === 'contend' && vet) add(DEMAND.contendVet, `${nm} is contending: veterans are worth more to them`)
      if (mode === 'rebuild' && vet) add(DEMAND.rebuildVet, `${nm} is rebuilding: veterans are worth less to them`)
      if (mode === 'rebuild' && young) add(DEMAND.rebuildYouth, `${nm} is rebuilding: young players are worth more to them`)
      const st = strength.get(`${rid}:${a.pos}`)
      if (st != null && st < THIN) add(DEMAND.thin, `${nm} is thin at ${a.pos}`)
      else if (st != null && st > STACKED) add(DEMAND.stacked, `${nm} is already stacked at ${a.pos}`)
      const hole = mode !== 'rebuild' && t?.holes.find(h => h.pos === a.pos && h.name !== a.name)
      if (hole) add(DEMAND.hole, `${nm} is without ${hole.name} (${hole.status}) this week`)
    }
    const out = { mult: Math.min(1 + DEMAND_CAP, Math.max(1 - DEMAND_CAP, m)), why: parts.map(q => q.text), parts }
    cache.set(key, out)
    return out
  }
}

export type Ideas = { mode: Mode; sells: Idea[]; buys: Idea[] }

export function buildIdeas(c: StrategyCtx, limit = 8): Ideas {
  const held = (a: Asset) => !!heldPick(a, c.me, c.nextSeason)
  const mine = c.assets.filter(a => a.owner === c.me && mineOf(a) > 0)
  const demand = demandModel(c)
  const params = (t: StrategyTeam): EvalParams => ({
    gamma: c.gamma,
    spotCost: c.spotCost,
    meFull: !!c.teams.find(x => x.roster_id === c.me)?.full,
    themFull: t.full,
    demand: a => demand(a, t.roster_id).mult,
  })
  const partners = c.teams.filter(t => t.roster_id !== c.me)
  const depthNote = (d: IdeaDeal) =>
    c.phase === 'inSeason' && c.mode === 'contend' && d.give.length > d.get.length
      ? ['Thins your depth: it takes more depth than it looks to get through a season.']
      : []

  // Sell: each asset you'd move, shopped alone to every partner; you take nothing you'd avoid.
  const sells: Array<Idea & { score: number }> = []
  for (const a of mine) {
    if (held(a)) continue
    const reasons = sellReasons(a, c)
    if (!reasons.length) continue
    let best: (Idea & { score: number }) | null = null
    for (const t of partners) {
      const pool = c.assets.filter(x => x.owner === t.roster_id && !avoid(x, c.mode))
      const cands = findPackages([a], pool, params(t), 40).map(p => ({ ...p, partner: t.roster_id, give: [a] }))
      const as = askSettle(cands, c.gamma)
      if (!as) continue
      // Only what makes them pay more is a reason to sell to them.
      const partnerWhy = demand(a, t.roster_id).parts.filter(q => q.x > 1).map(q => q.text)
      const wantsPicks = c.mode === 'rebuild' && as.ask.get.some(g => g.kind === 'pick')
      const score = as.ask.verdict.em + (wantsPicks ? PICKS_BONUS : 0)
      if (!best || score > best.score) best = { kind: 'sell', asset: a, reasons, ...as, partnerWhy, notes: depthNote(as.ask), score }
    }
    if (best) sells.push(best)
  }

  // Buy: each target worth chasing, paid for out of what you can give.
  const givePool = mine.filter(a => !held(a))
  const buys: Array<Idea & { score: number }> = []
  for (const t of partners) {
    for (const a of c.assets) {
      if (a.owner !== t.roster_id || avoid(a, c.mode)) continue
      const reasons = buyReasons(a, c)
      if (!reasons.length) continue
      const cands = findGives([a], givePool, params(t), 40).map(p => ({ ...p, partner: t.roster_id }))
      const as = askSettle(cands, c.gamma)
      if (!as) continue
      buys.push({ kind: 'buy', asset: a, reasons, ...as, partnerWhy: demand(a, t.roster_id).parts.filter(q => q.x < 1).map(q => q.text), notes: depthNote(as.ask), score: as.ask.verdict.em })
    }
  }

  const top = (xs: Array<Idea & { score: number }>) => xs.sort((x, y) => y.score - x.score).slice(0, limit).map(({ score: _, ...i }) => i)
  return { mode: c.mode, sells: top(sells), buys: top(buys) }
}

/** Per position, the PPG rank a weekly starter clears in this league: teams × (slots + flex share). */
export function starterLine(positions: string[], teams: number): Record<string, number> {
  const share: Record<string, Record<string, number>> = {
    QB: { QB: 1 },
    RB: { RB: 1 },
    WR: { WR: 1 },
    TE: { TE: 1 },
    FLEX: { RB: 0.4, WR: 0.5, TE: 0.1 },
    WRRB_FLEX: { RB: 0.5, WR: 0.5 },
    REC_FLEX: { WR: 0.7, TE: 0.3 },
    SUPER_FLEX: { QB: 0.9, RB: 0.04, WR: 0.05, TE: 0.01 },
  }
  const n: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 }
  for (const p of positions) for (const [pos, s] of Object.entries(share[p] ?? {})) n[pos] += s
  return Object.fromEntries(Object.entries(n).map(([pos, k]) => [pos, Math.round(k * teams)]))
}
