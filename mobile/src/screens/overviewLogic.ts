// useOverview(): loads League's data and starts the sim the starter ranks need. The maths is in core.
import { useEffect, useMemo, useState } from 'react'
import type { OverviewData, Result } from '@monte/core/types'
import { anonOverview } from '@monte/core/names'
import { buildRows } from '@monte/core/overviewMath'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'

export * from '@monte/core/overviewMath'
export { num, ORD } from '@/ui/kit'

// The last overview loaded, so the Team page opens on League's data instead of fetching again.
let last: { key: string; res: Result<OverviewData> } | null = null

/** Overview data for the selected league, ranked against the pick-odds sim (started if needed). */
export function useOverview() {
  const { context, bbBase, runBB, hide, dataVersion, sheet } = useApp()
  const [tick, setTick] = useState(0)
  const leagueId = context?.league.league_id
  const key = `${leagueId}|${dataVersion}`
  const [res, setRes] = useState<Result<OverviewData> | null>(() => (last?.key === key ? last.res : null))

  useEffect(() => {
    if (!leagueId || !sheet) return
    if (!tick && last?.key === key && last.res.ok) return setRes(last.res)
    let live = true
    setRes(null)
    void monte.leagueOverview(leagueId).then(r => {
      last = { key, res: r }
      if (live) setRes(r)
    })
    return () => {
      live = false
    }
  }, [leagueId, dataVersion, tick, !!sheet]) // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => setTick(x => x + 1)
  // Starter ranks and pick values need the sim; start it if this league has none yet.
  useEffect(() => {
    if (leagueId && sheet && !bbBase.result && !bbBase.busy && !bbBase.error) runBB()
  }, [leagueId, !!sheet]) // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => (res?.ok ? (hide ? anonOverview(res.value) : res.value) : null), [res, hide])
  const rows = useMemo(() => (data ? buildRows(data, bbBase.result) : []), [data, bbBase.result])
  const n = data?.teams.length ?? context?.rosters.length ?? 10
  return { res, data, rows, n, load, simBusy: !!bbBase.busy, simError: bbBase.error, runBB }
}
