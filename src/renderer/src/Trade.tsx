// Trade: three tabs. Build is three columns: your roster on the left and theirs on the right (the
// team list until you pick a partner), each row with a +/✓ toggle; in the middle (sticky) the
// verdict card with both sides, your roster after, Market influence and Send in Sleeper. Ideas is
// Tyler's strategy against the market: your direction, then what to sell and what to buy, each with
// the rule behind it and an ask / settle deal that opens in Build, then chains (two linked trades
// through a team that values the middle player less than another does). Vacuum scores any two sides
// of players and picks, rostered or not, on Tyler's sheet and on the market, with no teams at all.
import { useMemo, useState } from 'react'
import { vacuumText, type Asset, type Side } from '@shared/tradeMath'
import { MODE_LABEL, PHASE_LINE, type Chain, type Idea, type IdeaDeal, type Mode } from '@shared/strategy'
import { useApp } from './store'
import { assetMeta, marketTag, mineOf, useTrade, type VerdictTone } from './tradeModel'
import SleeperSend from './SleeperSend'
import { Btn, Check, ErrorBox, GradCard, grad, Headshot, Icon, HeatTiles, kfmt, Loading, NeedsSheet, nflColor, Notice, num, RING, Seg, signed, Stack2, StatTile, TeamAvatar, teamColor, useHeat } from './ui'

const tone = (t: VerdictTone) => `var(--${t})`
/** Build's three column headings share one height (the partner side's Change button sets it), so
 *  the verdict card and the first card on each side start on the same line. */
const HEAD = { minHeight: 34, alignItems: 'center' } as const
/** Position change in "your roster after" that reads as fully good or bad. */
const POS_SCALE = 8000
/** Players carry their NFL colour; picks their original team's. */
const assetColor = (a: Asset) => (a.kind === 'pick' ? teamColor(a.originalOwner ?? 1) : nflColor(a.team))
const assetName = (a: Asset) => (a.kind === 'pick' && a.slot ? `${a.name.split(' · ')[0]} (${a.slot})` : a.name)

function AssetFace({ a, size = 38 }: { a: Asset; size?: number }) {
  if (a.kind === 'player') return <Headshot id={a.id} name={a.name} size={size} />
  return (
    <span className="face" style={{ width: size, height: size, fontSize: 12 }}>
      R{a.round}
    </span>
  )
}

export default function Trade() {
  const { sheet, trade, setTrade, settings, settingsSaved, hide, context, openPlayer } = useApp()
  const { heat } = useHeat()
  const x = useTrade()
  const { d, res, partner, give, get, count, verdict: v } = x
  const [sending, setSending] = useState(false)
  // Ideas first when there is nothing being built.
  const [tab, setTab] = useState<'build' | 'ideas' | 'vacuum'>(count === 0 ? 'ideas' : 'build')

  if (!sheet)
    return (
      <div className="page">
        <NeedsSheet />
      </div>
    )

  const on = (id: string) => trade.give.includes(id) || trade.get.includes(id)
  const partnerName = partner == null ? null : x.teamName(partner)
  const theirs = partner == null ? [] : x.assets.filter(a => a.owner === partner).sort((a, b) => mineOf(b) - mineOf(a))
  const row = (a: Asset) => {
    const tag = marketTag(a)
    return (
      <GradCard key={a.id} color={assetColor(a)} ring={on(a.id) ? RING : undefined} minHeight={58} style={{ gap: 10, padding: '6px 8px 6px 10px', borderRadius: 14 }}>
        <AssetFace a={a} />
        <button onClick={() => a.kind === 'player' && openPlayer(a.id, a.name)} style={{ flex: 1, minWidth: 0, cursor: a.kind === 'player' ? 'pointer' : 'default' }}>
          <Stack2 title={assetName(a)} size={14} sub={`${assetMeta(a)}${tag.label !== 'No market' ? ` · ${tag.label}` : ''}`} subStyle={{ fontSize: 12 }} />
        </button>
        <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>
          {kfmt(mineOf(a))}
        </span>
        <Check on={on(a.id)} plus onClick={() => x.toggle(a.id)} label={`${on(a.id) ? 'Remove' : 'Add'} ${a.name}`} />
      </GradCard>
    )
  }

  return (
    <div className="page wide" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.15fr) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>
      {res && !res.ok && (
        <div style={{ gridColumn: '1 / -1' }}>
          <ErrorBox message={res.error} onRetry={x.load} />
        </div>
      )}
      {!res && (
        <div style={{ gridColumn: '1 / -1' }}>
          <Loading label="Pricing every roster…" />
        </div>
      )}

      {d && (
        <div style={{ gridColumn: '1 / -1' }}>
          <Seg
            lg
            value={tab}
            onChange={setTab}
            options={[
              { value: 'build', label: count ? `Build (${count})` : 'Build' },
              { value: 'ideas', label: 'Ideas' },
              { value: 'vacuum', label: 'Vacuum' },
            ]}
          />
        </div>
      )}

      {d && tab === 'vacuum' && (
        <div style={{ gridColumn: '1 / -1' }}>
          <VacuumView />
        </div>
      )}

      {d && tab === 'ideas' && (
        <div style={{ gridColumn: '1 / -1' }}>
          <IdeasView onOpen={() => setTab('build')} />
        </div>
      )}

      {d && tab === 'build' && (
        <>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={HEAD}>
              <span className="title-l">Your roster</span>
            </div>
            {x.mine.map(row)}
          </div>

          <div className="sticky stack" style={{ gap: 8 }}>
            <div aria-hidden style={HEAD} />
              <div className="hero" style={{ padding: 22, gap: 16 }}>
                <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: tone(x.tone) }}>{x.label}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <StatTile k="You" v={v ? signed(v.em) : '—'} size={26} bg="var(--surf2)" color={v ? (v.em >= 0 ? 'var(--pos)' : 'var(--neg)') : undefined} />
                  <StatTile k="Them" v={v ? signed(v.et) : '—'} size={26} bg="var(--surf2)" color={v ? (v.et >= 0 ? 'var(--pos)' : 'var(--neg)') : undefined} />
                </div>
                {(
                  [
                    ['You give', give, 'Click + on your roster'],
                    ['You get', get, partner != null ? 'Click + on their roster' : 'Choose a partner on the right'],
                  ] as const
                ).map(([title, items, empty]) => (
                  <div key={title} className="stack" style={{ gap: 6 }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 700 }}>{title}</span>
                      <span className="small mute num">{items.length ? num(items.reduce((s, a) => s + mineOf(a), 0)) : ''}</span>
                    </div>
                    {items.map(a => (
                      <GradCard key={a.id} color={assetColor(a)} minHeight={52} style={{ gap: 10, padding: '4px 4px 4px 10px', borderRadius: 14 }}>
                        <AssetFace a={a} size={36} />
                        <span className="trunc" style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14 }}>
                          {assetName(a)}
                        </span>
                        <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>
                          {num(mineOf(a))}
                        </span>
                        <button onClick={() => x.remove(a.id)} aria-label={`Remove ${a.name}`} style={{ width: 34, height: 34, borderRadius: 17, color: 'var(--mute)', fontSize: 18, textAlign: 'center' }}>
                          ×
                        </button>
                      </GradCard>
                    ))}
                    {items.length === 0 && <div className="dashed">{empty}</div>}
                  </div>
                ))}
                {x.extra > 0 && (
                  <Notice bg="var(--surf2)" message={`You take on ${x.extra} extra player${x.extra === 1 ? '' : 's'} on a full roster, so someone gets cut (−${num(d.spotCost)} each).`} />
                )}
                {x.fitWarnings.map(w => (
                  <Notice key={w} bg="var(--surf2)" message={w} />
                ))}
                {x.theirView.length > 0 && (
                  <div className="stack" style={{ gap: 2 }}>
                    <span className="small" style={{ fontWeight: 700 }}>
                      How they see it
                    </span>
                    {x.theirView.map(w => (
                      <span key={w} className="small mute">
                        {w}
                      </span>
                    ))}
                  </div>
                )}
                <div className="stack" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>Your roster after</span>
                  <HeatTiles
                    size={14}
                    items={x.groups.map(g => {
                      const delta = Math.round(g.after - g.before)
                      return {
                        k: g.g,
                        v: delta ? `${delta > 0 ? '+' : '−'}${kfmt(Math.abs(delta))}` : '–',
                        colors: delta ? heat(0.5 + Math.max(-0.5, Math.min(0.5, delta / POS_SCALE))) : { bg: 'var(--surf2)', fg: 'var(--mute)' },
                      }
                    })}
                  />
                </div>
                <div
                  style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 44px', gap: 10, alignItems: 'center' }}
                  title={`How much your league trades like the market (${d.market.source}) versus Tyler. Their side of every trade is judged on this blend.`}
                >
                  <span className="sub" style={{ fontSize: 14 }}>
                    Market influence
                  </span>
                  <input type="range" min={0} max={100} step={5} value={Math.round(x.beta * 100)} onChange={e => x.setBeta(Number(e.target.value) / 100)} />
                  <span className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>
                    {Math.round(x.beta * 100)}%
                  </span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Btn
                    kind="primary"
                    size="lg"
                    label="Send in Sleeper"
                    disabled={!v || x.me == null || partner == null}
                    title={settings.sleeperLink ? 'Review and send this offer in Sleeper' : 'Connect Sleeper, then review and send this offer'}
                    onClick={() => setSending(true)}
                    style={{ flex: 1 }}
                  />
                  <Btn size="lg" label="Clear" onClick={x.clear} />
                </div>
              </div>
            <span className="small mute" style={{ paddingTop: 8 }}>
              Your side is Tyler's sheet; theirs is the market, blended by Market influence. Verdicts use effective value: one star beats a bundle of the same raw total.
              {d.market.stale ? ` Market values are a stale copy: ${d.market.source} did not answer.` : ''}
            </span>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ ...HEAD, justifyContent: 'space-between', gap: 8 }}>
              <span className="title-l trunc">{partnerName ?? 'Choose a partner'}</span>
              {partner != null && <Btn size="sm" label="Change" onClick={() => setTrade(t => ({ ...t, partner: null, get: [] }))} bg="var(--surf)" style={{ color: 'var(--acc)', minHeight: 32, fontSize: 13 }} />}
            </div>
            {partner == null
              ? d.teams
                  .filter(tm => tm.roster_id !== x.me)
                  .map(tm => (
                    <GradCard key={tm.roster_id} color={teamColor(tm.roster_id)} minHeight={58} onClick={() => x.setPartner(tm.roster_id)} style={{ padding: '8px 14px', borderRadius: 14 }}>
                      <TeamAvatar rid={tm.roster_id} name={tm.name} size={38} />
                      <Stack2 title={tm.name} size={14} sub={`${tm.wins}-${tm.losses}${tm.full ? ' · roster full' : ''}`} subStyle={{ fontSize: 12 }} />
                    </GradCard>
                  ))
              : theirs.map(row)}
          </div>
        </>
      )}

      {sending && v && x.me != null && partner != null && context && (
        <SleeperSend
          settings={settings}
          hideNames={hide}
          leagueId={context.league.league_id}
          myRosterId={x.me}
          partnerRosterId={partner}
          partnerName={partnerName ?? 'them'}
          give={give}
          get={get}
          onSettings={settingsSaved}
          onSent={x.clear}
          onClose={() => setSending(false)}
        />
      )}
    </div>
  )
}

const MODES: Mode[] = ['contend', 'middle', 'rebuild']
const dealText = (dl: IdeaDeal) =>
  `Give ${dl.give.map(a => (a.kind === 'pick' && a.slot ? a.slot : a.name)).join(' + ')}. Get ${dl.get.map(a => (a.kind === 'pick' && a.slot ? a.slot : a.name)).join(' + ')}.`

/** Ideas: your direction (auto or set), then Sell and Buy side by side. */
function IdeasView({ onOpen }: { onOpen: () => void }) {
  const x = useTrade()
  const { direction, d } = x
  const ideas = useMemo(() => x.getIdeas(), [x.assets, direction.mode]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null
  const autoLabel = `Auto: ${MODE_LABEL[direction.auto.mode]}`
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="title-l" style={{ flex: 1 }}>
            You’re {direction.mode === 'middle' ? 'in between' : direction.mode === 'contend' ? 'contending' : 'rebuilding'}
          </span>
          <Seg
            onSurf
            value={direction.override ?? 'auto'}
            onChange={v => x.setMode(v === 'auto' ? null : (v as Mode))}
            options={[{ value: 'auto', label: autoLabel }, ...MODES.map(m => ({ value: m, label: MODE_LABEL[m] }))]}
          />
        </div>
        <span className="sub">
          {direction.override ? `Set by you. Auto would say ${MODE_LABEL[direction.auto.mode]}${direction.auto.why ? ` (${direction.auto.why})` : ''}.` : direction.auto.why}
        </span>
        <span className="small mute">{PHASE_LINE[d.phase]}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>
        {(
          [
            ['Sell', ideas.sells, 'Nothing to sell right now: no asset of yours where the market pays more, or Tyler says move on, and a partner says yes.'],
            ['Buy', ideas.buys, 'Nothing to buy right now that a partner would sell for a deal you win.'],
          ] as const
        ).map(([title, list, empty]) => (
          <div key={title} className="stack" style={{ gap: 10 }}>
            <span className="title-l">{title}</span>
            {list.length === 0 && <div className="card mute small">{empty}</div>}
            {list.map(i => (
              <IdeaCard key={i.asset.id} i={i} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <span className="title-l">Chains</span>
        {ideas.chains.length === 0 && <div className="card mute small">No chain beats selling directly right now. That’s normal: two teams have to value the middle player differently by more than the model’s error bar.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>
          {ideas.chains.map(ch => (
            <ChainCard key={ch.first.give[0].id} ch={ch} onOpen={onOpen} />
          ))}
        </div>
        {ideas.chains.length > 0 && <span className="small mute">A chain is two ordinary trades: send the first, and only once it’s accepted offer the second. Step one is a win on its own, so you’re fine holding the middle player if the second falls through.</span>}
      </div>
      <span className="small mute">
        Ideas follow Tyler’s strategy doc: values stay his board and the market, the rules pick what to shop, what to chase and who to aim at. Picks he says to hold never appear.
        Ask is the most you can take while they still say yes; Settle is what they clearly say yes to. Greed is good: open with the ask.
      </span>
    </div>
  )
}

function IdeaCard({ i, onOpen }: { i: Idea; onOpen: () => void }) {
  const x = useTrade()
  const { openPlayer } = useApp()
  const a = i.asset
  const open = (dl: IdeaDeal) => {
    x.loadDeal(dl)
    onOpen()
  }
  const deal = (label: string, dl: IdeaDeal) => (
    <button className="gcard" onClick={() => open(dl)} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, padding: '10px 14px', background: 'var(--surf2)', minHeight: 0 }}>
      <span className="row small" style={{ justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontWeight: 700 }}>
          {label} · {x.teamName(dl.partner)}
        </span>
        <span className="num mute">
          You {signed(dl.verdict.em)} · Them {signed(dl.verdict.et)}
        </span>
      </span>
      <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{dealText(dl)}</span>
    </button>
  )
  return (
    <div className="gcard" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, padding: '14px 16px', background: grad(assetColor(a)) }}>
      <div className="row" style={{ gap: 10 }}>
        <AssetFace a={a} />
        <button onClick={() => a.kind === 'player' && openPlayer(a.id, a.name)} style={{ flex: 1, minWidth: 0, cursor: a.kind === 'player' ? 'pointer' : 'default', textAlign: 'left' }}>
          <Stack2 title={assetName(a)} size={15} sub={`${assetMeta(a)}${i.kind === 'buy' ? ` · ${x.teamName(a.owner)}` : ''}`} subStyle={{ fontSize: 12 }} />
        </button>
        <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>
          {kfmt(mineOf(a))}
        </span>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        {[...i.reasons.map(r => [r.rule, r.text]), ...i.partnerWhy.map(w => ['Partner', w])].map(([rule, text]) => (
          <span key={text} className="small" style={{ lineHeight: 1.4 }}>
            <b style={{ color: 'var(--acc)' }}>{rule}.</b> {text}
          </span>
        ))}
      </div>
      {deal('Ask', i.ask)}
      {i.settle && deal('Settle', i.settle)}
      {i.notes.map(n => (
        <span key={n} className="small" style={{ color: 'var(--warn)', fontWeight: 600 }}>
          {n}
        </span>
      ))}
    </div>
  )
}

function ChainCard({ ch, onOpen }: { ch: Chain; onOpen: () => void }) {
  const x = useTrade()
  const step = (n: number, dl: IdeaDeal, open: boolean) => (
    <GradCard
      color={null}
      onClick={open ? () => (x.loadDeal(dl), onOpen()) : undefined}
      minHeight={0}
      style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, padding: '10px 14px', background: 'var(--surf2)' }}
    >
      <span className="row small" style={{ justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontWeight: 700 }}>
          {n === 1 ? '1 · Send' : '2 · Then offer'} · {x.teamName(dl.partner)}
        </span>
        <span className="num mute">
          You {signed(dl.verdict.em)} · Them {signed(dl.verdict.et)}
        </span>
      </span>
      <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{dealText(dl)}</span>
    </GradCard>
  )
  const a = ch.first.give[0]
  return (
    <div className="gcard" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, padding: '14px 16px', background: grad(assetColor(a)) }}>
      <div className="row" style={{ gap: 10 }}>
        <AssetFace a={a} />
        <Stack2 title={`${assetName(a)} → ${ch.first.get[0].name} → ${ch.second.get.map(g => g.name).join(' + ')}`} size={15} sub={`You ${signed(ch.total)} over both steps · selling ${a.name} directly: ${signed(ch.direct)}`} subStyle={{ fontSize: 12 }} />
      </div>
      <div className="stack" style={{ gap: 4 }}>
        {ch.why.map(w => (
          <span key={w} className="small" style={{ lineHeight: 1.4 }}>
            <b style={{ color: 'var(--acc)' }}>Why it works.</b> {w}
          </span>
        ))}
      </div>
      {step(1, ch.first, true)}
      {step(2, ch.second, false)}
    </div>
  )
}

/** Vacuum: search any player or pick on the left, add it to a side; the two lenses on the right. */
function VacuumView() {
  const x = useTrade()
  const [q, setQ] = useState('')
  const { vac, vacVerdict: v } = x
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase()
    const on = new Set([...vac.a, ...vac.b].map(a => a.id))
    return x.vacuumPool
      .filter(a => !on.has(a.id) && (!n || a.name.toLowerCase().includes(n)))
      .sort((a, b) => b.sheet - a.sheet)
      .slice(0, 40)
  }, [q, x.vacuumPool, vac.a.length, vac.b.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const txt = vacuumText(v)
  const where = (a: Asset) => (a.owner ? x.teamName(a.owner) : 'Free agent')
  const lensTile = (k: string, l: { a: number; b: number; diff: number }, w: Side) => (
    <StatTile
      k={k}
      v={w === 'even' ? 'Even' : `${w.toUpperCase()} +${kfmt(Math.abs(l.diff))}`}
      sub={`A gets ${kfmt(l.a)} · B gets ${kfmt(l.b)}`}
      size={26}
      bg="var(--surf2)"
      color={w === 'even' ? undefined : 'var(--pos)'}
    />
  )
  const vals = (a: Asset) => (
    <span className="num small" style={{ textAlign: 'right', lineHeight: 1.3 }}>
      <b>{kfmt(a.sheet)}</b>
      <br />
      <span className="mute">{a.market == null ? 'no mkt' : kfmt(a.market)}</span>
    </span>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)', gap: 20, alignItems: 'start' }}>
      <div className="stack" style={{ gap: 8 }}>
        <label className="search-pill" style={{ width: '100%' }}>
          <Icon name="search" size={18} stroke={2} style={{ color: 'var(--mute)' }} />
          <input autoFocus placeholder="Any player or pick" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <span className="small mute" style={{ padding: '0 4px' }}>
          Tyler’s value over the market’s. Add to the side that gets him.
        </span>
        {hits.map(a => (
          <GradCard key={a.id} color={assetColor(a)} minHeight={56} style={{ gap: 10, padding: '6px 8px 6px 10px', borderRadius: 14 }}>
            <AssetFace a={a} />
            <Stack2 title={assetName(a)} size={14} sub={`${assetMeta(a)} · ${where(a)}`} subStyle={{ fontSize: 12 }} />
            {vals(a)}
            <Btn size="sm" label="A" onClick={() => x.vacAdd(a.id, 'a')} style={{ minWidth: 40 }} />
            <Btn size="sm" label="B" onClick={() => x.vacAdd(a.id, 'b')} style={{ minWidth: 40 }} />
          </GradCard>
        ))}
        {hits.length === 0 && <div className="card mute small">No player or pick matches “{q}”.</div>}
      </div>

      <div className="sticky hero" style={{ padding: 22, gap: 16 }}>
        <div className="stack" style={{ gap: 6 }}>
          <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: `var(--${txt.tone === 'mute' ? 'ink' : txt.tone})` }}>{txt.title}</div>
          <span className="sub">{txt.line}</span>
        </div>
        {v && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {lensTile('Tyler’s sheet', v.tyler, v.tylerWinner)}
            {lensTile('Market', v.market, v.marketWinner)}
          </div>
        )}
        {(
          [
            ['Side A gets', vac.a],
            ['Side B gets', vac.b],
          ] as const
        ).map(([title, items]) => (
          <div key={title} className="stack" style={{ gap: 6 }}>
            <span style={{ fontWeight: 700 }}>{title}</span>
            {items.map(a => (
              <GradCard key={a.id} color={assetColor(a)} minHeight={52} style={{ gap: 10, padding: '4px 4px 4px 10px', borderRadius: 14 }}>
                <AssetFace a={a} size={36} />
                <Stack2 title={assetName(a)} size={14} sub={where(a)} subStyle={{ fontSize: 12 }} />
                {vals(a)}
                <button onClick={() => x.vacRemove(a.id)} aria-label={`Remove ${a.name}`} style={{ width: 34, height: 34, borderRadius: 17, color: 'var(--mute)', fontSize: 18, textAlign: 'center' }}>
                  ×
                </button>
              </GradCard>
            ))}
            {items.length === 0 && <div className="dashed">Add from the search on the left</div>}
          </div>
        ))}
        {v && v.unpriced.length > 0 && (
          <Notice bg="var(--surf2)" message={`No market price for ${v.unpriced.map(a => a.name).join(', ')}: the market lens uses Tyler’s value for them.`} />
        )}
        {(vac.a.length > 0 || vac.b.length > 0) && <Btn size="lg" label="Clear" onClick={x.vacClear} />}
        <span className="small mute">Vacuum ignores teams: no partner, no demand, no roster spots. Tyler’s lens is his sheet as-is, the market’s is KeepTradeCut’s price, both in this league’s scoring and in effective value (one star beats a bundle).</span>
      </div>
    </div>
  )
}
