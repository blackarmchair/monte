// Players: Tyler's superflex board (Value: a value-rank heat chip and the market read) and the usage
// board (Usage: PWOPR, heat on the gap between usage and projection) as one list, a card a row so it
// reads top to bottom. The top bar's search filters it live. Click a card for his page; its button adds him to the trade (or
// claims a free agent in Sleeper).
import { useEffect, useMemo, useState } from 'react'
import { tepBoardFor, type RanksData, type Result } from '@shared/types'
import { teamLabel } from './names'
import { value as rankValue } from '@shared/tradeMath'
import { useApp } from './store'
import { marketTag, mineOf, useAddToTrade, useTrade } from './tradeModel'
import { ErrorBox, GradCard, Headshot, HeatChip, kfmt, Loading, NeedsSheet, nflColor, Pills, Seg, Stack2, Tag, useHeat } from './ui'

/** usage gap (PPG) at which a player reads as Buy or Sell; the desktop's default */
const SIGNAL = 3

type Line = {
  key: string
  id: string
  name: string
  team: string
  owner: number | null
  meta: string
  /** Tyler's board: "#12 · WR4", null when he isn't on it */
  rank: string | null
  v: string
  /** heat position, 0 … 1 */
  h: number
  tag: string
  tagColor: string
  /** trade asset id, when he can be traded */
  assetId: string | null
  /** Sleeper injury status, '' when healthy */
  injury: string
  /** the card's middle columns: small key over a value */
  stats: Array<{ k: string; v: string; color?: string }>
}

const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`)

export default function Players() {
  const { context, settings, sheet, hide, dataVersion, playersUi: ui, setPlayersUi, pw, runPW, openPlayer, showToast } = useApp()
  const { byId, me } = useTrade()
  const { heat } = useHeat()
  const add = useAddToTrade()
  const [res, setRes] = useState<Result<RanksData> | null>(null)
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
    // picks one. Usage rows take their Tyler rank from it too.
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
          // Free agents aren't trade assets: Tyler's rank through the same value curve.
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
    return (pw.result?.rows ?? [])
      .filter(r => r.delta != null && (ui.pos === 'All' || r.pos === ui.pos) && (!q || r.name.toLowerCase().includes(q)))
      .sort((a, b) => b.delta! - a.delta!)
      .map(r => {
        const owner = ownerOf.get(r.player_id) ?? null
        const d = r.delta!
        const sig = d >= SIGNAL ? 'Buy' : d <= -SIGNAL ? 'Sell' : 'Hold'
        return {
          key: r.player_id,
          id: r.player_id,
          name: r.name,
          team: r.team,
          owner,
          meta: `${rankOf.has(r.player_id) ? '' : `${r.pos} · `}${r.team} · ${ownerName(owner)} · ${r.games} games`,
          rank: rankOf.get(r.player_id) ?? null,
          v: `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)}`,
          h: 0.5 + d / 16,
          tag: sig,
          tagColor: sig === 'Buy' ? 'var(--pos)' : sig === 'Sell' ? 'var(--acc)' : 'var(--mute)',
          assetId: byId.has(r.player_id) ? r.player_id : null,
          injury: byId.get(r.player_id)?.injury ?? '',
          stats: [
            { k: 'Usage PPG', v: r.usagePPG?.toFixed(1) ?? '—' },
            { k: 'Projected', v: r.sleeperPPG?.toFixed(1) ?? '—' },
            { k: 'Targets/g', v: r.tgtPerGame.toFixed(1) },
            { k: 'Tgt share', v: pct(r.tgtShare) },
            { k: 'Air share', v: pct(r.airShare) },
          ],
        }
      })
  }, [ui, ranks, pw.result, byId, ownerOf, me, hide, teamNames, settings?.rankBoard]) // eslint-disable-line react-hooks/exhaustive-deps

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
      ? `${lines.length} players · usage weeks ${pw.result.usageWeeks[0]}–${pw.result.usageWeeks[pw.result.usageWeeks.length - 1]}`
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
      <div className="stack" style={{ gap: 8 }}>
        {lines.map(l => (
          <GradCard key={l.key} div color={nflColor(l.team)} minHeight={84} onClick={() => openPlayer(l.id, l.name)} style={{ padding: '12px 14px 12px 16px', gap: 16 }}>
            <Headshot id={l.id} name={l.name} size={56} />
            <Stack2
              size={17}
              title={l.name}
              right={l.injury ? <Tag label={l.injury} tone={/^(Out|IR|PUP|Sus)/i.test(l.injury) ? 'bad' : 'warn'} /> : undefined}
              sub={
                <>
                  {l.rank && <b style={{ color: 'var(--acc)' }}>{l.rank} · </b>}
                  {l.meta}
                </>
              }
              subStyle={{ fontSize: 14 }}
            />
            <span className="pstats" style={{ gridTemplateColumns: `repeat(${l.stats.length}, 92px)` }}>
              {l.stats.map(x => (
                <span key={x.k} className="stack" style={{ gap: 1, minWidth: 0 }}>
                  <span className="small mute trunc">{x.k}</span>
                  <span className="num trunc" style={{ fontSize: 16, fontWeight: 700, color: x.color }} title={x.v}>
                    {x.v}
                  </span>
                </span>
              ))}
            </span>
            <span className="stack" style={{ alignItems: 'flex-end', gap: 3, width: 84, flex: 'none' }}>
              <HeatChip label={l.v} colors={heat(l.h)} minWidth={64} height={32} size={15} />
              {!!l.tag && <span style={{ fontSize: 12, fontWeight: 600, color: l.tagColor }}>{l.tag}</span>}
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
    </div>
  )
}
