// The Evolve palette and type, for React Native. Token names match the design handoff
// (bg, card, card2, chip, line, ink, ink2, mute, acc, …) so screens read like the desktop CSS.
import { useColorScheme } from 'react-native'
import { useApp } from '@/lib/store'

export const light = {
  bg: '#f3efe7',
  card: '#ede7db',
  card2: '#f7f4ee',
  chip: '#e4ddcf',
  line: '#ddd5c6',
  ink: '#1b1815',
  ink2: '#4a443c',
  mute: '#7a7266',
  acc: '#c2401f',
  accSoft: '#e6ae9a',
  accTint: '#f2ddd3',
  pos: '#2f6b3b',
  posTint: '#dce6d6',
  neg: '#b4301f',
  negTint: '#f1d9d3',
  warn: '#9a6210',
  warnTint: '#f1e3c8',
}
export type Palette = typeof light

export const dark: Palette = {
  bg: '#171513',
  card: '#211e1b',
  card2: '#1c1a17',
  chip: '#2b2722',
  line: '#34302a',
  ink: '#eee8de',
  ink2: '#c4bcaf',
  mute: '#8c8478',
  acc: '#e8622e',
  accSoft: '#6b2e1a',
  accTint: '#3a2218',
  pos: '#6dbe7e',
  posTint: '#1f3324',
  neg: '#ec6a57',
  negTint: '#3b201b',
  warn: '#e0a14a',
  warnTint: '#3a2c17',
}

/** Loaded in the root layout (expo-font). Weight lives in the family name on native. */
export const font = {
  sans: 'IBMPlexSans_400Regular',
  sansMed: 'IBMPlexSans_500Medium',
  sansSemi: 'IBMPlexSans_600SemiBold',
  mono: 'IBMPlexMono_400Regular',
  monoMed: 'IBMPlexMono_500Medium',
  monoSemi: 'IBMPlexMono_600SemiBold',
  serif: 'SourceSerif4_400Regular',
  serifItalic: 'SourceSerif4_400Regular_Italic',
}

/** Controls and cards; bottom sheets round their top corners at SHEET_RADIUS, floating bars at 4. */
export const RADIUS = 2
export const SHEET_RADIUS = 10
export const FLOAT_RADIUS = 4

/** Team avatars: squares in a muted team colour, ink text on top in both themes. */
export const TEAM_COLORS = ['#C98F6B', '#7FA08A', '#8E9AB5', '#B58E8E', '#A3A07A', '#9C8AB0', '#7E9EA6', '#B59A6E', '#8FA37F', '#A88A9E', '#9FA0A8', '#B8A27E']
export const TEAM_INK = '#1B1815'
/** Stable per roster slot, so a team keeps its colour across screens and Hide names. */
export const teamColor = (rosterId: number) => TEAM_COLORS[(Math.max(1, rosterId) - 1) % TEAM_COLORS.length]

/** Mix two #rrggbb colours: `pct` of `a` over `b` (the CSS color-mix the desktop uses). */
export function mix(a: string, b: string, pct: number): string {
  const p = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  const t = Math.max(0, Math.min(100, pct)) / 100
  return '#' + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, '0')).join('')
}

/** Rank tone, everywhere a league rank appears: top 3 green, bottom 3 red, else neutral. */
export function rankTone(t: Palette, rank: number | null | undefined, n: number): { bg: string; fg: string } {
  if (rank == null) return { bg: t.chip, fg: t.mute }
  if (rank <= 3) return { bg: t.posTint, fg: t.pos }
  if (rank >= n - 2) return { bg: t.negTint, fg: t.neg }
  return { bg: t.chip, fg: t.ink2 }
}

/** The active palette: Settings.theme, or the OS when it is 'system' (Auto). */
export function useTheme(): Palette & { dark: boolean } {
  const os = useColorScheme()
  const { settings } = useApp()
  const pref = settings?.theme ?? 'light'
  const isDark = pref === 'dark' || (pref === 'system' && os === 'dark')
  return { ...(isDark ? dark : light), dark: isDark }
}
