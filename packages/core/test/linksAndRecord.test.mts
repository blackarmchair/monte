// Linked sheets, phone updates and the track record. Nothing here touches the network.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compareVersions, newerApk } from '../src/appUpdate.ts'
import { buildLeagueWeek, type LeagueWeek } from '../src/leagueWeek.ts'
import { fetchSheet, sameWorkbook, sheetExportUrl } from '../src/sheetLink.ts'
import { forecastGames, scoreForecasts } from '../src/trackRecord.ts'

describe('sheetExportUrl', () => {
  const id = '1AbC_def-GHIjkl'
  it('turns any view of a sheet into its export address', () => {
    for (const link of [`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`, `https://docs.google.com/spreadsheets/d/${id}/htmlview`, ` https://docs.google.com/spreadsheets/d/${id} `])
      assert.equal(sheetExportUrl(link), `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`)
  })
  it('refuses anything else', () => {
    for (const link of ['', 'not a link', 'https://evil.example/spreadsheets/d/1AbC_def-GHIjkl/edit', 'http://docs.google.com/spreadsheets/d/1AbC_def-GHIjkl/edit', 'https://docs.google.com/document/d/1AbC_def-GHIjkl/edit'])
      assert.equal(sheetExportUrl(link), null)
  })
})

describe('fetchSheet', () => {
  const LINK = 'https://docs.google.com/spreadsheets/d/1AbC_def-GHIjkl/edit'
  const reply = (body: BodyInit, status = 200) => (async () => new Response(body, { status })) as typeof fetch
  const xlsx = new Uint8Array([0x50, 0x4b, 3, 4])

  it('returns a workbook', async () => assert.deepEqual(await fetchSheet(LINK, reply(xlsx)), xlsx))
  it('explains a sign-in page sent as a success', async () => {
    await assert.rejects(fetchSheet(LINK, reply('<!doctype html><title>Sign in</title>')), /viewable by anyone/)
  })
  for (const status of [401, 403, 404]) it(`explains a ${status}`, async () => assert.rejects(fetchSheet(LINK, reply('', status)), /viewable by anyone/))
  it('reports a server error as retryable', async () => assert.rejects(fetchSheet(LINK, reply('', 500)), /answered 500/))
  it('rejects a bad link without fetching', async () => {
    const never = (async () => assert.fail('fetched')) as typeof fetch
    await assert.rejects(fetchSheet('nope', never), /isn't a Google Sheets link/)
  })
  it('reports being offline', async () => {
    const down = (async () => {
      throw new TypeError('offline')
    }) as typeof fetch
    await assert.rejects(fetchSheet(LINK, down), /Couldn't reach Google/)
  })
})

describe('sameWorkbook', () => {
  // A fake unzip: the "bytes" just pick which fake archive this is.
  const u8 = (s: string) => new TextEncoder().encode(s)
  const files: Record<number, Record<string, Uint8Array>> = {
    1: { 'xl/worksheets/sheet1.xml': u8('a'), 'xl/sharedStrings.xml': u8('s'), 'docProps/core.xml': u8('built 10:00') },
    2: { 'xl/worksheets/sheet1.xml': u8('a'), 'xl/sharedStrings.xml': u8('s'), 'docProps/core.xml': u8('built 16:00') },
    3: { 'xl/worksheets/sheet1.xml': u8('b'), 'xl/sharedStrings.xml': u8('s') },
    4: { 'xl/worksheets/sheet1.xml': u8('a'), 'xl/worksheets/sheet2.xml': u8('c'), 'xl/sharedStrings.xml': u8('s') },
    5: { 'docProps/core.xml': u8('x') },
  }
  const same = (a: number, b: number) => sameWorkbook(new Uint8Array([a]), new Uint8Array([b]), bytes => files[bytes[0]])
  it('ignores a rebuilt export of the same data', () => assert.equal(same(1, 2), true))
  it('notices a changed cell', () => assert.equal(same(1, 3), false))
  it('notices a new tab', () => assert.equal(same(1, 4), false))
  it('never calls empty archives the same', () => assert.equal(same(5, 5), false))
})

describe('compareVersions', () => {
  it('compares numerically', () => {
    assert.ok(compareVersions('1.10.0', '1.9.9') > 0)
    assert.ok(compareVersions('1.5.0', '1.5.1') < 0)
    assert.equal(compareVersions('1.5', '1.5.0'), 0)
  })
})

describe('newerApk', () => {
  const url = 'https://github.com/blackarmchair/monte/releases/download/v0.8.0/Monte-1.6.0.apk'
  const release = (name: string, u = url) => ({ assets: [{ name: 'Monte-Setup-0.8.0.exe', browser_download_url: 'https://github.com/x.exe' }, { name, browser_download_url: u }] })
  it('finds a newer build', () => assert.deepEqual(newerApk(release('Monte-1.6.0.apk'), '1.5.0'), { version: '1.6.0', url }))
  it('ignores the same or an older build', () => {
    assert.equal(newerApk(release('Monte-1.5.0.apk'), '1.5.0'), null)
    assert.equal(newerApk(release('Monte-1.4.0.apk'), '1.5.0'), null)
  })
  it('ignores a release with no APK (a desktop-only release)', () => assert.equal(newerApk(release('latest.yml'), '1.5.0'), null))
  it('only sends you to GitHub', () => assert.equal(newerApk(release('Monte-1.6.0.apk', 'https://evil.example/a.apk'), '1.5.0'), null))
  it('survives a bad reply', () => assert.equal(newerApk(null, '1.5.0'), null))
})

describe('scoreForecasts', () => {
  it('has nothing to say with no games', () => {
    assert.deepEqual(scoreForecasts([]), { games: 0, favouriteWins: 0, favouriteGames: 0, brier: null, buckets: [] })
  })
  it('scores a coin flip at 0.25', () => assert.equal(scoreForecasts([{ p: 0.5, won: true }, { p: 0.5, won: false }]).brier, 0.25))
  it('rewards confidence that was right, and punishes it when wrong', () => {
    assert.ok((scoreForecasts([{ p: 0.9, won: true }]).brier ?? 1) < 0.25)
    assert.ok((scoreForecasts([{ p: 0.9, won: false }]).brier ?? 0) > 0.25)
  })
  it('reads each game from the favourite’s side', () => {
    const s = scoreForecasts([{ p: 0.3, won: false }, { p: 0.7, won: false }])
    assert.equal(s.favouriteGames, 2)
    assert.equal(s.favouriteWins, 1)
    assert.deepEqual(s.buckets.map(b => [b.label, b.games, b.actual]), [['70–80%', 2, 0.5]])
  })
  it('does not count a true 50/50 as the favourite, but buckets it', () => {
    const s = scoreForecasts([{ p: 0.5, won: true }])
    assert.equal(s.favouriteGames, 0)
    assert.equal(s.buckets[0].label, '50–60%')
  })
  it('includes a certainty in the top bucket', () => assert.equal(scoreForecasts([{ p: 1, won: true }]).buckets[0].label, '90–100%'))
})

describe('forecastGames', () => {
  const week = (a: number, b: number, p = 0.6) => ({ matchups: [{ sides: [{ points: a, winPct: p }, { points: b, winPct: 1 - p }] }] }) as unknown as LeagueWeek
  it('takes finished games', () => assert.deepEqual(forecastGames(week(120, 100)), [{ p: 0.6, won: true }]))
  it('skips unplayed and tied games', () => {
    assert.deepEqual(forecastGames(week(0, 0)), [])
    assert.deepEqual(forecastGames(week(100, 100)), [])
  })
})

describe('pregame forecasts', () => {
  const league = { scoring_settings: { rec: 1 } }
  const meta = { p1: { position: 'WR', team: 'DAL', first_name: 'A', last_name: 'A' }, p2: { position: 'WR', team: 'SF', first_name: 'B', last_name: 'B' }, gone: { position: 'WR', first_name: 'C', last_name: 'C' } }
  const matchups = [
    { roster_id: 1, matchup_id: 1, starters: ['p1'], players_points: { p1: 2 }, points: 2 },
    { roster_id: 2, matchup_id: 1, starters: ['p2', 'gone'], players_points: { p2: 1, gone: 50 }, points: 51 },
  ]
  const build = (pregame: boolean) =>
    buildLeagueWeek({ league, rosters: [], users: [], matchups, projections: { p1: { rec: 20 }, p2: { rec: 5 } }, schedule: { DAL: { 9: 'complete' }, SF: { 9: 'complete' } }, meta, season: '2026', week: 9, pregame })

  it('uses no results: the favourite is who was projected, even though they lost', () => {
    const [a, b] = build(true).matchups[0].sides
    assert.equal(a.projected, 20)
    assert.equal(b.projected, 5, "a teamless starter's 50 actual points must not leak in")
    assert.ok(a.winPct > 0.5)
  })

  it('keeps the final score for grading', () => {
    assert.deepEqual(forecastGames(build(true)).map(g => g.won), [false])
  })

  it('a live view still banks results', () => assert.ok(build(false).matchups[0].sides[1].projected > 50))
})
