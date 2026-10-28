// Draft tab data: a league's Sleeper drafts, the pick order with traded picks applied, and the
// user's board valued off the rankings workbook. Live picks are polled separately (draftPicks)
// because they change every few seconds and the board does not.
//
// Replaces draftPunk. Its hand-built CSV board, name aliases and "this is me" clicking are gone:
// Sleeper picks carry player_id and roster_id, so taken players and teams match by id.
import { fileName } from './paths'
import { findBoard, matchBoard, userAvatar, type Meta } from './values'
import type { Workbook } from './xlsx'
import type { DraftData, DraftPickRow, DraftPlayer, DraftPoll, DraftSlot, DraftSummary } from './types'

const SKILL = new Set(['QB', 'RB', 'WR', 'TE'])

export function summariseDraft(d: any): DraftSummary {
  return {
    draft_id: String(d.draft_id),
    season: String(d.season ?? ''),
    status: d.status ?? 'pre_draft',
    type: d.type ?? 'snake',
    rounds: Number(d.settings?.rounds) || 0,
    teams: Number(d.settings?.teams) || Object.keys(d.draft_order ?? {}).length || 0,
    startTime: d.start_time ? Number(d.start_time) : null,
    leagueId: d.league_id ? String(d.league_id) : null,
  }
}

/** The draft worth opening first: one in progress, then the next one, then the latest finished. */
export function defaultDraft(drafts: DraftSummary[]): DraftSummary | null {
  const rank = (d: DraftSummary) => (d.status === 'drafting' || d.status === 'paused' ? 0 : d.status === 'pre_draft' ? 1 : 2)
  return [...drafts].sort((a, b) => rank(a) - rank(b) || Number(b.season) - Number(a.season) || (b.startTime ?? 0) - (a.startTime ?? 0))[0] ?? null
}

export const pickLabel = (round: number, inRound: number) => `${round}.${String(inRound).padStart(2, '0')}`

/**
 * Every pick in the draft with the roster that owns it. Slot order per round follows the draft
 * type: linear never flips, snake flips every round, and a snake's reversal_round (3rd-round
 * reversal) flips it once more from that round on. Traded picks are keyed by the ORIGINAL
 * roster, so the slot's original owner is resolved first and the trade applied on top.
 */
export function pickOrder(draft: any, rosters: any[], traded: any[]): DraftSlot[] {
  const teams = Number(draft.settings?.teams) || 0
  const rounds = Number(draft.settings?.rounds) || 0
  const reversal = Number(draft.settings?.reversal_round) || 0
  const slotRoster = new Map<number, number>()
  for (const [slot, rid] of Object.entries(draft.slot_to_roster_id ?? {})) slotRoster.set(Number(slot), Number(rid))
  if (!slotRoster.size) {
    const rosterOfUser = new Map<string, number>()
    for (const r of rosters) {
      if (r.owner_id) rosterOfUser.set(String(r.owner_id), r.roster_id)
      for (const co of r.co_owners ?? []) rosterOfUser.set(String(co), r.roster_id)
    }
    for (const [user, slot] of Object.entries(draft.draft_order ?? {})) {
      const rid = rosterOfUser.get(user)
      if (rid != null) slotRoster.set(Number(slot), rid)
    }
  }
  const tradedTo = new Map<string, number>()
  for (const t of traded ?? []) tradedTo.set(`${t.round}:${t.roster_id}`, Number(t.owner_id))

  const out: DraftSlot[] = []
  for (let rd = 1; rd <= rounds; rd++) {
    let forward = draft.type !== 'snake' || rd % 2 === 1
    if (draft.type === 'snake' && reversal > 0 && rd >= reversal) forward = !forward
    for (let i = 0; i < teams; i++) {
      const slot = forward ? i + 1 : teams - i
      const orig = slotRoster.get(slot) ?? null
      out.push({
        pickNo: (rd - 1) * teams + i + 1,
        round: rd,
        label: pickLabel(rd, i + 1),
        slot,
        originalRosterId: orig,
        rosterId: orig == null ? null : (tradedTo.get(`${rd}:${orig}`) ?? orig),
      })
    }
  }
  return out
}

/**
 * The order of a draft Sleeper hasn't created yet (next season's, mid-season): `slots` is roster
 * ids from slot 1 down, from a projection, and `owner` is the season's pick ownership keyed
 * `original:round`, so traded picks land where they belong.
 */
export function provisionalOrder(slots: number[], rounds: number, type: string, owner: Record<string, number>): DraftSlot[] {
  const draft = { type, settings: { teams: slots.length, rounds }, slot_to_roster_id: Object.fromEntries(slots.map((rid, i) => [i + 1, rid])) }
  const traded = Object.entries(owner).map(([key, owner_id]) => {
    const [roster_id, round] = key.split(':').map(Number)
    return { roster_id, round, owner_id }
  })
  return pickOrder(draft, [], traded)
}

/** Sleeper's picks, trimmed to what the board needs. */
export function normalisePicks(picks: any[], teams: number): DraftPickRow[] {
  return [...(picks ?? [])]
    .sort((a, b) => a.pick_no - b.pick_no)
    .map(p => {
      const m = p.metadata ?? {}
      const inRound = teams ? ((p.pick_no - 1) % teams) + 1 : p.pick_no
      return {
        pickNo: p.pick_no,
        round: p.round,
        label: pickLabel(p.round, inRound),
        slot: p.draft_slot ?? null,
        rosterId: p.roster_id != null ? Number(p.roster_id) : null,
        playerId: String(p.player_id ?? ''),
        name: `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || m.player_name || 'Unknown',
        pos: String(m.position ?? '').toUpperCase(),
        team: m.team ?? '',
      }
    })
}

export function buildPoll(draft: any, picks: any[]): DraftPoll {
  const d = summariseDraft(draft)
  return { status: d.status, picks: normalisePicks(picks, d.teams), polledAt: new Date().toISOString() }
}

/**
 * How many starters each position fields, so "your room" compares what plays rather than raw
 * depth: dedicated slots, plus one for RB/WR to cover FLEX, plus one QB in superflex.
 */
function starterDepth(rosterPositions: string[]): Record<string, number> {
  const n = (p: string) => rosterPositions.filter(x => x === p).length
  const flex = rosterPositions.some(p => p === 'FLEX' || p === 'REC_FLEX' || p === 'WRRB_FLEX')
  return {
    QB: n('QB') + n('SUPER_FLEX'),
    RB: n('RB') + (flex ? 1 : 0),
    WR: n('WR') + (flex ? 1 : 0),
    TE: Math.max(1, n('TE')),
  }
}

export function buildDraft(opts: {
  wb: Workbook
  sheetPath: string
  modifiedAt: string
  draft: any
  drafts: any[]
  league: any | null
  rosters: any[]
  users: any[]
  traded: any[]
  picks: any[]
  meta: Meta
  userId: string
  nflSeason: string
}): DraftData {
  const { draft, league, rosters, users, meta } = opts
  const summary = summariseDraft(draft)
  const board = findBoard(opts.wb)
  const rostered = new Set<string>(rosters.flatMap(r => r.players ?? []))
  const { values, unmatched } = matchBoard(board, meta, rostered)

  const ownerOf = new Map<string, number>()
  for (const r of rosters) for (const id of r.players ?? []) ownerOf.set(id, r.roster_id)

  // A rookie is a player in his first season AS OF THE DRAFT: replaying last year's draft after
  // Sleeper rolls years_exp forward still finds the right class. Anyone actually picked in this
  // draft is eligible by definition, which covers the edge of that rollover.
  const expAtDraft = Math.max(0, Number(opts.nflSeason) - Number(summary.season))
  const picked = new Set((opts.picks ?? []).map((p: any) => String(p.player_id)))

  const players: DraftPlayer[] = []
  for (const [id, v] of values) {
    const p = meta[id]
    const pos = SKILL.has(p?.position) ? p.position : (p?.fantasy_positions ?? []).find((f: string) => SKILL.has(f))
    if (!pos || v.rank == null) continue
    players.push({
      id,
      name: p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
      pos,
      team: p.team ?? 'FA',
      age: typeof p.age === 'number' ? p.age : null,
      rank: v.rank,
      value: Math.round(v.value),
      rookie: Number(p.years_exp) === expAtDraft || picked.has(id),
      rosteredBy: ownerOf.get(id) ?? null,
      injury: p.injury_status ?? '',
    })
  }
  players.sort((a, b) => a.rank - b.rank)

  const userOf = new Map(users.map(u => [String(u.user_id), u]))
  const mine = rosters.find(r => String(r.owner_id) === opts.userId || (r.co_owners ?? []).map(String).includes(opts.userId))
  const teams = rosters.map(r => {
    const u = userOf.get(String(r.owner_id))
    return {
      roster_id: r.roster_id,
      name: u?.metadata?.team_name || u?.display_name || `Roster ${r.roster_id}`,
      owner: u?.display_name ?? `Roster ${r.roster_id}`,
      avatar: userAvatar(u),
    }
  })

  // A league's existing rosters mean this is a rookie draft; an empty league is a startup.
  const startup = rostered.size === 0

  return {
    draft: summary,
    drafts: opts.drafts.map(summariseDraft).sort((a, b) => Number(b.season) - Number(a.season)),
    leagueName: league?.name ?? null,
    order: pickOrder(draft, rosters, opts.traded),
    teams,
    myRosterId: mine?.roster_id ?? null,
    players,
    starterDepth: starterDepth(league?.roster_positions ?? []),
    defaultPool: startup ? 'all' : 'rookies',
    sheet: { name: fileName(opts.sheetPath), modifiedAt: opts.modifiedAt, unmatched: unmatched.length },
    initial: buildPoll(draft, opts.picks),
    builtAt: new Date().toISOString(),
  }
}
