// Parity: Monte's sheet values vs the Dynasty Daddy upload (which uses the same transform).
// node --experimental-strip-types scripts/parity.mts <ranks.xlsx> <players_nfl.json> <leagueId>
import { readFileSync } from 'node:fs'
import { readWorkbook } from '../packages/core/src/xlsx.ts'
import { findBoard, matchBoard, UNRANKED } from '../packages/core/src/values.ts'

const [xlsx, playersPath, leagueId] = process.argv.slice(2)
const wb = readWorkbook(new Uint8Array(readFileSync(xlsx)))
const board = findBoard(wb)
const meta = JSON.parse(readFileSync(playersPath, 'utf8'))
const [rosters, users] = await Promise.all(
  ['rosters', 'users'].map(p => fetch(`https://api.sleeper.app/v1/league/${leagueId}/${p}`).then(r => r.json())),
)
const rostered = new Set<string>(rosters.flatMap((r: any) => r.players ?? []))
const { values, unmatched } = matchBoard(board, meta, rostered)
console.log(`board: "${board.tab}" / ${board.column}, ${board.rows.length} rows, ${values.size} matched, ${unmatched.length} unmatched`)
if (unmatched.length) console.log('  unmatched:', unmatched.slice(0, 12).join(' | '))
const name = new Map(users.map((u: any) => [u.user_id, u.display_name]))
for (const r of rosters) {
  const tot: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 }
  for (const id of r.players ?? []) {
    const pos = meta[id]?.position
    if (pos in tot) tot[pos] += Math.round(values.get(id)?.value ?? UNRANKED)
  }
  const all = Object.values(tot).reduce((a, b) => a + b, 0)
  console.log(`${String(name.get(r.owner_id)).padEnd(16)} QB ${tot.QB} RB ${tot.RB} WR ${tot.WR} TE ${tot.TE} = ${all}`)
}
