// Trade data for one league: every rostered player valued on the sheet and on the market, plus
// what the renderer needs to price picks over the sim's slot odds. Scoring and searching happen
// in the renderer (tradeMath.ts) so building a trade re-scores instantly.
import { fileName } from './paths'
import type { Workbook } from './xlsx'
import { FUTURE_DISCOUNT, findBoard, matchBoard, rowMatcher, type Meta } from './values'
import {
  SHEET_SCORING,
  gammaFor,
  scoringAdj,
  spotCostFor,
  value,
  type Asset,
  type PickInputs,
} from './tradeMath'
import type { TradeData } from './types'
import { starterLine, type Phase } from './strategy'

const SKILL = ['QB', 'RB', 'WR', 'TE']
/** A starter with one of these statuses leaves his team a hole this week. */
const HOLE_STATUS = new Set(['IR', 'PUP', 'NFI', 'Out', 'Doubtful', 'Sus'])
/** Games before a player gets a PPG rank. */
const MIN_GP = 2

/** Positional PPG rank (PPR) for every skill player with MIN_GP games this season. */
function ppgRanks(stats: Record<string, Record<string, number>>, meta: Meta): Map<string, number> {
  const by = new Map<string, Array<{ id: string; ppg: number }>>()
  for (const [id, s] of Object.entries(stats)) {
    const pos = meta[id]?.position
    if (!SKILL.includes(pos) || (s.gp ?? 0) < MIN_GP) continue
    if (!by.has(pos)) by.set(pos, [])
    by.get(pos)!.push({ id, ppg: (s.pts_ppr ?? 0) / s.gp })
  }
  const out = new Map<string, number>()
  for (const xs of by.values()) xs.sort((a, b) => b.ppg - a.ppg).forEach((x, i) => out.set(x.id, i + 1))
  return out
}

/** One market row, from either source. `sleeperId` when the source has it (FantasyCalc);
 *  KeepTradeCut rows are matched to Sleeper by name, the same way as Tyler's board. */
export type MarketRow = { name: string; pos: string; value: number; sleeperId?: string; trend?: number }
export type Market = { source: 'KeepTradeCut' | 'FantasyCalc'; rows: MarketRow[]; asOf: string | null; stale: boolean; scoring: { te: number; passTd: number } }

export type FcRow = { player?: { name?: string; position?: string; sleeperId?: string }; value?: number; overallRank?: number }
export const fromFantasyCalc = (rows: FcRow[]): MarketRow[] =>
  rows
    .filter(r => r.value != null)
    .map(r => ({ name: r.player?.name ?? '', pos: r.player?.position ?? '', value: r.value!, sleeperId: r.player?.sleeperId ? String(r.player.sleeperId) : undefined }))

/**
 * Market rows -> players-only ranks, by value. Monte's player values are on a players-only scale,
 * so each pick is given "players ahead of it + ½" on that scale rather than its overall rank.
 */
export function marketRanks(rows: MarketRow[], idFor: (r: MarketRow) => string | null) {
  const sorted = [...rows].sort((a, b) => b.value - a.value)
  const players = new Map<string, { rank: number; pos: string; trend: number | null }>()
  const picks = new Map<string, number>()
  let n = 0
  for (const r of sorted) {
    if (r.pos === 'PICK' || r.pos === 'RDP') {
      picks.set(r.name, n + 0.5)
      continue
    }
    const id = idFor(r)
    // A player matched twice (two rows, one Sleeper id) keeps the higher rank.
    if (!id || players.has(id)) continue
    n += 1
    players.set(id, { rank: n, pos: r.pos, trend: r.trend ?? null })
  }
  return { players, picks }
}

const TRANCHES = ['early', 'mid', 'late']
/** "2027 1st (Early)" (FantasyCalc) or "2027 Early 1st" (KeepTradeCut) -> "2027:1:early";
 *  "2028 2nd" -> "2028:2". */
export function pickKey(name: string): string | null {
  const t = name.trim()
  const fc = /^(\d{4}) (\d)(?:st|nd|rd|th)(?: \((Early|Mid|Late)\))?$/.exec(t)
  if (fc) return fc[3] ? `${fc[1]}:${fc[2]}:${fc[3].toLowerCase()}` : `${fc[1]}:${fc[2]}`
  const ktc = /^(\d{4}) (Early|Mid|Late) (\d)(?:st|nd|rd|th)$/.exec(t)
  return ktc ? `${ktc[1]}:${ktc[3]}:${ktc[2].toLowerCase()}` : null
}

/** Pick values by key. A round priced only by tranche (KeepTradeCut) also gets the round
 *  average, which is what a later draft or an unsimulated slot is priced at. */
export function pickMarket(picks: Map<string, number>): Record<string, number> {
  const market: Record<string, number> = {}
  for (const [name, rank] of picks) {
    const key = pickKey(name)
    if (key) market[key] = value(rank)
  }
  const rounds = new Set(Object.keys(market).filter(k => k.split(':').length === 3).map(k => k.split(':').slice(0, 2).join(':')))
  for (const r of rounds) {
    if (market[r] != null) continue
    const xs = TRANCHES.map(t => market[`${r}:${t}`]).filter((v): v is number => v != null)
    if (xs.length === TRANCHES.length) market[r] = xs.reduce((a, b) => a + b, 0) / xs.length
  }
  return market
}

export function buildTrades(o: {
  wb: Workbook
  sheetPath: string
  modifiedAt: string
  league: any
  rosters: any[]
  users: any[]
  traded: any[]
  meta: Meta
  market: Market
  /** this season's stats so far (in season), for PPG ranks */
  stats?: Record<string, Record<string, number>>
  beta: number
  userId: string
}): TradeData {
  const scoring = o.league.scoring_settings ?? {}
  const lg = { te: Number(scoring.bonus_rec_te ?? 0), passTd: Number(scoring.pass_td ?? 4) }
  const positions: string[] = o.league.roster_positions ?? []
  const shape = {
    nStart: positions.filter(p => !['BN', 'IR', 'TAXI'].includes(p)).length,
    rosterCap: positions.filter(p => !['IR', 'TAXI'].includes(p)).length,
  }
  const board = findBoard(o.wb)
  const rostered = new Set<string>(o.rosters.flatMap(r => r.players ?? []))
  const { values } = matchBoard(board, o.meta, rostered)
  const byName = rowMatcher(o.meta, rostered)
  const { players: mkPlayers, picks: mkPicks } = marketRanks(o.market.rows, r => r.sleeperId ?? byName({ rank: 0, name: r.name, pos: r.pos }))

  const sheetOf = (id: string, pos: string) => {
    const v = values.get(id)
    // Position guard (dynasty_model.pinfo): a name match to a different skill position is a
    // collision, not the player.
    const sheetPos = board.rows.find(r => r.rank === v?.rank)?.pos
    if (!v || (sheetPos && SKILL.includes(sheetPos) && sheetPos !== pos)) return { rank: null, sheet: 0 }
    return { rank: v.rank, sheet: scoringAdj(pos, value(v.rank), SHEET_SCORING, lg) }
  }
  const marketOf = (id: string, pos: string) => {
    const m = mkPlayers.get(id)
    if (!m || (SKILL.includes(m.pos) && m.pos !== pos)) return null
    return scoringAdj(pos, value(m.rank), o.market.scoring, lg)
  }

  const ppgRank = ppgRanks(o.stats ?? {}, o.meta)
  const assets: Asset[] = []
  const ranks: Record<string, { sheetRank: number | null; marketRank: number | null }> = {}
  const toAsset = (id: string, owner: number): Asset | null => {
    const m = o.meta[id]
    const pos = SKILL.includes(m?.position) ? m.position : (m?.fantasy_positions ?? []).find((f: string) => SKILL.includes(f))
    if (!m || !pos) return null
    const { rank, sheet } = sheetOf(id, pos)
    const market = marketOf(id, pos)
    const val = market == null ? sheet : sheet + o.beta * (market - sheet)
    ranks[id] = { sheetRank: rank, marketRank: mkPlayers.get(id)?.rank ?? null }
    return {
      id,
      kind: 'player',
      name: m.full_name ?? `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim(),
      pos,
      team: m.team ?? 'FA',
      age: typeof m.age === 'number' ? m.age : null,
      owner,
      sheet,
      val,
      market,
      injury: m.injury_status || null,
      yearsExp: typeof m.years_exp === 'number' ? m.years_exp : null,
      trend: mkPlayers.get(id)?.trend ?? null,
      ppgRank: ppgRank.get(id) ?? null,
    }
  }
  for (const r of o.rosters)
    for (const id of r.players ?? []) {
      const a = toAsset(id, r.roster_id)
      if (a) assets.push(a)
    }
  // Everyone else Tyler or the market prices, for the Vacuum tab: owner 0, on no roster.
  const freeAgents = [...new Set([...values.keys(), ...mkPlayers.keys()])]
    .filter(id => !rostered.has(id))
    .map(id => toAsset(id, 0))
    .filter((a): a is Asset => !!a && (a.sheet > 0 || a.market != null))

  // Picks: ownership for the next three drafts; values are priced in the renderer.
  const season = Number(o.league.season)
  const first = o.league.status === 'pre_draft' ? season : season + 1
  const rounds = Number(o.league.settings?.draft_rounds) || 3
  const owner = new Map<string, number>()
  for (let s = first; s < first + 3; s++)
    for (const r of o.rosters) for (let rd = 1; rd <= rounds; rd++) owner.set(`${s}:${rd}:${r.roster_id}`, r.roster_id)
  for (const t of o.traded) {
    const k = `${t.season}:${t.round}:${t.roster_id}`
    if (owner.has(k)) owner.set(k, t.owner_id)
  }
  const picks = [...owner.entries()].map(([k, own]) => {
    const [s, rd, orig] = k.split(':')
    return { season: s, round: Number(rd), originalOwner: Number(orig), owner: own }
  })

  const market = pickMarket(mkPicks)
  const pickInputs: PickInputs = {
    season: String(first),
    teams: o.rosters.length,
    // The same class-valued curve as the Overview, translated into this league's scoring.
    sheetCurve: [...values.entries()]
      .filter(([id]) => Number(o.meta[id]?.years_exp) === 0)
      .map(([id, v]) => scoringAdj(o.meta[id]?.position ?? '', value(v.rank), SHEET_SCORING, lg))
      .sort((a, b) => b - a),
    // Index 0 is the NEXT draft, in season too: a 2027 pick during the 2026 season is worth its class,
    // not a year-out discount of it. Backtested against Tyler's #dynasty-trade-questions answers
    // (2026-08..10): discounting it to 0.72 was the largest single source of misses, all of them
    // Tyler taking the pick side.
    discount: FUTURE_DISCOUNT.concat(Array(3).fill(FUTURE_DISCOUNT[FUTURE_DISCOUNT.length - 1])),
    market,
  }

  // Each team's starters out this week: its top players at a position, as many as the league starts.
  const slots: Record<string, number> = {}
  for (const p of positions) if (SKILL.includes(p)) slots[p] = (slots[p] ?? 0) + 1
  const holesOf = (rid: number) =>
    SKILL.flatMap(pos =>
      assets
        .filter(a => a.owner === rid && a.pos === pos)
        .sort((a, b) => b.sheet - a.sheet)
        .slice(0, slots[pos] ?? 0)
        .filter(a => a.injury && HOLE_STATUS.has(a.injury))
        .map(a => ({ pos, name: a.name, status: a.injury! })),
    )
  const phase: Phase = o.league.status === 'in_season' ? 'inSeason' : o.league.status === 'drafting' ? 'drafting' : 'offseason'

  const active = (r: any) => (r.players ?? []).length - (r.taxi ?? []).length - (r.reserve ?? []).length
  const userOf = new Map(o.users.map(u => [u.user_id, u]))
  const me = o.rosters.find(r => r.owner_id === o.userId || (r.co_owners ?? []).includes(o.userId))
  return {
    assets,
    freeAgents,
    ranks,
    picks,
    pickInputs,
    teams: o.rosters.map(r => {
      const u = userOf.get(r.owner_id)
      return {
        roster_id: r.roster_id,
        name: (u?.metadata?.team_name || u?.display_name || `Roster ${r.roster_id}`).trim(),
        owner: u?.display_name ?? '',
        wins: Number(r.settings?.wins ?? 0),
        losses: Number(r.settings?.losses ?? 0),
        full: active(r) >= shape.rosterCap,
        holes: holesOf(r.roster_id),
      }
    }),
    myRosterId: me?.roster_id ?? null,
    phase,
    starterLine: starterLine(positions, o.rosters.length),
    gamma: gammaFor(shape),
    spotCost: spotCostFor(shape),
    shape,
    beta: o.beta,
    sheet: { name: fileName(o.sheetPath), modifiedAt: o.modifiedAt },
    market: { source: o.market.source, asOf: o.market.asOf, stale: o.market.stale, matched: mkPlayers.size },
    builtAt: new Date().toISOString(),
  }
}
