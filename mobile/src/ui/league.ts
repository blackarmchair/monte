// League labels shared by the header, the Leagues sheet and onboarding.
import type { LeagueSummary } from '@monte/core/types'
import { teamInitials } from './kit'

export function formatLabel(l: LeagueSummary): string {
  const parts = [`${l.total_rosters}-team`, l.superflex ? 'SF' : '1QB']
  if (l.tePremium > 0) parts.push(`${l.tePremium} TEP`)
  return parts.join(' · ')
}

/** "GF"; "L2" when names are hidden (the shown name is then "League #2"). */
export const leagueAbbr = (name: string) => teamInitials(name.replace(/^League #(\d+)$/, 'L $1'))
