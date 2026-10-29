// Weekly start/sit, a port of reference/start_sit.py. It reads Tyler's weekly position boards
// from the user's workbook and optimizes the user's actual Sleeper roster.
//
// Dynasty value is a price, not a forecast, so nothing here touches it. Tyler's boards rank
// within a position; a FLEX or SUPER_FLEX slot asks a cross-position question ordinals cannot
// answer, so each positional rank is mapped to the PPG the Nth-best player at that position
// posted LAST season, rescored into this league's rules. That curve is the shape of positional
// scarcity, not a forecast of a named player: ordering is the signal, totals are approximate.
//
// The property everything rests on: Tyler OMITS players who cannot play. The board is the
// availability list, so no injury multiplier is invented. Sleeper's tag is kept only to
// CONTRADICT him (news that landed after he published), and a contradiction is surfaced, not
// silently resolved.
import { fileName } from './paths'
import type { Workbook } from './xlsx'
import { norm, type Meta } from './values'
import type { SSChange, SSMove, SSPlayer, SSSlot, StartSitData } from './types'

const SKILL = ['QB', 'RB', 'WR', 'TE'] as const
const SMOOTH = 5 // centred rolling mean over the realized-PPG curve
const MIN_GP = 8 // games played to enter the curve
const TAIL_DECAY = 0.9 // per-rank decay once a rank runs off the end of the curve
const UNRANKED_PAD = 8 // an unranked player is priced this far past his position's last name
export const MIN_GAIN = 1 // a net gain under this is "nothing to do"
export const MARGINAL = 3 // a single swap under this is inside the model's resolution

const ELIG: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
}
const LABEL: Record<string, string> = { SUPER_FLEX: 'SF', WRRB_FLEX: 'W/R', REC_FLEX: 'W/T' }
// Fill order: dedicated slots, then the narrow flexes, then FLEX, then SUPER_FLEX. Eligibility
// is nested, which makes greedy-by-value exact rather than a heuristic.
const FILL_RANK: Record<string, number> = { WRRB_FLEX: 1, REC_FLEX: 1, FLEX: 2, SUPER_FLEX: 3 }

// ------------------------------------------------------------------------- boards
type Board = {
  pos: string
  week: number | null
  ranks: Map<string, number>
  matchups: Map<string, string>
  note: string
}
type Injured = Map<string, { name: string; reason: string; status: string }>

/** Which of a board's two scoring columns this league reads, found by the banner text. */
function variantCols(pos: string, banner: string[], passTd: number, rec: number): { cols: number[]; note: string } {
  const find = (re: RegExp) => banner.findIndex(b => re.test(b))
  if (pos === 'QB') {
    const four = find(/4\s*point/i)
    const six = find(/6\s*point/i)
    if (four < 0 || six < 0) throw new Error('QB board: could not find the 4pt / 6pt passing TD columns.')
    if (passTd <= 4.5) return { cols: [four], note: '4pt pass TD' }
    if (passTd >= 5.5) return { cols: [six], note: '6pt pass TD' }
    // A 5pt league sits between the two published columns. Averaging interpolates; it is not
    // a rank Tyler published, and the screen says so.
    return { cols: [four, six], note: 'average of 4pt and 6pt (this league is 5pt; neither column fits)' }
  }
  const half = find(/half\s*ppr/i)
  const full = banner.findIndex((b, i) => i !== half && /\bppr\b/i.test(b) && !/half/i.test(b))
  if (half < 0 && full < 0) return { cols: [1], note: 'single column' }
  if (rec >= 0.75 && full >= 0) return { cols: [full], note: 'full PPR' }
  return { cols: [half >= 0 ? half : full], note: half >= 0 ? 'half PPR' : 'full PPR' }
}

/** Find every weekly board by layout: a header row reading Rank / <POS> / Matchup. */
function readBoards(wb: Workbook, passTd: number, rec: number) {
  const boards = new Map<string, Board>()
  const injured: Injured = new Map()
  for (const tab of wb.sheets) {
    const g = wb.grid(tab)
    for (let h = 0; h < Math.min(6, g.length); h++) {
      const row = (g[h] ?? []).map(c => c.trim())
      const pos = row[1]?.toUpperCase()
      if (row[0]?.toLowerCase() !== 'rank' || row[2]?.toLowerCase() !== 'matchup') continue
      if (!pos || ![...SKILL, 'FLEX'].includes(pos)) continue
      const week = Number(/week\s*(\d+)/i.exec(tab)?.[1]) || null
      const prev = boards.get(pos)
      if (prev && (prev.week ?? 0) >= (week ?? 0)) break // keep the newest week if Tyler left an old tab
      // The banner (scoring variant names) sits on the first non-empty row above the header.
      let banner: string[] = []
      for (let b = h - 1; b >= 0; b--) if ((g[b] ?? []).some(c => c.trim())) { banner = (g[b] ?? []).map(c => c ?? ''); break }
      const { cols, note } = variantCols(pos, banner, passTd, rec)
      const col = (re: RegExp) => row.findIndex(c => re.test(c))
      const cInj = col(/injured/i)
      const cReason = col(/reason/i)
      const cStatus = col(/game status/i)
      const acc = new Map<string, number[]>()
      const matchups = new Map<string, string>()
      for (let r = h + 1; r < g.length; r++) {
        const cells = g[r] ?? []
        // The injured table shares rows with the ranks but is independent of them.
        if (cInj >= 0 && cells[cInj]?.trim())
          injured.set(norm(cells[cInj]), {
            name: cells[cInj].trim(),
            reason: (cells[cReason] ?? '').trim(),
            status: (cells[cStatus] ?? '').trim(),
          })
        const rank = Number.parseFloat(cells[0] ?? '')
        if (!Number.isFinite(rank)) continue
        for (const c of cols) {
          const name = (cells[c] ?? '').trim()
          if (!name) continue
          const k = norm(name)
          if (!acc.has(k)) acc.set(k, [])
          acc.get(k)!.push(rank)
          if (!matchups.has(k)) matchups.set(k, (cells[c + 1] ?? '').trim())
        }
      }
      const ranks = new Map([...acc].map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]))
      boards.set(pos, { pos, week, ranks, matchups, note })
      break
    }
  }
  const missing = SKILL.filter(p => !boards.has(p) || boards.get(p)!.ranks.size === 0)
  if (missing.length)
    throw new Error(`No weekly ${missing.join(' / ')} board found in the workbook. Re-download Tyler’s sheet as .xlsx.`)
  return { boards, injured }
}

// -------------------------------------------------------------------------- curve
export type SeasonStats = Record<string, Record<string, number>>

/** Last season's PPG at each positional rank, rescored into THIS league's rules. */
function buildCurves(stats: SeasonStats, meta: Meta, scoring: Record<string, number>) {
  const rec = scoring.rec ?? 1
  const te = scoring.bonus_rec_te ?? 0
  const passTd = scoring.pass_td ?? 4
  const byPos = new Map<string, number[]>()
  for (const [pid, s] of Object.entries(stats)) {
    const pos = meta[pid]?.position
    const gp = s.gp ?? 0
    if (!SKILL.includes(pos) || gp < MIN_GP) continue
    // Sleeper's pts_ppr is 1.0 per reception and 4pt passing TD; the rest is a delta.
    let pts = s.pts_ppr ?? 0
    pts += (rec - 1) * (s.rec ?? 0)
    if (pos === 'TE') pts += te * (s.rec ?? 0)
    if (pos === 'QB') pts += (passTd - 4) * (s.pass_td ?? 0)
    if (pts <= 0) continue
    if (!byPos.has(pos)) byPos.set(pos, [])
    byPos.get(pos)!.push(pts / gp)
  }
  const curves = new Map<string, number[]>()
  for (const [pos, v] of byPos) {
    v.sort((a, b) => b - a)
    // A rolling mean prices the NEIGHBOURHOOD of a rank, which is what a rank means; one fluke
    // season at rank 4 would otherwise open a fake gap.
    const half = Math.floor(SMOOTH / 2)
    curves.set(
      pos,
      v.map((_, i) => {
        const lo = Math.max(0, i - half)
        const hi = Math.min(v.length, i + half + 1)
        return v.slice(lo, hi).reduce((a, b) => a + b, 0) / (hi - lo)
      }),
    )
  }
  return curves
}

function ppgAt(curves: Map<string, number[]>, pos: string, rank: number): number {
  const c = curves.get(pos) ?? []
  if (!c.length) return 0
  const i = Math.round(rank) - 1
  if (i >= c.length) return c[c.length - 1] * TAIL_DECAY ** (i - c.length + 1)
  return c[Math.max(0, i)]
}

// ------------------------------------------------------------------------ lineup
/** Greedy fill over nested-eligibility slots; exact for this structure. `pinned` stays put. */
function fill(slots: string[], pool: SSPlayer[], pinned: Map<number, SSPlayer>): Array<SSPlayer | null> {
  const order = slots.map((_, i) => i).sort((a, b) => (FILL_RANK[slots[a]] ?? 0) - (FILL_RANK[slots[b]] ?? 0))
  const ranked = [...pool].sort((a, b) => b.proj - a.proj)
  const used = new Set([...pinned.values()].map(p => p.id))
  const out: Array<SSPlayer | null> = slots.map((_, i) => pinned.get(i) ?? null)
  for (const i of order) {
    if (out[i]) continue
    const pick = ranked.find(p => !used.has(p.id) && (ELIG[slots[i]] ?? []).includes(p.pos))
    if (pick) {
      used.add(pick.id)
      out[i] = pick
    }
  }
  return out
}

/**
 * Turn the optimal SET into a plan that moves as few people as possible: starters who belong
 * in the optimal lineup keep their current slot, and only the freed slots take newcomers.
 * (Without this, two players trading FLEX spots reads as two "moves", one of them negative.)
 */
function swapPlan(slots: string[], current: Array<SSPlayer | null>, best: Array<SSPlayer | null>) {
  const bestIds = new Set(best.filter(Boolean).map(p => p!.id))
  const plan: Array<SSPlayer | null> = current.map(p => (p && bestIds.has(p.id) ? p : null))
  const placed = new Set(plan.filter(Boolean).map(p => p!.id))
  const incoming = best.filter(p => p && !placed.has(p.id)) as SSPlayer[]
  incoming.sort((a, b) => b.proj - a.proj)
  for (const p of incoming) {
    const i = plan.findIndex((x, k) => !x && (ELIG[slots[k]] ?? []).includes(p.pos))
    if (i < 0) return best // no keep-in-place assignment works: fall back to the raw optimum
    plan[i] = p
  }
  return plan
}

// ------------------------------------------------------------------------- build
export function buildStartSit(o: {
  wb: Workbook
  sheetPath: string
  modifiedAt: string
  league: any
  rosters: any[]
  users: any[]
  matchups: any[]
  schedule: Record<string, Record<number, string>>
  stats: SeasonStats
  meta: Meta
  userId: string
  week: number
  /** manual injury overrides by Sleeper id: return week, 99 = out for the season */
  overrides: Record<string, number>
}): StartSitData {
  const scoring = o.league.scoring_settings ?? {}
  const passTd = Number(scoring.pass_td ?? 4)
  const rec = Number(scoring.rec ?? 1)
  const { boards, injured } = readBoards(o.wb, passTd, rec)
  const curves = buildCurves(o.stats, o.meta, scoring)
  const warnings: string[] = []

  const boardWeek = boards.get('QB')!.week
  if (boardWeek != null && boardWeek !== o.week)
    warnings.push(
      boardWeek < o.week
        ? `Tyler’s boards in this file are for week ${boardWeek}, but it is week ${o.week}. Re-download the sheet for this week’s ranks.`
        : `Tyler’s boards are already for week ${boardWeek}; Sleeper still shows week ${o.week}.`,
    )
  if (!curves.size) warnings.push('Last season’s stats were unavailable, so projections are flat and only rank order is meaningful.')
  const flex = boards.get('FLEX')
  if (!flex || flex.ranks.size === 0) warnings.push('Tyler hasn’t filled this week’s Flex board yet; FLEX ordering rests on the curve alone.')
  // Byes and locks always follow Sleeper's week; a stale board is a warning, not a different week.
  const week = o.week

  const player = (id: string, where: 'starter' | 'bench' | 'taxi' | 'ir'): SSPlayer | null => {
    const m = o.meta[id]
    if (!m) return null
    const pos = m.position
    const name = m.full_name ?? `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim()
    const team = m.team ?? ''
    const k = norm(name)
    const board = boards.get(pos)
    const rank = board?.ranks.get(k) ?? null
    const depth = board?.ranks.size ?? 0
    const status = o.schedule[team]?.[week]
    const locked = !!status && status !== 'pre_game'
    const tyler = injured.get(k)
    const sleeperTag = String(m.injury_status ?? '')
    const sleeperOut = /^(out|ir|pup|sus|doubtful|na)$/i.test(sleeperTag)

    let startable = true
    let flag = ''
    let conflict: string | null = null
    if (!SKILL.includes(pos)) [startable, flag] = [false, 'not ranked by Tyler']
    else if (where === 'taxi') [startable, flag] = [false, 'Taxi']
    else if (where === 'ir') [startable, flag] = [false, 'IR']
    else if (!team) [startable, flag] = [false, 'No NFL team']
    else if (!o.schedule[team]?.[week]) [startable, flag] = [false, 'Bye']
    // A manual override is the user's own newer information, so it outranks Tyler's board.
    else if (o.overrides[id] != null && week < o.overrides[id])
      [startable, flag] = [false, o.overrides[id] >= 99 ? 'Out for season (manual)' : `Out until wk ${o.overrides[id]} (manual)`]
    else if (tyler && rank == null) [startable, flag] = [false, `${tyler.status || 'Out'} — ${tyler.reason || 'injury'} (Tyler)`]
    else if (tyler) flag = `${tyler.status || 'Listed'} — ${tyler.reason || 'injury'} (Tyler)`
    else if (rank == null) conflict = sleeperTag ? `Sleeper tags him ${sleeperTag} and he isn’t on Tyler’s board` : null
    else if (sleeperOut)
      conflict = `Tyler ranks him ${pos}${Math.round(rank)}, but Sleeper now tags him ${sleeperTag}. A tag that landed after the board was published is the newer fact — check it.`
    else if (sleeperTag) flag = sleeperTag

    return {
      id,
      name,
      pos,
      team: team || 'FA',
      matchup: board?.matchups.get(k) ?? '',
      rank,
      rankLabel: rank != null ? `${pos}${Math.round(rank)}` : `${pos}—`,
      flexRank: flex?.ranks.get(k) ?? null,
      proj: SKILL.includes(pos) ? ppgAt(curves, pos, rank ?? depth + UNRANKED_PAD) : 0,
      startable,
      flag,
      conflict,
      locked,
    }
  }

  const me = o.rosters.find(r => r.owner_id === o.userId || (r.co_owners ?? []).includes(o.userId))
  if (!me) throw new Error('You don’t have a roster in this league.')
  const positions: string[] = (o.league.roster_positions ?? []).filter((p: string) => !['BN', 'IR', 'TAXI'].includes(p))
  // The matchup leg is the lineup that plays and the one Sleeper's app writes; the roster's
  // `starters` can lag behind it (see sleeperLineup), so it is only the fallback.
  const mine = o.matchups.find(m => m.roster_id === me.roster_id)
  const starterIds: string[] = mine?.starters?.length ? mine.starters : me.starters ?? []
  const taxi = new Set<string>(me.taxi ?? [])
  const ir = new Set<string>(me.reserve ?? [])
  const all = new Map<string, SSPlayer>()
  for (const id of me.players ?? []) {
    const p = player(id, ir.has(id) ? 'ir' : taxi.has(id) ? 'taxi' : starterIds.includes(id) ? 'starter' : 'bench')
    if (p) all.set(id, p)
  }
  const current = positions.map((_, i) => (starterIds[i] && starterIds[i] !== '0' ? all.get(starterIds[i]) ?? null : null))

  // Pinned: a started game, or a slot type Monte doesn't rank (K, DEF, IDP) — leave it alone.
  const pinned = new Map<number, SSPlayer>()
  positions.forEach((slot, i) => {
    const p = current[i]
    if (p && (p.locked || !ELIG[slot])) pinned.set(i, p)
  })
  const pool = [...all.values()].filter(p => p.startable && !p.locked && ![...pinned.values()].some(x => x.id === p.id))
  const optimal = fill(positions, pool, pinned)
  const sum = (xs: Array<SSPlayer | null>) => xs.reduce((s, p) => s + (p && p.startable ? p.proj : 0), 0)
  const cur = sum(current)
  const planned = swapPlan(positions, current, optimal)
  const opt = sum(planned)
  // Under MIN_GAIN the curve can't tell the lineups apart, so the plan is "leave it".
  const best = opt - cur >= MIN_GAIN ? planned : current

  const slots: SSSlot[] = positions.map((slot, i) => ({
    slot,
    label: LABEL[slot] ?? slot,
    current: current[i],
    best: best[i],
    locked: !!current[i]?.locked,
    supported: !!ELIG[slot],
  }))
  // Changes are a SET difference, not slot-by-slot: when the plan has to shuffle a starter
  // (Allen FLEX -> RB so Egbuka fits FLEX), a per-slot diff reads "Egbuka for Allen -2.9", which
  // is wrong and unactionable. Pair incoming with outgoing, best with worst, and list slot moves
  // separately.
  const inLineup = (xs: Array<SSPlayer | null>) => new Set(xs.filter(Boolean).map(p => p!.id))
  const curIds = inLineup(current)
  const bestIds = inLineup(best)
  const incoming = best
    .map((p, i) => ({ p, i }))
    .filter(x => x.p && !curIds.has(x.p.id))
    .sort((a, b) => b.p!.proj - a.p!.proj)
  const outgoing = current
    .filter(p => p && !bestIds.has(p.id))
    .sort((a, b) => (a!.startable ? a!.proj : 0) - (b!.startable ? b!.proj : 0)) as SSPlayer[]
  // Pair each incoming player with an outgoing one at his own position first (a QB replaces a
  // QB), then the weakest remaining. Rank-order pairing alone mislabels ties: with two zeros
  // out, it once printed "Egbuka for Daniels" when Sanders was the QB replacing Daniels.
  const left = [...outgoing]
  const pairs = incoming.map(x => ({ ...x, out: null as SSPlayer | null }))
  for (const x of pairs) {
    const k = left.findIndex(o => o.pos === x.p!.pos)
    if (k >= 0) x.out = left.splice(k, 1)[0]
  }
  for (const x of pairs) if (!x.out) x.out = left.shift() ?? null
  const changes: SSChange[] = pairs.map(({ p, i, out }) => {
    const gain = p!.proj - (out && out.startable ? out.proj : 0)
    return { slot: positions[i], label: LABEL[positions[i]] ?? positions[i], inPlayer: p!, outPlayer: out, gain, marginal: gain < MARGINAL }
  })
  const moves: SSMove[] = []
  current.forEach((p, i) => {
    if (!p || !bestIds.has(p.id) || best[i]?.id === p.id) return
    const to = best.findIndex(x => x?.id === p.id)
    moves.push({ player: p, from: LABEL[positions[i]] ?? positions[i], to: LABEL[positions[to]] ?? positions[to] })
  })
  // Bench is relative to the lineup Sleeper has now, which the screens draw from `current`. Leaving
  // out the BEST lineup instead dropped every benched player the plan wants to start off both lists.
  const bench = [...all.values()].filter(p => !curIds.has(p.id)).sort((a, b) => Number(b.startable) - Number(a.startable) || b.proj - a.proj)

  // Opponent's projection from the lineup they actually have set, priced the same way.
  // No matchup_id is no game this week (a playoff bye, or out of the playoffs). It must not pair
  // with the other rosters that have none.
  let opponent: StartSitData['opponent'] = null
  const theirs = mine?.matchup_id != null && o.matchups.find(m => m.matchup_id === mine.matchup_id && m.roster_id !== me.roster_id)
  if (mine && mine.matchup_id == null) warnings.push('You have no game this week (a playoff bye, or out of the playoffs), so there’s no opponent to beat.')
  if (theirs) {
    const r = o.rosters.find(x => x.roster_id === theirs.roster_id)
    const u = o.users.find(x => x.user_id === r?.owner_id)
    const total = ((theirs.starters?.length ? theirs.starters : r?.starters) ?? [])
      .filter((id: string) => id && id !== '0')
      .map((id: string) => player(id, 'starter'))
      .reduce((s: number, p: SSPlayer | null) => s + (p && p.startable ? p.proj : 0), 0)
    opponent = { name: (u?.metadata?.team_name || u?.display_name || `Roster ${theirs.roster_id}`).trim(), total, rosterId: theirs.roster_id }
  }

  // A Tyler/Sleeper disagreement only matters for someone who is, or would be, in the lineup;
  // deep-bench noise ("Sleeper tags him Q and Tyler doesn't rank him") is left on the row.
  const relevant = new Set([...curIds, ...bestIds])
  const conflicts = [...all.values()].filter(p => p.conflict && relevant.has(p.id))
  if (conflicts.length) warnings.push(...conflicts.map(p => `${p.name}: ${p.conflict}`))
  const columns = Object.fromEntries([...boards.values()].map(b => [b.pos, b.note]))

  return {
    week,
    rosterId: me.roster_id,
    starters: positions.map((_, i) => (starterIds[i] ? String(starterIds[i]) : '0')),
    boardWeek,
    sheet: { name: fileName(o.sheetPath), modifiedAt: o.modifiedAt },
    columns,
    slots,
    bench,
    changes,
    moves,
    totals: { current: cur, best: opt },
    gain: opt - cur,
    minGain: MIN_GAIN,
    opponent,
    warnings,
    leagueUrl: `https://sleeper.com/leagues/${o.league.league_id}/team`,
    builtAt: new Date().toISOString(),
  }
}
