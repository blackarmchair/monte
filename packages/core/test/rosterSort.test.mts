import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { lineupSections } from '../src/rosterSort.ts'
import type { OvPlayer, OvTeam } from '../src/types.ts'

const pl = (id: string, pos: OvPlayer['pos'], value: number, f: Partial<OvPlayer> = {}): OvPlayer => ({
  id, name: id, pos, team: 'BUF', age: 25, rank: 1, value, starter: false, taxi: false, ir: false, injury: '', ...f,
})
const team = (lineup?: OvTeam['lineup']): OvTeam => ({
  roster_id: 1, display_name: 'a', team_name: 'a', avatar: null, wins: 0, losses: 0, ties: 0, pf: 0,
  players: [
    pl('qb1', 'QB', 90, { starter: true }),
    pl('wr1', 'WR', 80, { starter: true }),
    pl('rb1', 'RB', 70, { starter: true }),
    pl('wr2', 'WR', 60),
    pl('rb2', 'RB', 50),
    pl('te9', 'TE', 40, { ir: true }),
    pl('wr9', 'WR', 30, { taxi: true }),
  ],
  lineup,
})
const lineup = [
  { slot: 'QB', id: 'qb1' },
  { slot: 'RB', id: 'rb1' },
  { slot: 'WR', id: null },
  { slot: 'FLEX', id: 'wr1' },
  { slot: 'K', id: '4666', name: 'Some Kicker', pos: 'K' },
]

describe('lineupSections', () => {
  it('lays out starters in slot order, then bench, IR and taxi', () => {
    const s = lineupSections(team(lineup))
    assert.deepEqual(s.map(x => x.title), ['Starters', 'Bench', 'IR', 'Taxi'])
    assert.deepEqual(s[0].rows.map(r => [r.badge, r.player?.id ?? r.name ?? null]), [
      ['QB', 'qb1'], ['RB', 'rb1'], ['WR', null], ['FLEX', 'wr1'], ['K', 'Some Kicker'],
    ])
    assert.deepEqual(s[1].rows.map(r => [r.badge, r.player!.id]), [['RB', 'rb2'], ['WR', 'wr2']])
    assert.deepEqual(s[2].rows.map(r => r.player!.id), ['te9'])
    assert.deepEqual(s[3].rows.map(r => [r.badge, r.player!.id]), [['TX', 'wr9']])
  })

  it('filters to one position and drops empty sections', () => {
    const s = lineupSections(team(lineup), 'WR')
    assert.deepEqual(s.map(x => [x.title, x.rows.map(r => r.player!.id)]), [['Starters', ['wr1']], ['Bench', ['wr2']], ['Taxi', ['wr9']]])
  })

  it('falls back to starters by position without slot data', () => {
    const s = lineupSections(team())
    assert.deepEqual(s[0].rows.map(r => [r.badge, r.player!.id]), [['QB', 'qb1'], ['RB', 'rb1'], ['WR', 'wr1']])
  })
})
