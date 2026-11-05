// "This week": what needs you, in the order you'd want to deal with it. Each source is its own
// function, so a screen can show what it has while the rest is still loading or has failed.
import type { TradeTx } from './leagueWeek'
import { tagOf } from './startSitLogic'
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
  /** who the card is about: sets its face and colour */
  face?: { kind: 'player'; id: string; name: string; team: string } | { kind: 'team'; rid: number; name: string }
  /** a small status tag beside the title */
  tag?: { label: string; tone: 'bad' | 'warn' | 'mid' }
  /** the sheet rank, shown as a heat chip */
  rank?: number
  /** the one sentence to lead with when this is the top thing to do */
  lead?: string
  /** the button for it */
  cta?: string
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
    title: `Offer from ${from}`,
    detail: verdict || 'Waiting on your answer.',
    action: { kind: 'trades' },
    face: tx.creator != null ? { kind: 'team', rid: tx.creator, name: from } : undefined,
    lead: `${from} sent you a trade offer.${verdict ? ` ${verdict}.` : ''}`,
    cta: 'Review offer',
  }))
}

/** Lineup problems you can still fix: empty slots and unstartable starters first, then the best swap. */
export function lineupItems(ss: StartSitData, now = Date.now()): InboxItem[] {
  const out: InboxItem[] = []
  const flagged = new Set<string>()
  const faceOf = (p: { id: string; name: string; team: string }) => ({ kind: 'player' as const, id: p.id, name: p.name, team: p.team })
  for (const s of ss.slots) {
    if (s.locked || !s.supported) continue
    const better = s.best && s.best.id !== s.current?.id ? s.best : null
    const fix = better ? `Start ${better.name}.` : 'No better option on your bench.'
    if (!s.current) {
      out.push({ id: `empty:${s.slot}`, tone: 'act', title: `Empty ${s.label} slot`, detail: fix, action: { kind: 'lineup' }, face: better ? faceOf(better) : undefined, lead: `Your ${s.label} slot is empty. ${fix}`, cta: 'Fix lineup' })
    } else if (!s.current.startable) {
      flagged.add(s.current.id)
      out.push({
        id: `bad:${s.current.id}`,
        tone: 'act',
        title: s.current.name,
        detail: `In your lineup: ${s.current.flag}. ${fix}`,
        action: { kind: 'lineup' },
        face: faceOf(s.current),
        tag: tagOf(s.current) ?? undefined,
        lead: `${s.current.name} is in your lineup: ${s.current.flag}. ${fix}`,
        cta: 'Fix lineup',
      })
    }
  }
  const swaps = ss.gain >= ss.minGain ? ss.changes.filter(c => !c.marginal && !(c.outPlayer && flagged.has(c.outPlayer.id)) && c.outPlayer) : []
  if (swaps.length) {
    const text = swaps.map(c => `Start ${c.inPlayer.name} over ${c.outPlayer!.name}.`).join(' ')
    out.push({ id: 'swap', tone: 'act', title: `A better lineup gains ${ss.gain.toFixed(1)} points`, detail: text, action: { kind: 'lineup' }, face: faceOf(swaps[0].inPlayer), lead: `${text} A better lineup gains ${ss.gain.toFixed(1)} points.`, cta: 'Fix lineup' })
  }
  const age = Math.floor((now - Date.parse(ss.sheet.modifiedAt)) / DAY_MS)
  if (age > SHEET_STALE_DAYS)
    out.push({ id: 'sheet-old', tone: 'note', title: `Your rankings sheet is ${age} days old`, detail: 'Lineup and trade reads use it. Download the new one', action: { kind: 'settings' } })
  else if (ss.boardWeek != null && ss.boardWeek !== ss.week)
    out.push({ id: 'sheet-week', tone: 'note', title: `Your sheet's boards are for week ${ss.boardWeek}`, detail: `It's week ${ss.week}, so the lineup read may be out of date`, action: { kind: 'settings' } })
  return out
}

/** The lowest-ranked player on your roster; someone the sheet doesn't rank at all counts as lowest. */
function lowestOf(mine: Asset[], ranks: Record<string, { sheetRank: number | null }>) {
  const rankOf = (a: Asset) => ranks[a.id]?.sheetRank ?? null
  const players = mine.filter(a => a.kind === 'player')
  if (!players.length) return null
  const worst = players.reduce((x, y) => {
    const rx = rankOf(x)
    const ry = rankOf(y)
    return rx == null ? x : ry == null || ry > rx ? y : x
  })
  return { asset: worst, rank: rankOf(worst) }
}

/** What the unrostered suggestions are measured against. */
export function lowestNote(mine: Asset[], ranks: Record<string, { sheetRank: number | null }>): string | null {
  const low = lowestOf(mine, ranks)
  if (!low) return null
  return low.rank == null ? `Ranked by the sheet. Your lowest, ${low.asset.name}, isn't on it.` : `Ranked ahead of your lowest, ${low.asset.name} (#${low.rank}).`
}

/**
 * Unrostered players the sheet ranks ahead of the lowest-ranked player on your roster. Compared and
 * shown as the sheet's own ranks (lower is better), not Monte's value scores: those run the other
 * way, and scoring adjustments can move a TE or QB past someone ranked ahead of him.
 */
export function waiverItems(freeAgents: Asset[], mine: Asset[], ranks: Record<string, { sheetRank: number | null }>, likelyOnWaivers: string[] = []): InboxItem[] {
  const low = lowestOf(mine, ranks)
  if (!low) return []
  return freeAgents
    .filter(a => a.kind === 'player' && !OUT_FOR_NOW.has(a.injury ?? ''))
    .flatMap(a => {
      const rank = ranks[a.id]?.sheetRank ?? null
      return rank != null && (low.rank == null || rank < low.rank) ? [{ a, rank }] : []
    })
    .sort((x, y) => x.rank - y.rank)
    .slice(0, WAIVER_LIMIT)
    .map(({ a, rank }) => ({
      id: `waiver:${a.id}`,
      tone: 'note' as const,
      title: a.name,
      detail: [a.pos, a.team, likelyOnWaivers.includes(a.id) ? 'likely on waivers' : ''].filter(Boolean).join(' · '),
      action: { kind: 'player' as const, id: a.id, name: a.name },
      face: { kind: 'player' as const, id: a.id, name: a.name, team: a.team },
      rank,
    }))
}

/** Anything stopping Monte from seeing your offers. */
export function connectionItems(link: { expiresAt: number | null } | undefined, pendingNote: string | null, now = Date.now()): InboxItem[] {
  if (pendingNote) return [{ id: 'connect', tone: 'note', title: pendingNote, detail: '', action: { kind: 'settings' } }]
  if (link?.expiresAt != null && link.expiresAt - now < TOKEN_WARN_DAYS * DAY_MS) {
    const days = Math.max(0, Math.ceil((link.expiresAt - now) / DAY_MS))
    return [{ id: 'token', tone: 'note', title: `Your Sleeper connection ends ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`, detail: 'Connect again in Settings to keep sending from Monte', action: { kind: 'settings' } }]
  }
  return []
}

/** Things to act on first; otherwise each source keeps its own order. */
export const orderInbox = (items: InboxItem[]) => [...items.filter(i => i.tone === 'act'), ...items.filter(i => i.tone === 'note')]
