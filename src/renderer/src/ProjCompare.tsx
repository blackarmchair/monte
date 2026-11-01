// The Matchups ↔ Lineup comparison both screens open from their basis line: each screen's
// numbers side by side, why they differ (biggest first), and what each counts every starter for.
import type { Comparison } from '@shared/projBasis'
import { Link } from './ui'

/** "Submitted lineup · Sleeper projections" with the link that opens the comparison. */
export function BasisLine({ label, open, onToggle, other }: { label: string; open: boolean; onToggle: () => void; other: string }) {
  return (
    <span className="row small mute" style={{ gap: 10, flexWrap: 'wrap' }}>
      <span>{label}</span>
      <Link label={open ? 'Hide comparison' : `Compare with ${other}`} onClick={onToggle} style={{ fontSize: 13 }} />
    </span>
  )
}

const STATE: Record<string, string> = { live: 'Live', done: 'Final', bye: 'Bye' }

export function ProjCompare({ c, note, here }: { c: Comparison | null; note?: string | null; here: 'matchups' | 'lineup' }) {
  if (!c) return <div className="small mute">{note ?? 'Reading the other screen’s numbers…'}</div>
  const head = (t: string, on: boolean) => (
    <span className="label" style={{ textAlign: 'right', color: on ? 'var(--ink2)' : undefined }}>
      {t}
    </span>
  )
  const diff = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b)
  return (
    <div className="stack" style={{ gap: 14, padding: 16, borderRadius: 16, background: 'var(--surf)' }}>
      {note && <span className="small mute">{note}</span>}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) minmax(0,1fr)', columnGap: 16, rowGap: 6, alignItems: 'baseline' }}>
        <span />
        {head('Matchups', here === 'matchups')}
        {head('Lineup', here === 'lineup')}
        {c.rows.map(r => [
          <span key={`${r.label}l`} className="small mute">
            {r.label}
          </span>,
          <span key={`${r.label}m`} className="num" style={{ textAlign: 'right', fontWeight: 600 }}>
            {r.matchups}
          </span>,
          <span key={`${r.label}x`} className="num" style={{ textAlign: 'right', fontWeight: 600 }}>
            {r.lineup}
          </span>,
        ])}
      </div>
      {c.reasons.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Why they differ</span>
          {c.reasons.map(r => (
            <span key={r} className="small" style={{ color: 'var(--ink2)', textWrap: 'pretty' }}>
              {r}
            </span>
          ))}
        </div>
      )}
      {c.players.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Starters in Sleeper, as each screen counts them</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 72px 72px 60px', columnGap: 12, rowGap: 3, alignItems: 'baseline' }}>
            <span />
            {head('Matchups', here === 'matchups')}
            {head('Lineup', here === 'lineup')}
            {head('Δ', false)}
            {c.players.map(p => {
              const d = diff(p.matchups, p.lineup)
              return [
                <span key={`${p.id}n`} className="small trunc">
                  {p.name} <span className="mute">{[p.pos, p.state ? STATE[p.state] : ''].filter(Boolean).join(' · ')}</span>
                </span>,
                <span key={`${p.id}m`} className="small num" style={{ textAlign: 'right' }}>
                  {p.matchups == null ? '—' : p.matchups.toFixed(1)}
                </span>,
                <span key={`${p.id}x`} className="small num" style={{ textAlign: 'right' }}>
                  {p.lineup == null ? '—' : p.lineup.toFixed(1)}
                </span>,
                <span key={`${p.id}d`} className="small num" style={{ textAlign: 'right', color: d == null || Math.abs(d) < 0.5 ? 'var(--mute)' : 'var(--ink2)' }}>
                  {d == null ? '' : `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`}
                </span>,
              ]
            })}
          </div>
        </div>
      )}
    </div>
  )
}
