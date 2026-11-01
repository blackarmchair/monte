// Why Matchups and Lineup show different numbers for the same game. They answer different
// questions, so they can disagree for real reasons, and the screens have to say which:
//   - lineup: Matchups prices what is set in Sleeper; Lineup prices the lineup on screen, which can
//     carry proposed swaps or sim-outs that aren't in Sleeper yet.
//   - projections: Matchups scores Sleeper's weekly projection lines in the league's scoring;
//     Lineup maps the sheet's rank to last season's PPG at that rank (see startSit).
//   - games played: Matchups banks what started games have scored; Lineup ignores the scoreboard.
//   - spread: Matchups spreads each unplayed starter around his projection; Lineup a flat ±WIN_SD.
// The basis line and the comparison are both built here so the desktop and the phone say the same.
import { expectedOf, type GameState, type MatchSide } from './leagueWeek'
import type { StartSitData } from './types'

export type Basis = {
  lineup: 'submitted' | 'proposed'
  source: 'sleeper' | 'monte'
  you: number
  opp: number | null
  /** 0..1 */
  win: number | null
  /** your starters whose games have started, counted at what they scored */
  played: number
}

export function basisLabel(b: Basis): string {
  return [
    b.lineup === 'submitted' ? 'Submitted lineup' : 'Proposed lineup',
    b.source === 'sleeper' ? 'Sleeper projections' : 'Monte projections',
    b.played ? `${b.played} game${b.played === 1 ? '' : 's'} under way` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function matchupBasis(me: MatchSide, opp: MatchSide): Basis {
  return {
    lineup: 'submitted',
    source: 'sleeper',
    you: me.projected,
    opp: opp.projected,
    win: me.winPct,
    played: me.starters.filter(p => p.state === 'live' || p.state === 'done').length,
  }
}

/** Lineup's number for what Sleeper has set, before any change on screen. */
export function lineupBasis(d: StartSitData, win: (diff: number) => number, you = d.totals.current): Basis {
  const opp = d.opponent?.total ?? null
  return { lineup: 'submitted', source: 'monte', you, opp, win: opp == null ? null : win(you - opp), played: 0 }
}

export type CompareRow = { label: string; matchups: string; lineup: string }
export type ComparePlayer = { id: string; name: string; pos: string; state: GameState | null; matchups: number | null; lineup: number | null }
export type Comparison = { rows: CompareRow[]; reasons: string[]; players: ComparePlayer[] }

const f1 = (x: number | null) => (x == null ? '—' : x.toFixed(1))
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`)
const arrow = (a: string, b: string | null) => (b == null || a === b ? a : `${a} → ${b}`)

/**
 * Both screens' numbers side by side, with the reasons they differ, biggest first. `proposed` is
 * Lineup's on-screen lineup when it differs from Sleeper's; `me`/`opp` are this week's matchup
 * sides; `d` is the start/sit read (null without the sheet).
 */
export function compareBases(o: {
  me: MatchSide | null
  opp: MatchSide | null
  d: StartSitData | null
  win: (diff: number) => number
  /** Lineup's total for what Sleeper has set, when it knows better than the read (just pushed) */
  submitted?: number
  proposed?: { you: number; win: number | null } | null
}): Comparison {
  const m = o.me && o.opp ? matchupBasis(o.me, o.opp) : null
  const l = o.d ? lineupBasis(o.d, o.win, o.submitted) : null
  const p = o.proposed ?? null
  const rows: CompareRow[] = [
    { label: 'Lineup', matchups: m ? 'In Sleeper' : '—', lineup: l ? arrow('In Sleeper', p ? 'proposed' : null) : '—' },
    { label: 'Projections', matchups: m ? 'Sleeper weekly' : '—', lineup: l ? 'Sheet rank → PPG' : '—' },
    { label: 'Games started', matchups: m ? (m.played ? `${m.played} at their score` : 'none yet') : '—', lineup: l ? 'not counted' : '—' },
    { label: 'You', matchups: m ? f1(m.you) : '—', lineup: l ? arrow(f1(l.you), p ? f1(p.you) : null) : '—' },
    { label: 'Opponent', matchups: m ? f1(m.opp) : '—', lineup: l ? f1(l.opp) : '—' },
    { label: 'Win', matchups: m ? pct(m.win) : '—', lineup: l ? arrow(pct(l.win), p ? pct(p.win) : null) : '—' },
  ]

  // Per starter: what each screen counts him for, joined by id over Sleeper's submitted lineup.
  const monte = new Map<string, number>()
  for (const s of o.d?.slots ?? []) if (s.current) monte.set(s.current.id, s.current.startable ? s.current.proj : 0)
  const players: ComparePlayer[] = []
  const seen = new Set<string>()
  for (const s of o.me?.starters ?? []) {
    if (s.state === 'empty') continue
    seen.add(s.id)
    players.push({ id: s.id, name: s.name, pos: s.pos, state: s.state, matchups: expectedOf(s), lineup: monte.has(s.id) ? monte.get(s.id)! : null })
  }
  for (const s of o.d?.slots ?? [])
    if (s.current && !seen.has(s.current.id))
      players.push({ id: s.current.id, name: s.current.name, pos: s.current.pos, state: null, matchups: null, lineup: monte.get(s.current.id)! })

  const reasons: string[] = []
  if (m && l) {
    // Only players both screens price can say anything about the sources; K / DEF / IDP have no
    // Monte number and sit in Matchups' total alone.
    let src = 0
    let live = 0
    let only = 0
    for (const x of players) {
      if (x.matchups != null && x.lineup == null) only += x.matchups
      if (x.matchups == null || x.lineup == null) continue
      if (x.state === 'live' || x.state === 'done') live += x.matchups - x.lineup
      else src += x.matchups - x.lineup
    }
    const sgn = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`
    const parts: Array<{ size: number; text: string }> = []
    if (Math.abs(src) >= 0.5)
      parts.push({
        size: Math.abs(src),
        text: `Projection source (${sgn(src)} in Matchups): Matchups uses Sleeper’s weekly projections; Lineup maps the sheet’s rank to what that rank scored per game last season.`,
      })
    if (m.played && Math.abs(live) >= 0.5)
      parts.push({
        size: Math.abs(live),
        text: `Games under way (${sgn(live)} in Matchups): Matchups counts what ${m.played} of your starters have already scored; Lineup still prices them by rank.`,
      })
    if (only >= 0.5)
      parts.push({ size: only, text: `Slots Lineup doesn’t rank (K, DEF, IDP) add ${only.toFixed(1)} in Matchups and nothing in Lineup.` })
    parts.sort((a, b) => b.size - a.size)
    reasons.push(...parts.map(x => x.text))
    if (p && Math.abs(p.you - l.you) >= 0.05)
      reasons.push(`Proposed changes (${sgn(p.you - l.you)} in Lineup): Lineup shows the lineup on screen; Matchups only sees what’s set in Sleeper.`)
    if (m.win != null && l.win != null && Math.abs(m.win - l.win) >= 0.05)
      reasons.push('Win %: Matchups spreads each unplayed starter around his own projection; Lineup uses one fixed spread for the whole week.')
  }
  return { rows, reasons, players }
}
