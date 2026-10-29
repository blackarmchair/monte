// League's Matchups and Trades tabs, phone-sized. Matchups: this week's pairs, yours first and open,
// each team on its own row with Monte's win chance under them; tap for the starters slot by slot.
// Trades: your open offers when Sleeper is connected, then the league's completed trades this
// season, newest first, each side stacked ("You get" first).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Linking, Pressable, View } from 'react-native'
import type { LeagueTrades, LeagueWeek, MatchPlayer, MatchSide, TradeTx } from '@monte/core/leagueWeek'
import { teamLabel } from '@monte/core/names'
import type { Result } from '@monte/core/types'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { mineOf, useTrade } from '@/lib/trade'
import { Card, ErrorBox, GradCard, Headshot, kfmt, Loading, ORD, Row, Section, Stack2, T, TeamAvatar } from '@/ui/kit'
import { nflColor, R, ring, teamColor, useTheme } from '@/ui/theme'

/** Load once per league, with a manual refresh. */
function useLoad<T>(fetcher: (leagueId: string) => Promise<Result<T>>) {
  const { context } = useApp()
  const leagueId = context?.league.league_id
  const [res, setRes] = useState<Result<T> | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => {
    if (!leagueId) return
    setBusy(true)
    void fetcher(leagueId).then(r => {
      setRes(r)
      setBusy(false)
    })
  }
  useEffect(load, [leagueId]) // eslint-disable-line react-hooks/exhaustive-deps
  return { res, busy, load }
}

function Head({ title, busy, onRefresh }: { title: string; busy: boolean; onRefresh: () => void }) {
  return (
    <Section
      title={title}
      right={
        <T v="smallSemi" c="acc" onPress={busy ? undefined : onRefresh}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </T>
      }
    />
  )
}

export function Matchups() {
  const t = useTheme()
  const { context, hide } = useApp()
  const { res, busy, load } = useLoad(id => monte.leagueWeek(id))
  const me = context?.myRosterId ?? null
  const lw: LeagueWeek | null = res?.ok ? res.value : null
  // Yours first; within each pair, yours on top.
  const pairs = useMemo(() => {
    if (!lw) return []
    return lw.matchups
      .map(m => (m.sides[1].rosterId === me ? { ...m, sides: [m.sides[1], m.sides[0]] as [MatchSide, MatchSide] } : m))
      .sort((a, b) => Number(b.sides[0].rosterId === me) - Number(a.sides[0].rosterId === me))
  }, [lw, me])
  const [open, setOpen] = useState<number | null>(null)
  const shownOpen = open ?? pairs[0]?.id ?? null
  const label = (s: MatchSide) => (hide ? teamLabel(s.rosterId) : s.team)

  return (
    <View style={{ gap: 12 }}>
      <Head title={lw ? `Week ${lw.week} ${lw.playoffs ? 'playoffs' : 'matchups'}` : 'Matchups'} busy={busy} onRefresh={load} />
      {res && !res.ok && <ErrorBox message={res.error} onRetry={load} />}
      {!res && <Loading label="Reading this week’s matchups…" />}
      {lw && pairs.length === 0 && (
        <T c="mute" size={14}>
          {lw.playoffs ? 'No playoff games this week: the bracket is done.' : 'No head-to-head matchups this week.'}
        </T>
      )}
      {pairs.map(m => {
        const [a, b] = m.sides
        const isOpen = shownOpen === m.id
        return (
          <View key={m.id} style={[{ borderRadius: R.card, backgroundColor: t.surf, overflow: 'hidden' }, a.rosterId === me && ring(t, true)]}>
            <Pressable onPress={() => setOpen(isOpen ? -1 : m.id)} style={({ pressed }) => [{ padding: 14, gap: 10 }, pressed && { opacity: 0.8 }]}>
              <SideRow s={a} name={label(a)} lead={a.winPct >= b.winPct} />
              <SideRow s={b} name={label(b)} lead={b.winPct > a.winPct} />
              <WinBar a={a} b={b} />
            </Pressable>
            {isOpen && <StarterRows a={a} b={b} />}
          </View>
        )
      })}
      {lw && (
        <T v="small" c="mute">
          Win % is Monte’s estimate (Sleeper doesn’t publish one): finished games count as scored, the rest as Sleeper’s projection in your league’s scoring, with a typical
          week’s spread around it. Tap a matchup for its starters.
        </T>
      )}
    </View>
  )
}

function SideRow({ s, name, lead }: { s: MatchSide; name: string; lead: boolean }) {
  const { hide } = useApp()
  return (
    <Row gap={12}>
      <TeamAvatar rid={s.rosterId} name={name} size={38} src={hide ? null : s.avatar} />
      <Stack2 title={name} sub={`proj ${s.projected.toFixed(1)} · ${Math.round(s.winPct * 100)}% to win`} subC={lead ? 'pos' : 'mute'} size={15} />
      <T v="bold" size={24} num>
        {s.points.toFixed(1)}
      </T>
    </Row>
  )
}

function WinBar({ a, b }: { a: MatchSide; b: MatchSide }) {
  const t = useTheme()
  const pa = Math.round(a.winPct * 100)
  const lead = a.winPct >= b.winPct
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: t.surf2, overflow: 'hidden', flexDirection: 'row' }}>
      <View style={{ width: `${pa}%`, backgroundColor: lead ? t.pos : t.mute }} />
    </View>
  )
}

const STATE_LABEL: Record<MatchPlayer['state'], string> = { pre: '', live: 'Live', done: 'Final', bye: 'Bye', empty: '' }

function StarterRows({ a, b }: { a: MatchSide; b: MatchSide }) {
  const t = useTheme()
  const { openPlayer } = useApp()
  const n = Math.max(a.starters.length, b.starters.length)
  const cell = (p: MatchPlayer | undefined, right: boolean) => {
    if (!p) return <View style={{ flex: 1 }} />
    const empty = p.state === 'empty'
    const score = (
      <View style={{ alignItems: right ? 'flex-start' : 'flex-end', minWidth: 40 }}>
        <T v="bold" size={14} num c={p.state === 'pre' ? 'mute' : 'ink'}>
          {p.state === 'pre' ? '–' : p.points.toFixed(1)}
        </T>
        <T v="small" c="mute" num>
          {p.proj.toFixed(1)}
        </T>
      </View>
    )
    return (
      <Pressable
        disabled={empty}
        onPress={() => openPlayer(p.id, p.name)}
        style={({ pressed }) => [
          { flex: 1, minWidth: 0, flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 10, backgroundColor: t.bg },
          pressed && { opacity: 0.8 },
        ]}
      >
        <View style={{ flex: 1, minWidth: 0, alignItems: right ? 'flex-end' : 'flex-start' }}>
          <T v="semi" size={13} lines={1} color={empty ? t.bad : undefined}>
            {p.name}
          </T>
          <T v="small" c="mute" lines={1} size={11}>
            {[p.pos, p.team, STATE_LABEL[p.state]].filter(Boolean).join(' · ')}
          </T>
        </View>
        {score}
      </Pressable>
    )
  }
  return (
    <View style={{ gap: 5, paddingHorizontal: 10, paddingBottom: 12 }}>
      {Array.from({ length: n }, (_, i) => (
        <Row key={i} gap={5} align="stretch">
          {cell(a.starters[i], false)}
          {cell(b.starters[i], true)}
        </Row>
      ))}
    </View>
  )
}

const ago = (ms: number) => {
  const d = Math.round((Date.now() - ms) / 86400000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function Trades() {
  const { context } = useApp()
  const { res, busy, load } = useLoad(id => monte.leagueTrades(id))
  const lt: LeagueTrades | null = res?.ok ? res.value : null
  const me = context?.myRosterId ?? null
  const open = (lt?.pending ?? []).filter(t => me == null || t.sides.some(s => s.rosterId === me))
  return (
    <View style={{ gap: 20 }}>
      <Head title="Trades" busy={busy} onRefresh={load} />
      {res && !res.ok && <ErrorBox message={res.error} onRetry={load} />}
      {!res && <Loading label="Reading the league’s trades…" />}
      {lt && (
        <Block title={`Your open offers${open.length ? ` · ${open.length}` : ''}`}>
          {lt.pendingNote ? (
            <T c="mute" size={14}>
              {lt.pendingNote}
            </T>
          ) : open.length === 0 ? (
            <T c="mute" size={14}>
              No open offers.
            </T>
          ) : (
            open.map(t => <TradeCard key={t.id} t={t} />)
          )}
        </Block>
      )}
      {lt && (
        <Block title={`Completed this season${lt.recent.length ? ` · ${lt.recent.length}` : ''}`}>
          {lt.recent.length === 0 ? (
            <T c="mute" size={14}>
              No trades yet this season.
            </T>
          ) : (
            lt.recent.map(t => <TradeCard key={t.id} t={t} />)
          )}
        </Block>
      )}
    </View>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <T v="label">{title}</T>
      {children}
    </View>
  )
}

function TradeCard({ t: tx }: { t: TradeTx }) {
  const t = useTheme()
  const { context, openPlayer } = useApp()
  const { byId, teamName } = useTrade()
  const me = context?.myRosterId ?? null
  const sides = [...tx.sides].sort((a, b) => Number(b.rosterId === me) - Number(a.rosterId === me))
  const status =
    tx.status === 'complete'
      ? `Week ${tx.week} · ${ago(tx.created)}`
      : `${tx.creator === me ? 'You sent this' : tx.creator != null ? `From ${teamName(tx.creator)}` : 'Open'} · ${ago(tx.created)}`
  return (
    <Card gap={12}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="small" c="mute" lines={1} style={{ flexShrink: 1 }}>
          {status}
        </T>
        {tx.status === 'proposed' && context && (
          <T v="smallSemi" c="acc" onPress={() => void Linking.openURL(`https://sleeper.com/leagues/${context.league.league_id}/trades`)}>
            Open in Sleeper ↗
          </T>
        )}
      </Row>
      {sides.map(s => (
        <View key={s.rosterId} style={{ gap: 6 }}>
          <Row gap={10}>
            <TeamAvatar rid={s.rosterId} name={teamName(s.rosterId)} size={28} />
            <T v="bold" size={15} lines={1} style={{ flexShrink: 1 }}>
              {s.rosterId === me ? 'You get' : `${teamName(s.rosterId)} gets`}
            </T>
          </Row>
          {s.players.map(p => {
            const a = byId.get(p.id)
            return (
              <GradCard key={p.id} color={nflColor(t, p.team)} minHeight={52} onPress={() => openPlayer(p.id, p.name)} style={{ paddingVertical: 6 }} accessibilityLabel={p.name}>
                <Headshot id={p.id} name={p.name} size={34} />
                <Stack2 title={p.name} sub={[p.pos, p.team].filter(Boolean).join(' · ')} size={15} />
                {a && (
                  <T v="bold" size={14} num>
                    {kfmt(mineOf(a))}
                  </T>
                )}
              </GradCard>
            )
          })}
          {s.picks.map((p, i) => (
            <GradCard key={i} color={teamColor(p.orig)} minHeight={46} style={{ paddingVertical: 6 }}>
              <Stack2 title={`${p.season} ${ORD[p.round] ?? `R${p.round}`}`} sub={p.orig === s.rosterId ? 'own' : `via ${teamName(p.orig)}`} size={15} />
            </GradCard>
          ))}
          {s.players.length === 0 && s.picks.length === 0 && (
            <T v="small" c="mute">
              Nothing
            </T>
          )}
        </View>
      ))}
    </Card>
  )
}
