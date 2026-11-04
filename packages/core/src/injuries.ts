// Manual injury overrides belong to the season they were made in: "out for the season" must not
// still bench a player next year, and "out until week 14" must not apply to next year's week 3.
import type { ManualInjury } from './types'

/** The season an override was made for. Entries saved before `season` existed go by their date;
 *  January and February still belong to the season that started the previous autumn. */
export function injurySeason(i: ManualInjury): string | null {
  if (i.season) return i.season
  const at = new Date(i.addedAt)
  if (Number.isNaN(at.getTime())) return null
  return String(at.getUTCMonth() < 2 ? at.getUTCFullYear() - 1 : at.getUTCFullYear())
}

/** With no known season (nothing loaded yet, or an undated entry) an override counts as current. */
export function isCurrentInjury(i: ManualInjury, season: string | null | undefined): boolean {
  const own = injurySeason(i)
  return !season || !own || own === season
}

/** From an earlier season, or a return week that has arrived: safe to offer for clearing. */
export function isExpiredInjury(i: ManualInjury, season: string | null | undefined, week: number): boolean {
  return !isCurrentInjury(i, season) || (i.returnWeek != null && i.returnWeek <= week)
}

/** Sleeper id -> return week (99 = season) for this season, the shape the engine's resolver takes. */
export function overridesFor(injuries: ManualInjury[] | undefined, season: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const i of injuries ?? []) if (isCurrentInjury(i, season)) out[i.id] = i.returnWeek ?? 99
  return out
}
