// Pure helpers for the Start/Sit screen, ported from the desktop StartSitView.
import type { SSPlayer } from '@monte/core/types'

/** Positions each Sleeper slot code accepts; a slot missing here (K, DEF, IDP…) is pinned. */
export const ELIG: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
}
export const eligible = (slot: string, p: SSPlayer | null | undefined) => !p || (ELIG[slot] ?? []).includes(p.pos)

/** Win-probability spread: the prototype's points SD for a head-to-head week. */
export const WIN_SD = 22

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf). */
export function normCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

/** Short tag for a player's availability: neg when he can't play, warn when he's listed. */
export function tagOf(p: SSPlayer): { label: string; tone: 'bad' | 'warn' | 'mid' } | null {
  if (p.locked) return { label: 'Locked', tone: 'mid' }
  if (!p.flag) return null
  const short = p.flag.split(' — ')[0].replace(/^Questionable$/i, 'Q').replace(/^Doubtful$/i, 'D')
  return { label: short, tone: p.startable ? 'warn' : p.flag === 'Taxi' ? 'mid' : 'bad' }
}

/** Taxi and IR players can't be started in Sleeper, so they never move into the lineup. */
export const benchOnly = (p: SSPlayer) => p.flag === 'Taxi' || p.flag === 'IR'

export type Swap = { slot: number; inId: string; outId: string | null; hop: { from: number; to: number } | null; gain: number }
