// Projected draft slots from a pick-odds run. Each team gets a distinct slot: the assignment that
// is jointly most likely under the simulated slot distributions (Hungarian method on -log p).
// Ranking teams by average slot instead barely moves when the distributions shift, so the
// projected pick drifted away from the odds it was drawn next to.
import type { BBTeam } from './types'

const FLOOR = 1e-6

/** Roster id -> projected slot (1-based). Ties fall to the earlier average slot. */
export function projectedSlots(teams: Pick<BBTeam, 'roster_id' | 'slotDist' | 'meanDraftSlot'>[]): Map<number, number> {
  const ts = [...teams].sort((a, b) => a.meanDraftSlot - b.meanDraftSlot)
  const n = ts.length
  if (!n) return new Map()
  // cost[i][j]: team i in slot j. The tiny distance term makes ties land in average-slot order.
  const cost = ts.map((t, i) => Array.from({ length: n }, (_, j) => -Math.log(Math.max(FLOOR, t.slotDist[j] ?? 0)) + 1e-9 * Math.abs(i - j)))

  // Hungarian algorithm (potentials, 1-indexed), O(n^3).
  const u = new Array(n + 1).fill(0)
  const v = new Array(n + 1).fill(0)
  const p = new Array(n + 1).fill(0)
  const way = new Array(n + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array(n + 1).fill(Infinity)
    const used = new Array(n + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else minv[j] -= delta
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0)
  }

  const out = new Map<number, number>()
  for (let j = 1; j <= n; j++) out.set(ts[p[j] - 1].roster_id, j)
  return out
}
