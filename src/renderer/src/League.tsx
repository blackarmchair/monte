// League: where you stand and Standings on the left; on the right (sticky) the selected team, which
// is yours until you click another: its verdict, four heat tiles and its roster one position at a
// time. This panel is the desktop's Team page.
import { useMemo, useState } from 'react'
import { useApp } from './store'
import { Btn, ErrorBox, GradCard, Headshot, HeatChip, HeatTiles, kfmt, Loading, NeedsSheet, nflColor, num, ORD, Pills, RING, RING_SOFT, Seg, Stack2, Tag, TeamAvatar, grad, teamColor, useHeat } from './ui'
import { headline, POS, record, statusTag, thinnest, useOverview, verdict, type Pos, type TeamRow } from './overviewLogic'

type Sort = 'overall' | 'starter' | 'record'
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'overall', label: 'Value' },
  { value: 'starter', label: 'Starters' },
  { value: 'record', label: 'Record' },
]

export default function League() {
  const { context, sheet, findTargets, leagueTeam, setLeagueTeam } = useApp()
  const { res, data, rows, n, load, simBusy, simError, runBB } = useOverview()
  const { rank } = useHeat()
  const [sort, setSort] = useState<Sort>('overall')
  const ordered = useMemo(() => [...rows].sort((a, b) => (a.ranks[sort] ?? 99) - (b.ranks[sort] ?? 99)), [rows, sort])

  if (!sheet)
    return (
      <div className="page">
        <NeedsSheet />
      </div>
    )

  const me = context?.myRosterId ?? null
  const myRow = rows.find(r => r.team.roster_id === me)
  const need = myRow && thinnest(myRow)
  const shown = rows.find(r => r.team.roster_id === (leagueTeam ?? me)) ?? myRow

  return (
    <div className="page" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.1fr)', gap: 24, alignItems: 'start' }}>
      <div className="stack" style={{ gap: 20 }}>
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
                  ring={rid === shown?.team.roster_id ? RING : rid === me ? RING_SOFT : undefined}
                  onClick={() => setLeagueTeam(rid === me ? null : rid)}
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

      {shown && data && <TeamPanel key={shown.team.roster_id} row={shown} n={n} />}
    </div>
  )
}

function TeamPanel({ row, n }: { row: TeamRow; n: number }) {
  const { context, findTargets, tradeWith, hide, openPlayer } = useApp()
  const { rank } = useHeat()
  const team = row.team
  const mine = team.roster_id === context?.myRosterId
  const need = thinnest(row)
  const [tab, setTab] = useState<Pos | 'Picks'>('QB')
  const players = tab === 'Picks' ? [] : team.players.filter(x => x.pos === tab).sort((a, b) => b.value - a.value)
  const room = tab === 'Picks' ? null : row.pos[tab]

  return (
    <div className="sticky stack" style={{ gap: 16 }}>
      <div style={{ padding: 22, borderRadius: 22, background: grad(teamColor(team.roster_id)), display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="row" style={{ gap: 14 }}>
          <TeamAvatar rid={team.roster_id} name={team.team_name} size={60} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-.01em' }}>{team.team_name}</div>
            <div className="sub" style={{ fontSize: 14 }}>
              {[hide ? null : team.display_name, record(team), row.tier?.name].filter(Boolean).join(' · ')}
            </div>
          </div>
          <Btn kind="primary" label={mine ? `Find ${need} targets` : 'Start a trade'} onClick={() => (mine ? findTargets(need) : tradeWith(team.roster_id))} />
        </div>
        <div style={{ fontSize: 17, lineHeight: 1.4, textWrap: 'pretty' }}>
          {headline(row, n)} {verdict(row)}
        </div>
      </div>
      <HeatTiles
        items={[
          { k: 'Value', v: `#${row.ranks.overall}`, colors: rank(row.ranks.overall, n) },
          { k: 'Starters', v: row.ranks.starter ? `#${row.ranks.starter}` : '…', colors: rank(row.ranks.starter, n) },
          { k: 'Age', v: row.avgAge?.toFixed(1) ?? '—', colors: rank(row.ranks.youngest, n) },
          { k: 'Picks', v: `#${row.ranks.picks}`, colors: rank(row.ranks.picks, n) },
        ]}
      />
      <Pills
        value={tab}
        onChange={setTab}
        options={[...POS.map(p => ({ value: p as Pos | 'Picks', label: `${p} #${row.pos[p].rank}` })), { value: 'Picks' as const, label: `Picks #${row.ranks.picks}` }]}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
        {players.map(x => {
          const tag = statusTag(x)
          return (
            <GradCard key={x.id} color={nflColor(x.team)} onClick={() => openPlayer(x.id, x.name)} style={{ padding: '10px 14px' }}>
              <Headshot id={x.id} name={x.name} size={42} />
              <Stack2 title={x.name} sub={[x.team, x.age, x.starter ? 'Starter' : null].filter(v => v != null && v !== '').join(' · ')} />
              {tag && <Tag label={tag.label} tone={tag.tone} />}
              <span className="num" style={{ fontWeight: 700, fontSize: 14 }}>
                {x.rank ? num(x.value) : '–'}
              </span>
            </GradCard>
          )
        })}
        {tab === 'Picks' &&
          row.picks.map((p, i) => (
            <GradCard key={i} color={teamColor(p.orig)} minHeight={58}>
              <Stack2 title={`${p.season} ${ORD[p.round] ?? `R${p.round}`}`} sub={[p.slot ? `projected ${p.slot}` : null, p.via ? `via ${p.via}` : 'own'].filter(Boolean).join(' · ')} />
              <span className="num" style={{ fontWeight: 700, fontSize: 14 }}>
                {num(p.value)}
              </span>
            </GradCard>
          ))}
      </div>
      <div className="small mute">
        {room
          ? `${tab} room: ${num(room.value)} total value, avg age ${room.age?.toFixed(1) ?? '—'}.`
          : row.picks.length
          ? `${row.picks.length} pick${row.picks.length === 1 ? '' : 's'}: ${num(row.pickValue)} total value.`
          : 'No picks owned.'}
      </div>
    </div>
  )
}
