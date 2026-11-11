// Player (pushed from anywhere a player shows): the profile card (NFL-colour hero with his headshot,
// name, chips and a 3×2 bio) beside Value (sheet against market), with Injury (the override every
// model uses) and Trade (who has him, the one action and a deal Monte found) as two cards under it.
// His NFL team's season runs the full width below (opponent, bye, points or date each week), then
// Stats: a season's games (this one, or any earlier one from the season
// pills), points and finish heat-coloured within each column.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import Claim from './Claim'
import { gameTable } from '@shared/gameLog'
import { shortDate } from '@shared/nflSchedule'
import { injuryLabel, isAvailableOverride, isCurrentInjury } from '@shared/injuries'
import { tepBoardFor, boardRankFor, boardRankLabel, type GameLog, type ManualInjury, type PlayerInfo, type Result } from '@shared/types'
import { useApp } from './store'
import { marketTag, mineOf, useAddToTrade, useTrade, verdictText } from './tradeModel'
import { Btn, ErrorBox, headshotUrl, heroGrad, kfmt, Link, Loading, nflColor, num, Pills, RING_SOFT, Stepper, StatTile, useHeat } from './ui'

type Usage = { usagePPG: number | null; sleeperPPG: number | null; delta: number | null }
const n1 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(1))
const sgn1 = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`
const initialsOf = (name: string) =>
  name
    .replace(/\s+(Jr|Sr|II|III|IV|V)\.?$/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i, a) => (i === 0 || i === a.length - 1 ? w[0] : ''))
    .join('')
    .toUpperCase()

export default function Player({ id, fallbackName }: { id: string; fallbackName: string }) {
  const { context, pw, settings } = useApp()
  const { byId, me, teamName, d } = useTrade()
  const [info, setInfo] = useState<Result<PlayerInfo> | null>(null)
  const [shot, setShot] = useState(true)
  useEffect(() => {
    let live = true
    void window.monte.playerInfo(id).then(r => live && setInfo(r))
    return () => {
      live = false
    }
  }, [id])

  const p = info?.ok ? info.value : null
  const asset = byId.get(id)
  const owner = asset?.owner ?? context?.rosters.find(r => r.players.includes(id))?.roster_id ?? null
  const name = p?.name ?? asset?.name ?? fallbackName
  const pos = p?.pos ?? asset?.pos ?? ''
  const nfl = p?.team ?? asset?.team ?? ''
  const exp = p?.yearsExp == null ? '' : p.yearsExp === 0 ? 'Rookie' : `${p.yearsExp} yr${p.yearsExp === 1 ? '' : 's'} exp`
  const bio: Array<[string, string]> = [
    ['Age', String(p?.age ?? asset?.age ?? '–')],
    ['Height', p?.height ? `${Math.floor(p.height / 12)}'${p.height % 12}"` : '–'],
    ['Weight', p?.weight ? `${p.weight}` : '–'],
    ['College', p?.college ?? '–'],
    ['Owner', owner == null ? 'FA' : owner === me ? 'You' : teamName(owner)],
    ['Value', asset ? kfmt(mineOf(asset)) : '–'],
  ]
  const usage = pw.result?.rows.find(r => r.player_id === id)
  // The sheet's rank, on the board that matches the league (or the one Settings picks).
  const board = boardRankFor(p?.board, tepBoardFor(settings?.rankBoard, context?.league.tePremium ?? 0))
  const boardText = p?.board ? boardRankLabel(board, pos) ?? 'Not on the board' : null

  return (
    <div className="page stack" style={{ gap: 28 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '360px minmax(0,1fr)', gap: 28, alignItems: 'start' }}>
        <div style={{ borderRadius: 22, overflow: 'hidden', background: 'var(--card)' }}>
          <div style={{ position: 'relative', height: 250, background: heroGrad(nflColor(nfl)), display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden' }}>
            <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 72, fontWeight: 700, opacity: 0.18 }}>{initialsOf(name)}</span>
            {shot && /^\d+$/.test(id) && (
              <img
                src={headshotUrl(id, true)}
                alt=""
                onError={() => setShot(false)}
                style={{ position: 'relative', height: 230, width: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 10px 20px rgba(0,0,0,.35))' }}
              />
            )}
          </div>
          <div style={{ padding: '20px 22px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-.02em', textWrap: 'balance' }}>{name}</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {!!nfl && <span style={{ padding: '3px 10px', borderRadius: 12, background: nflColor(nfl), color: '#fff', fontWeight: 700, fontSize: 13 }}>{nfl}</span>}
              <span style={{ fontWeight: 700 }}>{pos}</span>
              {exp && <span className="sub">{exp}</span>}
            </div>
            {boardText && (
              <span
                className="num"
                style={{ alignSelf: 'flex-start', padding: '5px 12px', borderRadius: 12, fontWeight: 700, fontSize: 15, background: board ? 'var(--acc)' : 'var(--surf2)', color: board ? 'var(--acc-ink)' : 'var(--mute)' }}
              >
                {boardText}
              </span>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px 10px', paddingTop: 4 }}>
              {bio.map(([k, v]) => (
                <div key={k} className="stack" style={{ gap: 1, minWidth: 0 }}>
                  <span className="label">{k}</span>
                  <span className="trunc" style={{ fontSize: 16, fontWeight: 700 }} title={v}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="stack" style={{ gap: 20, minWidth: 0 }}>
          <Section title="Value">
            <ValueTab id={id} usage={usage} ranks={d?.ranks[id]} />
          </Section>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, alignItems: 'stretch' }}>
            <InjuryTab id={id} name={name} pos={pos} team={nfl} sleeperTag={p?.injury ?? ''} />
            <TradeTab id={id} name={name} owner={owner} />
          </div>
        </div>
      </div>
      {info?.ok && info.value.schedule && <NflSchedule p={info.value} />}
      {info == null ? <Loading label="Reading his games…" /> : !info.ok ? <ErrorBox message={info.error} /> : <StatsTab key={info.value.id} p={info.value} usage={usage} />}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }}>
      <span className="title-l">{title}</span>
      {children}
    </section>
  )
}

function ValueTab({ id, usage, ranks }: { id: string; usage: Usage | undefined; ranks?: { sheetRank: number | null; marketRank: number | null } }) {
  const { byId } = useTrade()
  const a = byId.get(id)
  const head = (text: string) => <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3, textWrap: 'pretty' }}>{text}</div>
  if (!a)
    return (
      <>
        {head("Not in the trade pool: he isn't on a roster in this league, or not on the sheet.")}
        {usage && <UsageCard usage={usage} />}
      </>
    )
  const tag = marketTag(a)
  const mine = mineOf(a)
  const gap = mine > 0 ? Math.round(Math.abs(a.val / mine - 1) * 100) : 0
  const line =
    tag.label === 'Sell high'
      ? `Sell high. The market pays ${gap}% more than the sheet.`
      : tag.label === 'Undervalued'
      ? `Undervalued. The market is ${gap}% below the sheet.`
      : tag.label === 'No market'
      ? "No market price: the market source doesn't list him."
      : 'Fairly priced. Market and sheet are within 10%.'
  return (
    <>
      {head(line)}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <StatTile k="Sheet value" v={num(mine)} size={26} />
        <StatTile k="Market" v={a.market == null ? '—' : num(a.val)} size={26} color={tag.tone === 'acc' ? 'var(--acc)' : tag.tone === 'pos' ? 'var(--pos)' : undefined} />
        <StatTile k="Sheet, overall" v={ranks?.sheetRank ? `#${ranks.sheetRank}` : '—'} size={26} />
        <StatTile k="Market, overall" v={ranks?.marketRank ? `#${Math.round(ranks.marketRank)}` : '—'} size={26} />
      </div>
      {usage && <UsageCard usage={usage} />}
    </>
  )
}

function UsageCard({ usage }: { usage: Usage }) {
  const gap = usage.delta
  return (
    <div style={{ padding: 18, borderRadius: 18, background: 'var(--surf)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="small mute">Usage vs projection</span>
      <span className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="num" style={{ fontSize: 20, fontWeight: 700 }}>
          {n1(usage.usagePPG)} → {n1(usage.sleeperPPG)} PPG
        </span>
        {gap != null && (
          <span className="num" style={{ fontWeight: 700, color: gap > 0 ? 'var(--pos)' : 'var(--neg)' }}>
            {sgn1(gap)}
          </span>
        )}
      </span>
      {gap != null && <span className="sub" style={{ fontSize: 14 }}>{gap > 0 ? 'His role earns more than Sleeper projects: room to grow.' : "He's scoring past his role: running hot."}</span>}
    </div>
  )
}

/** His team's regular season, a chip a week: played weeks show his PPR points, the rest the date. */
function NflSchedule({ p }: { p: PlayerInfo }) {
  const s = p.schedule!
  const pts = new Map(p.season === s.season ? p.games.map(g => [g.week, g.stats.pts_ppr ?? 0]) : [])
  const next = s.weeks.find(w => w.state === 'pre' || w.state === 'live')?.week
  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="title-l">
          {s.season} schedule: {p.team}
        </span>
        <span className="small mute">PPR points once played</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 6 }}>
        {s.weeks.map(w => {
          const bye = w.state === 'bye'
          const played = pts.get(w.week)
          const sub = bye ? '' : w.state === 'live' ? 'Live' : w.state === 'done' ? (played == null ? 'DNP' : `${played.toFixed(1)} pts`) : shortDate(w.date)
          return (
            <div
              key={w.week}
              className="stack"
              style={{
                gap: 1,
                padding: '8px 10px',
                borderRadius: 12,
                background: bye ? 'transparent' : w.week === next ? 'var(--surf2)' : 'var(--surf)',
                boxShadow: bye ? 'inset 0 0 0 1px var(--surf2)' : w.week === next ? RING_SOFT : undefined,
              }}
            >
              <span className="label">W{w.week}</span>
              <span style={{ fontWeight: 700, color: bye ? 'var(--mute)' : 'var(--ink)' }}>{bye ? 'BYE' : `${w.away ? '@' : 'vs'} ${w.opp}`}</span>
              <span className="small num" style={{ color: w.state === 'live' ? 'var(--pos)' : 'var(--mute)', minHeight: 18 }}>
                {sub}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function StatsTab({ p, usage }: { p: PlayerInfo; usage: Usage | undefined }) {
  const { heat } = useHeat()
  // The season playerInfo sent comes with its games; any other is fetched when its pill is picked.
  const [season, setSeason] = useState(p.season)
  const [logs, setLogs] = useState<Record<string, Result<GameLog[]>>>({ [p.season]: { ok: true, value: p.games } })
  useEffect(() => {
    if (logs[season]) return
    let live = true
    void window.monte.playerGames(p.id, season).then(r => live && setLogs(m => ({ ...m, [season]: r })))
    return () => {
      live = false
    }
  }, [p.id, season]) // eslint-disable-line react-hooks/exhaustive-deps
  const log = logs[season]
  const tb = gameTable(p.pos, log?.ok ? log.value : [])
  const cell = (bg: string, fg: string, fw: number, v: string | number, key: string) => (
    <span key={key} style={{ height: 42, borderRadius: 10, background: bg, color: fg, display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: fw }}>
      {v}
    </span>
  )
  const head = (h: string, key: string, extra?: CSSProperties) => (
    <span key={key} style={{ height: 18, fontSize: 12, fontWeight: 600, letterSpacing: '.06em', color: 'var(--mute)', textAlign: 'center', whiteSpace: 'nowrap', ...extra }}>
      {h}
    </span>
  )
  // WK and OPP stay put; the stat columns scroll sideways when they outgrow the page.
  const grid = (cols: string) => ({ display: 'grid', gridTemplateColumns: cols, gap: 6, alignItems: 'center' }) as const
  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="title-l">Stats: {season} by week</span>
        <span className="small mute">{p.pos} · PPR</span>
      </div>
      {p.seasons.length > 1 && <Pills value={season} onChange={setSeason} options={p.seasons.map(s => ({ value: s, label: s }))} />}
      {log == null ? (
        <Loading label={`Reading his ${season} games…`} />
      ) : !log.ok ? (
        <ErrorBox message={log.error} onRetry={() => setLogs(({ [season]: _, ...m }) => m)} />
      ) : tb.rows.length === 0 ? (
        <div className="mute">{season === p.seasons[0] ? 'No games yet this season.' : `No games in ${season}.`}</div>
      ) : (
        <div className="num" style={{ display: 'flex', gap: 6, minWidth: 0 }}>
          <div style={grid('40px 56px')}>
            {head('', 'g0')}
            {head('', 'g1')}
            {head('WK', 'wk')}
            {head('OPP', 'opp')}
            {tb.rows.flatMap((r, i) => [cell('transparent', 'var(--mute)', 600, r.week, `w${i}`), cell('transparent', 'var(--ink2)', 500, r.opp, `o${i}`)])}
            {cell('transparent', 'var(--mute)', 700, 'AVG', 'avg')}
            <span />
          </div>
          <div style={{ ...grid(`repeat(${tb.cols.length}, minmax(52px, 1fr))`), flex: 1, minWidth: 0, overflowX: 'auto', paddingBottom: 4 }}>
            {tb.groups.map((g, i) =>
              head(g.label.toUpperCase(), `g${i}`, { gridColumn: `span ${g.span}`, borderBottom: '1px solid var(--surf2)', fontSize: 11 }),
            )}
            {tb.cols.map((h, j) => head(h, `h${j}`))}
            {tb.rows.flatMap((r, i) =>
              r.cells.map((c, j) => {
                const h = c.heat == null ? { bg: 'var(--surf)', fg: c.text === '–' ? 'var(--mute)' : 'var(--ink)' } : heat(c.heat)
                return cell(h.bg, h.fg, j === 0 ? 700 : 600, c.text, `${i}:${j}`)
              }),
            )}
            {tb.avg.map((x, j) => cell('var(--surf)', 'var(--ink)', 700, x, `a${j}`))}
          </div>
        </div>
      )}
      <div className="small mute">
        Coloured cells rank his weeks by points and finish: brighter is better. RK is his PPR finish at {p.pos} that week; SNP% his share of offensive snaps; FL fumbles lost.
        {usage?.usagePPG != null ? ` Usage ${n1(usage.usagePPG)} PPG vs projection ${n1(usage.sleeperPPG)}.` : ''}
      </div>
    </section>
  )
}

function TradeTab({ id, name, owner }: { id: string; name: string; owner: number | null }) {
  const { context, go } = useApp()
  const x = useTrade()
  const add = useAddToTrade()
  const a = x.byId.get(id)
  const yours = owner != null && owner === x.me
  const first = name.split(' ')[0]
  const last = name.split(' ').slice(-1)[0]
  // A deal with him in it: shop him if he's yours, else the best package that lands him.
  const deal = useMemo(() => {
    if (!a) return null
    if (yours) return x.findDeals([a], 1, 1)[0] ?? null
    return x.findDeals([], 2, 40).find(dl => dl.get.some(g => g.id === id)) ?? null
  }, [a?.id, yours, x.assets]) // eslint-disable-line react-hooks/exhaustive-deps
  const v = deal && verdictText(deal.verdict)
  const line =
    owner == null
      ? `${name} is not on a team here.`
      : yours
      ? `${first} is yours. ${a && marketTag(a).label === 'Sell high' ? 'Now is a good time to shop him.' : 'Hold unless the return is clear.'}`
      : `${name} is on ${x.teamName(owner)}.`
  return (
    <div className="stack" style={{ gap: 12, padding: '20px 22px 22px', borderRadius: 22, background: 'var(--card)' }}>
      <span className="label">Trade</span>
      <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.35, textWrap: 'pretty' }}>{line}</div>
      <div>
        {owner != null && a ? (
          <Btn kind="primary" label={yours ? 'Offer him in a trade' : `Trade for ${last}`} onClick={() => add(a.id, owner, a.name)} />
        ) : owner == null && context ? (
          <Claim id={id} name={name} />
        ) : null}
      </div>
      {deal && v && (
        <button
          onClick={() => {
            x.loadDeal(deal)
            go('trade')
          }}
          className="gcard"
          style={{ padding: 16, borderRadius: 16, flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}
        >
          <span className="small mute">Monte found a deal{yours ? '' : ` with ${x.teamName(deal.partner)}`}</span>
          <span style={{ fontSize: 17, fontWeight: 600 }}>
            Give {deal.give.map(g => (g.kind === 'pick' && g.slot ? g.slot : g.name)).join(', ')}. Get {deal.get.map(g => g.name).join(' + ')}.
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: `var(--${v.tone})` }}>{v.label}</span>
        </button>
      )}
    </div>
  )
}

function InjuryTab({ id, name, pos, team, sleeperTag }: { id: string; name: string; pos: string; team: string; sleeperTag: string }) {
  const { settings, setSettings, context, showToast } = useApp()
  const injuries = settings.injuries ?? []
  const season = context?.league.season
  // An override from an earlier season no longer applies, so don't report it as the status.
  const o = injuries.find(i => i.id === id && isCurrentInjury(i, season))
  const first = Math.max(1, (context?.week ?? 0) + 1)
  const [wk, setWk] = useState(Math.min(18, Math.max(first, o?.returnWeek ?? first)))
  const save = (returnWeek: number | null) => {
    const entry: ManualInjury = { id, name, pos, team, returnWeek, season, addedAt: new Date().toISOString() }
    void setSettings({ injuries: [...injuries.filter(i => i.id !== id), entry] })
    showToast(returnWeek === 0 ? `${name} marked available` : returnWeek == null ? `${name} out for the season` : `${name} out until week ${returnWeek}`)
  }
  const available = !!o && isAvailableOverride(o)
  const status = o ? `${injuryLabel(o)} (your override)` : sleeperTag ? `${sleeperTag}, per Sleeper` : 'Healthy'
  // A healthy player gets a link rather than a return-week stepper he doesn't need.
  const [editing, setEditing] = useState(false)
  const showControls = !!o || !!sleeperTag || editing
  return (
    <div className="stack" style={{ gap: 12, padding: '20px 22px 22px', borderRadius: 22, background: 'var(--card)' }}>
      <div className="stack" style={{ gap: 2 }}>
        <span className="label">Injury status</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: (o && !available) || (!o && sleeperTag) ? 'var(--warn)' : 'var(--pos)' }}>{status}</span>
      </div>
      {showControls ? (
        <>
          <div className="row" style={{ gap: 10, padding: '6px 6px 6px 16px', borderRadius: 16, background: 'var(--surf)' }}>
            <span style={{ flex: 1, fontWeight: 600 }}>Back in week</span>
            <Stepper value={wk} onDec={() => setWk(w => Math.max(first, w - 1))} onInc={() => setWk(w => Math.min(18, w + 1))} />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Btn kind="primary" label="Save" onClick={() => save(wk)} style={{ flex: 1, minHeight: 42 }} />
            <Btn label="Out for season" onClick={() => save(null)} style={{ flex: 1, minHeight: 42 }} />
          </div>
          {/* Sleeper (or your own override) says he's out, but you know he plays. */}
          {!available && (!!o || !!sleeperTag) && <Btn label="Mark available" onClick={() => save(0)} style={{ minHeight: 42 }} />}
        </>
      ) : (
        <Link label="Set an override" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing(true)} />
      )}
      <span className="small mute">Overrides outrank Sleeper's tag, the sheet's injured list and ESPN's estimate in Pick odds, Usage and Lineup.</span>
      {o && (
        <Link
          label="Clear override"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            void setSettings({ injuries: injuries.filter(i => i.id !== id) })
            showToast('Override cleared')
          }}
        />
      )}
    </div>
  )
}
