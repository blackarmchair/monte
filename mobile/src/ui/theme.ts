// The hybrid design's warm skin, for React Native. Token names match the handoff (bg, surf, surf2,
// card, ink, ink2, mute, acc, good / bad / mid for heat, pos / neg / warn for verdicts). Dark is
// the primary theme. Colours mix in oklab, as the handoff's color-mix(in oklab, …) does.
import { Platform, useColorScheme, type ViewStyle } from 'react-native'
import { useApp } from '@/lib/store'

export const dark = {
  bg: '#141210',
  surf: '#211E1B',
  surf2: '#2D2924',
  card: '#1C1916',
  ink: '#EEE8DE',
  ink2: '#C4BCAF',
  mute: '#8F877B',
  acc: '#E8622E',
  accInk: '#141210',
  accTint: 'rgba(232,98,46,0.15)',
  good: '#D9B95E',
  bad: '#D3735F',
  mid: '#332E28',
  pos: '#6DBE7E',
  neg: '#EC6A57',
  warn: '#E0A14A',
  /** gradient strength: how much of the card colour the gradient starts with */
  gs: 42,
  /** heat text turns dark past this distance from the middle */
  heatCut: 0.36,
}
export type Palette = typeof dark

export const light: Palette = {
  bg: '#F3EFE7',
  surf: '#FBF8F2',
  surf2: '#E8E2D6',
  card: '#FBF8F2',
  ink: '#1B1815',
  ink2: '#4A443C',
  mute: '#716A5E',
  acc: '#C2401F',
  accInk: '#FFFFFF',
  accTint: 'rgba(194,64,31,0.10)',
  good: '#E5CA72',
  bad: '#E8A491',
  mid: '#E4DDCF',
  pos: '#2F6B3B',
  neg: '#B4301F',
  warn: '#9A6210',
  gs: 26,
  heatCut: 0.2,
}

/** Text on a strong heat cell, team avatar or tag, in both themes. */
export const ON_COLOR = '#16140F'

/** Loaded in the root layout (expo-font). Weight lives in the family name on native. */
export const font = {
  sans: 'IBMPlexSans_400Regular',
  sansMed: 'IBMPlexSans_500Medium',
  sansSemi: 'IBMPlexSans_600SemiBold',
  sansBold: 'IBMPlexSans_700Bold',
}

/** Cards 16, hero cards 20–22, sheets 24 on top, heat chips 8–10; pills are fully round. */
export const R = { card: 16, hero: 20, heroLg: 22, sheet: 24, chip: 10 }

/** Fantasy team colours: avatars, team / pick / draft card gradients. Stable per roster slot. */
export const TEAM_COLORS = ['#D98B5F', '#6FB08A', '#7E98C9', '#C98585', '#B8AE6A', '#9D86C4', '#64A9B5', '#C9A061', '#8FB06F', '#B97FA6', '#9AA0AE', '#D1A36F']
export const teamColor = (rosterId: number) => TEAM_COLORS[(Math.max(1, rosterId) - 1) % TEAM_COLORS.length]

/** NFL team colours, for player gradients and the team chip on the player page. */
export const NFL: Record<string, string> = {
  ARI: '#97233F', ATL: '#A71930', BAL: '#4B2E9B', BUF: '#00338D', CAR: '#0085CA', CHI: '#C83803', CIN: '#FB4F14', CLE: '#FF3C00',
  DAL: '#2C5BA8', DEN: '#FB4F14', DET: '#0076B6', GB: '#2E6B45', HOU: '#A71930', IND: '#1D5BAA', JAX: '#007A8C', KC: '#E31837',
  LAC: '#0080C6', LAR: '#2853B5', LV: '#8A8D8F', MIA: '#008E97', MIN: '#4F2683', NE: '#C60C30', NO: '#B3995D', NYG: '#2347A8',
  NYJ: '#18704F', PHI: '#0B6E6E', PIT: '#FFB612', SEA: '#69BE28', SF: '#AA0000', TB: '#D50A0A', TEN: '#4B92DB', WAS: '#8C2131',
}
export const nflColor = (t: Palette, team: string | null | undefined) => (team && NFL[team]) || t.mute

// ---- colour maths -----------------------------------------------------------------------------
type Rgba = [number, number, number, number]
function parse(c: string): Rgba {
  if (c.startsWith('#')) {
    const h = c.length === 4 ? c.slice(1).split('').map(x => x + x).join('') : c.slice(1)
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1) as Rgba
  }
  const m = c.match(/rgba?\(([^)]+)\)/)
  const p = (m?.[1] ?? '0,0,0').split(',').map(Number)
  return [p[0], p[1], p[2], p[3] ?? 1]
}
const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const unlin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
function toLab([r, g, b]: Rgba) {
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
function fromLab([L, a, b]: number[]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(
    v => Math.max(0, Math.min(255, Math.round(unlin(v)))),
  )
}

/** color-mix(in oklab, a pct%, b), as #rrggbb. */
export function mix(a: string, b: string, pct: number): string {
  const p = Math.max(0, Math.min(100, pct)) / 100
  const [x, y] = [toLab(parse(a)), toLab(parse(b))]
  return '#' + fromLab(x.map((v, i) => v * p + y[i] * (1 - p))).map(v => v.toString(16).padStart(2, '0')).join('')
}

/** A colour at some opacity, for tracks and tints. */
export function alpha(c: string, a: number): string {
  const [r, g, b] = parse(c)
  return `rgba(${r},${g},${b},${a})`
}

// ---- the design's primitives --------------------------------------------------------------------
const bgImage = (g: string): ViewStyle =>
  (Platform.OS === 'web' ? { backgroundImage: g } : { experimental_backgroundImage: g }) as ViewStyle

/** The gradient card: the colour fading into the card from the left by 72%. */
export const grad = (t: Palette, c: string): ViewStyle => ({
  backgroundColor: t.card,
  ...bgImage(`linear-gradient(100deg, ${mix(c, t.card, t.gs)} 0%, ${t.card} 72%)`),
})

/** The player hero: a stronger, steeper NFL-colour gradient. */
export const heroGrad = (t: Palette, c: string): ViewStyle => ({
  backgroundColor: t.card,
  ...bgImage(`linear-gradient(160deg, ${mix(c, t.card, 55)} 0%, ${t.card} 75%)`),
})

/** Selected / yours: a 2px accent ring inside the card. `thin` is a candidate's 1px ring. */
export const ring = (t: Palette, thin = false): ViewStyle => ({ boxShadow: `inset 0 0 0 ${thin ? 1 : 2}px ${t.acc}` })

/** Heat cell for t in 0 (bad) … 1 (good): bad, through mid, to good. */
export function heat(t: Palette, v: number): { bg: string; fg: string } {
  const x = Math.max(0, Math.min(1, v))
  const bg = x >= 0.5 ? mix(t.good, t.mid, (x - 0.5) * 200) : mix(t.bad, t.mid, (0.5 - x) * 200)
  return { bg, fg: Math.abs(x - 0.5) > t.heatCut ? ON_COLOR : t.ink }
}

/** Heat for a league rank: #1 is best, #n worst. */
export const rankHeat = (t: Palette, rank: number | null | undefined, n: number) =>
  rank == null ? { bg: t.surf2, fg: t.mute } : heat(t, 1 - (rank - 1) / Math.max(1, n - 1))

/** The active palette: Settings.theme, or the OS when it is 'system' (Auto). Dark when unset. */
export function useTheme(): Palette & { dark: boolean } {
  const os = useColorScheme()
  const { settings } = useApp()
  const pref = settings?.theme ?? 'dark'
  const isDark = pref === 'dark' || (pref === 'system' && os !== 'light')
  return { ...(isDark ? dark : light), dark: isDark }
}
