// Trade: three columns. Your roster on the left and theirs on the right (the team list until you
// pick a partner), each row with a +/✓ toggle; in the middle (sticky) Monte's deal ideas while the
// trade is empty, then the verdict card with both sides, your roster after, Market influence and
// Send in Sleeper.
import { useMemo, useState } from 'react'
import type { Asset } from '@shared/tradeMath'
import { useApp } from './store'
import { assetMeta, marketTag, mineOf, useTrade, verdictText, type VerdictTone } from './tradeModel'
import SleeperSend from './SleeperSend'
import { Btn, Check, ErrorBox, GradCard, Headshot, HeatTiles, kfmt, Loading, NeedsSheet, nflColor, Notice, num, RING, signed, Stack2, StatTile, TeamAvatar, teamColor, useHeat } from './ui'

const tone = (t: VerdictTone) => `var(--${t})`
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
  // Deal ideas while the trade is empty: your top assets shopped one at a time, both sides winning.
  const ideas = useMemo(() => (d && count === 0 ? x.findDeals([], 2, 3) : []), [d, count, x.assets]) // eslint-disable-line react-hooks/exhaustive-deps

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
        <>
          <div className="stack" style={{ gap: 8 }}>
            <span className="title-l" style={{ paddingBottom: 2 }}>
              Your roster
            </span>
            {x.mine.map(row)}
          </div>

          <div className="sticky stack" style={{ gap: 16 }}>
            {count === 0 ? (
              <div className="stack" style={{ gap: 8 }}>
                <span className="title-l">Deals Monte found</span>
                {ideas.length === 0 && <div className="card mute small">No deal where both sides win right now.</div>}
                {ideas.map((deal, i) => {
                  const vt = verdictText(deal.verdict)
                  return (
                    <button key={i} className="gcard" onClick={() => x.loadDeal(deal)} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, padding: '16px 18px' }}>
                      <span className="row small" style={{ justifyContent: 'space-between', gap: 8 }}>
                        <span className="mute trunc">with {x.teamName(deal.partner)}</span>
                        <span style={{ color: tone(vt.tone), fontWeight: 700 }}>{vt.label}</span>
                      </span>
                      <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35 }}>
                        Give {deal.give.map(a => (a.kind === 'pick' && a.slot ? a.slot : a.name)).join(', ')}. Get {deal.get.map(a => a.name).join(' + ')}.
                      </span>
                    </button>
                  )
                })}
                <span className="small mute" style={{ paddingTop: 4 }}>
                  Or click + on any player in either roster.
                </span>
              </div>
            ) : (
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
                  title="How much your league trades like the market (FantasyCalc) versus Tyler. Their side of every trade is judged on this blend."
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
            )}
            <span className="small mute">
              Your side is Tyler's sheet; theirs is the market, blended by Market influence. Verdicts use effective value: one star beats a bundle of the same raw total.
              {d.market.stale ? ' Market values are a stale copy: FantasyCalc did not answer.' : ''}
            </span>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8, paddingBottom: 2 }}>
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
