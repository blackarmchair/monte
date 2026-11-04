// A saved pick-odds result is good for screens that start the sim on their own, as long as the
// inputs match and it's recent: games and injury news move the odds.
const FRESH_MS = 6 * 3600 * 1000

/** A flat, file-safe cache key. Any input that changes the odds changes the key. */
export function simCacheKey(o: { leagueId: string; sims: number; strengthCV: number; seed: number; model: string; overrides: Record<string, number> }): string {
  const overrides = JSON.stringify(Object.entries(o.overrides).sort(([a], [b]) => a.localeCompare(b)))
  let hash = 5381
  for (let i = 0; i < overrides.length; i++) hash = ((hash * 33) ^ overrides.charCodeAt(i)) >>> 0
  return `sim_${o.leagueId}_${o.sims}_${o.strengthCV}_${o.seed}_${o.model}_${hash.toString(36)}.json`
}

export function simResultFresh(ranAt: string | undefined, now = Date.now()): boolean {
  const at = ranAt ? Date.parse(ranAt) : NaN
  return !Number.isNaN(at) && at <= now && now - at < FRESH_MS
}
