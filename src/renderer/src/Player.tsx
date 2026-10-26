// Player (pushed from anywhere a player shows): a sticky profile card on the left (NFL-colour hero
// with his headshot, name, chips and a 3×2 bio), tabs on the right. Value: sheet against market.
// Stats: this season's games, every cell heat-coloured within its column. Trade: who has him, the
// one action and a deal Monte found. Injury: the override every model uses.
import { useEffect, useMemo, useState } from 'react'
import type { GameLog, ManualInjury, PlayerInfo, Result } from '@shared/types'
import { useApp } from './store'
import { marketTag, mineOf, useAddToTrade, useTrade, verdictText } from './tradeModel'
import { Btn, ErrorBox, headshotUrl, heroGrad, kfmt, Link, Loading, nflColor, num, Stepper, StatTile, useHeat } from './ui'

type Tab = 'value' | 'stats' | 'trade' | 'injury'
const TABS: Array<[Tab, string]> = [
  ['value', 'Value'],
  ['stats', 'Stats'],
  ['trade', 'Trade'],
  ['injury', 'Injury'],
]
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
  const { context, pw } = useApp()
  const { byId, me, teamName, d } = useTrade()
  const [info, setInfo] = useState<Result<PlayerInfo> | null>(null)
  const [tab, setTab] = useState<Tab>('value')
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

  return (
    <div className="page" style={{ display: 'grid', gridTemplateColumns: '360px minmax(0,1fr)', gap: 28, alignItems: 'start' }}>
      <div className="sticky" style={{ borderRadius: 22, overflow: 'hidden', background: 'var(--card)' }}>
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
        <div className="row" style={{ gap: 4 }} role="tablist">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              style={{ minHeight: 48, padding: '0 20px', fontWeight: 600, color: tab === k ? 'var(--ink)' : 'var(--mute)', boxShadow: tab === k ? 'inset 0 -3px 0 var(--acc)' : 'inset 0 -1px 0 var(--surf2)' }}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'value' && <ValueTab id={id} usage={usage} ranks={d?.ranks[id]} />}
        {tab === 'stats' && (info == null ? <Loading label="Reading his games…" /> : !info.ok ? <ErrorBox message={info.error} /> : <StatsTab p={info.value} usage={usage} />)}
        {tab === 'trade' && <TradeTab id={id} name={name} owner={owner} />}
        {tab === 'injury' && <InjuryTab id={id} name={name} pos={pos} team={nfl} sleeperTag={p?.injury ?? ''} />}
      </div>
    </div>
  )
}

function ValueTab({ id, usage, ranks }: { id: string; usage: Usage | undefined; ranks?: { sheetRank: number | null; marketRank: number | null } }) {
  const { byId } = useTrade()
  const a = byId.get(id)
  const head = (text: string) => <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.25, textWrap: 'pretty', maxWidth: 720 }}>{text}</div>
  if (!a)
    return (
      <>
        {head("Not in the trade pool: he isn't on a roster in this league, or not on Tyler's sheet.")}
        {usage && <div style={{ maxWidth: 520 }}><UsageCard usage={usage} /></div>}
      </>
    )
  const tag = marketTag(a)
  const mine = mineOf(a)
  const gap = mine > 0 ? Math.round(Math.abs(a.val / mine - 1) * 100) : 0
  const line =
    tag.label === 'Sell high'
      ? `Sell high. The market pays ${gap}% more than Tyler's sheet.`
      : tag.label === 'Undervalued'
      ? `Undervalued. The market is ${gap}% below Tyler's sheet.`
      : tag.label === 'No market'
      ? "No market price: FantasyCalc doesn't list him."
      : 'Fairly priced. Market and sheet are within 10%.'
  return (
    <>
      {head(line)}
      <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)', gap: 12 }}>
        <div className="stack" style={{ gap: 12 }}>
          <StatTile k="Tyler's sheet" v={num(mine)} />
          <StatTile k="Market" v={a.market == null ? '—' : num(a.val)} color={tag.tone === 'acc' ? 'var(--acc)' : tag.tone === 'pos' ? 'var(--pos)' : undefined} />
        </div>
        <div className="stack" style={{ gap: 12 }}>
          <div style={{ padding: 18, borderRadius: 18, background: 'var(--surf)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Where he ranks</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <StatTile k="Tyler, overall" v={ranks?.sheetRank ? `#${ranks.sheetRank}` : '—'} size={26} bg="var(--surf2)" />
              <StatTile k="Market, overall" v={ranks?.marketRank ? `#${Math.round(ranks.marketRank)}` : '—'} size={26} bg="var(--surf2)" />
            </div>
          </div>
          {usage && <UsageCard usage={usage} />}
        </div>
      </div>
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

/** Five columns per position, in Sleeper's stat keys. */
function columnsFor(pos: string): Array<{ k: string; get: (s: Record<string, number>) => number; low?: boolean }> {
  const g = (key: string) => (s: Record<string, number>) => Number(s[key] ?? 0)
  const ppr = { k: 'PPR', get: g('pts_ppr') }
  if (pos === 'QB') return [ppr, { k: 'YDS', get: g('pass_yd') }, { k: 'TD', get: g('pass_td') }, { k: 'INT', get: g('pass_int'), low: true }, { k: 'RUSH', get: g('rush_yd') }]
  if (pos === 'RB') return [ppr, { k: 'ATT', get: g('rush_att') }, { k: 'YDS', get: g('rush_yd') }, { k: 'REC', get: g('rec') }, { k: 'TD', get: s => Number(s.rush_td ?? 0) + Number(s.rec_td ?? 0) }]
  return [ppr, { k: 'TGT', get: g('rec_tgt') }, { k: 'REC', get: g('rec') }, { k: 'YDS', get: g('rec_yd') }, { k: 'TD', get: g('rec_td') }]
}

function StatsTab({ p, usage }: { p: PlayerInfo; usage: Usage | undefined }) {
  const { heat } = useHeat()
  const cols = columnsFor(p.pos)
  const games: GameLog[] = p.games
  const vals = games.map(gm => cols.map(c => c.get(gm.stats)))
  const lo = cols.map((_, j) => Math.min(...vals.map(v => v[j])))
  const hi = cols.map((_, j) => Math.max(...vals.map(v => v[j])))
  const avg = cols.map((_, j) => (vals.length ? vals.reduce((s, v) => s + v[j], 0) / vals.length : 0))
  const fmt = (j: number, x: number, mean = false) => (j === 0 ? x.toFixed(1) : mean && x < 10 ? x.toFixed(1) : String(Math.round(x)))
  const cell = (bg: string, fg: string, fw: number, v: string | number, key: string) => (
    <span key={key} style={{ height: 42, borderRadius: 10, background: bg, color: fg, display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: fw }}>
      {v}
    </span>
  )
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', maxWidth: 760 }}>
        <span style={{ fontWeight: 700, fontSize: 20 }}>{p.season} by week</span>
        <span className="small mute">{p.pos} · PPR</span>
      </div>
      {games.length === 0 ? (
        <div className="mute">No games yet this season.</div>
      ) : (
        <div className="num" style={{ display: 'grid', gridTemplateColumns: '44px 56px repeat(5, minmax(0,1fr))', gap: 6, alignItems: 'center', maxWidth: 760 }}>
          {['WK', 'OPP', ...cols.map(c => c.k)].map(h => (
            <span key={h} style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', color: 'var(--mute)', textAlign: 'center' }}>
              {h}
            </span>
          ))}
          {games.flatMap((gm, i) => [
            cell('transparent', 'var(--mute)', 600, gm.week, `w${i}`),
            cell('transparent', 'var(--ink2)', 500, gm.opp, `o${i}`),
            ...cols.map((c, j) => {
              let v = hi[j] === lo[j] ? 0.5 : (vals[i][j] - lo[j]) / (hi[j] - lo[j])
              if (c.low) v = 1 - v
              const h = heat(v)
              return cell(h.bg, h.fg, j === 0 ? 700 : 600, fmt(j, vals[i][j]), `${i}:${c.k}`)
            }),
          ])}
          {cell('transparent', 'var(--mute)', 700, 'AVG', 'avg')}
          <span />
          {avg.map((x, j) => cell('var(--surf)', 'var(--ink)', 700, fmt(j, x, true), `a${j}`))}
        </div>
      )}
      <div className="small mute">
        Brighter cells are his best weeks in that stat.{usage?.usagePPG != null ? ` Usage ${n1(usage.usagePPG)} PPG vs projection ${n1(usage.sleeperPPG)}.` : ''}
      </div>
    </>
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
      ? `${name} is a free agent.`
      : yours
      ? `${first} is yours. ${a && marketTag(a).label === 'Sell high' ? 'Now is a good time to shop him.' : 'Hold unless the return is clear.'}`
      : `${name} is on ${x.teamName(owner)}.`
  return (
    <div className="stack" style={{ gap: 14, maxWidth: 620 }}>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.3, textWrap: 'pretty' }}>{line}</div>
      <div>
        {owner != null && a ? (
          <Btn kind="primary" size="lg" label={yours ? 'Offer him in a trade' : `Trade for ${last}`} onClick={() => add(a.id, owner, a.name)} />
        ) : owner == null && context ? (
          <Btn kind="primary" size="lg" label="Claim in Sleeper ↗" onClick={() => window.open(`https://sleeper.com/leagues/${context.league.league_id}/players`, '_blank')} />
        ) : null}
      </div>
      {deal && v && (
        <button
          onClick={() => {
            x.loadDeal(deal)
            go('trade')
          }}
          className="gcard"
          style={{ padding: 18, borderRadius: 18, flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}
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
  const o = injuries.find(i => i.id === id)
  const first = Math.max(1, (context?.week ?? 0) + 1)
  const [wk, setWk] = useState(Math.min(18, Math.max(first, o?.returnWeek ?? first)))
  const save = (returnWeek: number | null) => {
    const entry: ManualInjury = { id, name, pos, team, returnWeek, addedAt: new Date().toISOString() }
    void setSettings({ injuries: [...injuries.filter(i => i.id !== id), entry] })
    showToast(returnWeek == null ? `${name} out for the season` : `${name} out until week ${returnWeek}`)
  }
  const status = o ? (o.returnWeek == null ? 'Out for the season (your override)' : `Out until week ${o.returnWeek} (your override)`) : sleeperTag ? `${sleeperTag}, per Sleeper` : 'Healthy'
  return (
    <div className="stack" style={{ gap: 14, maxWidth: 520 }}>
      <div style={{ padding: 18, borderRadius: 18, background: 'var(--surf)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="small mute">Status Monte is using</span>
        <span style={{ fontSize: 20, fontWeight: 700, color: o || sleeperTag ? 'var(--warn)' : 'var(--pos)' }}>{status}</span>
      </div>
      <div className="sub" style={{ fontSize: 14 }}>
        Overrides outrank Sleeper's tag and ESPN's estimate in Pick odds, Usage and Lineup.
      </div>
      <div className="row" style={{ gap: 10, padding: '10px 16px', borderRadius: 18, background: 'var(--surf)' }}>
        <span style={{ flex: 1, fontWeight: 600 }}>Back in week</span>
        <Stepper value={wk} onDec={() => setWk(w => Math.max(first, w - 1))} onInc={() => setWk(w => Math.min(18, w + 1))} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <Btn kind="primary" label="Save" onClick={() => save(wk)} style={{ flex: 1, minHeight: 46 }} />
        <Btn label="Out for season" onClick={() => save(null)} style={{ flex: 1, minHeight: 46 }} />
      </div>
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
