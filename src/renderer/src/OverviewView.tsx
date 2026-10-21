import { useEffect, useMemo, useState } from 'react'
import type { BBResult, LeagueContext, OverviewData, OvPlayer, OvTeam, Result } from '@shared/types'
import type { Run } from './App'
import { InlineError, NextMove, PlayerAvatar, Segmented, SkeletonRows, TeamAvatar } from './ui'
import './OverviewView.css'
import { anonOverview } from './names'

const POS = ['QB', 'RB', 'WR', 'TE'] as const
type Pos = (typeof POS)[number]
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th']
const num = (v: number) => Math.round(v).toLocaleString()

type Tier = 'Contender' | 'Last dance' | 'Frisky' | 'Fraud' | 'Rebuilding'

/**
 * Tier thresholds, as fractions of the league size so they work for 10 or 12 teams. The spec
 * asks for these to be configurable; this is the one place to change them.
 */
export const TIER_RULES = {
  /** Fraud: record at or above this fraction while starters are below it */
  fraudRecord: 0.5,
  /** Contender: starters in this top fraction, and value in the top `contenderValue` */
  contenderStarters: 1 / 3,
  contenderValue: 0.5,
  /** Last dance: starters in the top half but value in the bottom half, or this average age */
  lastDanceAge: 27,
  /** Frisky: starters outside this bottom fraction, value in the top half */
  friskyStarterFloor: 1 / 3,
}

type Row = {
  team: OvTeam
  value: number
  pos: Record<Pos, { value: number; age: number | null; rank: number }>
  picks: Array<{ season: string; round: number; orig: number; via: string | null; value: number; slot: string | null }>
  pickValue: number
  avgAge: number | null
  ranks: { overall: number; starter: number | null; picks: number; record: number; youngest: number }
  starterPPG: number | null
  needs: Pos[]
  deep: Pos[]
  tier: { name: Tier; why: string } | null
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** 1-based rank of every key by a score, best first. */
function rankBy<K>(keys: K[], score: (k: K) => number): Map<K, number> {
  return new Map([...keys].sort((a, b) => score(b) - score(a)).map((k, i) => [k, i + 1]))
}

/**
 * Contender tier: a transparent rule on starter rank (points: the sim's projected optimal lineup,
 * never dynasty value), value rank and record, checked in this order:
 *   Fraud       record in the top half but starters in the bottom half (winning past the roster)
 *   Contender   starters in the top third and value in the top half
 *   Last dance  starters in the top half but value in the bottom half, or an old roster
 *   Frisky      starters outside the bottom third and value in the top half
 *   Rebuilding  everything else
 */
function tierOf(r: Omit<Row, 'tier'>, n: number): Row['tier'] {
  const s = r.ranks.starter
  if (s == null) return null
  const R = TIER_RULES
  const o = r.ranks.overall
  const old = (r.avgAge ?? 0) >= R.lastDanceAge
  if (r.ranks.record <= n * R.fraudRecord && s > n * R.fraudRecord)
    return { name: 'Fraud', why: `record #${r.ranks.record} but starters #${s}: winning past the roster` }
  if (s <= n * R.contenderStarters && o <= n * R.contenderValue) return { name: 'Contender', why: `starters #${s} and value #${o}` }
  if (s <= n / 2 && (o > n / 2 || old))
    return { name: 'Last dance', why: `starters #${s} but value #${o}${old ? `, avg age ${r.avgAge!.toFixed(1)}` : ''}` }
  if (s <= n - n * R.friskyStarterFloor && o <= n / 2) return { name: 'Frisky', why: `starters #${s}, value #${o}: young and close` }
  return { name: 'Rebuilding', why: `starters #${s}, value #${o}` }
}

function buildRows(data: OverviewData, bb: BBResult | undefined): Row[] {
  const n = data.teams.length
  const bbBy = new Map(bb?.teams.map(t => [t.roster_id, t]))
  const name = new Map(data.teams.map(t => [t.roster_id, t.display_name]))
  const curve = (rd: number, slot: number) => data.pickCurve[(rd - 1) * n + slot - 1] ?? 0
  const weeksLeft = bb ? Math.max(1, bb.weeks.length - bb.lastScoredWeek) : 1
  const seasons = [...new Set(data.picks.map(p => p.season))].sort()

  // Next draft: expected value over the sim's slot distribution. Later drafts: slot unknown,
  // so the round's average.
  const pickEV = (season: string, rd: number, orig: number) => {
    const disc = data.discount[seasons.indexOf(season)] ?? data.discount[data.discount.length - 1]
    const dist = season === data.season ? bbBy.get(orig)?.slotDist : undefined
    const ev = dist
      ? dist.reduce((s, p, k) => s + p * curve(rd, k + 1), 0)
      : Array.from({ length: n }, (_, k) => curve(rd, k + 1)).reduce((a, b) => a + b, 0) / n
    return ev * disc
  }
  const slotOf = new Map(
    [...(bb?.teams ?? [])].sort((a, b) => a.meanDraftSlot - b.meanDraftSlot).map((t, i) => [t.roster_id, i + 1]),
  )

  const base = data.teams.map(team => {
    const pos = Object.fromEntries(
      POS.map(p => {
        const ps = team.players.filter(x => x.pos === p)
        return [p, { value: ps.reduce((s, x) => s + x.value, 0), age: mean(ps.flatMap(x => (x.age == null ? [] : [x.age]))), rank: 0 }]
      }),
    ) as Row['pos']
    const picks = data.picks
      .filter(p => p.ownerRosterId === team.roster_id)
      .sort(
        (a, b) =>
          a.season.localeCompare(b.season) ||
          a.round - b.round ||
          (slotOf.get(a.originalRosterId) ?? 99) - (slotOf.get(b.originalRosterId) ?? 99),
      )
      .map(p => ({
        season: p.season,
        round: p.round,
        orig: p.originalRosterId,
        via: p.originalRosterId === team.roster_id ? null : name.get(p.originalRosterId) ?? null,
        value: pickEV(p.season, p.round, p.originalRosterId),
        slot: p.season === data.season && slotOf.has(p.originalRosterId) ? `${p.round}.${String(slotOf.get(p.originalRosterId)).padStart(2, '0')}` : null,
      }))
    const pickValue = picks.reduce((s, p) => s + p.value, 0)
    const playerValue = team.players.reduce((s, x) => s + x.value, 0)
    const t = bbBy.get(team.roster_id)
    return {
      team,
      value: playerValue + pickValue,
      pos,
      picks,
      pickValue,
      avgAge: mean(team.players.flatMap(x => (x.age == null ? [] : [x.age]))),
      starterPPG: t ? t.rosMaxPF / weeksLeft : null,
      ranks: { overall: 0, starter: null as number | null, picks: 0, record: 0, youngest: 0 },
      needs: [] as Pos[],
      deep: [] as Pos[],
    }
  })

  const ids = base.map(b => b.team.roster_id)
  const by = new Map(base.map(b => [b.team.roster_id, b]))
  const overall = rankBy(ids, id => by.get(id)!.value)
  const picksR = rankBy(ids, id => by.get(id)!.pickValue)
  const record = rankBy(ids, id => {
    const t = by.get(id)!.team
    return t.wins + t.ties / 2 + t.pf / 1e6
  })
  const starter = bb ? rankBy(ids, id => by.get(id)!.starterPPG ?? 0) : null
  const youngest = rankBy(ids, id => -(by.get(id)!.avgAge ?? 99))
  const posR = Object.fromEntries(POS.map(p => [p, rankBy(ids, id => by.get(id)!.pos[p].value)])) as Record<Pos, Map<number, number>>

  return base
    .map(b => {
      const id = b.team.roster_id
      for (const p of POS) b.pos[p].rank = posR[p].get(id)!
      b.ranks = {
        overall: overall.get(id)!,
        starter: starter?.get(id) ?? null,
        picks: picksR.get(id)!,
        record: record.get(id)!,
        youngest: youngest.get(id)!,
      }
      // Spec: thin = bottom 3 at a position, deepest = top 2.
      b.needs = POS.filter(p => b.pos[p].rank > n - 3)
      b.deep = POS.filter(p => b.pos[p].rank <= 2)
      return { ...b, tier: tierOf(b, n) }
    })
    .sort((a, b) => a.ranks.overall - b.ranks.overall)
}


/** Rank cell: green tint for the top 3 (deepest at #1), red text for the bottom 3, plain otherwise. */
function rankStyle(rank: number | null, n: number): React.CSSProperties {
  if (rank == null) return { background: 'var(--card)', color: 'var(--mute)' }
  if (rank <= 3)
    return {
      background: `color-mix(in oklab, var(--pos) ${rank === 1 ? 28 : rank === 2 ? 20 : 13}%, var(--card2))`,
      color: 'var(--pos)',
      fontWeight: 600,
    }
  if (rank > n - 3) return { background: 'var(--card2)', color: 'var(--neg)', fontWeight: 600 }
  return { background: 'var(--card)', color: 'var(--ink2)' }
}

/** Small rank chip for roster group headers: tinted for the top and bottom 3. */
function RankChip({ rank, n }: { rank: number; n: number }) {
  const cls = rank <= 3 ? 'pos' : rank > n - 3 ? 'neg' : ''
  return <span className={`ov2-chip ${cls}`}>#{rank}</span>
}

type SortKey = 'overall' | 'starter' | Pos | 'picks'
const COLS: Array<{ key: SortKey; label: string }> = [
  { key: 'overall', label: 'Overall' },
  { key: 'starter', label: 'Starters' },
  { key: 'QB', label: 'QB' },
  { key: 'RB', label: 'RB' },
  { key: 'WR', label: 'WR' },
  { key: 'TE', label: 'TE' },
  { key: 'picks', label: 'Picks' },
]

const rankOf = (r: Row, k: SortKey): number | null =>
  k === 'overall' ? r.ranks.overall : k === 'starter' ? r.ranks.starter : k === 'picks' ? r.ranks.picks : r.pos[k].rank

function statusTag(p: OvPlayer): { label: string; tone: 'neg' | 'warn' | 'muted' } | null {
  if (p.ir || p.injury === 'IR') return { label: 'IR', tone: 'neg' }
  const s = p.injury
  if (s === 'Out' || s === 'Sus' || s === 'PUP' || s === 'NFI') return { label: s, tone: 'neg' }
  if (s === 'Questionable') return { label: 'Q', tone: 'warn' }
  if (s === 'Doubtful') return { label: 'D', tone: 'warn' }
  if (p.taxi) return { label: 'Taxi', tone: 'muted' }
  return null
}

const joinAnd = (xs: string[]) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const record = (t: OvTeam) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`
/** The position where a team ranks worst: what "thinnest" means in the CTA and Next-move bar. */
const thinnest = (r: Row): Pos => [...POS].sort((a, b) => r.pos[b].rank - r.pos[a].rank)[0]

function verdict(r: Row): string {
  const S = r.ranks.starter
  const O = r.ranks.overall
  const s1 = S == null ? `Total value #${O}; starter rank is still simulating.` : `Starters #${S}, total value #${O}.`
  const parts = [r.deep.length ? `Deepest at ${joinAnd(r.deep)}` : '', r.needs.length ? `thin at ${joinAnd(r.needs)}` : ''].filter(Boolean)
  const s2 = parts.length ? `${parts.join(', ')}.` : 'No thin spots.'
  return `${s1} ${s2.charAt(0).toUpperCase()}${s2.slice(1)}`
}

type TradeLinks = {
  onAsset: (assetId: string, owner: number) => void
  onFindTargets: (pos: string) => void
  onTradeWith: (owner: number) => void
}

function Detail({ row, n, mine, nextDraft, links }: { row: Row; n: number; mine: boolean; nextDraft: string; links: TradeLinks }) {
  const t = row.team
  const need = thinnest(row)
  const current = row.picks.filter(p => p.season === nextDraft)
  const future = [...new Set(row.picks.filter(p => p.season !== nextDraft).map(p => p.season))].map(season => {
    const ps = row.picks.filter(p => p.season === season)
    const counts = new Map<number, number>()
    for (const p of ps) counts.set(p.round, (counts.get(p.round) ?? 0) + 1)
    const rounds = [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rd, c]) => `${ORD[rd] ?? `R${rd}`}${c > 1 ? ` ×${c}` : ''}`)
    return { season, label: `${season} ${rounds.join(' · ')}`, value: ps.reduce((s, p) => s + p.value, 0) }
  })
  const stats = [
    { k: 'Overall', v: `#${row.ranks.overall}`, sub: num(row.value) },
    { k: 'Starters', v: row.ranks.starter ? `#${row.ranks.starter}` : '—', sub: row.starterPPG ? `${row.starterPPG.toFixed(1)}/wk` : 'simulating' },
    { k: 'Avg age', v: row.avgAge?.toFixed(1) ?? '—', sub: `#${row.ranks.youngest} youngest` },
    { k: 'Picks', v: `#${row.ranks.picks}`, sub: num(row.pickValue) },
  ]
  return (
    <aside className="ov2-panel">
      <div className="ov2-phead">
        <div className="ov2-id">
          <TeamAvatar src={t.avatar} name={t.team_name} size={52} />
          <div style={{ minWidth: 0 }}>
            <div className="ov2-pname">{t.team_name}</div>
            <div className="ov2-pmeta">
              {t.display_name} · {record(t)}
              {row.tier && ` · ${row.tier.name}`}
            </div>
          </div>
        </div>
        <div className="ov2-verdict">{verdict(row)}</div>
        <button className="btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => (mine ? links.onFindTargets(need) : links.onTradeWith(t.roster_id))}>
          {mine ? `Find ${need} targets` : `Trade with ${t.team_name}`}
        </button>
      </div>
      <div className="ov2-stats">
        {stats.map(s => (
          <div key={s.k}>
            <div className="k">{s.k}</div>
            <div className="v">{s.v}</div>
            <div className="sub">{s.sub}</div>
          </div>
        ))}
      </div>
      {POS.map(p => {
        const ps = t.players.filter(x => x.pos === p).sort((a, b) => b.value - a.value)
        return (
          <div key={p} className="ov2-group">
            <div className="gh">
              <b>{p}</b>
              <RankChip rank={row.pos[p].rank} n={n} />
              <span className="grow" />
              <span className="gm">{ps.length ? `${num(row.pos[p].value)} val · ${row.pos[p].age?.toFixed(1) ?? '—'} age` : 'none rostered'}</span>
            </div>
            {ps.map(x => {
              const tag = statusTag(x)
              return (
                <button
                  key={x.id}
                  className="ov2-item"
                  title={`${mine ? 'Offer in Trades' : `Target from ${t.team_name}`}${x.rank ? ` · Tyler #${x.rank}` : ' · unranked'}`}
                  onClick={() => links.onAsset(x.id, t.roster_id)}
                >
                  <PlayerAvatar id={x.id} name={x.name} size={26} />
                  <span className="nm">
                    <span style={{ fontWeight: x.starter ? 600 : 400 }}>{x.name}</span>{' '}
                    <span className="sub">
                      {x.team}
                      {x.age ? ` · ${x.age}` : ''}
                    </span>
                  </span>
                  <span>{tag && <span className={`ov2-tag ${tag.tone}`}>{tag.label}</span>}</span>
                  <span className="v">{x.rank ? num(x.value) : '–'}</span>
                </button>
              )
            })}
          </div>
        )
      })}
      <div className="ov2-group">
        <div className="gh">
          <b>Picks</b>
          <RankChip rank={row.ranks.picks} n={n} />
          <span className="grow" />
          <span className="gm">{num(row.pickValue)} val</span>
        </div>
        {current.map((p, i) => (
          <button key={i} className="ov2-item nopic" title="Open in Trades" onClick={() => links.onAsset(`pick:${p.season}:${p.round}:${p.orig}`, t.roster_id)}>
            <span className="nm">
              <span style={{ fontWeight: 600 }}>
                {p.season} {ORD[p.round] ?? `R${p.round}`}
              </span>{' '}
              <span className="sub">
                {p.slot ?? ''}
                {p.via ? `${p.slot ? ' · ' : ''}via ${p.via}` : ''}
              </span>
            </span>
            <span />
            <span className="v">{num(p.value)}</span>
          </button>
        ))}
        {future.map(f => (
          <button key={f.season} className="ov2-item nopic" title="Open Trades" onClick={() => (mine ? links.onFindTargets('All') : links.onTradeWith(t.roster_id))}>
            <span className="nm">{f.label}</span>
            <span />
            <span className="v">{num(f.value)}</span>
          </button>
        ))}
        {row.picks.length === 0 && <div className="ov2-none">No picks owned.</div>}
      </div>
      <div className="ov2-foot">Starters in bold. Click a player or pick to open it in Trades.</div>
    </aside>
  )
}

function LeagueMap({ rows, n, me, sel, onSelect }: { rows: Row[]; n: number; me: number | null; sel: number | undefined; onSelect: (rid: number) => void }) {
  const span = Math.max(1, n - 1)
  return (
    <div className="ov2-mapcard">
      <div className="ov2-map">
        <div className="vline" />
        <div className="hline" />
        <div className="corner tl">Rich later, weak now</div>
        <div className="corner tr" style={{ color: 'var(--pos)' }}>
          Strong both ways
        </div>
        <div className="corner bl" style={{ color: 'var(--neg)' }}>
          Stuck
        </div>
        <div className="corner br">Win-now, aging</div>
        {rows.map(r => {
          const id = r.team.roster_id
          const s = r.ranks.starter
          // Bubbles are inset so they never sit on the corner labels.
          const left = s == null ? 51 : 10 + ((n - s) / span) * 82
          const top = 15 + ((r.ranks.overall - 1) / span) * 76
          const on = id === sel
          const ring = on ? '0 0 0 3px var(--card2), 0 0 0 5px var(--acc)' : id === me ? '0 0 0 2px var(--acc)' : 'none'
          return (
            <button
              key={id}
              className="ov2-bubble"
              style={{ left: `${left}%`, top: `${top}%`, zIndex: on ? 3 : 1 }}
              onClick={() => onSelect(id)}
              title={`${r.team.team_name} · starters #${s ?? '—'} · value #${r.ranks.overall}`}
            >
              <span className="b" style={{ boxShadow: ring }}>
                <TeamAvatar src={r.team.avatar} name={r.team.team_name} size={44} />
              </span>
              <span className="lbl">{r.team.team_name}</span>
            </button>
          )
        })}
      </div>
      <div className="ov2-axes">
        <span>↑ Total roster value</span>
        <span>Starter strength →</span>
      </div>
    </div>
  )
}

export default function OverviewView(
  props: {
    context: LeagueContext
    bb: Run<BBResult>
    runBB: () => void
    sheetVersion: string | undefined
    hideNames: boolean
    selected: number | null
    onSelect: (rid: number) => void
    onPickOdds: () => void
  } & TradeLinks,
) {
  const { context, bb } = props
  const [res, setRes] = useState<Result<OverviewData> | null>(null)
  const [sort, setSort] = useState<SortKey>('overall')
  const [view, setView] = useState<'Table' | 'Map'>('Table')

  const load = () => {
    setRes(null)
    void window.monte.leagueOverview(context.league.league_id).then(setRes)
  }
  // Reload when the league or the rankings file changes.
  useEffect(load, [context.league.league_id, props.sheetVersion]) // eslint-disable-line react-hooks/exhaustive-deps
  // Starter ranks and pick values need the sim; start it if this league has none yet.
  useEffect(() => {
    if (!bb.result && !bb.busy && !bb.error) props.runBB()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => (res?.ok ? (props.hideNames ? anonOverview(res.value) : res.value) : null), [res, props.hideNames])
  const rows = useMemo(() => (data ? buildRows(data, bb.result) : []), [data, bb.result])
  const n = data?.teams.length ?? context.rosters.length
  const ordered = useMemo(() => [...rows].sort((a, b) => (rankOf(a, sort) ?? 99) - (rankOf(b, sort) ?? 99)), [rows, sort])

  const myRow = rows.find(r => r.team.roster_id === context.myRosterId)
  const detail = rows.find(r => r.team.roster_id === (props.selected ?? context.myRosterId)) ?? ordered[0]

  const need = myRow && thinnest(myRow)
  const move = myRow && need && (
    <NextMove
      head={`You're #${myRow.ranks.overall} in total value and ${myRow.ranks.starter ? `#${myRow.ranks.starter}` : 'still simulating'} in starters.`}
      sub={`${need} is your thinnest spot (#${myRow.pos[need].rank} of ${n}).`}
      actions={[
        { label: `Find ${need} targets`, onClick: () => props.onFindTargets(need), primary: true },
        { label: 'See pick odds', onClick: props.onPickOdds },
      ]}
    />
  )

  return (
    <div className="ov2-page">
      {move}
      <div className="ov2-layout">
        <div className="ov2-left">
          <div className="ov2-bar">
            <Segmented<'Table' | 'Map'> value={view} onChange={setView} options={['Table', 'Map'].map(v => ({ value: v as 'Table' | 'Map', label: v }))} />
            <span className="ov2-src">
              {data
                ? `Values from ${data.sheet.name} · ${data.sheet.ranked} players matched`
                : res && !res.ok
                ? ''
                : 'Reading your rankings file…'}
              {bb.busy ? ' · simulating starters…' : ''}
            </span>
          </div>
          {res && !res.ok && <InlineError message={res.error} onRetry={load} />}
          {bb.error && <InlineError message={`Starter ranks need the sim, which failed: ${bb.error}`} onRetry={props.runBB} />}
          {data && data.sheet.unmatched.length > 0 && (
            <div className="ov2-src">
              Couldn’t match {data.sheet.unmatched.length} sheet names to Sleeper: {data.sheet.unmatched.slice(0, 8).join(', ')}
              {data.sheet.unmatched.length > 8 ? '…' : ''}
            </div>
          )}

          {view === 'Table' ? (
            <div className="ov2-table">
              <div className="ov2-inner">
                <div className="ov2-head">
                  <span>Team</span>
                  <span>W-L</span>
                  <span className="ov2-tier ov2-tier-h">Tier</span>
                  {COLS.map(c => (
                    <button key={c.key} className={c.key === sort ? 'on' : ''} onClick={() => setSort(c.key)}>
                      {c.label}
                      {c.key === sort ? ' ↑' : ''}
                    </button>
                  ))}
                </div>
                {!data && !(res && !res.ok) && <SkeletonRows n={n} />}
                {ordered.map(r => {
                  const id = r.team.roster_id
                  return (
                    <div
                      key={id}
                      className={`ov2-row ${detail?.team.roster_id === id ? 'sel' : ''}`}
                      onClick={() => props.onSelect(id)}
                    >
                      <div className="ov2-team">
                        <TeamAvatar src={r.team.avatar} name={r.team.team_name} size={32} />
                        <div style={{ minWidth: 0 }}>
                          <div className="tn">
                            {r.team.team_name} {id === context.myRosterId && <span className="you">YOU</span>}
                          </div>
                          <div className="un">{r.team.display_name}</div>
                        </div>
                      </div>
                      <span className="mono">{record(r.team)}</span>
                      <span className="ov2-tier" title={r.tier?.why}>
                        {r.tier ? r.tier.name : bb.busy ? '…' : '—'}
                      </span>
                      {COLS.map(c => {
                        const k = rankOf(r, c.key)
                        return (
                          <span key={c.key} className="ov2-cell" style={rankStyle(k, n)}>
                            {k ?? '—'}
                          </span>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <LeagueMap rows={rows} n={n} me={context.myRosterId} sel={detail?.team.roster_id} onSelect={props.onSelect} />
          )}
        </div>
        {detail && data && (
          <Detail
            row={detail}
            n={n}
            mine={detail.team.roster_id === context.myRosterId}
            nextDraft={data.season}
            links={{ onAsset: props.onAsset, onFindTargets: props.onFindTargets, onTradeWith: props.onTradeWith }}
          />
        )}
      </div>
    </div>
  )
}
