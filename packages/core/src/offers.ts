// Reading an open trade offer from your side of the table: what you'd give and get in Monte's
// terms, and whether you can still act on it.
import type { TradeTx } from './leagueWeek'
import { ET_NOISE, type Asset, type Verdict } from './tradeMath'

/** received: yours to answer. accepted: you agreed, it's waiting. sent: you proposed it. */
export type OfferRole = 'received' | 'accepted' | 'sent' | 'none'

export function offerRole(tx: TradeTx, me: number | null): OfferRole {
  if (me == null || !tx.sides.some(s => s.rosterId === me)) return 'none'
  if (tx.creator === me) return 'sent'
  return tx.consenters.includes(me) ? 'accepted' : 'received'
}

export const pickAssetId = (p: { season: string; round: number; orig: number }) => `pick:${p.season}:${p.round}:${p.orig}`

export type OfferSides = {
  give: Asset[]
  get: Asset[]
  /** the other team; null in a three-team trade, which Monte doesn't value or counter */
  partner: number | null
  /** assets Monte has no value for (a pick past the priced seasons, say): no verdict without them */
  missing: string[]
}

export function offerSides(tx: TradeTx, me: number | null, byId: Map<string, Asset>): OfferSides {
  const missing: string[] = []
  const assets = (s: TradeTx['sides'][number]) => {
    const out: Asset[] = []
    for (const p of s.players) {
      const a = byId.get(p.id)
      if (a) out.push(a)
      else missing.push(p.name)
    }
    for (const p of s.picks) {
      const a = byId.get(pickAssetId(p))
      if (a) out.push(a)
      else missing.push(`${p.season} round ${p.round}`)
    }
    return out
  }
  const mine = tx.sides.find(s => s.rosterId === me)
  const others = tx.sides.filter(s => s.rosterId !== me)
  if (!mine || others.length !== 1) return { give: [], get: [], partner: null, missing: [] }
  return { get: assets(mine), give: assets(others[0]), partner: others[0].rosterId, missing }
}

/** The read on an offer made to you: only your side matters, since they already said yes. */
export function offerVerdictText(v: Verdict | null): { label: string; tone: 'pos' | 'warn' | 'neg' | 'mute' } {
  if (!v) return { label: '', tone: 'mute' }
  if (v.em > ET_NOISE) return { label: 'Worth taking', tone: 'pos' }
  if (v.em >= -ET_NOISE) return { label: 'Close call', tone: 'warn' }
  return { label: 'You lose value', tone: 'neg' }
}
