// Draft pick grades, ported from draftPunk's draftGrade.ts (sheet-order mode).
//
// A pick is graded on its POSITIONAL ORDER DIFFERENTIAL: "he was the 8th RB off the board, the
// sheet has him RB3" is +5. Only the sheet's within-position order is used, so no cross-position
// value scale is invented. The pool decides which sheet rows count: in a rookie draft the first
// rookie WR is WR1 of the pool, not WR10 of the overall board, or every correct pick reads as a
// reach.
//
// Not ported: draftPunk's RosterAudit value-curve mode. It was an external feed whose rookie
// curves were too shallow to grade rookie drafts anyway (draftPunk fell back to sheet order).
// Matching is by Sleeper id rather than normalised name, so draftPunk's alias table is gone.
import type { DraftPickRow } from './types'

export const GRADED_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
const GRADED = new Set<string>(GRADED_POSITIONS)

export type GradeLetter = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F'
export type GradeTone = 'great' | 'good' | 'fair' | 'poor' | 'bad'

/** position -> Sleeper id -> 1-based rank within the position in the pool */
export type PositionalRankIndex = ReadonlyMap<string, ReadonlyMap<string, number>>

export type PickGrade =
  | { pickNo: number; graded: true; position: string; posPick: number; userRank: number; score: number; letter: GradeLetter }
  | { pickNo: number; graded: false; reason: 'not-on-sheet' | 'position-not-graded' }

export type TeamGrade = { letter: GradeLetter | null; averageScore: number | null; gradedCount: number; totalCount: number }

// Constants are draftPunk's, unchanged; its comments explain each calibration.
/** Floor on the sqrt(rank) divisor so one slot at the very top can't manufacture an A+. */
const RANK_DEPTH_FLOOR = 4
/** Depth the bands are calibrated at; shallower pools are rescaled into it. */
const REFERENCE_POOL_DEPTH = 100
const MIN_POOL_DEPTH = 3
/** Bands saturate well inside this, so clamping costs no letter but stops one outlier swamping a team. */
const SCORE_CLAMP = 6

/** Lower bound of each band, highest first; below the last is F. B is wide on purpose: a slot or two
 *  ahead of the sheet is inside any sheet's noise. */
const GRADE_BANDS: ReadonlyArray<readonly [number, GradeLetter]> = [
  [3.0, 'A+'],
  [2.0, 'A'],
  [1.25, 'A-'],
  [0.6, 'B+'],
  [-0.55, 'B'],
  [-1.1, 'B-'],
  [-1.7, 'C+'],
  [-2.4, 'C'],
  [-3.1, 'C-'],
  [-4.5, 'D'],
]

export function scoreToLetter(score: number): GradeLetter {
  for (const [threshold, letter] of GRADE_BANDS) if (score >= threshold) return letter
  return 'F'
}

export function gradeTone(letter: GradeLetter): GradeTone {
  if (letter.startsWith('A')) return 'great'
  if (letter.startsWith('B')) return 'good'
  if (letter.startsWith('C')) return 'fair'
  return letter === 'D' ? 'poor' : 'bad'
}

/** `players` in sheet order; `inPool` restricts which count, and ranks are re-densified within it. */
export function buildPositionalRankIndex(players: ReadonlyArray<{ id: string; pos: string }>, inPool: (id: string) => boolean): PositionalRankIndex {
  const index = new Map<string, Map<string, number>>()
  for (const p of players) {
    if (!GRADED.has(p.pos) || !inPool(p.id)) continue
    let byId = index.get(p.pos)
    if (!byId) index.set(p.pos, (byId = new Map()))
    if (!byId.has(p.id)) byId.set(p.id, byId.size + 1)
  }
  return index
}

const clamp = (s: number) => Math.max(-SCORE_CLAMP, Math.min(SCORE_CLAMP, s))

function ordinalScore(posPick: number, userRank: number, poolDepth: number): number {
  const scale = poolDepth < MIN_POOL_DEPTH ? 1 : Math.sqrt(REFERENCE_POOL_DEPTH / poolDepth)
  const rank = userRank * scale
  return clamp((posPick * scale - rank) / Math.sqrt(Math.max(rank, RANK_DEPTH_FLOOR)))
}

/** Grade every pick, keyed by pick number. A player counts toward his position's run whether or
 *  not he is on the sheet: he came off the board either way. */
export function gradePicks(picks: ReadonlyArray<DraftPickRow>, index: PositionalRankIndex): Map<number, PickGrade> {
  const grades = new Map<number, PickGrade>()
  const taken = new Map<string, number>()
  for (const pick of [...picks].sort((a, b) => a.pickNo - b.pickNo)) {
    if (!GRADED.has(pick.pos)) {
      grades.set(pick.pickNo, { pickNo: pick.pickNo, graded: false, reason: 'position-not-graded' })
      continue
    }
    const posPick = (taken.get(pick.pos) ?? 0) + 1
    taken.set(pick.pos, posPick)
    const userRank = index.get(pick.pos)?.get(pick.playerId)
    if (userRank === undefined) {
      grades.set(pick.pickNo, { pickNo: pick.pickNo, graded: false, reason: 'not-on-sheet' })
      continue
    }
    const score = ordinalScore(posPick, userRank, index.get(pick.pos)?.size ?? 0)
    grades.set(pick.pickNo, { pickNo: pick.pickNo, graded: true, position: pick.pos, posPick, userRank, score, letter: scoreToLetter(score) })
  }
  return grades
}

/** Average raw scores, then map to a letter once (letters first would round twice). */
export function gradeTeam(pickNos: Iterable<number>, grades: Map<number, PickGrade>): TeamGrade {
  let total = 0
  let graded = 0
  let sum = 0
  for (const n of pickNos) {
    total++
    const g = grades.get(n)
    if (g?.graded) {
      sum += g.score
      graded++
    }
  }
  if (!graded) return { letter: null, averageScore: null, gradedCount: 0, totalCount: total }
  return { letter: scoreToLetter(sum / graded), averageScore: sum / graded, gradedCount: graded, totalCount: total }
}

export function gradeExplanation(g: Extract<PickGrade, { graded: true }>): string {
  const diff = g.posPick - g.userRank
  const move =
    diff > 0 ? `fell ${diff} spot${diff === 1 ? '' : 's'} past the sheet` : diff < 0 ? `taken ${-diff} spot${diff === -1 ? '' : 's'} ahead of the sheet` : 'taken exactly at the sheet'
  return `${g.letter}: ${g.position}${g.posPick} off the board, the sheet has him ${g.position}${g.userRank} (${move})`
}
