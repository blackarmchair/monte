// League Overview data: every roster valued off the user's rankings workbook, plus pick
// ownership for the next three drafts and the best free agents. Ranks/tiers are derived in the
// renderer, where the pick-odds sim result is available to price picks and rate starters.
import { fileName } from './paths'
import type { Book } from './xlsx'
import { FUTURE_DISCOUNT, findBoard, matchBoard, rookieCurve, UNRANKED, userAvatar, type Meta } from './values'
import type { OverviewData, OvPick, OvPlayer } from './types'

const SKILL = new Set(['QB', 'RB', 'WR', 'TE'])

export async function buildOverview(opts: {
  book: Book
  league: any
  rosters: any[]
  users: any[]
  traded: any[]
  meta: Meta
}): Promise<OverviewData> {
  const { league, rosters, users, traded, meta } = opts
  const { wb, modifiedAt } = opts.book
  const board = findBoard(wb)

  const rostered = new Set<string>(rosters.flatMap(r => r.players ?? []))
  const { values, unmatched } = matchBoard(board, meta, rostered)

  const player = (id: string, r?: any): OvPlayer | null => {
    const p = meta[id]
    if (!p) return null
    const pos = SKILL.has(p.position) ? p.position : (p.fantasy_positions ?? []).find((f: string) => SKILL.has(f))
    if (!pos) return null
    const v = values.get(id)
    return {
      id,
      name: p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
      pos,
      team: p.team ?? 'FA',
      age: typeof p.age === 'number' ? p.age : null,
      rank: v?.rank ?? null,
      // Whole numbers per player, as Dynasty Daddy stores them, so position totals match DD's.
      value: v ? Math.round(v.value) : UNRANKED,
      starter: !!r?.starters?.includes(id),
      taxi: !!r?.taxi?.includes(id),
      ir: !!r?.reserve?.includes(id),
      injury: p.injury_status ?? '',
    }
  }

  const userOf = new Map(users.map(u => [u.user_id, u]))
  const teams = rosters.map(r => {
    const u = userOf.get(r.owner_id)
    return {
      roster_id: r.roster_id,
      display_name: u?.display_name ?? `Roster ${r.roster_id}`,
      team_name: u?.metadata?.team_name || u?.display_name || `Roster ${r.roster_id}`,
      avatar: userAvatar(u),
      wins: Number(r.settings?.wins ?? 0),
      losses: Number(r.settings?.losses ?? 0),
      ties: Number(r.settings?.ties ?? 0),
      pf: Number(r.settings?.fpts ?? 0) + Number(r.settings?.fpts_decimal ?? 0) / 100,
      players: (r.players ?? [])
        .map((id: string) => player(id, r))
        .filter((p: OvPlayer | null): p is OvPlayer => !!p)
        .sort((a: OvPlayer, b: OvPlayer) => b.value - a.value),
    }
  })

  // Pick ownership for the next three drafts (Sleeper tracks traded picks that far out).
  const season = Number(league.season)
  const first = league.status === 'pre_draft' ? season : season + 1
  const rounds = Number(league.settings?.draft_rounds) || 3
  const owner = new Map<string, number>()
  for (let s = first; s < first + 3; s++)
    for (const r of rosters) for (let rd = 1; rd <= rounds; rd++) owner.set(`${s}:${rd}:${r.roster_id}`, r.roster_id)
  for (const t of traded) {
    const k = `${t.season}:${t.round}:${t.roster_id}`
    if (owner.has(k)) owner.set(k, t.owner_id)
  }
  const picks: OvPick[] = [...owner.entries()].map(([k, o]) => {
    const [s, rd, orig] = k.split(':')
    return { season: s, round: Number(rd), originalRosterId: Number(orig), ownerRosterId: o }
  })

  // Free agents: ranked players on no roster, best first.
  const freeAgents: OverviewData['freeAgents'] = { QB: [], RB: [], WR: [], TE: [] }
  for (const [id] of [...values.entries()].sort((a, b) => b[1].value - a[1].value)) {
    if (rostered.has(id) || !meta[id]?.active) continue
    const p = player(id)
    if (p && freeAgents[p.pos].length < 5) freeAgents[p.pos].push(p)
  }

  return {
    sheet: {
      name: fileName(opts.book.path),
      tab: board.tab,
      column: board.column,
      modifiedAt,
      ranked: values.size,
      unmatched,
    },
    season: String(first),
    teams,
    picks,
    freeAgents,
    pickCurve: rookieCurve(values, meta),
    // Index 0 is the NEXT draft, in season too, the same as the Trade screen's pick prices (see
    // trades.ts): a 2027 pick during the 2026 season is worth its class, not a year-out discount.
    discount: FUTURE_DISCOUNT.concat(Array(3).fill(FUTURE_DISCOUNT[FUTURE_DISCOUNT.length - 1])),
    builtAt: new Date().toISOString(),
  }
}
