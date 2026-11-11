// Team (pushed from Standings, like a player's page): the team-coloured hero with the verdict and
// the next move beside the four heat tiles and its position rooms, then the roster at full width:
// all of it or one position (a room row picks it too). The roster opens as Sleeper draws it, starters
// in their slots then the bench, IR and taxi squad; Value / Position / Youngest sort it instead.
// Click a player for his page.
import { useMemo, useState } from 'react'
import { lineupSections, ROSTER_SORT, ROSTER_VIEWS, type LineupRow, type RosterView } from '@shared/rosterSort'
import type { OvPlayer } from '@shared/types'
import { TeamSchedule } from './Schedule'
import { useApp } from './store'
import { Btn, ErrorBox, GradCard, Headshot, HeatChip, HeatTiles, Loading, nflColor, num, ORD, Pills, Seg, Stack2, Tag, TeamAvatar, grad, teamColor, useHeat } from './ui'
import { headline, POS, record, ROLE_HELP, ROLES, roleValues, statusTag, thinnest, useOverview, verdict, type Pos, type Role, type TeamRow } from './overviewLogic'

type RosterTab = Pos | 'All' | 'Picks' | 'Schedule'

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
  return <TeamBody row={row} rows={rows} n={n} />
}

function TeamBody({ row, rows, n }: { row: TeamRow; rows: TeamRow[]; n: number }) {
  const { context, findTargets, tradeWith, hide, openPlayer } = useApp()
  const { rank } = useHeat()
  const team = row.team
  const mine = team.roster_id === context?.myRosterId
  const need = thinnest(row)
  const [tab, setTab] = useState<RosterTab>('All')
  const [view, setView] = useState<RosterView>('lineup')
  const notRoster = tab === 'Picks' || tab === 'Schedule'
  const lineup = !notRoster && view === 'lineup'
  const sections = lineup ? lineupSections(team, tab === 'All' ? undefined : tab) : []
  const players = notRoster || lineup ? [] : team.players.filter(x => tab === 'All' || x.pos === tab).sort(ROSTER_SORT[view as Exclude<RosterView, 'lineup'>])
  const room = notRoster || tab === 'All' ? null : row.pos[tab]
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
          <ValueRadar row={row} rows={rows} n={n} />
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
              { value: 'Schedule' as const, label: 'Schedule' },
            ]}
          />
          {!notRoster && (
            <div className="row" style={{ gap: 10 }}>
              <span className="small mute">View</span>
              <Seg value={view} onChange={setView} options={ROSTER_VIEWS} />
            </div>
          )}
        </div>
        {sections.map(s => (
          <div key={s.title} className="stack" style={{ gap: 8 }}>
            <span className="title-l">
              {s.title} <span className="mute" style={{ fontWeight: 500 }}>{s.rows.length}</span>
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
              {s.rows.map(r => (
                <SlotCard key={r.key} row={r} starter={s.title === 'Starters'} onOpen={openPlayer} />
              ))}
            </div>
          </div>
        ))}
        {lineup && !sections.length && <div className="mute">No {tab === 'All' ? '' : `${tab}s `}on this roster.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
          {players.map(x => {
            const tag = statusTag(x)
            return (
              <GradCard key={x.id} color={nflColor(x.team)} minHeight={60} onClick={() => openPlayer(x.id, x.name)} style={{ padding: '8px 14px' }}>
                <Headshot id={x.id} name={x.name} size={40} />
                <Stack2 title={x.name} sub={playerSub(x, tab === 'All', true)} />
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
        {tab === 'Schedule' && <TeamSchedule rid={team.roster_id} />}
        {tab !== 'Schedule' && (
          <div className="small mute">
            {room
              ? `${tab} room: ${num(room.value)} total value, avg age ${room.age?.toFixed(1) ?? '—'}.`
              : tab === 'Picks'
              ? row.picks.length
                ? `${row.picks.length} pick${row.picks.length === 1 ? '' : 's'}: ${num(row.pickValue)} total value.`
                : 'No picks owned.'
              : `${team.players.length} players.`}
          </div>
        )}
      </div>
    </div>
  )
}

const playerSub = (x: OvPlayer, showPos: boolean, showStarter: boolean) =>
  [showPos ? x.pos : null, x.team, x.age, showStarter && x.starter ? 'Starter' : null].filter(v => v != null && v !== '').join(' · ')

/** A lineup row: the slot badge (QB, FLEX, SF… or the bench position / IR / TX), then the player.
 * Starters wear their NFL colour; the bench, IR and taxi sit on plain cards, as in Lineup. */
function SlotCard({ row, starter, onOpen }: { row: LineupRow; starter: boolean; onOpen: (id: string, name: string) => void }) {
  const x = row.player
  // The IR and taxi sections already say so; keep the injury tag only.
  const tag = x && statusTag(x)
  const shown = tag && !(row.badge === 'IR' && tag.label === 'IR') && !(row.badge === 'TX' && tag.label === 'Taxi') ? tag : null
  return (
    <GradCard
      color={starter && x ? nflColor(x.team) : null}
      minHeight={60}
      onClick={x ? () => onOpen(x.id, x.name) : undefined}
      style={{ padding: '8px 14px 8px 10px' }}
    >
      <span
        style={{
          width: 46,
          height: 28,
          flex: 'none',
          borderRadius: 9,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--surf2)',
          color: starter ? 'var(--ink)' : 'var(--mute)',
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {row.badge}
      </span>
      {x ? (
        <>
          <Headshot id={x.id} name={x.name} size={40} />
          <Stack2 title={x.name} sub={playerSub(x, starter, false)} />
          {shown && <Tag label={shown.label} tone={shown.tone} />}
          <span className="num" style={{ fontWeight: 700, fontSize: 14 }}>
            {x.rank ? num(x.value) : '–'}
          </span>
        </>
      ) : (
        <>
          <span style={{ width: 40 }} />
          <Stack2 title={row.name ?? 'Empty'} sub={row.name ? row.pos : 'No one in this slot'} titleStyle={row.name ? undefined : { color: 'var(--mute)', fontWeight: 600 }} />
        </>
      )}
    </GradCard>
  )
}

/** Value share: what fraction of the league's total value in each bucket this team holds, as a
 * radar. By position (QB, RB, WR, TE, picks) or by role (core, win-now, upside, depth, picks; see
 * rolesOf). Shares cluster near an even split (1/n), so the radius is the share against that split on
 * a log scale: the dashed ring at mid-radius is even, the rim is double (or more, clipped) and the
 * centre half (or less). 13% against a 10% split then reads as the edge it is. */
type Breakdown = 'pos' | 'role'
let lastBreakdown: Breakdown = 'pos'

function ValueRadar({ row, rows, n }: { row: TeamRow; rows: TeamRow[]; n: number }) {
  const [mode, setModeState] = useState<Breakdown>(lastBreakdown)
  const setMode = (m: Breakdown) => setModeState((lastBreakdown = m))
  const [hover, setHover] = useState<string | null>(null)

  const { buckets, val } = useMemo(() => {
    if (mode === 'pos') {
      const b = [...POS, 'Picks'] as string[]
      return { buckets: b, val: (r: TeamRow, k: string) => (k === 'Picks' ? r.pickValue : r.pos[k as Pos].value) }
    }
    const by = new Map(rows.map(r => [r, roleValues(r)]))
    return { buckets: [...ROLES, 'Picks'] as string[], val: (r: TeamRow, k: string) => by.get(r)![k as Role | 'Picks'] }
  }, [mode, rows])

  const totals = Object.fromEntries(buckets.map(b => [b, rows.reduce((s, r) => s + val(r, b), 0)]))
  const share = (r: TeamRow, b: string) => (totals[b] > 0 ? val(r, b) / totals[b] : 0)
  const rankIn = (b: string) => 1 + rows.filter(r => val(r, b) > val(row, b)).length
  const even = 1 / Math.max(1, n)
  /** times an even split */
  const idx = (v: number) => v / even
  /** radius fraction: ½× or less at the centre, even at the middle, 2× or more at the rim */
  const rad = (v: number) => Math.min(1, Math.max(0, 0.5 + Math.log2(Math.max(idx(v), 1e-9)) / 2))
  const leagueTotal = rows.reduce((s, r) => s + r.value, 0)
  const overall = leagueTotal > 0 ? row.value / leagueTotal : 0
  const mix = buckets.map(b => [b, row.value > 0 ? val(row, b) / row.value : 0] as const)

  const W = 300
  const H = 230
  const cx = W / 2
  const cy = H / 2 + 4
  const R = 78
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / buckets.length
  /** a point on spoke i at radius fraction f */
  const pt = (i: number, f: number) => [cx + Math.cos(ang(i)) * R * f, cy + Math.sin(ang(i)) * R * f] as const
  const poly = (fs: number[]) => fs.map((f, i) => pt(i, f).join(',')).join(' ')
  const times = (v: number) => `${idx(v).toFixed(1)}×`
  const color = teamColor(row.team.roster_id)
  const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`
  const grid = 'color-mix(in oklab, var(--ink) 12%, transparent)'

  return (
    <div className="row" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Share of league value: ${buckets.map(b => `${b} ${pct(share(row, b))}`).join(', ')}`} style={{ flex: 'none', overflow: 'visible' }}>
        {[0.25, 0.75, 1].map(f => (
          <polygon key={f} points={poly(buckets.map(() => f))} fill="none" stroke={grid} strokeWidth={1} />
        ))}
        {buckets.map((_, i) => {
          const [x, y] = pt(i, 1)
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={grid} strokeWidth={1} />
        })}
        <polygon points={poly(buckets.map(() => 0.5))} fill="none" stroke="var(--mute)" strokeWidth={1.5} strokeDasharray="4 4" />
        <polygon points={poly(buckets.map(b => rad(share(row, b))))} fill={`color-mix(in oklab, ${color} 28%, transparent)`} stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {buckets.map((b, i) => {
          const [x, y] = pt(i, rad(share(row, b)))
          const [lx, ly] = pt(i, 1.24)
          const anchor = Math.abs(lx - cx) < 4 ? 'middle' : lx > cx ? 'start' : 'end'
          return (
            <g key={b} onMouseEnter={() => setHover(b)} onMouseLeave={() => setHover(null)}>
              <circle cx={x} cy={y} r={hover === b ? 6 : 4.5} fill={color} stroke="var(--card)" strokeWidth={2} />
              <text x={lx} y={ly - 2} textAnchor={anchor} fontSize={12} fontWeight={700} fill="var(--ink)">
                {b}
              </text>
              <text x={lx} y={ly + 12} textAnchor={anchor} fontSize={12} fill="var(--ink2)">
                {times(share(row, b))}
              </text>
              <rect x={Math.min(lx, x) - 24} y={Math.min(ly, y) - 18} width={Math.abs(lx - x) + 48} height={Math.abs(ly - y) + 36} fill="transparent" />
            </g>
          )
        })}
      </svg>
      <div className="stack" style={{ gap: 8, minWidth: 170, flex: 1 }}>
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { value: 'pos' as const, label: 'Position' },
            { value: 'role' as const, label: 'Role' },
          ]}
        />
        <div className="stack" style={{ gap: 2 }}>
          <span className="small mute">Share of league value</span>
          <span className="num" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>
            {pct(overall)}
          </span>
          <span className="small mute">Spokes are × an even split ({pct(even)}, the dashed ring); the rim is 2×.</span>
        </div>
        <div className="small" style={{ minHeight: 38, color: 'var(--ink2)', textWrap: 'pretty' }}>
          {hover
            ? `${hover}${mode === 'role' ? ` (${ROLE_HELP[hover as Role | 'Picks']})` : ''}: ${pct(share(row, hover))} of the league's ${num(totals[hover])} (${times(share(row, hover))} even), #${rankIn(hover)} of ${n}.`
            : `Mix: ${mix.map(([b, f]) => `${b} ${Math.round(f * 100)}%`).join(' · ')}`}
        </div>
      </div>
    </div>
  )
}
