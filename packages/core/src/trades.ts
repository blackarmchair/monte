// Trade data for one league: every rostered player valued on the sheet and on the market, plus
// what the renderer needs to price picks over the sim's slot odds. Scoring and searching happen
// in the renderer (tradeMath.ts) so building a trade re-scores instantly.
import { fileName } from './paths'
import type { Workbook } from './xlsx'
import { FUTURE_DISCOUNT, findBoard, matchBoard, type Meta } from './values'
import {
  MARKET_SCORING,
  SHEET_SCORING,
  gammaFor,
  scoringAdj,
  spotCostFor,
  value,
  type Asset,
  type PickInputs,
} from './tradeMath'
import type { TradeData } from './types'

const SKILL = ['QB', 'RB', 'WR', 'TE']

export type FcRow = { player?: { name?: string; position?: string; sleeperId?: string }; value?: number; overallRank?: number }

/**
 * FantasyCalc rows -> players-only ranks. The engine fetches WITHOUT picks, so a player's rank
 * counts players only; asking with picks shifts everyone down. One call with picks, then:
 * players ranked among players, and each pick given "players ahead of it + ½" on that scale.
 */
export function marketRanks(rows: FcRow[]) {
  const sorted = [...rows].filter(r => r.overallRank).sort((a, b) => a.overallRank! - b.overallRank!)
  const players = new Map<string, { rank: number; pos: string }>()
  const picks = new Map<string, number>()
  let n = 0
  for (const r of sorted) {
    const pl = r.player ?? {}
    if (pl.position === 'PICK') {
      picks.set(pl.name ?? '', n + 0.5)
    } else if (pl.sleeperId) {
      n += 1
      players.set(String(pl.sleeperId), { rank: n, pos: pl.position ?? '' })
    }
  }
  return { players, picks }
}

/** "2027 1st (Early)" -> "2027:1:early"; "2028 2nd" -> "2028:2". */
function pickKey(name: string): string | null {
  const m = /^(\d{4}) (\d)(?:st|nd|rd|th)(?: \((Early|Mid|Late)\))?$/.exec(name.trim())
  if (!m) return null
  return m[3] ? `${m[1]}:${m[2]}:${m[3].toLowerCase()}` : `${m[1]}:${m[2]}`
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
  fc: { rows: FcRow[]; asOf: string | null; stale: boolean }
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
  const { players: fcPlayers, picks: fcPicks } = marketRanks(o.fc.rows)

  const sheetOf = (id: string, pos: string) => {
    const v = values.get(id)
    // Position guard (dynasty_model.pinfo): a name match to a different skill position is a
    // collision, not the player.
    const sheetPos = board.rows.find(r => r.rank === v?.rank)?.pos
    if (!v || (sheetPos && SKILL.includes(sheetPos) && sheetPos !== pos)) return { rank: null, sheet: 0 }
    return { rank: v.rank, sheet: scoringAdj(pos, value(v.rank), SHEET_SCORING, lg) }
  }
  const marketOf = (id: string, pos: string) => {
    const m = fcPlayers.get(id)
    if (!m || (SKILL.includes(m.pos) && m.pos !== pos)) return null
    return scoringAdj(pos, value(m.rank), MARKET_SCORING, lg)
  }

  const assets: Asset[] = []
  const ranks: Record<string, { sheetRank: number | null; marketRank: number | null }> = {}
  for (const r of o.rosters)
    for (const id of r.players ?? []) {
      const m = o.meta[id]
      const pos = SKILL.includes(m?.position) ? m.position : (m?.fantasy_positions ?? []).find((f: string) => SKILL.includes(f))
      if (!m || !pos) continue
      const { rank, sheet } = sheetOf(id, pos)
      const market = marketOf(id, pos)
      const val = market == null ? sheet : sheet + o.beta * (market - sheet)
      ranks[id] = { sheetRank: rank, marketRank: fcPlayers.get(id)?.rank ?? null }
      assets.push({
        id,
        kind: 'player',
        name: m.full_name ?? `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim(),
        pos,
        team: m.team ?? 'FA',
        age: typeof m.age === 'number' ? m.age : null,
        owner: r.roster_id,
        sheet,
        val,
        market,
      })
    }

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

  const market: Record<string, number> = {}
  for (const [name, rank] of fcPicks) {
    const key = pickKey(name)
    if (key) market[key] = value(rank)
  }
  const pickInputs: PickInputs = {
    season: String(first),
    teams: o.rosters.length,
    // The same class-valued curve as the Overview, translated into this league's scoring.
    sheetCurve: [...values.entries()]
      .filter(([id]) => Number(o.meta[id]?.years_exp) === 0)
      .map(([id, v]) => scoringAdj(o.meta[id]?.position ?? '', value(v.rank), SHEET_SCORING, lg))
      .sort((a, b) => b - a),
    discount: FUTURE_DISCOUNT.slice(first - season).concat(Array(3).fill(FUTURE_DISCOUNT[FUTURE_DISCOUNT.length - 1])),
    market,
  }

  const active = (r: any) => (r.players ?? []).length - (r.taxi ?? []).length - (r.reserve ?? []).length
  const userOf = new Map(o.users.map(u => [u.user_id, u]))
  const me = o.rosters.find(r => r.owner_id === o.userId || (r.co_owners ?? []).includes(o.userId))
  return {
    assets,
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
      }
    }),
    myRosterId: me?.roster_id ?? null,
    gamma: gammaFor(shape),
    spotCost: spotCostFor(shape),
    shape,
    beta: o.beta,
    sheet: { name: fileName(o.sheetPath), modifiedAt: o.modifiedAt },
    market: { source: 'FantasyCalc', asOf: o.fc.asOf, stale: o.fc.stale, matched: fcPlayers.size },
    builtAt: new Date().toISOString(),
  }
}
