import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildSchedule, regularWeeks, teamSchedule } from '../src/schedule.ts'

const league = { status: 'in_season', season: '2026', settings: { start_week: 1, playoff_week_start: 4 } }
const rosters = [1, 2, 3, 4].map(r => ({ roster_id: r, owner_id: `u${r}` }))
const users = [1, 2, 3, 4].map(r => ({ user_id: `u${r}`, display_name: `T${r}` }))
const wk = (pairs: Array<[number, number, number, number]>) =>
  pairs.flatMap(([a, b, pa, pb], i) => [
    { roster_id: a, matchup_id: i + 1, points: pa },
    { roster_id: b, matchup_id: i + 1, points: pb },
  ])
const matchups = {
  1: wk([[1, 2, 100, 90], [3, 4, 80, 80]]),
  2: wk([[1, 3, 70, 75.5], [2, 4, 60, 61]]),
  3: wk([[1, 4, 0, 0], [2, 3, 0, 0]]),
}

describe('schedule', () => {
  it('runs start_week to the week before the playoffs, or 17 without them', () => {
    assert.deepEqual(regularWeeks(league), [1, 2, 3])
    assert.equal(regularWeeks({ settings: {} }).length, 17)
  })

  it('marks weeks final / current / upcoming and hides points not yet played', () => {
    const s = buildSchedule({ league, rosters, users, season: '2026', currentWeek: 3, matchups })
    assert.deepEqual(s.weeks.map(w => w.state), ['final', 'final', 'current'])
    assert.equal(s.teams[2].name, 'T2')
    const s2 = buildSchedule({ league, rosters, users, season: '2026', currentWeek: 2, matchups })
    assert.equal(s2.weeks[2].state, 'upcoming')
    assert.equal(s2.weeks[2].games[0].sides[0].points, null)
  })

  it('gives one team its opponents, scores and results', () => {
    const s = buildSchedule({ league, rosters, users, season: '2026', currentWeek: 3, matchups })
    assert.deepEqual(
      teamSchedule(s, 1).map(g => [g.week, g.opp, g.result]),
      [[1, 2, 'W'], [2, 3, 'L'], [3, 4, null]],
    )
    assert.equal(teamSchedule(s, 3)[0].result, 'T')
  })

  it('has no current week before the season', () => {
    const s = buildSchedule({ league: { ...league, status: 'pre_draft' }, rosters, users, season: '2027', currentWeek: 10, matchups })
    assert.equal(s.currentWeek, 0)
    assert.ok(s.weeks.every(w => w.state === 'upcoming'))
  })
})
