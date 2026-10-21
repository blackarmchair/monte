// The Ranks tab: Tyler's superflex boards shown as he ranks them, each row matched to Sleeper so
// the view can show team, age and who rosters the player in this league. No values or model.
import { fileName } from './paths'
import type { Book } from './xlsx'
import { boardIsTep, findBoards, rowMatcher, userAvatar, type Meta } from './values'
import type { RankRow, RanksData } from './types'

export async function buildRanks(opts: {
  book: Book
  league: any
  rosters: any[]
  users: any[]
  meta: Meta
  userId: string
}): Promise<RanksData> {
  const { league, rosters, users, meta } = opts
  const { wb, modifiedAt } = opts.book
  const boards = findBoards(wb)

  const rostered = new Set<string>(rosters.flatMap(r => r.players ?? []))
  const ownerOf = new Map<string, number>()
  for (const r of rosters) for (const id of r.players ?? []) ownerOf.set(id, r.roster_id)
  const idFor = rowMatcher(meta, rostered)

  const userOf = new Map(users.map(u => [u.user_id, u]))
  return {
    sheet: { name: fileName(opts.book.path), tab: boards[0].tab, modifiedAt },
    boards: boards.map(b => {
      const seen = new Map<string, number>()
      const rows: RankRow[] = b.rows.map(row => {
        const posRank = (seen.get(row.pos) ?? 0) + 1
        seen.set(row.pos, posRank)
        const id = idFor(row)
        const p = id ? meta[id] : undefined
        return {
          rank: row.rank,
          name: row.name,
          pos: row.pos,
          posRank,
          id,
          team: p?.team ?? (id ? 'FA' : ''),
          age: typeof p?.age === 'number' ? p.age : null,
          owner: id ? ownerOf.get(id) ?? null : null,
          injury: p?.injury_status ?? '',
        }
      })
      return { label: b.column, tep: boardIsTep(b), rows }
    }),
    teams: rosters.map(r => {
      const u = userOf.get(r.owner_id)
      return {
        roster_id: r.roster_id,
        name: u?.metadata?.team_name || u?.display_name || `Roster ${r.roster_id}`,
        avatar: userAvatar(u),
      }
    }),
    myRosterId: rosters.find(r => r.owner_id === opts.userId)?.roster_id ?? null,
    tePremium: Number(league?.scoring_settings?.bonus_rec_te ?? 0),
    builtAt: new Date().toISOString(),
  }
}
