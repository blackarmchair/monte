import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { teamWeeks } from '../src/nflSchedule.ts'

const g = (week: number, away: string, home: string, status = 'pre_game') => ({ week, away, home, date: `2026-09-${10 + week}`, status })
const games = [g(1, 'BUF', 'MIA', 'complete'), g(2, 'NYJ', 'BUF', 'in_game'), g(4, 'BUF', 'KC'), g(4, 'NYJ', 'MIA')]

describe('teamWeeks', () => {
  it('lists every week with opponent, side, state, and byes filled in', () => {
    assert.deepEqual(
      teamWeeks(games, 'BUF').map(w => [w.week, w.opp, w.away, w.state]),
      [[1, 'MIA', true, 'done'], [2, 'NYJ', false, 'live'], [3, null, false, 'bye'], [4, 'KC', true, 'pre']],
    )
  })
  it('is empty for a team not on the schedule', () => assert.deepEqual(teamWeeks(games, 'FA'), []))
})
