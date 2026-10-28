// KeepTradeCut's rankings page -> slim market rows. KTC has no API; the page embeds every value as
// JSON in <script id="ktc-players">. Monte keeps only the trade-derived values ("vft": built from
// KTC's database of real trades, not its keep/trade/cut votes), for 1QB and Superflex at each
// TE-premium tier, so one cached copy serves every league format.

/** Values by TE-premium tier: off, TE+, TE++, TE+++. */
export type KtcRow = {
  name: string
  pos: string
  one: number[]
  sf: number[]
  /** recent trade-value trend as a share of value: 1QB, Superflex */
  trend: [number, number]
}

const TIERS = ['tep', 'tepp', 'teppp'] as const

export function parseKtc(html: string): KtcRow[] {
  const at = html.indexOf('id="ktc-players"')
  const start = at < 0 ? -1 : html.indexOf('>', at) + 1
  const end = start <= 0 ? -1 : html.indexOf('</script>', start)
  if (end < 0) throw new Error('KeepTradeCut page has no player data (the page layout changed?)')
  const raw = JSON.parse(html.slice(start, end)) as any[]
  const vals = (f: any) => [f?.vftValue ?? f?.value, ...TIERS.map(t => f?.[t]?.vftValue ?? f?.[t]?.value)].map(v => Number(v) || 0)
  const trend = (f: any) => (Number(f?.vftValue) > 0 ? (Number(f?.vftOverallTrend) || 0) / Number(f.vftValue) : 0)
  const rows = raw
    .filter(p => p?.playerName && p?.position)
    .map(p => ({
      name: String(p.playerName),
      pos: String(p.position),
      one: vals(p.oneQBValues),
      sf: vals(p.superflexValues),
      trend: [trend(p.oneQBValues), trend(p.superflexValues)] as [number, number],
    }))
  // A real page lists ~500; a short list means the parse found something else.
  if (rows.length < 150) throw new Error(`KeepTradeCut page parsed to only ${rows.length} rows`)
  return rows
}

/**
 * The KTC tier for a league, from KTC's own guide: TE+ is one TE with a ~.5–.75 bonus, TE++ two
 * TEs or a >1 bonus, TE+++ two TEs and a bonus. `te` is the bonus the tier stands for, so
 * scoringAdj() only corrects the remainder (a 2-TE league's tier already is its format).
 */
export function ktcTier(teBonus: number, teSlots: number): { i: number; te: number } {
  if (teSlots >= 2) return teBonus > 0 ? { i: 3, te: teBonus } : { i: 2, te: teBonus }
  if (teBonus <= 0) return { i: 0, te: 0 }
  if (teBonus <= 0.75) return { i: 1, te: 0.625 }
  return { i: 2, te: 1 }
}
