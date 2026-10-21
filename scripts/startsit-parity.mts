// Parity: Monte's start/sit engine vs reference/start_sit.py on the same inputs.
// node --experimental-strip-types scripts/startsit-parity.mts <ranks.xlsx> <players_nfl.json> <stats_prev.json> <leagueId> <userId>
import { readFileSync } from 'node:fs'
import { readWorkbook } from '../src/main/xlsx.ts'
import { buildStartSit } from '../src/main/startSit.ts'

const [xlsx, playersPath, statsPath, leagueId, userId] = process.argv.slice(2)
const api = (p: string) => fetch(`https://api.sleeper.app/v1${p}`).then(r => r.json())
const state = await api('/state/nfl')
const week = Number(state.display_week || state.week)
const season = String(state.league_season || state.season)
const [league, rosters, users, matchups, sched] = await Promise.all([
  api(`/league/${leagueId}`),
  api(`/league/${leagueId}/rosters`),
  api(`/league/${leagueId}/users`),
  api(`/league/${leagueId}/matchups/${week}`),
  fetch(`https://api.sleeper.app/schedule/nfl/regular/${season}`).then(r => r.json()),
])
const schedule: Record<string, Record<number, string>> = {}
for (const g of sched) if (g.status !== 'canceled') for (const t of [g.home, g.away]) (schedule[t] ??= {})[g.week] = g.status || 'pre_game'

const d = buildStartSit({
  wb: readWorkbook(new Uint8Array(readFileSync(xlsx))),
  sheetPath: xlsx,
  modifiedAt: new Date().toISOString(),
  league,
  rosters,
  users,
  matchups,
  schedule,
  stats: JSON.parse(readFileSync(statsPath, 'utf8')),
  meta: JSON.parse(readFileSync(playersPath, 'utf8')),
  userId,
  week,
  // Parity with start_sit.py, which has no manual overrides.
  overrides: {},
})
console.log(`week ${d.week} board ${d.boardWeek} · cur ${d.totals.current.toFixed(1)} best ${d.totals.best.toFixed(1)} gain ${d.gain.toFixed(1)}`)
console.log('columns', d.columns)
for (const s of d.slots) {
  const f = (p: any) => (p ? `${p.name} ${p.pos} ${p.proj.toFixed(1)} ${p.flag}` : '-')
  console.log(`${s.slot.padEnd(11)} cur: ${f(s.current).padEnd(40)} best: ${f(s.best)}`)
}
console.log('changes:', d.changes.map(c => `${c.label}: ${c.inPlayer.name} for ${c.outPlayer?.name ?? '(empty)'} ${c.gain >= 0 ? '+' : ''}${c.gain.toFixed(1)}`))
console.log('moves:', d.moves.map(m => `${m.player.name} ${m.from} -> ${m.to}`))
console.log('opponent:', d.opponent, '\nwarnings:', d.warnings)
