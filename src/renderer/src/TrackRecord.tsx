// Settings: how Monte's matchup win chances have held up, on your leagues' finished games this season.
import { useState } from 'react'
import type { TrackRecord as Record_ } from '@shared/trackRecord'
import type { Result } from '@shared/types'
import { useApp } from './store'
import { Btn, ErrorBox } from './ui'

const pct = (x: number) => `${Math.round(x * 100)}%`

export default function TrackRecord({ style }: { style: React.CSSProperties }) {
  const { settings } = useApp()
  const [res, setRes] = useState<Result<Record_> | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!settings.userId) return
    setBusy(true)
    setRes(await window.monte.trackRecord(settings.userId))
    setBusy(false)
  }
  const r = res?.ok ? res.value : null
  return (
    <div style={style}>
      <span className="small mute">Track record</span>
      {!r && <span className="sub" style={{ fontSize: 14 }}>How often Monte's matchup win chances came true this season, across your leagues.</span>}
      {res && !res.ok && <ErrorBox message={res.error} onRetry={run} />}
      {r && r.games === 0 && <span className="sub" style={{ fontSize: 14 }}>No finished games to score yet.</span>}
      {r && r.games > 0 && (
        <>
          <span style={{ fontWeight: 700 }}>
            The favourite won {r.favouriteWins} of {r.favouriteGames} games{r.favouriteGames ? ` (${pct(r.favouriteWins / r.favouriteGames)})` : ''}, weeks 1–{r.throughWeek}, {r.leagues} league{r.leagues === 1 ? '' : 's'}.
          </span>
          <span className="sub" style={{ fontSize: 14 }}>Brier score {r.brier?.toFixed(3)}. A coin flip scores 0.250; lower is better.</span>
          {r.buckets.map(b => (
            <span key={b.label} className="small">
              Said {b.label}: won {pct(b.actual)} ({b.games} game{b.games === 1 ? '' : 's'}, averaging {pct(b.predicted)})
            </span>
          ))}
          <span className="small mute">Scored afterwards with Sleeper's stored projections and the lineups actually played, so live accuracy may be somewhat lower.</span>
        </>
      )}
      <div>
        <Btn size="sm" label={busy ? 'Scoring…' : r ? 'Score again' : 'Score Monte'} disabled={busy} onClick={run} />
      </div>
    </div>
  )
}
