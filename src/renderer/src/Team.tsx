// Team (pushed from Standings, like a player's page): the team-coloured hero with the verdict and
// the next move beside the four heat tiles and its position rooms, then the roster at full width:
// all of it or one position (a room row picks it too), sorted as you like. Click a player for his page.
import { useState } from 'react'
import { ROSTER_SORT, ROSTER_SORTS, type RosterSort } from '@shared/rosterSort'
import { useApp } from './store'
import { Btn, ErrorBox, GradCard, Headshot, HeatChip, HeatTiles, Loading, nflColor, num, ORD, Pills, Seg, Stack2, Tag, TeamAvatar, grad, teamColor, useHeat } from './ui'
import { headline, POS, record, statusTag, thinnest, useOverview, verdict, type Pos, type TeamRow } from './overviewLogic'

type RosterTab = Pos | 'All' | 'Picks'

export default function Team({ rid }: { rid: number }) {
  const { res, data, rows, n, load } = useOverview()
  const row = rows.find(r => r.team.roster_id === rid)
  if (res && !res.ok)
    return (
      <div className="page">
        <ErrorBox message={res.error} onRetry={load} />
      </div>
    )
  if (!row || !data)
    return (
      <div className="page">
        <Loading label="Reading your rankings file…" />
      </div>
    )
  return <TeamBody row={row} n={n} />
}

function TeamBody({ row, n }: { row: TeamRow; n: number }) {
  const { context, findTargets, tradeWith, hide, openPlayer } = useApp()
  const { rank } = useHeat()
  const team = row.team
  const mine = team.roster_id === context?.myRosterId
  const need = thinnest(row)
  const [tab, setTab] = useState<RosterTab>('All')
  const [sort, setSort] = useState<RosterSort>('value')
  const players = tab === 'Picks' ? [] : team.players.filter(x => tab === 'All' || x.pos === tab).sort(ROSTER_SORT[sort])
  const room = tab === 'Picks' || tab === 'All' ? null : row.pos[tab]
  const starters = (p: Pos) => team.players.filter(x => x.pos === p && x.starter).length

  return (
    <div className="page stack" style={{ gap: 28 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)', gap: 24, alignItems: 'stretch' }}>
        <div style={{ padding: 28, borderRadius: 22, background: grad(teamColor(team.roster_id)), display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="row" style={{ gap: 18 }}>
            <TeamAvatar rid={team.roster_id} name={team.team_name} size={76} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-.02em', textWrap: 'balance' }}>{team.team_name}</div>
              <div className="sub" style={{ fontSize: 15, paddingTop: 4 }}>
                {[hide ? null : team.display_name, record(team), row.tier?.name].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <div style={{ fontSize: 18, lineHeight: 1.45, textWrap: 'pretty' }}>
              {headline(row, n)} {verdict(row)}
            </div>
            {row.tier?.why && <div className="small mute">{row.tier.why}</div>}
          </div>
          <div style={{ marginTop: 'auto' }}>
            <Btn kind="primary" size="lg" label={mine ? `Find ${need} targets` : 'Start a trade'} onClick={() => (mine ? findTargets(need) : tradeWith(team.roster_id))} />
          </div>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <HeatTiles
            cols={2}
            items={[
              { k: 'Value', v: `#${row.ranks.overall}`, colors: rank(row.ranks.overall, n) },
              { k: 'Starters', v: row.ranks.starter ? `#${row.ranks.starter}` : '…', colors: rank(row.ranks.starter, n) },
              { k: 'Age', v: row.avgAge?.toFixed(1) ?? '—', colors: rank(row.ranks.youngest, n) },
              { k: 'Picks', v: `#${row.ranks.picks}`, colors: rank(row.ranks.picks, n) },
            ]}
          />
          <div className="card stack" style={{ gap: 4, padding: '10px 8px' }}>
            {[...POS, 'Picks' as const].map(p => {
              const isPicks = p === 'Picks'
              const rk = isPicks ? row.ranks.picks : row.pos[p].rank
              const sub = isPicks
                ? `${row.picks.length} owned`
                : `${team.players.filter(x => x.pos === p).length} players · ${starters(p)} starting · avg age ${row.pos[p].age?.toFixed(1) ?? '—'}`
              return (
                <button
                  key={p}
                  className="row"
                  onClick={() => setTab(p)}
                  style={{ gap: 12, padding: '8px 10px', borderRadius: 12, textAlign: 'left', background: tab === p ? 'var(--surf2)' : 'transparent' }}
                >
                  <span style={{ width: 44, fontWeight: 700 }}>{p}</span>
                  <Stack2 title={num(isPicks ? row.pickValue : row.pos[p].value)} sub={sub} size={14} />
                  <HeatChip label={`#${rk}`} colors={rank(rk, n)} height={30} size={14} />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <Pills
            value={tab}
            onChange={setTab}
            options={[
              { value: 'All' as const, label: `All ${team.players.length}` },
              ...POS.map(p => ({ value: p as RosterTab, label: `${p} #${row.pos[p].rank}` })),
              { value: 'Picks' as const, label: `Picks #${row.ranks.picks}` },
            ]}
          />
          {tab !== 'Picks' && (
            <div className="row" style={{ gap: 10 }}>
              <span className="small mute">Sort</span>
              <Seg value={sort} onChange={setSort} options={ROSTER_SORTS} />
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
          {players.map(x => {
            const tag = statusTag(x)
            return (
              <GradCard key={x.id} color={nflColor(x.team)} minHeight={60} onClick={() => openPlayer(x.id, x.name)} style={{ padding: '8px 14px' }}>
                <Headshot id={x.id} name={x.name} size={40} />
                <Stack2 title={x.name} sub={[tab === 'All' ? x.pos : null, x.team, x.age, x.starter ? 'Starter' : null].filter(v => v != null && v !== '').join(' · ')} />
                {tag && <Tag label={tag.label} tone={tag.tone} />}
                <span className="num" style={{ fontWeight: 700, fontSize: 14 }}>
                  {x.rank ? num(x.value) : '–'}
                </span>
              </GradCard>
            )
          })}
          {tab === 'Picks' &&
            row.picks.map((p, i) => (
              <GradCard key={i} color={teamColor(p.orig)} minHeight={60}>
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
            : tab === 'Picks'
            ? row.picks.length
              ? `${row.picks.length} pick${row.picks.length === 1 ? '' : 's'}: ${num(row.pickValue)} total value.`
              : 'No picks owned.'
            : `${team.players.length} players.`}
        </div>
      </div>
    </div>
  )
}
