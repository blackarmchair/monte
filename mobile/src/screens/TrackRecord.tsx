// Settings: how Monte's matchup win chances have held up, on your leagues' finished games this season.
import { useState } from 'react'
import type { TrackRecord as Record_ } from '@monte/core/trackRecord'
import type { Result } from '@monte/core/types'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { Btn, Card, ErrorBox, T } from '@/ui/kit'

const pct = (x: number) => `${Math.round(x * 100)}%`

export default function TrackRecord() {
  const { settings } = useApp()
  const [res, setRes] = useState<Result<Record_> | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!settings?.userId) return
    setBusy(true)
    setRes(await monte.trackRecord(settings.userId))
    setBusy(false)
  }
  const r = res?.ok ? res.value : null
  return (
    <Card radius={18} gap={8}>
      <T v="small" c="mute">
        Track record
      </T>
      {!r && (
        <T size={14} c="ink2">
          How often Monte's matchup win chances came true this season, across your leagues.
        </T>
      )}
      {res && !res.ok && <ErrorBox message={res.error} onRetry={run} />}
      {r && r.games === 0 && (
        <T size={14} c="ink2">
          No finished games to score yet.
        </T>
      )}
      {r && r.games > 0 && (
        <>
          <T v="bold" size={15}>
            The favourite won {r.favouriteWins} of {r.favouriteGames} games{r.favouriteGames ? ` (${pct(r.favouriteWins / r.favouriteGames)})` : ''}, weeks 1–{r.throughWeek}, {r.leagues} league{r.leagues === 1 ? '' : 's'}.
          </T>
          <T size={14} c="ink2">
            Brier score {r.brier?.toFixed(3)}. A coin flip scores 0.250; lower is better.
          </T>
          {r.buckets.map(b => (
            <T key={b.label} size={14}>
              Said {b.label}: won {pct(b.actual)} ({b.games} game{b.games === 1 ? '' : 's'}, averaging {pct(b.predicted)})
            </T>
          ))}
          <T v="small" c="mute">
            Scored afterwards with Sleeper's stored projections and the lineups actually played, so live accuracy may be somewhat lower.
          </T>
        </>
      )}
      <Btn size="sm" label={busy ? 'Scoring…' : r ? 'Score again' : 'Score Monte'} disabled={busy} style={{ minHeight: 40 }} onPress={run} />
    </Card>
  )
}
