// Draft tab parity: replays a finished Sleeper draft through Monte's draft module and checks
//  1. the computed pick order (slots + traded picks) names the roster that actually picked,
//  2. every pick matched a board player by Sleeper id,
//  3. grades equal draftPunk's own gradePicks (sheet-order mode) on the same pool.
// node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/draft-parity.mts \
//   <ranks.xlsx> <players_nfl.json> <draftId> <userId> [draftPunk draftGrade.ts copy with `import type`]
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { readWorkbook } from '../src/main/xlsx.ts'
import { findBoard, norm } from '../src/main/values.ts'
import { buildDraft } from '../src/main/draft.ts'
import { buildPositionalRankIndex, gradePicks } from '../src/shared/draftGrade.ts'

const [xlsx, playersPath, draftId, userId, punkGrade] = process.argv.slice(2)
const api = (p: string) => fetch(`https://api.sleeper.app/v1${p}`).then(r => r.json())
const raw = JSON.parse(readFileSync(playersPath, 'utf8'))
const meta = raw.players ?? raw
const [draft, picks, traded, state] = await Promise.all([api(`/draft/${draftId}`), api(`/draft/${draftId}/picks`), api(`/draft/${draftId}/traded_picks`), api('/state/nfl')])
const lid = draft.league_id
const [league, rosters, users, drafts] = await Promise.all([api(`/league/${lid}`), api(`/league/${lid}/rosters`), api(`/league/${lid}/users`), api(`/league/${lid}/drafts`)])
const wb = readWorkbook(new Uint8Array(readFileSync(xlsx)))
const d = buildDraft({
  wb,
  sheetPath: xlsx, modifiedAt: '', draft, drafts, league, rosters, users, traded, picks, meta, userId,
  nflSeason: String(state.league_season || state.season),
})
let fails = 0
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++ }

const made = d.initial.picks
const orderBad = made.filter(p => d.order.find(s => s.pickNo === p.pickNo)?.rosterId !== p.rosterId)
check(orderBad.length === 0, `pick order: ${made.length - orderBad.length}/${made.length} picks owned by the roster that made them` + (orderBad.length ? ` (wrong: ${orderBad.map(p => p.label).join(', ')})` : ''))
const labelBad = made.filter(p => d.order.find(s => s.pickNo === p.pickNo)?.label !== p.label)
check(labelBad.length === 0, `pick labels agree between order and picks (${made.length})`)

// A pick missing from the board is only a failure if the sheet DOES list him (a matching miss).
// Players Tyler doesn't rank (kickers, retirees, deep rookies) are ungraded by design.
const ids = new Set(d.players.map(p => p.id))
const sheetNames = new Set(findBoard(wb).rows.map(r => norm(r.name)))
const off = made.filter(p => !ids.has(p.playerId))
const missed = off.filter(p => sheetNames.has(norm(p.name)))
check(missed.length === 0, `board match: every pick the sheet lists matched by id; ${off.length} picks are off the sheet (ungraded)` + (missed.length ? ` (on the sheet but unmatched: ${missed.map(p => p.name).join(', ')})` : ''))

const pool = d.players.filter(p => p.rookie || made.some(m => m.playerId === p.id))
const mine = gradePicks(made, buildPositionalRankIndex(pool, () => true))
console.log(`pool: ${pool.length} rookies; my roster ${d.myRosterId}; rounds ${d.draft.rounds}, ${d.draft.type}`)

if (punkGrade) {
  const punk = await import(pathToFileURL(punkGrade).href)
  const { normalizeName } = await import(pathToFileURL(punkGrade.replace(/services[\/]draftGrade\.ts$/, 'utils/normalizeName.ts')).href)
  const { applyAlias } = await import(pathToFileURL(punkGrade.replace(/services[\/]draftGrade\.ts$/, 'data/aliases.ts')).href)
  // draftPunk's inputs: the same pool as CSV rows in sheet order, the picks by name.
  const rows = pool.map(p => ({ name: p.name, tier: 1, position: p.pos, taken: false, normalizedName: applyAlias(normalizeName(p.name)) }))
  const dpPicks = made.map(p => ({ pickNo: p.pickNo, pickDisplay: p.label, playerName: p.name, position: p.pos, team: p.team, pickedBy: '', isMyPick: false, draftSlot: p.slot ?? undefined }))
  const theirs: Map<number, any> = punk.gradePicks(dpPicks, punk.buildPositionalRankIndex(rows, null), null, 'all')
  const diff = made.filter(p => {
    const a = mine.get(p.pickNo)!, b = theirs.get(p.pickNo)!
    return a.graded !== b.graded || (a.graded && (a.letter !== b.letter || Math.abs(a.score - b.score) > 1e-9 || a.posPick !== b.posPick || a.userRank !== b.userRank))
  })
  // Known, expected diff: names only Monte's ALIAS resolves (Tyler's "Kenny Gainwell") are
  // ungraded in draftPunk, which matched by name with no such entry. Shown, not hidden.
  const show = (g: any) => (g.graded ? `${g.letter} ${g.position}${g.posPick}/sheet ${g.userRank}` : g.reason)
  check(diff.length === 0, `grades vs draftPunk: ${made.length - diff.length}/${made.length} identical (letter, score, positional run, sheet rank)`)
  for (const p of diff) console.log(`      ${p.label} ${p.name}: Monte ${show(mine.get(p.pickNo))} | draftPunk ${show(theirs.get(p.pickNo))}`)
}
for (const p of made) {
  const g = mine.get(p.pickNo)!
  console.log(`  ${p.label} r${String(p.rosterId).padStart(2)} ${p.name.padEnd(22)} ${p.pos} ${g.graded ? `${g.letter.padEnd(2)} ${g.position}${g.posPick} sheet ${g.position}${g.userRank} ${g.score.toFixed(2)}` : g.reason}`)
}
process.exit(fails ? 1 : 0)
