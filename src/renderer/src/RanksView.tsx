import { useEffect, useMemo, useState } from 'react'
import type { LeagueContext, RankRow, RanksData, Result } from '@shared/types'
import { InlineError, NextMove, PlayerAvatar, Segmented, SkeletonRows, TeamAvatar } from './ui'
import { teamLabel } from './names'
import './RanksView.css'

type Pos = 'All' | 'QB' | 'RB' | 'WR' | 'TE'
type Owner = 'Everyone' | 'Mine' | 'Others' | 'FA'

/** Tyler's superflex boards, as he ranks them: no model, just who's where and who has them here. */
export default function RanksView(props: { context: LeagueContext; userId: string; sheetVersion: string | undefined; hideNames: boolean }) {
  const leagueId = props.context.league.league_id
  const [res, setRes] = useState<Result<RanksData> | null>(null)
  const [board, setBoard] = useState<number | null>(null)
  const [pos, setPos] = useState<Pos>('All')
  const [owner, setOwner] = useState<Owner>('Everyone')
  const [q, setQ] = useState('')

  const load = () => {
    setRes(null)
    void window.monte.ranks(leagueId, props.userId).then(setRes)
  }
  useEffect(load, [leagueId, props.sheetVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = res?.ok ? res.value : null
  // Open on the board that matches the league: TE premium leagues get the TE-prem block.
  const bi = board ?? (d ? Math.max(0, d.boards.findIndex(b => b.tep === d.tePremium > 0)) : 0)
  const rows = d?.boards[bi]?.rows ?? []
  const me = d?.myRosterId ?? null

  const team = useMemo(() => {
    const m = new Map(d?.teams.map(t => [t.roster_id, t]))
    return (rid: number) => ({
      name: props.hideNames ? teamLabel(rid) : m.get(rid)?.name ?? `Roster ${rid}`,
      // a photo identifies a manager as well as a name, so Hide names drops these too
      avatar: props.hideNames ? null : m.get(rid)?.avatar ?? null,
    })
  }, [d, props.hideNames])

  const needle = q.trim().toLowerCase()
  const shown = rows.filter(
    r =>
      (pos === 'All' || r.pos === pos) &&
      (owner === 'Everyone' ||
        (owner === 'Mine' && me != null && r.owner === me) ||
        (owner === 'Others' && r.owner != null && r.owner !== me) ||
        (owner === 'FA' && r.id != null && r.owner == null)) &&
      (!needle || r.name.toLowerCase().includes(needle)),
  )

  const mine = me == null ? [] : rows.filter(r => r.owner === me)
  const top50 = mine.filter(r => r.rank <= 50).length
  const best = mine[0]
  const fa = rows.find(r => r.id != null && r.owner == null && r.pos !== 'K' && r.pos !== 'DST')

  return (
    <div className="rk2-page">
      {d && me != null && (
        <NextMove
          head={`You roster ${top50} of the top 50 on this board.`}
          sub={[
            best && `Highest: ${best.name}, #${best.rank} (${best.pos}${best.posRank}).`,
            fa && `Best free agent: ${fa.name}, #${fa.rank}.`,
          ]
            .filter(Boolean)
            .join(' ')}
          actions={[
            { label: owner === 'Mine' ? 'Show everyone' : 'Show my players', primary: true, onClick: () => setOwner(o => (o === 'Mine' ? 'Everyone' : 'Mine')) },
            { label: 'Show free agents', onClick: () => setOwner('FA') },
          ]}
        />
      )}

      <div className="rk2-filters">
        {d && d.boards.length > 1 && (
          <Segmented<number>
            value={bi}
            onChange={setBoard}
            options={d.boards.map((b, i) => ({ value: i, label: b.tep ? 'SF · TE Prem' : 'SF · No TE Prem' }))}
          />
        )}
        <span className="rk2-ctl">
          <span className="lbl">Position</span>
          <Segmented<Pos> value={pos} onChange={setPos} options={(['All', 'QB', 'RB', 'WR', 'TE'] as Pos[]).map(v => ({ value: v, label: v }))} />
        </span>
        <span className="rk2-ctl">
          <span className="lbl">Owner</span>
          <Segmented<Owner> value={owner} onChange={setOwner} options={(['Everyone', 'Mine', 'Others', 'FA'] as Owner[]).map(v => ({ value: v, label: v }))} />
        </span>
        <input className="search" placeholder="Search players" value={q} onChange={e => setQ(e.target.value)} />
        <span className="grow" />
        {d && (
          <span className="rk2-meta" title={d.boards[bi]?.label}>
            {shown.length} of {rows.length} · {d.sheet.name} › {d.sheet.tab}
          </span>
        )}
      </div>

      {res && !res.ok && <InlineError message={res.error} onRetry={load} />}

      <div className="rk2-table">
        <div className="rk2-row head">
          <span className="r">Rank</span>
          <span>Player</span>
          <span>Pos</span>
          <span>Team</span>
          <span className="r">Age</span>
          <span>Owner</span>
        </div>
        {!d && !(res && !res.ok) && <SkeletonRows n={14} />}
        {d && shown.length === 0 && <div className="rk2-empty">No players match these filters.</div>}
        {shown.map(r => (
          <Row
            key={`${r.rank}:${r.name}`}
            r={r}
            mine={me != null && r.owner === me}
            // On the Mine filter every row is yours; tinting them all would just colour the table.
            tint={owner !== 'Mine'}
            owner={r.owner == null ? null : team(r.owner)}
          />
        ))}
      </div>
    </div>
  )
}

function Row({ r, mine, tint, owner }: { r: RankRow; mine: boolean; tint: boolean; owner: { name: string; avatar: string | null } | null }) {
  return (
    <div className={`rk2-row ${mine && tint ? 'mine' : ''}`}>
      <span className="r rk2-rank">{r.rank}</span>
      <span className="rk2-player">
        {r.id ? <PlayerAvatar id={r.id} name={r.name} size={24} /> : <span className="rk2-noav" />}
        <span className="nm">{r.name}</span>
        {r.injury && <span className="status warn">{r.injury}</span>}
      </span>
      <span className="rk2-pos">
        {r.pos}
        {r.posRank}
      </span>
      <span className="rk2-mono">{r.team || '—'}</span>
      <span className="r rk2-mono">{r.age ?? '—'}</span>
      <span className="rk2-owner">
        {r.id == null ? (
          <span className="faint" title="This sheet name didn't match a Sleeper player">
            not matched
          </span>
        ) : mine ? (
          <span className="you">You</span>
        ) : owner ? (
          <>
            <TeamAvatar src={owner.avatar} name={owner.name} size={18} />
            <span className="nm">{owner.name}</span>
          </>
        ) : (
          <span className="faint">FA</span>
        )}
      </span>
    </div>
  )
}
