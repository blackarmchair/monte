// The Matchups ↔ Lineup comparison both screens open from their basis line (the desktop has the
// same component): each screen's numbers side by side, why they differ, and every starter.
import { View } from 'react-native'
import type { Comparison } from '@monte/core/projBasis'
import { Row, T } from '@/ui/kit'
import { useTheme } from '@/ui/theme'

/** "Submitted lineup · Sleeper projections" with the link that opens the comparison. */
export function BasisLine({ label, open, onToggle, other }: { label: string; open: boolean; onToggle: () => void; other: string }) {
  return (
    <T v="small" c="mute">
      {label}
      {'  '}
      <T v="smallSemi" c="acc" onPress={onToggle}>
        {open ? 'Hide comparison' : `Compare with ${other}`}
      </T>
    </T>
  )
}

const STATE: Record<string, string> = { live: 'Live', done: 'Final', bye: 'Bye' }

export function ProjCompare({ c, note, here }: { c: Comparison | null; note?: string | null; here: 'matchups' | 'lineup' }) {
  const t = useTheme()
  if (!c)
    return (
      <T v="small" c="mute">
        {note ?? 'Reading the other screen’s numbers…'}
      </T>
    )
  const head = (s: string, on: boolean, w: number) => (
    <T v="label" c={on ? 'ink2' : 'mute'} style={{ width: w, textAlign: 'right' }}>
      {s}
    </T>
  )
  return (
    <View style={{ gap: 12, padding: 14, borderRadius: 14, backgroundColor: t.surf2 }}>
      {!!note && (
        <T v="small" c="mute">
          {note}
        </T>
      )}
      <View style={{ gap: 4 }}>
        <Row gap={8}>
          <View style={{ flex: 1 }} />
          {head('Matchups', here === 'matchups', 96)}
          {head('Lineup', here === 'lineup', 116)}
        </Row>
        {c.rows.map(r => (
          <Row key={r.label} gap={8}>
            <T v="small" c="mute" style={{ flex: 1 }}>
              {r.label}
            </T>
            <T v="smallSemi" num style={{ width: 96, textAlign: 'right' }}>
              {r.matchups}
            </T>
            <T v="smallSemi" num style={{ width: 116, textAlign: 'right' }}>
              {r.lineup}
            </T>
          </Row>
        ))}
      </View>
      {c.reasons.length > 0 && (
        <View style={{ gap: 6 }}>
          <T v="label">Why they differ</T>
          {c.reasons.map(r => (
            <T key={r} v="small" c="ink2">
              {r}
            </T>
          ))}
        </View>
      )}
      {c.players.length > 0 && (
        <View style={{ gap: 3 }}>
          <T v="label">Starters in Sleeper, as each screen counts them</T>
          <Row gap={8}>
            <View style={{ flex: 1 }} />
            {head('Match', here === 'matchups', 48)}
            {head('Lineup', here === 'lineup', 48)}
            {head('Δ', false, 44)}
          </Row>
          {c.players.map(p => {
            const d = p.matchups == null || p.lineup == null ? null : p.matchups - p.lineup
            return (
              <Row key={p.id} gap={8}>
                <T v="small" lines={1} style={{ flex: 1 }}>
                  {p.name}{' '}
                  <T v="small" c="mute">
                    {[p.pos, p.state ? STATE[p.state] : ''].filter(Boolean).join(' · ')}
                  </T>
                </T>
                <T v="small" num style={{ width: 48, textAlign: 'right' }}>
                  {p.matchups == null ? '—' : p.matchups.toFixed(1)}
                </T>
                <T v="small" num style={{ width: 48, textAlign: 'right' }}>
                  {p.lineup == null ? '—' : p.lineup.toFixed(1)}
                </T>
                <T v="small" num c={d == null || Math.abs(d) < 0.5 ? 'mute' : 'ink2'} style={{ width: 44, textAlign: 'right' }}>
                  {d == null ? '' : `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`}
                </T>
              </Row>
            )
          })}
        </View>
      )}
    </View>
  )
}
