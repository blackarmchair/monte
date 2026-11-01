// Players: the sheet's superflex board (Value: a value-rank heat chip and the market read) and the usage
// board (Usage: PWOPR, heat on the gap between usage and projection, last 3 games beside the season,
// a sample-strength mark and a label framed by who holds him) as one list, a card a row so it
// reads top to bottom, under one sticky header row (click a Usage column to sort by it; its (?)
// opens what each column means, and clicking a verdict opens why that player got it). The top bar's search filters it live. Click a card for his page; its button adds him to the trade (or
// claims a free agent in Sleeper).
import { useEffect, useMemo, useState } from 'react'
import { tepBoardFor, type RanksData, type Result } from '@shared/types'
import { teamLabel } from './names'
import { value as rankValue } from '@shared/tradeMath'
import { injuryShort, moveOf, pct0, sameSample, sampleDots, USAGE_SIGNAL, usageRead } from '@shared/usageRead'
import { useApp } from './store'
import { marketTag, mineOf, useAddToTrade, useTrade } from './tradeModel'
import { ErrorBox, GradCard, Headshot, HeatChip, kfmt, Loading, NeedsSheet, nflColor, Pills, Seg, Stack2, Tag, useHeat } from './ui'

type Line = {
  key: string
  id: string
  name: string
  team: string
  owner: number | null
  meta: string
  /** the board: "#12 · WR4", null when he isn't on it */
  rank: string | null
  v: string
  /** heat position, 0 … 1 */
  h: number
  tag: string
  tagColor: string
  /** Usage: sample size under the tag, "Sample ●●○ 4g" */
  note?: string
  /** Usage: why the verdict, one reason a line, shown when the verdict is clicked */
  why?: string[]
  /** trade asset id, when he can be traded */
  assetId: string | null
  /** Sleeper injury status, '' when healthy */
  injury: string
  /** the card's middle columns, labelled once in the header row. `base` is a muted second figure
   *  (the season, beside the last 3 games); `sort` makes the column sortable. */
  stats: Array<{ k: string; v: string; base?: string; color?: string; sort?: number | null; title?: string }>
}

/** The Usage board's definitions, shown in its (?) modal: what each column measures, over which games. */
const usageTerms = (week: number): Array<[string, string]> => [
  [
    'Usage PPG',
    "What his role is worth per game, as a rate for the coming week; not points he scored. Built from his target share and air-yard share over every game he's played this season, weighted toward recent games (the last game carries about 35%, the last four about 80%), times his team's passing volume, then converted to points by a fit of usage to next-week scoring (last season plus this one, in your league's scoring).",
  ],
  [`Proj wk ${week}`, `Sleeper's projection for week ${week} only, in your league's scoring. One game, not a season average.`],
  ['Tgt% · Air% · Snap%', "His share of the team's targets, air yards and offensive snaps. Bold: average of his last 3 games played, green or red when it has moved from the season. Muted: his season average. When his season is only those 3 games the two figures are the same sample. Sleeper has no route data, so snap share is the closest measure of participation."],
  ['Gap', `Usage PPG minus the week ${week} projection, both per game. Positive: his role says more than Sleeper does.`],
  [
    'Verdict',
    `A call needs a gap of ±${USAGE_SIGNAL.toFixed(1)} or more and at least 3 games played. It reads by who holds him: yours Supports holding / Hold / Sell; another team's Buy / No edge / Avoid; a free agent Add / No edge / Pass. Under 3 games it says Watch (Hold if he's yours). Click a verdict for that player's reasons.`,
  ],
  ['Sample', 'Games he has played this season: ●○○ thin (under 3), ●●○ fair (3–4), ●●● solid (5+). A thinner sample also mutes the gap chip.'],
  ['Role growing / shrinking', 'His target or snap share over the last 3 games is clearly above (or below) his season: 3 points of target share or 8 of snap share, without the other moving the opposite way.'],
]

/** width of one stat column; the labels live in the header row, so the cells hold just the figures */
const STAT_W = 80

const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`)

export default function Players() {
  const { context, settings, sheet, hide, dataVersion, playersUi: ui, setPlayersUi, pw, runPW, openPlayer, showToast } = useApp()
  const { byId, me } = useTrade()
  const { heat } = useHeat()
  const add = useAddToTrade()
  const [res, setRes] = useState<Result<RanksData> | null>(null)
  /** Usage column to sort by, high first; null = by gap */
  const [sortBy, setSortBy] = useState<string | null>(null)
  /** the Usage help modal: the definitions, headed by one player's verdict when a verdict was clicked */
  const [help, setHelp] = useState<{ player?: Pick<Line, 'name' | 'tag' | 'tagColor' | 'why'> } | null>(null)
  const leagueId = context?.league.league_id
  const set = (patch: Partial<typeof ui>) => setPlayersUi(u => ({ ...u, ...patch }))

  useEffect(() => {
    if (!leagueId || !settings.userId || !sheet) return
    let live = true
    setRes(null)
    void window.monte.ranks(leagueId, settings.userId).then(r => live && setRes(r))
    return () => {
      live = false
    }
  }, [leagueId, settings.userId, dataVersion, !!sheet]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ui.mode === 'usage' && context && !pw.result && !pw.busy && !pw.error) runPW()
  }, [ui.mode, leagueId]) // eslint-disable-line react-hooks/exhaustive-deps

  const ranks = res?.ok ? res.value : null
  const ownerOf = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of context?.rosters ?? []) for (const p of r.players) m.set(p, r.roster_id)
    return m
  }, [context])
  const teamNames = useMemo(() => new Map(ranks?.teams.map(x => [x.roster_id, x.name])), [ranks])
  const ownerName = (rid: number | null | undefined) => (rid == null ? 'FA' : rid === me ? 'You' : hide ? teamLabel(rid) : teamNames.get(rid) ?? teamLabel(rid))

  const lines = useMemo((): Line[] => {
    const q = ui.q.trim().toLowerCase()
    // The board that matches the league (TE-premium leagues get the TE-prem block), unless Settings
    // picks one. Usage rows take their board rank from it too.
    const board = ranks ? ranks.boards[Math.max(0, ranks.boards.findIndex(b => b.tep === tepBoardFor(settings?.rankBoard, ranks.tePremium)))] : null
    const rankOf = new Map((board?.rows ?? []).filter(r => r.id).map(r => [r.id!, `#${r.rank} · ${r.pos}${r.posRank}`]))
    if (ui.mode === 'value') {
      if (!ranks) return []
      const teAdj = 1 + 0.25 * (ranks.tePremium - 0.75)
      const rows = (board?.rows ?? []).filter(r => r.id)
      const last = Math.max(2, rows[rows.length - 1]?.rank ?? 2)
      return rows
        .filter(r => (ui.pos === 'All' || r.pos === ui.pos) && (!q || r.name.toLowerCase().includes(q)))
        .map(r => {
          const a = byId.get(r.id!)
          const tag = a ? marketTag(a) : null
          // Free agents aren't trade assets: the sheet's rank through the same value curve.
          const v = a ? mineOf(a) : rankValue(r.rank) * (r.pos === 'TE' ? teAdj : 1)
          // KTC's move is whole rank places; round anyway so a stray fraction can't overrun the card.
          const move = a?.trend == null ? null : Math.round(a.trend)
          return {
            key: r.id!,
            id: r.id!,
            name: r.name,
            team: r.team,
            owner: r.owner,
            meta: [
              r.team,
              r.age != null ? `${r.age} yo` : null,
              a?.yearsExp == null ? null : a.yearsExp === 0 ? 'Rookie' : `${a.yearsExp} yr${a.yearsExp === 1 ? '' : 's'} exp`,
              ownerName(r.owner),
            ]
              .filter(x => x != null && x !== '')
              .join(' · '),
            rank: rankOf.get(r.id!) ?? null,
            v: kfmt(v),
            h: 1 - (r.rank - 1) / (last - 1),
            tag: tag && tag.label !== 'No market' ? tag.label : r.owner == null ? 'Free agent' : '',
            tagColor: tag?.tone === 'acc' ? 'var(--acc)' : tag?.tone === 'pos' ? 'var(--pos)' : 'var(--mute)',
            assetId: a ? a.id : null,
            injury: r.injury || a?.injury || '',
            stats: [
              { k: 'Market', v: a?.market == null ? '—' : kfmt(a.val), color: tag?.tone === 'acc' ? 'var(--acc)' : tag?.tone === 'pos' ? 'var(--pos)' : undefined },
              { k: 'Season PPG', v: a?.ppgRank ? `${r.pos}${a.ppgRank}` : '—' },
              {
                k: 'KTC move',
                v: move == null ? '—' : move > 0 ? `▲ ${move}` : move < 0 ? `▼ ${-move}` : '–',
                color: move ? (move > 0 ? 'var(--pos)' : 'var(--neg)') : undefined,
              },
            ],
          }
        })
    }
    const week = pw.result?.targetWeek ?? 0
    return (pw.result?.rows ?? [])
      .filter(r => r.delta != null && (ui.pos === 'All' || r.pos === ui.pos) && (!q || r.name.toLowerCase().includes(q)))
      .sort((a, b) => b.delta! - a.delta!)
      .map(r => {
        const owner = ownerOf.get(r.player_id) ?? null
        const d = r.delta!
        const read = usageRead(r, owner == null ? 'fa' : owner === me ? 'mine' : 'theirs')
        // Last 3 games, bold and coloured by its move, over the season, muted. When the season is
        // only those games both figures still show, and the (?) modal explains it's the same sample.
        const same = sameSample(r)
        const win = (k: string, rec: number | null | undefined, szn: number | null | undefined, step: number) => {
          const m = same ? null : moveOf(rec, szn, step)
          return {
            k,
            v: pct0(rec),
            base: pct0(szn),
            color: m ? (m > 0 ? 'var(--pos)' : 'var(--neg)') : undefined,
            sort: rec ?? null,
            title: same ? `Same sample: his season is only these ${r.games} games` : `Last 3 games ${pct0(rec)}%, season ${pct0(szn)}%`,
          }
        }
        return {
          key: r.player_id,
          id: r.player_id,
          name: r.name,
          team: r.team,
          owner,
          meta: [rankOf.has(r.player_id) ? null : r.pos, r.team, ownerName(owner), read.role === 'growing' ? 'Role growing' : read.role === 'shrinking' ? 'Role shrinking' : null]
            .filter(Boolean)
            .join(' · '),
          rank: rankOf.get(r.player_id) ?? null,
          v: `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)}`,
          h: read.heat,
          tag: read.tag,
          tagColor: `var(--${read.tone})`,
          note: `Sample ${sampleDots(read.sample)} ${r.games}g`,
          why: read.why,
          assetId: byId.has(r.player_id) ? r.player_id : null,
          injury: byId.get(r.player_id)?.injury ?? '',
          stats: [
            { k: 'Usage PPG', v: r.usagePPG?.toFixed(1) ?? '—', sort: r.usagePPG },
            { k: `Proj wk ${week}`, v: r.sleeperPPG?.toFixed(1) ?? '—', sort: r.sleeperPPG },
            // Rows from a run made before the engine had windows fall back to the smoothed shares.
            ...(r.recent || r.season
              ? [win('Tgt%', r.recent?.tgtShare, r.season?.tgtShare, 0.03), win('Air%', r.recent?.airShare, r.season?.airShare, 0.05), win('Snap%', r.recent?.snapShare, r.season?.snapShare, 0.08)]
              : [
                  { k: 'Tgt share', v: pct(r.tgtShare), sort: r.tgtShare },
                  { k: 'Air share', v: pct(r.airShare), sort: r.airShare },
                ]),
          ],
        }
      })
  }, [ui, ranks, pw.result, byId, ownerOf, me, hide, teamNames, settings?.rankBoard]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    if (ui.mode !== 'usage' || !sortBy) return lines
    const at = (l: Line) => l.stats.find(x => x.k === sortBy)?.sort ?? -Infinity
    return [...lines].sort((a, b) => at(b) - at(a))
  }, [lines, sortBy, ui.mode])

  if (!sheet)
    return (
      <div className="page">
        <NeedsSheet />
      </div>
    )

  const act = (l: Line) => {
    if (l.owner == null) {
      if (context) window.open(`https://sleeper.com/leagues/${context.league.league_id}/players`, '_blank')
      return
    }
    if (!l.assetId) return showToast(`${l.name} isn't in the trade pool.`)
    add(l.assetId, l.owner, l.name)
  }
  const usage = ui.mode === 'usage'
  const count = usage
    ? pw.result
      ? `${lines.length} players · usage weeks ${pw.result.usageWeeks[0]}–${pw.result.usageWeeks[pw.result.usageWeeks.length - 1]} · shares: last 3 games / season · snap share shown; route data unavailable`
      : ''
    : ranks
    ? `${lines.length} players · ${ranks.sheet.name}`
    : ''

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <Seg
          lg
          value={ui.mode}
          onChange={mode => set({ mode, pos: mode === 'usage' && !['All', 'WR', 'TE'].includes(ui.pos) ? 'All' : ui.pos })}
          options={[
            { value: 'value', label: 'Value' },
            { value: 'usage', label: 'Usage' },
          ]}
        />
        <Pills value={ui.pos} onChange={pos => set({ pos })} options={(usage ? ['All', 'WR', 'TE'] : ['All', 'QB', 'RB', 'WR', 'TE']).map(v => ({ value: v, label: v }))} />
        <span style={{ flex: 1 }} />
        <span className="small mute">{count}</span>
      </div>
      {!usage && res && !res.ok && <ErrorBox message={res.error} />}
      {usage && pw.error && <ErrorBox message={`Usage board failed: ${pw.error}`} onRetry={runPW} />}
      {((!usage && !res) || (usage && !pw.result && pw.busy)) && <Loading label={usage ? 'Building the usage board…' : 'Reading the board…'} />}
      {(usage ? pw.result : ranks) && lines.length === 0 && <div className="mute">No players match{ui.q ? ` “${ui.q}”` : ''}.</div>}
      {shown.length > 0 && (
        <div className="row sticky small mute" style={{ gap: 16, padding: '6px 14px 6px 16px', background: 'var(--bg)', zIndex: 2, marginBottom: -8 }}>
          <span style={{ width: 56, flex: 'none' }} />
          <span className="row" style={{ flex: 1, minWidth: 180, gap: 8 }}>
            Player
            {usage && (
              <button className="qmark" onClick={() => setHelp({})} aria-label="What these columns mean" title="What these columns mean">
                ?
              </button>
            )}
          </span>
          <span className="pstats" style={{ gridTemplateColumns: `repeat(${shown[0].stats.length}, ${STAT_W}px)` }}>
            {shown[0].stats.map(x =>
              usage ? (
                <button
                  key={x.k}
                  className="trunc"
                  onClick={() => setSortBy(sortBy === x.k ? null : x.k)}
                  title={`Sort by ${x.k}`}
                  style={{ all: 'unset', cursor: 'pointer', fontWeight: sortBy === x.k ? 700 : undefined, color: sortBy === x.k ? 'var(--ink)' : undefined }}
                >
                  {x.k}
                  {sortBy === x.k ? ' ▼' : ''}
                </button>
              ) : (
                <span key={x.k} className="trunc">
                  {x.k}
                </span>
              ),
            )}
          </span>
          {usage ? (
            <button
              onClick={() => setSortBy(null)}
              title="Sort by gap"
              style={{ all: 'unset', cursor: 'pointer', width: 112, flex: 'none', textAlign: 'right', fontWeight: sortBy ? undefined : 700, color: sortBy ? undefined : 'var(--ink)' }}
            >
              Gap · verdict{sortBy ? '' : ' ▼'}
            </button>
          ) : (
            <span style={{ width: 84, flex: 'none', textAlign: 'right' }}>Value</span>
          )}
          <span style={{ width: 92, flex: 'none' }} />
        </div>
      )}
      <div className="stack" style={{ gap: 8 }}>
        {shown.map(l => (
          <GradCard key={l.key} div color={nflColor(l.team)} minHeight={84} onClick={() => openPlayer(l.id, l.name)} style={{ padding: '12px 14px 12px 16px', gap: 16 }}>
            <Headshot id={l.id} name={l.name} size={56} />
            <Stack2
              size={17}
              style={{ minWidth: 180 }}
              title={<span title={l.name}>{l.name}</span>}
              right={
                l.injury ? (
                  <span title={l.injury} style={{ display: 'flex' }}>
                    <Tag label={injuryShort(l.injury)} tone={/^(Out|IR|PUP|Sus)/i.test(l.injury) ? 'bad' : 'warn'} />
                  </span>
                ) : undefined
              }
              sub={
                <>
                  {l.rank && <b style={{ color: 'var(--acc)' }}>{l.rank} · </b>}
                  {l.meta}
                </>
              }
              subStyle={{ fontSize: 14 }}
            />
            <span className="pstats" style={{ gridTemplateColumns: `repeat(${l.stats.length}, ${STAT_W}px)` }}>
              {l.stats.map(x => (
                <span key={x.k} className="num trunc" style={{ fontSize: 16, fontWeight: 700, color: x.color }} title={x.title ?? x.v}>
                  {x.v}
                  {x.base != null && <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--mute)' }}> / {x.base}</span>}
                </span>
              ))}
            </span>
            <span className="stack" style={{ alignItems: 'flex-end', gap: 3, width: usage ? 112 : 84, flex: 'none' }}>
              <HeatChip label={l.v} colors={heat(l.h)} minWidth={64} height={32} size={15} />
              {!!l.tag &&
                (l.why ? (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      setHelp({ player: l })
                    }}
                    title="Why this verdict"
                    style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: l.tagColor, whiteSpace: 'nowrap' }}
                  >
                    {l.tag}
                    <span className="qmark sm">?</span>
                  </button>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 600, color: l.tagColor, whiteSpace: 'nowrap' }}>{l.tag}</span>
                ))}
              {!!l.note && (
                <span className="small mute" style={{ whiteSpace: 'nowrap' }}>
                  {l.note}
                </span>
              )}
            </span>
            <button
              className="btn sm"
              style={{ fontWeight: 700, fontSize: 13, width: 92, flex: 'none', justifyContent: 'center' }}
              onClick={e => {
                e.stopPropagation()
                act(l)
              }}
            >
              {l.owner == null ? 'Claim' : l.owner === me ? 'Offer' : 'Trade for'}
            </button>
          </GradCard>
        ))}
      </div>
      {help && <UsageHelp week={pw.result?.targetWeek ?? 0} player={help.player} onClose={() => setHelp(null)} />}
    </div>
  )
}

function UsageHelp({ week, player, onClose }: { week: number; player?: Pick<Line, 'name' | 'tag' | 'tagColor' | 'why'>; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Reading the Usage board" style={{ gap: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div className="modal-title">{player ? player.name : 'Reading the Usage board'}</div>
          <button className="btn sm" onClick={onClose}>
            Close
          </button>
        </div>
        {player && (
          <div className="stack" style={{ gap: 6, padding: '12px 14px', borderRadius: 14, background: 'var(--surf)' }}>
            <span style={{ fontWeight: 700, color: player.tagColor }}>{player.tag}</span>
            {player.why?.map(w => (
              <span key={w} style={{ fontSize: 14 }}>
                {w}
              </span>
            ))}
          </div>
        )}
        {player && <div className="small mute">What the columns mean</div>}
        {usageTerms(week).map(([term, text]) => (
          <div key={term} className="stack" style={{ gap: 2 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{term}</span>
            <span className="sub" style={{ fontSize: 14, lineHeight: 1.45 }}>
              {text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
