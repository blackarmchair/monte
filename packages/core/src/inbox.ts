// "This week": what needs you, in the order you'd want to deal with it. Each source is its own
// function, so a screen can show what it has while the rest is still loading or has failed.
import type { TradeTx } from './leagueWeek'
import type { Asset } from './tradeMath'
import type { StartSitData } from './types'

export type InboxAction = { kind: 'trades' } | { kind: 'lineup' } | { kind: 'player'; id: string; name: string } | { kind: 'settings' }

export type InboxItem = {
  id: string
  /** act: yours to deal with. note: worth knowing. */
  tone: 'act' | 'note'
  title: string
  detail: string
  action: InboxAction
}

const DAY_MS = 86400000
/** The sheet's weekly boards are stale past this. */
export const SHEET_STALE_DAYS = 7
const TOKEN_WARN_DAYS = 7
const WAIVER_LIMIT = 3
const OUT_FOR_NOW = new Set(['IR', 'Out', 'PUP', 'Sus', 'NA', 'DNR'])

/** A warning for screens that lean on the sheet, or null while it's fresh. */
export function staleSheetNote(modifiedAt: string, now = Date.now()): string | null {
  const age = Math.floor((now - Date.parse(modifiedAt)) / DAY_MS)
  return age > SHEET_STALE_DAYS ? `Your rankings sheet is ${age} days old, so these reads may be out of date.` : null
}

/** Offers waiting on your answer, already filtered to `received`. */
export function offerItems(offers: Array<{ tx: TradeTx; from: string; verdict: string }>): InboxItem[] {
  return offers.map(({ tx, from, verdict }) => ({
    id: `offer:${tx.id}`,
    tone: 'act',
    title: `Trade offer from ${from}`,
    detail: verdict || 'Waiting on your answer.',
    action: { kind: 'trades' },
  }))
}

/** Lineup problems you can still fix: empty slots and unstartable starters first, then the best swap. */
export function lineupItems(ss: StartSitData, now = Date.now()): InboxItem[] {
  const out: InboxItem[] = []
  const flagged = new Set<string>()
  for (const s of ss.slots) {
    if (s.locked || !s.supported) continue
    const fix = s.best && s.best.id !== s.current?.id ? `Start ${s.best.name}.` : 'No better option on your bench.'
    if (!s.current) {
      out.push({ id: `empty:${s.slot}`, tone: 'act', title: `Empty ${s.label} slot`, detail: fix, action: { kind: 'lineup' } })
    } else if (!s.current.startable) {
      flagged.add(s.current.id)
      out.push({ id: `bad:${s.current.id}`, tone: 'act', title: `${s.current.name} is in your lineup`, detail: `${s.current.flag}. ${fix}`, action: { kind: 'lineup' } })
    }
  }
  const swaps = ss.gain >= ss.minGain ? ss.changes.filter(c => !c.marginal && !(c.outPlayer && flagged.has(c.outPlayer.id)) && c.outPlayer) : []
  if (swaps.length)
    out.push({
      id: 'swap',
      tone: 'act',
      title: `A better lineup gains ${ss.gain.toFixed(1)} points`,
      detail: swaps.map(c => `Start ${c.inPlayer.name} over ${c.outPlayer!.name}.`).join(' '),
      action: { kind: 'lineup' },
    })
  const age = Math.floor((now - Date.parse(ss.sheet.modifiedAt)) / DAY_MS)
  if (age > SHEET_STALE_DAYS)
    out.push({ id: 'sheet-old', tone: 'note', title: `Your rankings sheet is ${age} days old`, detail: 'Lineup and trade reads use it. Download the new one.', action: { kind: 'settings' } })
  else if (ss.boardWeek != null && ss.boardWeek !== ss.week)
    out.push({ id: 'sheet-week', tone: 'note', title: `Your sheet's boards are for week ${ss.boardWeek}`, detail: `It's week ${ss.week}, so the lineup read may be out of date.`, action: { kind: 'settings' } })
  return out
}

/**
 * Unrostered players the sheet ranks ahead of the lowest-ranked player on your roster. Compared and
 * shown as the sheet's own ranks (lower is better), not Monte's value scores: those run the other
 * way, and scoring adjustments can move a TE or QB past someone ranked ahead of him.
 */
export function waiverItems(freeAgents: Asset[], mine: Asset[], ranks: Record<string, { sheetRank: number | null }>, likelyOnWaivers: string[] = []): InboxItem[] {
  const rankOf = (a: Asset) => ranks[a.id]?.sheetRank ?? null
  const players = mine.filter(a => a.kind === 'player')
  if (!players.length) return []
  // Someone the sheet doesn't rank at all counts as your lowest.
  const worst = players.reduce((x, y) => {
    const rx = rankOf(x)
    const ry = rankOf(y)
    return rx == null ? x : ry == null || ry > rx ? y : x
  })
  const worstRank = rankOf(worst)
  const lowest = worstRank == null ? `${worst.name}, your lowest, isn't on the sheet.` : `Your lowest is ${worst.name} at #${worstRank}.`
  return freeAgents
    .filter(a => a.kind === 'player' && !OUT_FOR_NOW.has(a.injury ?? ''))
    .flatMap(a => {
      const rank = rankOf(a)
      return rank != null && (worstRank == null || rank < worstRank) ? [{ a, rank }] : []
    })
    .sort((x, y) => x.rank - y.rank)
    .slice(0, WAIVER_LIMIT)
    .map(({ a, rank }) => ({
      id: `waiver:${a.id}`,
      tone: 'note' as const,
      title: `${a.name} is unrostered`,
      detail: `${a.pos}, ${a.team}. The sheet ranks him #${rank}. ${lowest}${likelyOnWaivers.includes(a.id) ? ' Recently dropped, so likely on waivers.' : ''}`,
      action: { kind: 'player' as const, id: a.id, name: a.name },
    }))
}

/** Anything stopping Monte from seeing your offers. */
export function connectionItems(link: { expiresAt: number | null } | undefined, pendingNote: string | null, now = Date.now()): InboxItem[] {
  if (pendingNote) return [{ id: 'connect', tone: 'note', title: "Monte can't see your open offers", detail: pendingNote, action: { kind: 'settings' } }]
  if (link?.expiresAt != null && link.expiresAt - now < TOKEN_WARN_DAYS * DAY_MS) {
    const days = Math.max(0, Math.ceil((link.expiresAt - now) / DAY_MS))
    return [{ id: 'token', tone: 'note', title: `Your Sleeper connection ends ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`, detail: 'Connect again in Settings to keep sending from Monte.', action: { kind: 'settings' } }]
  }
  return []
}

/** Things to act on first; otherwise each source keeps its own order. */
export const orderInbox = (items: InboxItem[]) => [...items.filter(i => i.tone === 'act'), ...items.filter(i => i.tone === 'note')]
