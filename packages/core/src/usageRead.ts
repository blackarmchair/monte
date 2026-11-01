// The Usage board's read on one player: how much to trust the gap (sample strength), whether his
// role is moving (last 3 games against the season), and what the gap means for the person looking,
// which depends on who holds him. Shared by the desktop and phone Players screens.
import type { PWOPRRow, UsageWindow } from './types'

/** usage gap (PPG) at which a player reads as a buy or a sell */
export const USAGE_SIGNAL = 3

export type Holder = 'mine' | 'theirs' | 'fa'

/** 1 = thin (the engine's two-game minimum), 2 = fair, 3 = solid */
export type Sample = { level: 1 | 2 | 3; label: 'Thin' | 'Fair' | 'Solid'; games: number }

export function sampleOf(games: number): Sample {
  if (games >= 5) return { level: 3, label: 'Solid', games }
  if (games >= 3) return { level: 2, label: 'Fair', games }
  return { level: 1, label: 'Thin', games }
}

/** ●●○ */
export const sampleDots = (s: Sample) => '●'.repeat(s.level) + '○'.repeat(3 - s.level)

/** Recent-minus-season moves big enough to call: 3 points of target share, 8 of snap share. */
const TGT_MOVE = 0.03
const SNAP_MOVE = 0.08

/** +1 recent above season, −1 below, 0 level; null when there is no separate season to compare to */
export function moveOf(recent: number | null | undefined, season: number | null | undefined, step: number): -1 | 0 | 1 | null {
  if (recent == null || season == null) return null
  return recent - season >= step ? 1 : season - recent >= step ? -1 : 0
}

export type Role = 'growing' | 'shrinking' | 'steady' | null

/** Is his role growing? Target share and snap share over the last 3 games against the season. */
export function roleOf(recent: UsageWindow | null | undefined, season: UsageWindow | null | undefined): Role {
  if (!recent || !season || season.games <= recent.games) return null
  const t = moveOf(recent.tgtShare, season.tgtShare, TGT_MOVE) ?? 0
  const s = moveOf(recent.snapShare, season.snapShare, SNAP_MOVE) ?? 0
  if (t + s > 0 && t >= 0 && s >= 0) return 'growing'
  if (t + s < 0 && t <= 0 && s <= 0) return 'shrinking'
  return 'steady'
}

export type UsageRead = {
  tag: string
  tone: 'pos' | 'acc' | 'mute'
  sample: Sample
  role: Role
  /** heat position 0 … 1: the gap, pulled toward neutral on a thin or fair sample */
  heat: number
  /** why the verdict is what it is, one reason a line, shown when the verdict is clicked */
  why: string[]
}

/**
 * The gap framed as the decision in front of the user. A thin sample never gets a buy or a sell,
 * only "Watch" (or "Hold" for your own). Owned players read Hold / Supports holding / Sell (never "Buy" beside "Offer");
 * other teams' players Buy / Avoid; free agents Add / Pass.
 */
export function usageRead(row: Pick<PWOPRRow, 'delta' | 'games' | 'recent' | 'season' | 'usagePPG' | 'sleeperPPG'>, holder: Holder): UsageRead {
  const d = row.delta ?? 0
  const sample = sampleOf(row.games)
  const role = roleOf(row.recent, row.season)
  const heat = 0.5 + (d / 16) * [0, 0.45, 0.75, 1][sample.level]
  const dir = d >= USAGE_SIGNAL ? 1 : d <= -USAGE_SIGNAL ? -1 : 0
  const gap = `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`
  const why = [
    `Usage says ${row.usagePPG?.toFixed(1) ?? '—'} PPG, Sleeper projects ${row.sleeperPPG?.toFixed(1) ?? '—'}: gap ${gap}.`,
    dir === 0
      ? `No call: a call needs a gap of ±${USAGE_SIGNAL.toFixed(1)} or more.`
      : `Past ±${USAGE_SIGNAL.toFixed(1)}, the gap that makes a call.`,
    `Sample: ${row.games} game${row.games === 1 ? '' : 's'} played: ${['', 'a thin sample (under 3)', 'a fair sample (3–4)', 'a solid sample (5+)'][sample.level]}.` +
      (dir !== 0 && sample.level === 1 ? ` Too few games for a buy or sell, so it stays ${holder === 'mine' ? 'Hold' : 'Watch'}.` : ''),
  ]
  if (role === 'growing' || role === 'shrinking') why.push(`Role ${role}: target or snap share over the last 3 games is ${role === 'growing' ? 'above' : 'below'} his season.`)
  if (dir === 0) return { tag: holder === 'mine' ? 'Hold' : 'No edge', tone: 'mute', sample, role, heat, why }
  if (sample.level === 1) return { tag: holder === 'mine' ? 'Hold' : 'Watch', tone: 'mute', sample, role, heat, why }
  const tag =
    dir > 0
      ? { mine: 'Supports holding', theirs: 'Buy', fa: 'Add' }[holder]
      : { mine: 'Sell', theirs: 'Avoid', fa: 'Pass' }[holder]
  return { tag, tone: dir > 0 ? 'pos' : 'acc', sample, role, heat, why }
}

/** a share as a whole percent, no sign: "24" */
export const pct0 = (x: number | null | undefined) => (x == null ? '—' : String(Math.round(x * 100)))

/** True when the season window is only the recent games, so the two numbers are the same sample. */
export const sameSample = (row: Pick<PWOPRRow, 'recent' | 'season'>) => !row.season || !row.recent || row.season.games <= row.recent.games

/** Sleeper's injury tag as one or two letters for a tight row: Questionable -> Q */
export function injuryShort(status: string): string {
  const s = status.trim()
  if (/^(IR|PUP|NFI|Sus|COV)/i.test(s)) return s.split(/[\s-]/)[0].toUpperCase()
  return s.charAt(0).toUpperCase()
}
