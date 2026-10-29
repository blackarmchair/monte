// League, three tabs. Standings: where you stand, then the table; click a team for its page (Team).
// Matchups: this week's pairs, yours first and open, with Monte's win chance. Trades: your open
// offers (Sleeper connected) and the league's completed trades.
import { useMemo, useState } from 'react'
import { Matchups, Trades } from './LeagueTabs'
import { useApp } from './store'
import { Btn, ErrorBox, GradCard, HeatChip, kfmt, Loading, NeedsSheet, RING_SOFT, Seg, Stack2, TeamAvatar, teamColor, useHeat } from './ui'
import { record, thinnest, useOverview } from './overviewLogic'

type Sort = 'overall' | 'starter' | 'record'
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'overall', label: 'Value' },
  { value: 'starter', label: 'Starters' },
  { value: 'record', label: 'Record' },
]

type Tab = 'standings' | 'matchups' | 'trades'

export default function League() {
  const [tab, setTab] = useState<Tab>('standings')
  return (
    <div className="page stack" style={{ gap: 20 }}>
      <Seg
        lg
        value={tab}
        onChange={setTab}
        options={[
          { value: 'standings', label: 'Standings' },
          { value: 'matchups', label: 'Matchups' },
          { value: 'trades', label: 'Trades' },
        ]}
      />
      {tab === 'standings' ? <Standings /> : tab === 'matchups' ? <Matchups /> : <Trades />}
    </div>
  )
}

function Standings() {
  const { context, sheet, findTargets, openTeam } = useApp()
  const { res, data, rows, n, load, simBusy, simError, runBB } = useOverview()
  const { rank } = useHeat()
  const [sort, setSort] = useState<Sort>('overall')
  const ordered = useMemo(() => [...rows].sort((a, b) => (a.ranks[sort] ?? 99) - (b.ranks[sort] ?? 99)), [rows, sort])

  if (!sheet) return <NeedsSheet />

  const me = context?.myRosterId ?? null
  const myRow = rows.find(r => r.team.roster_id === me)
  const need = myRow && thinnest(myRow)

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 860 }}>
      {myRow && need && (
        <div className="hero" style={{ padding: 24 }}>
          <div className="small mute">
            {[context && context.week > 0 ? `Week ${context.week}` : null, record(myRow.team), myRow.tier?.name].filter(Boolean).join(' · ')}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-.01em', textWrap: 'pretty' }}>
            You're #{myRow.ranks.overall} in value and {myRow.ranks.starter ? `#${myRow.ranks.starter}` : '…'} in starters.
          </div>
          <div className="sub" style={{ fontSize: 15 }}>
            {need} is your thinnest spot, #{myRow.pos[need].rank} of {n}.{simBusy ? ' Simulating starters…' : ''}
          </div>
          <div style={{ paddingTop: 6 }}>
            <Btn kind="primary" label={`Find ${need} targets`} onClick={() => findTargets(need)} />
          </div>
        </div>
      )}
      {res && !res.ok && <ErrorBox message={res.error} onRetry={load} />}
      {simError && <ErrorBox message={`Starter ranks need the sim, which failed: ${simError}`} onRetry={() => runBB()} />}
      {!data && !(res && !res.ok) && <Loading label="Reading your rankings file…" />}

      {data && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 10, paddingBottom: 2 }}>
            <span className="title-l">Standings</span>
            <Seg value={sort} onChange={setSort} options={SORTS} />
          </div>
          {ordered.map((r, i) => {
            const rid = r.team.roster_id
            const rk = r.ranks[sort]
            const metric = sort === 'overall' ? kfmt(r.value) : sort === 'starter' ? (r.starterPPG != null ? `${r.starterPPG.toFixed(0)}/wk` : '…') : record(r.team)
            const sub =
              sort === 'overall'
                ? `${record(r.team)} · Starters ${r.ranks.starter ? `#${r.ranks.starter}` : '…'}`
                : sort === 'starter'
                ? `${record(r.team)} · Value #${r.ranks.overall}`
                : `${r.tier?.name ?? 'Tier pending'} · Value #${r.ranks.overall}`
            return (
              <GradCard
                key={rid}
                color={teamColor(rid)}
                minHeight={68}
                ring={rid === me ? RING_SOFT : undefined}
                onClick={() => openTeam(rid, r.team.team_name)}
                style={{ gap: 14 }}
              >
                <span className="num mute" style={{ width: 18, fontSize: 14, fontWeight: 600 }}>
                  {i + 1}
                </span>
                <TeamAvatar rid={rid} name={r.team.team_name} />
                <Stack2 title={r.team.team_name} sub={sub} size={16} />
                <HeatChip label={metric} colors={rank(rk, n)} />
              </GradCard>
            )
          })}
          <div className="small mute" style={{ paddingTop: 4 }}>
            {data.sheet.name} · {data.sheet.ranked} players matched
            {data.sheet.unmatched.length ? ` · ${data.sheet.unmatched.length} sheet names didn't match Sleeper` : ''}
          </div>
        </div>
      )}
    </div>
  )
}
