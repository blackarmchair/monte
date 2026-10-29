// Parity: Monte's trade values (sheet / market-blended val) vs dynasty_model.pinfo().
// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/trades-parity.mts <xlsx> <players.json> <py_dump.json> <leagueId> <userId>
import { readFileSync } from 'node:fs'
import { readWorkbook } from '../packages/core/src/xlsx.ts'
import { buildTrades, fromFantasyCalc } from '../packages/core/src/trades.ts'
import { FC_SCORING } from '../packages/core/src/tradeMath.ts'

const [xlsx, playersPath, pyPath, leagueId, userId] = process.argv.slice(2)
const api = (p: string) => fetch(`https://api.sleeper.app/v1${p}`).then(r => r.json())
const [league, rosters, users, traded] = await Promise.all(
  [`/league/${leagueId}`, `/league/${leagueId}/rosters`, `/league/${leagueId}/users`, `/league/${leagueId}/traded_picks`].map(api),
)
const qbs = (league.roster_positions as string[]).includes('SUPER_FLEX') ? 2 : 1
// Optional 6th arg: a FantasyCalc snapshot, to compare against the exact data the engine cached.
const fcRows = process.argv[7] ? JSON.parse(readFileSync(process.argv[7], 'utf8')) : await fetch(
  `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=${qbs}&ppr=1&numTeams=${rosters.length}&includePicks=true`,
).then(r => r.json())
const py = JSON.parse(readFileSync(pyPath, 'utf8'))
const d = buildTrades({
  wb: readWorkbook(new Uint8Array(readFileSync(xlsx))),
  sheetPath: xlsx,
  modifiedAt: '',
  league,
  rosters,
  users,
  traded,
  meta: JSON.parse(readFileSync(playersPath, 'utf8')),
  market: { source: 'FantasyCalc', rows: fromFantasyCalc(fcRows), asOf: null, stale: false, scoring: FC_SCORING },
  beta: py.beta,
  userId,
})
console.log(`gamma ${d.gamma} (py ${py.gamma}) · spot ${d.spotCost} (py ${py.spot}) · ${d.assets.length} assets`)
let sheetBad = 0, valBad = 0, both = 0
const worst: string[] = []
for (const a of d.assets) {
  const p = py.players[a.id]
  if (!p) continue
  both++
  if (Math.abs(a.sheet - p.sheet) > 0.5) { sheetBad++; worst.push(`SHEET ${a.name}: monte ${a.sheet.toFixed(0)} py ${p.sheet.toFixed(0)}`) }
  const dv = Math.abs(a.val - p.val)
  if (dv > Math.max(25, 0.02 * p.val)) { valBad++; worst.push(`VAL   ${a.name}: monte ${a.val.toFixed(0)} py ${p.val.toFixed(0)} (py ${p.src} rank ${p.mrank}, monte rank ${d.ranks[a.id]?.marketRank})`) }
}
console.log(`compared ${both}: sheet mismatches ${sheetBad}, val mismatches (>2%) ${valBad}`)
console.log(worst.slice(0, 15).join('\n'))
const picks = Object.entries(d.pickInputs.market).slice(0, 6).map(([k, v]) => `${k}=${v.toFixed(0)}`)
console.log('pick market sample:', picks.join(' '), '| sheet curve top:', d.pickInputs.sheetCurve.slice(0, 4).map(v => v.toFixed(0)).join(' '))
