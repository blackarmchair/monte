// How the Trade screens describe assets and verdicts.
import { ET_NOISE, type Asset, type Verdict } from './tradeMath'

export type VerdictTone = 'pos' | 'warn' | 'neg' | 'mute'
export const mineOf = (a: Asset) => a.mine ?? a.sheet

/** Your-value-vs-market read on one asset, from your side of the table. */
export function marketTag(a: Asset): { label: string; tone: 'acc' | 'pos' | 'mute' } {
  const m = mineOf(a)
  const d = m - a.val
  if (a.market == null) return { label: 'No market', tone: 'mute' }
  if (d <= -Math.max(250, 0.1 * m)) return { label: 'Sell high', tone: 'acc' }
  if (d >= Math.max(250, 0.1 * a.val)) return { label: 'Undervalued', tone: 'pos' }
  return { label: 'Fair', tone: 'mute' }
}

export const assetMeta = (a: Asset) =>
  a.kind === 'pick' ? (a.slot ? `projected ${a.slot}` : 'future pick') : `${a.pos} · ${a.team}${a.age ? ` · ${a.age}` : ''}`

export function verdictText(v: Verdict | null): { label: string; tone: VerdictTone } {
  if (!v) return { label: 'Build a trade', tone: 'mute' }
  if (v.em > 0 && v.et > ET_NOISE) return { label: 'Both sides win', tone: 'pos' }
  if (v.em > 0 && v.et > 0) return { label: 'Coin flip for them', tone: 'warn' }
  if (v.em > 0) return { label: 'They say no', tone: 'neg' }
  return { label: 'You lose value', tone: 'neg' }
}
