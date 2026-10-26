// The handoff's line icons (24-unit viewBox, round caps), drawn with react-native-svg.
import Svg, { Circle, Path } from 'react-native-svg'

const PATHS = {
  league: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  lineup: 'M4 6h16M4 12h16M4 18h10',
  trade: 'M4 8h15l-4-4M20 16H5l4 4',
  players: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8',
  picks: 'M4 20h16M7 20v-6M12 20V8M17 20V11',
  back: 'M15 5l-7 7 7 7',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  search: 'M11 4.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13zM20 20l-4.2-4.2',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  // a cog: a toothed ring around the centre circle (drawn separately)
  gear: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
} as const
export type IconName = keyof typeof PATHS

export function Icon({ name, size = 22, color, stroke = 1.6 }: { name: IconName; size?: number; color: string; stroke?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      {name === 'gear' && <Circle cx={12} cy={12} r={3} />}
      <Path d={PATHS[name]} />
    </Svg>
  )
}
