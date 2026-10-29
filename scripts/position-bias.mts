// How much of the sheet-vs-market gap is position-wide? Median market/sheet ratio per position.
import { readFileSync } from 'node:fs'
import { readWorkbook } from '../packages/core/src/xlsx.ts'
import { buildTrades, fromFantasyCalc } from '../packages/core/src/trades.ts'
import { FC_SCORING } from '../packages/core/src/tradeMath.ts'
const [xlsx, playersPath, leagueId, userId] = process.argv.slice(2)
const api = (p: string) => fetch(`https://api.sleeper.app/v1${p}`).then(r => r.json())
const [league, rosters, users, traded] = await Promise.all(
  [`/league/${leagueId}`, `/league/${leagueId}/rosters`, `/league/${leagueId}/users`, `/league/${leagueId}/traded_picks`].map(api),
)
const fc = await fetch(`https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&ppr=1&numTeams=${rosters.length}&includePicks=true`).then(r => r.json())
const d = buildTrades({ wb: readWorkbook(new Uint8Array(readFileSync(xlsx))), sheetPath: xlsx, modifiedAt: '', league, rosters, users, traded,
  meta: JSON.parse(readFileSync(playersPath, 'utf8')), market: { source: 'FantasyCalc', rows: fromFantasyCalc(fc), asOf: null, stale: false, scoring: FC_SCORING }, beta: 1, userId })
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  const xs = d.assets.filter(a => a.pos === pos && a.sheet >= 1000 && a.market != null)
  const ratio = xs.map(a => a.market! / a.sheet)
  const under = xs.filter(a => a.sheet > a.val).length
  console.log(`${pos}: n=${xs.length}  median market/sheet ${med(ratio).toFixed(2)}  sheet>market (reads as BUY) ${under}/${xs.length}`)
}
