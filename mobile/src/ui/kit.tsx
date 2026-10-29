// Monte's mobile building blocks, to the hybrid handoff (2b, warm): IBM Plex Sans at 15px, meta at
// 13px, numbers in tabular figures; rounded cards on surf or tinted by team colour, heat chips,
// fully round pill controls, and no 1px dividers: items sit 8px apart. Colours only from the theme.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import SliderBase from '@react-native-community/slider'
import { Image } from 'expo-image'
import { useFocusEffect } from 'expo-router'
import { useApp } from '@/lib/store'
import { font, grad, heat, ON_COLOR, R, rankHeat, ring, teamColor, useTheme, type Palette } from './theme'

export type Tone = 'ink' | 'ink2' | 'mute' | 'acc' | 'pos' | 'neg' | 'warn'

// ---- text ---------------------------------------------------------------------------------
type Variant = 'body' | 'medium' | 'semi' | 'bold' | 'small' | 'smallSemi' | 'label' | 'title' | 'head'
const VARIANT: Record<Variant, TextStyle> = {
  body: { fontFamily: font.sans, fontSize: 15, lineHeight: 21 },
  medium: { fontFamily: font.sansMed, fontSize: 15, lineHeight: 21 },
  semi: { fontFamily: font.sansSemi, fontSize: 15, lineHeight: 21 },
  bold: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 21 },
  small: { fontFamily: font.sans, fontSize: 13, lineHeight: 18 },
  smallSemi: { fontFamily: font.sansSemi, fontSize: 13, lineHeight: 18 },
  /** bio keys and table heads: small uppercase */
  label: { fontFamily: font.sansSemi, fontSize: 11, letterSpacing: 0.88, textTransform: 'uppercase' },
  /** verdicts and hero lines */
  head: { fontFamily: font.sansBold, fontSize: 24, lineHeight: 29, letterSpacing: -0.24 },
  /** page and sheet titles */
  title: { fontFamily: font.sansBold, fontSize: 20, lineHeight: 25 },
}

export function T(props: {
  v?: Variant
  c?: Tone
  color?: string
  size?: number
  /** tabular figures */
  num?: boolean
  style?: StyleProp<TextStyle>
  lines?: number
  children: ReactNode
  onPress?: () => void
}) {
  const t = useTheme()
  const v = props.v ?? 'body'
  const color = props.color ?? t[props.c ?? (v === 'label' ? 'mute' : 'ink')]
  return (
    <Text
      numberOfLines={props.lines}
      onPress={props.onPress}
      style={[
        VARIANT[v],
        { color },
        props.size ? { fontSize: props.size, lineHeight: Math.round(props.size * (props.size >= 24 ? 1.15 : 1.35)) } : null,
        props.num ? { fontVariant: ['tabular-nums'] } : null,
        props.style,
      ]}
    >
      {props.children}
    </Text>
  )
}

/** A section heading over a list: 17px bold, with an optional right-hand slot. */
export function Section(props: { title: string; right?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 4 }, props.style]}>
      <T v="bold" size={17}>
        {props.title}
      </T>
      {props.right}
    </View>
  )
}

// ---- layout -------------------------------------------------------------------------------
type Scrollable = { scrollTo?: (o: { y: number; animated: boolean }) => void; scrollToOffset?: (o: { offset: number; animated: boolean }) => void }
/** Coming back to a tab starts it at the top. */
export function useTopOnFocus<R extends Scrollable>() {
  const ref = useRef<R>(null)
  useFocusEffect(
    useCallback(() => {
      const r = ref.current
      if (r?.scrollToOffset) r.scrollToOffset({ offset: 0, animated: false })
      else r?.scrollTo?.({ y: 0, animated: false })
    }, []),
  )
  return ref
}

/**
 * The on-screen keyboard's height, 0 when it's down. Android runs edge-to-edge (Expo 57), so the
 * window no longer shrinks for the keyboard: a scroll view pads its bottom by this to reach fields
 * and results that would sit under it.
 */
export function useKeyboardHeight() {
  const [h, setH] = useState(0)
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => setH(e.endCoordinates.height))
    const hide = Keyboard.addListener('keyboardDidHide', () => setH(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return h
}

/** A scrolling screen body: 16px gutters, 4px under the header. `bottom` clears a floating bar. */
export function Screen(props: {
  children: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
  gap?: number
  bottom?: number
  pad?: boolean
  contentStyle?: StyleProp<ViewStyle>
  scrollRef?: React.Ref<ScrollView>
}) {
  const t = useTheme()
  return (
    <ScrollView
      ref={props.scrollRef}
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={[
        { paddingHorizontal: props.pad === false ? 0 : 16, paddingTop: 4, paddingBottom: (props.bottom ?? 0) + 28, gap: props.gap ?? 12 },
        props.contentStyle,
      ]}
      refreshControl={props.onRefresh ? <RefreshControl refreshing={!!props.refreshing} onRefresh={props.onRefresh} tintColor={t.mute} colors={[t.acc]} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      {props.children}
    </ScrollView>
  )
}

/** A plain card on surf. */
export function Card(props: { children: ReactNode; style?: StyleProp<ViewStyle>; pad?: number; gap?: number; onPress?: () => void; radius?: number }) {
  const t = useTheme()
  const style: StyleProp<ViewStyle> = [{ backgroundColor: t.surf, borderRadius: props.radius ?? R.card, padding: props.pad ?? 16, gap: props.gap ?? 6 }, props.style]
  return props.onPress ? (
    <Pressable onPress={props.onPress} style={({ pressed }) => [style, pressed && { opacity: 0.85 }]}>
      {props.children}
    </Pressable>
  ) : (
    <View style={style}>{props.children}</View>
  )
}

/** The top-of-screen hero card: 20px radius, 20px padding. */
export const Hero = (props: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) => (
  <Card radius={R.hero} pad={20} gap={props.gap ?? 10} style={props.style}>
    {props.children}
  </Card>
)

/**
 * A list card: a row tinted by `color` (team or NFL colour) fading into the card, or plain surf
 * when `color` is null. `selected` rings it in the accent (yours / picked), `candidate` thinly.
 */
export function GradCard(props: {
  children: ReactNode
  color: string | null
  selected?: boolean
  candidate?: boolean
  dim?: boolean
  onPress?: () => void
  onLongPress?: () => void
  minHeight?: number
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}) {
  const t = useTheme()
  const base: StyleProp<ViewStyle> = [
    {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: props.minHeight ?? 68,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: R.card,
      opacity: props.dim ? 0.35 : 1,
    },
    props.color ? grad(t, props.color) : { backgroundColor: t.surf },
    props.selected ? ring(t) : props.candidate ? ring(t, true) : null,
    props.style,
  ]
  if (!props.onPress && !props.onLongPress) return <View style={base}>{props.children}</View>
  return (
    <Pressable
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      delayLongPress={480}
      accessibilityLabel={props.accessibilityLabel}
      style={({ pressed }) => [base, pressed && { opacity: props.dim ? 0.3 : 0.8 }]}
    >
      {props.children}
    </Pressable>
  )
}

export const Row = (props: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean; align?: ViewStyle['alignItems'] }) => (
  <View style={[{ flexDirection: 'row', alignItems: props.align ?? 'center', gap: props.gap ?? 8, flexWrap: props.wrap ? 'wrap' : 'nowrap' }, props.style]}>{props.children}</View>
)

/** Name over a meta line, truncating: the middle of almost every card. */
export function Stack2(props: { title: ReactNode; sub?: ReactNode; size?: number; titleC?: Tone; subC?: Tone; style?: StyleProp<ViewStyle>; right?: ReactNode }) {
  return (
    <View style={[{ flex: 1, minWidth: 0 }, props.style]}>
      <Row gap={8} style={{ minWidth: 0 }}>
        <T v="bold" size={props.size ?? 16} c={props.titleC} lines={1} style={{ flexShrink: 1 }}>
          {props.title}
        </T>
        {props.right}
      </Row>
      {props.sub != null && props.sub !== '' && (
        <T v="small" c={props.subC ?? 'ink2'} lines={1}>
          {props.sub}
        </T>
      )}
    </View>
  )
}

// ---- controls -----------------------------------------------------------------------------
/** Segmented control on a round surf track; the chosen segment is ink. `fill` spreads it out. */
export function Seg<V extends string | number>(props: {
  value: V
  options: Array<{ value: V; label: string }>
  onChange: (v: V) => void
  fill?: boolean
  /** track colour; surf2 inside a surf card */
  track?: string
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  return (
    <View style={[{ flexDirection: 'row', padding: 3, borderRadius: 22, backgroundColor: props.track ?? t.surf, alignSelf: props.fill ? 'stretch' : 'flex-start' }, props.style]}>
      {props.options.map(o => {
        const on = o.value === props.value
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => props.onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{
              flex: props.fill ? 1 : undefined,
              minHeight: props.fill ? 38 : 34,
              paddingHorizontal: 12,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 19,
              backgroundColor: on ? t.ink : 'transparent',
            }}
          >
            <Text numberOfLines={1} style={{ fontFamily: font.sansSemi, fontSize: props.fill ? 14 : 13, color: on ? t.bg : t.ink2 }}>
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Round filter pills; the chosen one is ink. Scrolls sideways unless `bare`. */
export function Pills<V extends string>(props: {
  value: V
  options: Array<{ value: V; label: string }>
  onChange: (v: V) => void
  padX?: number
  bare?: boolean
  small?: boolean
}) {
  const t = useTheme()
  const pills = props.options.map(o => {
    const on = o.value === props.value
    return (
      <Pressable
        key={o.value}
        onPress={() => props.onChange(o.value)}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        style={{
          minHeight: props.small ? 36 : 38,
          minWidth: 36,
          paddingHorizontal: props.small ? 8 : 14,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 19,
          backgroundColor: on ? t.ink : t.surf,
        }}
      >
        <Text style={{ fontFamily: font.sansSemi, fontSize: props.small ? 13 : 14, color: on ? t.bg : t.ink2 }}>{o.label}</Text>
      </Pressable>
    )
  })
  if (props.bare) return <>{pills}</>
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingHorizontal: props.padX ?? 0 }}>
      {pills}
    </ScrollView>
  )
}

/** Pill buttons: primary is accent, secondary sits on surf2, link is accent text. */
export function Btn(props: {
  label: string
  onPress: () => void
  kind?: 'primary' | 'secondary' | 'link'
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
  full?: boolean
  /** background for a secondary button that sits on bg rather than a card */
  bg?: string
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const kind = props.kind ?? 'secondary'
  if (kind === 'link')
    return (
      <Pressable onPress={props.onPress} disabled={props.disabled} hitSlop={10} style={[{ minHeight: 36, justifyContent: 'center' }, props.style]}>
        <Text style={{ fontFamily: font.sansSemi, fontSize: 14, color: props.disabled ? t.mute : t.acc }}>{props.label}</Text>
      </Pressable>
    )
  const primary = kind === 'primary'
  const h = props.size === 'sm' ? 36 : props.size === 'lg' ? 52 : 44
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [
        {
          minHeight: h,
          paddingHorizontal: props.size === 'sm' ? 14 : 18,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: h / 2,
          backgroundColor: primary ? t.acc : props.bg ?? t.surf2,
          alignSelf: props.full ? 'stretch' : 'flex-start',
          opacity: props.disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        props.style,
      ]}
    >
      <Text numberOfLines={1} style={{ fontFamily: primary ? font.sansBold : font.sansSemi, fontSize: props.size === 'lg' ? 16 : props.size === 'sm' ? 14 : 15, color: primary ? t.accInk : t.ink }}>
        {props.label}
      </Text>
    </Pressable>
  )
}

/** On/off switch: 46×28 track in acc (on) or surf2 (off). */
export function Toggle({ on }: { on: boolean }) {
  const t = useTheme()
  return (
    <View style={{ width: 46, height: 28, borderRadius: 14, backgroundColor: on ? t.acc : t.surf2 }}>
      <View style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' }} />
    </View>
  )
}

export function Slider(props: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; onDone?: (v: number) => void }) {
  const t = useTheme()
  return (
    <SliderBase
      style={{ flex: 1, height: 40 }}
      value={props.value}
      minimumValue={props.min}
      maximumValue={props.max}
      step={props.step}
      onValueChange={props.onChange}
      onSlidingComplete={props.onDone}
      minimumTrackTintColor={t.acc}
      maximumTrackTintColor={t.surf2}
      thumbTintColor={t.acc}
    />
  )
}

/** A round text field on surf. */
export function Field(props: TextInputProps & { icon?: ReactNode; boxStyle?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  const { icon, boxStyle, style, ...rest } = props
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 16, borderRadius: 24, backgroundColor: t.surf }, boxStyle]}>
      {icon}
      <TextInput
        placeholderTextColor={t.mute}
        autoCorrect={false}
        style={[{ flex: 1, minWidth: 0, color: t.ink, fontFamily: font.sans, fontSize: 16, paddingVertical: 10 }, style]}
        {...rest}
      />
    </View>
  )
}

/** A − value + stepper. */
export function Stepper(props: { value: number; onDec: () => void; onInc: () => void }) {
  const t = useTheme()
  const b = (label: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityLabel={label === '−' ? 'Earlier' : 'Later'}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surf2, opacity: pressed ? 0.7 : 1 })}
    >
      <Text style={{ fontFamily: font.sans, fontSize: 18, color: t.ink }}>{label}</Text>
    </Pressable>
  )
  return (
    <Row gap={10}>
      {b('−', props.onDec)}
      <T v="bold" size={18} num style={{ width: 28, textAlign: 'center' }}>
        {props.value}
      </T>
      {b('+', props.onInc)}
    </Row>
  )
}

/** A check circle: accent with ✓ when on. */
export function Check({ on, off }: { on: boolean; off?: string }) {
  const t = useTheme()
  return (
    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: on ? t.acc : off ?? 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      {on && <Text style={{ fontFamily: font.sansBold, fontSize: 14, color: t.accInk }}>✓</Text>}
    </View>
  )
}

// ---- data display ---------------------------------------------------------------------------
export const toneColor = (t: Palette, tone: Tone | 'mute') => t[tone]

/** A heat-coloured number: `v` is 0 (bad) … 1 (good), or pass `colors` from rankHeat. */
export function HeatChip(props: {
  label: string
  v?: number
  colors?: { bg: string; fg: string }
  minWidth?: number
  height?: number
  size?: number
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const c = props.colors ?? heat(t, props.v ?? 0.5)
  const h = props.height ?? 34
  return (
    <View
      style={[
        { minWidth: props.minWidth ?? 58, height: h, paddingHorizontal: 10, borderRadius: h >= 32 ? R.chip : 8, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' },
        props.style,
      ]}
    >
      <Text numberOfLines={1} style={{ fontFamily: font.sansBold, fontSize: props.size ?? 15, color: c.fg, fontVariant: ['tabular-nums'] }}>
        {props.label}
      </Text>
    </View>
  )
}

/** Heat tiles in a row: small key over a big value (team ranks, roster change after a trade). */
export function HeatTiles({ items, size = 21 }: { items: Array<{ k: string; v: string; colors: { bg: string; fg: string } }>; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {items.map(x => (
        <View key={x.k} style={{ flex: 1, minWidth: 0, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 14, backgroundColor: x.colors.bg, alignItems: 'center', gap: 2 }}>
          <Text numberOfLines={1} style={{ fontFamily: font.sansSemi, fontSize: 12, color: x.colors.fg, opacity: 0.8 }}>
            {x.k}
          </Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: font.sansBold, fontSize: size, lineHeight: Math.round(size * 1.15), color: x.colors.fg, fontVariant: ['tabular-nums'] }}>
            {x.v}
          </Text>
        </View>
      ))}
    </View>
  )
}

/** Small status tag: Out / IR (bad), Q / D (warn), Taxi (mid). */
export function Tag({ label, tone }: { label: string; tone: 'bad' | 'warn' | 'mid' | 'acc' }) {
  const t = useTheme()
  const bg = tone === 'bad' ? t.bad : tone === 'warn' ? t.warn : tone === 'acc' ? t.acc : t.mid
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: bg, alignSelf: 'center' }}>
      <Text style={{ fontFamily: font.sansBold, fontSize: 12, color: tone === 'mid' ? t.ink2 : tone === 'acc' ? t.accInk : ON_COLOR }}>{label}</Text>
    </View>
  )
}

/** A tile on surf: small mute key over a big number (sheet vs market, You vs Them). */
export function StatTile(props: { k: string; v: string; color?: string; size?: number; sub?: string }) {
  const t = useTheme()
  return (
    <View style={{ flex: 1, minWidth: 0, padding: 14, borderRadius: R.card, backgroundColor: t.surf, gap: 2 }}>
      <T v="small" c="mute">
        {props.k}
      </T>
      <T v="bold" size={props.size ?? 26} num color={props.color} lines={1}>
        {props.v}
      </T>
      {!!props.sub && (
        <T v="small" c="ink2" lines={1}>
          {props.sub}
        </T>
      )}
    </View>
  )
}

/** "Hamilton Family FF" -> "HF"; "NoSkill" -> "NO"; a trailing number wins the second slot ("Team #4" -> "T4"). */
export function teamInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean)
  const numeric = words.slice(1).find(w => /^\d+$/.test(w))
  if (words.length === 1) return words[0].replace(/\d+$/, '').slice(0, 2).toUpperCase() || words[0].slice(0, 2).toUpperCase()
  return ((words[0]?.[0] ?? '?') + (numeric ?? words[1]?.[0] ?? '')).toUpperCase()
}

/** An image over its fallback; a 403 or a missing image just leaves the fallback showing. */
function Over({ src, radius, top }: { src: string | null | undefined; radius: number; top?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return null
  return (
    <Image
      source={src}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius }}
      contentFit="cover"
      contentPosition={top ? 'top' : 'center'}
      cachePolicy="disk"
      onError={() => setFailed(src)}
    />
  )
}

/**
 * A team: a circle in its colour with two dark initials, and its Sleeper avatar on top when it
 * has one (Hide names strips avatars, so the initials show).
 */
export function TeamAvatar({ rid, name, size = 44, src }: { rid: number; name: string; size?: number; src?: string | null }) {
  const { context } = useApp()
  const avatar = src !== undefined ? src : context?.rosters.find(r => r.roster_id === rid)?.avatar
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: teamColor(rid), alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <Text style={{ fontFamily: font.sansBold, fontSize: size >= 56 ? 18 : size >= 40 ? 13 : 11, color: ON_COLOR }}>{teamInitials(name)}</Text>
      <Over src={avatar} radius={size / 2} />
    </View>
  )
}

const initialsOf = (name: string) => {
  const parts = name.replace(/\s+(Jr|Sr|II|III|IV|V)\.?$/i, '').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
/** Sleeper's CDN: thumbs in lists, the full cut-out on the player hero, logos for defenses. */
export const headshotUrl = (id: string, full = false) =>
  /^\d+$/.test(id)
    ? `https://sleepercdn.com/content/nfl/players/${full ? '' : 'thumb/'}${id}.jpg`
    : `https://sleepercdn.com/images/team_logos/nfl/${id.toLowerCase()}.png`

/** A player's Sleeper headshot in a circle, over his initials (fresh rookies have none). */
export function Headshot({ id, name, size = 46 }: { id: string | null | undefined; name: string; size?: number }) {
  const t = useTheme()
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.surf2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: font.sansBold, fontSize: size >= 44 ? 13 : 12, color: t.ink2 }}>{initialsOf(name)}</Text>
      {!!id && <Over src={headshotUrl(id)} radius={size / 2} top />}
    </View>
  )
}

/** The league's circle: its Sleeper avatar over its initials. */
export function LeagueAvatar({ label, src, size = 42 }: { label: string; src?: string | null; size?: number }) {
  const t = useTheme()
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.surf2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <Text style={{ fontFamily: font.sansBold, fontSize: 12, color: t.ink }}>{label}</Text>
      <Over src={src} radius={size / 2} />
    </View>
  )
}

/** Mini histogram: one bar per slot, the projected one in the accent. */
export function Histogram(props: { dist: number[]; at: number; height: number; gap?: number; dim?: string }) {
  const t = useTheme()
  const mx = Math.max(...props.dist, 1e-9)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: props.gap ?? 2, height: props.height }}>
      {props.dist.map((p, i) => (
        <View key={i} style={{ flex: 1, height: Math.max(2, (p / mx) * props.height), borderRadius: 2, backgroundColor: i + 1 === props.at ? t.acc : props.dim ?? t.surf2 }} />
      ))}
    </View>
  )
}

// ---- states ---------------------------------------------------------------------------------
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme()
  return (
    <Card gap={10}>
      <T size={14} color={t.neg}>
        {message}
      </T>
      {onRetry && <Btn size="sm" label="Retry" onPress={onRetry} />}
    </Card>
  )
}

/** A short line on a surf card: warnings, tips, roster-full notes. */
export function Notice({ message, tone = 'warn', style }: { message: string; tone?: 'warn' | 'mute' | 'pos' | 'acc'; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  return (
    <View style={[{ backgroundColor: tone === 'acc' ? t.accTint : t.surf, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 }, style]}>
      <T v="smallSemi" size={14} color={tone === 'mute' ? t.ink2 : t[tone]}>
        {message}
      </T>
    </View>
  )
}

export function Loading({ label }: { label?: string }) {
  const t = useTheme()
  return (
    <Row gap={10} style={{ paddingVertical: 28, justifyContent: 'center' }}>
      <ActivityIndicator color={t.mute} />
      {!!label && (
        <T c="mute" size={14}>
          {label}
        </T>
      )}
    </Row>
  )
}

export function Empty({ message, style }: { message: string; style?: StyleProp<ViewStyle> }) {
  return (
    <Card style={[{ alignItems: 'center', padding: 18 }, style]}>
      <T c="mute" size={14} style={{ textAlign: 'center' }}>
        {message}
      </T>
    </Card>
  )
}

/** Sheet missing: every sheet-backed screen shows this instead of a raw error, with the pick's
 *  progress and any error right here, since this is where the user tapped. */
export function NeedsSheet({ inset = true }: { inset?: boolean }) {
  const { sheetBusy, sheetError, pickSheet } = useApp()
  return (
    <View style={inset ? { paddingHorizontal: 16, paddingTop: 4 } : null}>
      <Hero>
        <T v="head">Pick your rankings sheet</T>
        <T c="ink2">
          Download Tyler's sheet as Excel (Google Sheets: File → Download → Microsoft Excel), save it to Files or Drive, then pick it here. Pick it again whenever he
          updates it.
        </T>
        {sheetError && <ErrorBox message={sheetError} />}
        <Btn label={sheetBusy ? 'Reading the sheet…' : 'Pick the .xlsx'} kind="primary" onPress={pickSheet} disabled={sheetBusy} style={{ marginTop: 6 }} />
      </Hero>
    </View>
  )
}

// ---- formatting -------------------------------------------------------------------------------
// Commas by hand: Hermes may ship without Intl, where toLocaleString() drops the separators.
const commas = (n: number) => String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
export const num = (v: number) => (Math.round(v) < 0 ? '−' : '') + commas(v)
/** "+1,234" / "−1,234" / "0" */
export const signed = (v: number) => (Math.round(v) > 0 ? '+' : Math.round(v) < 0 ? '−' : '') + commas(v)
/** 12345 -> "12.3k", 850 -> "850" */
export const kfmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))
export const pad2 = (n: number) => String(n).padStart(2, '0')
export const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th']
export { rankHeat }
