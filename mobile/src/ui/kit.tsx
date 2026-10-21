// Monte's mobile building blocks, to the mobile handoff: 15px body, 13px secondary, nothing under
// 12px; hit targets of 44px and up; radius 2 on controls and cards, 1px rules, no shadows except
// on floating bars and sheets. Colours only from the theme.
import { useCallback, useRef, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
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
import { font, RADIUS, TEAM_INK, rankTone, teamColor, useTheme, type Palette } from './theme'

export type Tone = 'ink' | 'ink2' | 'mute' | 'acc' | 'pos' | 'neg' | 'warn'

// ---- text ---------------------------------------------------------------------------------
type Variant = 'body' | 'semi' | 'small' | 'smallSemi' | 'kicker' | 'mono' | 'monoSemi' | 'serif' | 'serifItalic' | 'title'
const VARIANT: Record<Variant, TextStyle> = {
  body: { fontFamily: font.sans, fontSize: 15, lineHeight: 21 },
  semi: { fontFamily: font.sansSemi, fontSize: 15, lineHeight: 21 },
  small: { fontFamily: font.sans, fontSize: 13, lineHeight: 18 },
  smallSemi: { fontFamily: font.sansSemi, fontSize: 13, lineHeight: 18 },
  /** mono uppercase section label */
  kicker: { fontFamily: font.mono, fontSize: 12, letterSpacing: 1.44, textTransform: 'uppercase' },
  mono: { fontFamily: font.mono, fontSize: 15, fontVariant: ['tabular-nums'] },
  monoSemi: { fontFamily: font.monoSemi, fontSize: 15, fontVariant: ['tabular-nums'] },
  /** headlines and verdicts */
  serif: { fontFamily: font.serif, fontSize: 22, lineHeight: 27 },
  serifItalic: { fontFamily: font.serifItalic, fontSize: 18, lineHeight: 24 },
  title: { fontFamily: font.serif, fontSize: 26, lineHeight: 30 },
}

export function T(props: { v?: Variant; c?: Tone; color?: string; size?: number; style?: StyleProp<TextStyle>; lines?: number; children: ReactNode; onPress?: () => void }) {
  const t = useTheme()
  const v = props.v ?? 'body'
  const color = props.color ?? t[props.c ?? (v === 'kicker' ? 'mute' : 'ink')]
  return (
    <Text
      numberOfLines={props.lines}
      onPress={props.onPress}
      style={[VARIANT[v], { color }, props.size ? { fontSize: props.size, lineHeight: Math.round(props.size * 1.25) } : null, props.style]}
    >
      {props.children}
    </Text>
  )
}

export const Kicker = (props: { children: ReactNode; c?: Tone; style?: StyleProp<TextStyle> }) => (
  <T v="kicker" c={props.c} style={props.style}>
    {props.children}
  </T>
)

// ---- layout -------------------------------------------------------------------------------
type Scrollable = { scrollTo?: (o: { y: number; animated: boolean }) => void; scrollToOffset?: (o: { offset: number; animated: boolean }) => void }
/** Coming back to a tab starts it at the top (the handoff's "changing tab scrolls to top"). */
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

/** A scrolling screen body. `bottom` leaves room for a floating bar (the trade verdict). */
export function Screen(props: {
  children: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
  pad?: boolean
  gap?: number
  bottom?: number
  contentStyle?: StyleProp<ViewStyle>
  scrollRef?: React.Ref<ScrollView>
}) {
  const t = useTheme()
  return (
    <ScrollView
      ref={props.scrollRef}
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={[{ padding: props.pad === false ? 0 : 16, paddingBottom: (props.bottom ?? 0) + 32, gap: props.gap ?? (props.pad === false ? 0 : 12) }, props.contentStyle]}
      refreshControl={props.onRefresh ? <RefreshControl refreshing={!!props.refreshing} onRefresh={props.onRefresh} tintColor={t.mute} colors={[t.acc]} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      {props.children}
    </ScrollView>
  )
}

/** A full-width band with a rule underneath: the top-of-screen headline blocks. */
export function Band(props: { children: ReactNode; style?: StyleProp<ViewStyle>; bg?: string; gap?: number }) {
  const t = useTheme()
  return <View style={[{ padding: 16, gap: props.gap ?? 10, borderBottomWidth: 1, borderColor: t.line, backgroundColor: props.bg }, props.style]}>{props.children}</View>
}

export function Card(props: { children: ReactNode; style?: StyleProp<ViewStyle>; pad?: number; onPress?: () => void; selected?: boolean }) {
  const t = useTheme()
  const style: StyleProp<ViewStyle> = [
    { backgroundColor: t.card2, borderWidth: 1, borderColor: props.selected ? t.ink : t.line, borderRadius: RADIUS, padding: props.pad ?? 14 },
    props.style,
  ]
  return props.onPress ? (
    <Pressable onPress={props.onPress} style={({ pressed }) => [style, pressed && { backgroundColor: t.card }]}>
      {props.children}
    </Pressable>
  ) : (
    <View style={style}>{props.children}</View>
  )
}

export const Row = (props: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean; align?: ViewStyle['alignItems'] }) => (
  <View style={[{ flexDirection: 'row', alignItems: props.align ?? 'center', gap: props.gap ?? 8, flexWrap: props.wrap ? 'wrap' : 'nowrap' }, props.style]}>{props.children}</View>
)

export const Grow = () => <View style={{ flex: 1 }} />

/** A tappable full-width list row: 1px rule underneath, a press tint, 56px+ tall. */
export function ListRow(props: {
  children: ReactNode
  onPress?: () => void
  onLongPress?: () => void
  bg?: string
  minHeight?: number
  style?: StyleProp<ViewStyle>
  disabled?: boolean
}) {
  const t = useTheme()
  const base: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: props.minHeight ?? 60,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: t.line,
    backgroundColor: props.bg ?? 'transparent',
  }
  if (!props.onPress && !props.onLongPress) return <View style={[base, props.style]}>{props.children}</View>
  return (
    <Pressable
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      delayLongPress={480}
      disabled={props.disabled}
      style={({ pressed }) => [base, pressed && { backgroundColor: props.bg && props.bg !== 'transparent' ? props.bg : t.card }, props.style]}
    >
      {props.children}
    </Pressable>
  )
}

/** Name over a muted meta line, truncating: the left side of almost every list row. */
export function Stack2(props: { title: ReactNode; sub?: ReactNode; titleV?: Variant; titleC?: Tone; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flex: 1, minWidth: 0 }, props.style]}>
      <T v={props.titleV ?? 'semi'} c={props.titleC} size={16} lines={1}>
        {props.title}
      </T>
      {props.sub != null && props.sub !== '' && (
        <T v="small" c="mute" lines={1}>
          {props.sub}
        </T>
      )}
    </View>
  )
}

// ---- controls -----------------------------------------------------------------------------
/** Segmented control. `fill` stretches it across its row with equal segments. */
export function Seg<V extends string | number>(props: {
  value: V
  options: Array<{ value: V; label: string }>
  onChange: (v: V) => void
  fill?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  return (
    <View
      style={[
        { flexDirection: 'row', backgroundColor: t.card, borderWidth: 1, borderColor: t.line, borderRadius: RADIUS, padding: 2, alignSelf: props.fill ? 'stretch' : 'flex-start' },
        props.style,
      ]}
    >
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
              minHeight: 36,
              paddingHorizontal: 14,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: RADIUS,
              backgroundColor: on ? t.ink : 'transparent',
            }}
          >
            <Text numberOfLines={1} style={{ fontFamily: font.sansMed, fontSize: 14, color: on ? t.bg : t.ink2 }}>
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Rounded filter pills in a horizontal scroll (sorts, positions, owners). `bare` drops the scroll
 *  so several groups can share one scrolling row. */
export function Pills<V extends string>(props: { value: V; options: Array<{ value: V; label: string }>; onChange: (v: V) => void; padX?: number; bare?: boolean }) {
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
          minHeight: 34,
          paddingHorizontal: 12,
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: on ? t.ink : t.line,
          borderRadius: 17,
          backgroundColor: on ? t.ink : 'transparent',
        }}
      >
        <Text style={{ fontFamily: font.sans, fontSize: 14, color: on ? t.bg : t.ink2 }}>{o.label}</Text>
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

export function Btn(props: {
  label: string
  onPress: () => void
  kind?: 'primary' | 'outline' | 'quiet' | 'link'
  disabled?: boolean
  big?: boolean
  full?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const kind = props.kind ?? 'outline'
  if (kind === 'link')
    return (
      <Pressable onPress={props.onPress} disabled={props.disabled} hitSlop={10} style={[{ minHeight: 36, justifyContent: 'center' }, props.style]}>
        <Text style={{ fontFamily: font.sans, fontSize: 14, color: props.disabled ? t.mute : t.acc }}>{props.label}</Text>
      </Pressable>
    )
  const primary = kind === 'primary'
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [
        {
          minHeight: props.big ? 48 : 40,
          paddingHorizontal: props.big ? 18 : 14,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: primary || kind === 'outline' ? t.ink : t.line,
          backgroundColor: primary ? t.ink : 'transparent',
          borderRadius: RADIUS,
          alignSelf: props.full ? 'stretch' : 'flex-start',
          opacity: props.disabled ? 0.4 : pressed ? 0.8 : 1,
        },
        props.style,
      ]}
    >
      <Text numberOfLines={1} style={{ fontFamily: kind === 'quiet' ? font.sans : font.sansSemi, fontSize: props.big ? 15 : 14, color: primary ? t.bg : t.ink }}>
        {props.label}
      </Text>
    </Pressable>
  )
}

/** The design's on/off switch: 44×26 track in acc (on) or line (off). */
export function Toggle({ on }: { on: boolean }) {
  const t = useTheme()
  return (
    <View style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: on ? t.acc : t.line }}>
      <View style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' }} />
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
      maximumTrackTintColor={t.chip}
      thumbTintColor={t.acc}
    />
  )
}

export function Field(props: TextInputProps & { icon?: ReactNode; boxStyle?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  const { icon, boxStyle, style, ...rest } = props
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: t.line, borderRadius: RADIUS, backgroundColor: t.card2 },
        boxStyle,
      ]}
    >
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

// ---- data display ---------------------------------------------------------------------------
export const toneColors = (t: Palette, tone: Tone | 'chip') =>
  tone === 'pos'
    ? { bg: t.posTint, fg: t.pos }
    : tone === 'neg'
    ? { bg: t.negTint, fg: t.neg }
    : tone === 'warn'
    ? { bg: t.warnTint, fg: t.warn }
    : tone === 'acc'
    ? { bg: t.accTint, fg: t.acc }
    : { bg: t.chip, fg: t.ink2 }

/** Small tinted tag: status (Out, IR, Taxi), signals, grades. */
export function Chip(props: { label: string; tone?: Tone | 'chip'; mono?: boolean; strong?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  const c = toneColors(t, props.tone ?? 'chip')
  return (
    <View style={[{ backgroundColor: c.bg, paddingHorizontal: 6, paddingVertical: 1, borderRadius: RADIUS, alignSelf: 'center' }, props.style]}>
      <Text style={{ fontFamily: props.mono ? (props.strong ? font.monoSemi : font.mono) : props.strong ? font.sansSemi : font.sans, fontSize: 12, color: c.fg }}>{props.label}</Text>
    </View>
  )
}

/** Grade badge (draft): A green, C/D amber, else neutral. */
export function GradeBadge({ g, size = 32 }: { g: string | null | undefined; size?: number }) {
  const t = useTheme()
  const c = !g ? { bg: t.chip, fg: t.mute } : g[0] === 'A' ? { bg: t.posTint, fg: t.pos } : g[0] === 'C' || g[0] === 'D' || g[0] === 'F' ? { bg: t.warnTint, fg: t.warn } : { bg: t.chip, fg: t.ink2 }
  return (
    <View style={{ minWidth: 36, height: size, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
      <Text style={{ fontFamily: font.monoSemi, fontSize: 15, color: c.fg }}>{g ?? '–'}</Text>
    </View>
  )
}

/** A rank in a tinted block, toned top 3 / bottom 3. */
export function RankCell({ rank, n, width = 56, height = 40, size = 17 }: { rank: number | null | undefined; n: number; width?: number; height?: number; size?: number }) {
  const t = useTheme()
  const c = rankTone(t, rank, n)
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
      <Text style={{ fontFamily: font.monoSemi, fontSize: size, color: c.fg }}>{rank ?? '—'}</Text>
    </View>
  )
}

/** "#3" in a small tinted tag, toned like RankCell. */
export function RankTag({ rank, n }: { rank: number; n: number }) {
  const t = useTheme()
  const c = rankTone(t, rank, n)
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, backgroundColor: c.bg }}>
      <Text style={{ fontFamily: font.monoSemi, fontSize: 13, color: c.fg }}>#{rank}</Text>
    </View>
  )
}

/** "Hamilton Family FF" -> "HF"; "NoSkill" -> "NO"; a trailing number wins the second slot ("Team #4" -> "T4"). */
export function teamInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean)
  const numeric = words.slice(1).find(w => /^\d+$/.test(w))
  // One word ("NoSkill", "Cheesehead10"): its first two letters.
  if (words.length === 1) return words[0].replace(/\d+$/, '').slice(0, 2).toUpperCase() || words[0].slice(0, 2).toUpperCase()
  return ((words[0]?.[0] ?? '?') + (numeric ?? words[1]?.[0] ?? '')).toUpperCase()
}

/** A Sleeper avatar over its fallback (colour square and initials). A 403 or a missing image just
 *  leaves the fallback showing. */
function AvatarImage({ src, radius }: { src: string | null | undefined; radius: number }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return null
  return <Image source={src} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius }} contentFit="cover" cachePolicy="disk" onError={() => setFailed(src)} />
}

/**
 * A team: its Sleeper avatar, over a square in its colour with a two-letter mono abbreviation
 * (what shows when it has no avatar, or Hide names is on). The avatar comes from the selected
 * league's rosters, which Hide names already strips.
 */
export function TeamSquare({ rid, name, size = 34, round, ring, src }: { rid: number; name: string; size?: number; round?: boolean; ring?: boolean; src?: string | null }) {
  const t = useTheme()
  const { context } = useApp()
  const avatar = src !== undefined ? src : context?.rosters.find(r => r.roster_id === rid)?.avatar
  const radius = round ? size / 2 : RADIUS
  const sq = (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: teamColor(rid),
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Text style={{ fontFamily: font.monoSemi, fontSize: size >= 44 ? 14 : size >= 30 ? 12 : 11, color: TEAM_INK }}>{teamInitials(name)}</Text>
      <AvatarImage src={avatar} radius={radius} />
    </View>
  )
  if (!ring) return sq
  // Yours: a bg gap, then an accent ring, like box-shadow 0 0 0 3px bg, 0 0 0 5px acc.
  return (
    <View style={{ padding: 2, borderRadius: round ? size : RADIUS + 4, borderWidth: 2, borderColor: t.acc }}>
      <View style={{ padding: 1, borderRadius: round ? size : RADIUS + 2, backgroundColor: t.bg }}>{sq}</View>
    </View>
  )
}

const initialsOf = (name: string) => {
  const parts = name.replace(/\s+(Jr|Sr|II|III|IV|V)\.?$/i, '').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
// Sleeper's CDN: headshots by player id, logos for team defenses.
const headshotUrl = (id: string) =>
  /^\d+$/.test(id) ? `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg` : `https://sleepercdn.com/images/team_logos/nfl/${id.toLowerCase()}.png`

/** A player's Sleeper headshot, round, over his initials (fresh rookies have none). */
export function PlayerAvatar({ id, name, size = 32 }: { id: string | null | undefined; name: string; size?: number }) {
  const t = useTheme()
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.chip, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: font.monoSemi, fontSize: Math.max(11, Math.round(size * 0.34)), color: t.ink2 }}>{initialsOf(name)}</Text>
      {!!id && <AvatarImage src={headshotUrl(id)} radius={size / 2} />}
    </View>
  )
}

/** The league's square: its Sleeper avatar over a chip square with a mono abbreviation. */
export function LeagueSquare({ label, src, size = 34 }: { label: string; src?: string | null; size?: number }) {
  const t = useTheme()
  return (
    <View style={{ width: size, height: size, backgroundColor: t.chip, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <Text style={{ fontFamily: font.monoSemi, fontSize: 12, color: t.ink }}>{label}</Text>
      <AvatarImage src={src} radius={0} />
    </View>
  )
}

/** Horizontal fill bar on a chip-coloured track. */
export function Bar(props: { frac: number; color?: string; height?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  return (
    <View style={[{ height: props.height ?? 8, backgroundColor: t.chip, flex: 1 }, props.style]}>
      <View style={{ height: '100%', width: `${Math.max(0, Math.min(1, props.frac)) * 100}%`, backgroundColor: props.color ?? t.acc }} />
    </View>
  )
}

/** Diverging bar: centre is zero, full width is ±scale. */
export function DivBar(props: { v: number; scale: number; height?: number; color?: string }) {
  const t = useTheme()
  const w = Math.min(50, (Math.abs(props.v) / props.scale) * 50)
  const h = props.height ?? 10
  return (
    <View style={{ height: h, backgroundColor: t.chip, flex: 1 }}>
      <View style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1, backgroundColor: t.mute }} />
      <View
        style={{
          position: 'absolute',
          top: 0,
          height: h,
          left: props.v >= 0 ? '50%' : `${50 - w}%`,
          width: `${w}%`,
          backgroundColor: props.color ?? (props.v >= 0 ? t.pos : t.neg),
        }}
      />
    </View>
  )
}

/** A row of stat tiles in one bordered strip: kicker, big serif value, small note. */
export function Tiles({ items }: { items: Array<{ k: string; v: string; s?: string; color?: string }> }) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: t.line, backgroundColor: t.card2 }}>
      {items.map((x, i) => (
        <View key={x.k} style={{ flex: 1, minWidth: 0, padding: 10, gap: 2, borderLeftWidth: i ? 1 : 0, borderColor: t.line }}>
          <Text numberOfLines={1} style={{ fontFamily: font.mono, fontSize: 12, letterSpacing: 0.96, textTransform: 'uppercase', color: t.mute }}>
            {x.k}
          </Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: font.serif, fontSize: 24, lineHeight: 28, color: x.color ?? t.ink }}>
            {x.v}
          </Text>
          {!!x.s && (
            <Text numberOfLines={1} style={{ fontFamily: font.sans, fontSize: 12, color: t.mute }}>
              {x.s}
            </Text>
          )}
        </View>
      ))}
    </View>
  )
}

// ---- states ---------------------------------------------------------------------------------
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme()
  return (
    <View style={{ borderWidth: 1, borderColor: t.neg, backgroundColor: t.negTint, borderRadius: RADIUS, padding: 12, gap: 8 }}>
      <T v="small" color={t.neg}>
        {message}
      </T>
      {onRetry && <Btn label="Retry" onPress={onRetry} />}
    </View>
  )
}

/** A tinted strip with a line of text: warnings, tips, roster-full notes. */
export function Notice({ message, tone = 'warn', style }: { message: string; tone?: 'warn' | 'mute' | 'pos' | 'acc'; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  const c = tone === 'mute' ? { bg: t.card, fg: t.ink2 } : toneColors(t, tone)
  return (
    <View style={[{ backgroundColor: c.bg, paddingHorizontal: 12, paddingVertical: 10 }, style]}>
      <T v="small" size={14} color={c.fg}>
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
        <T v="small" c="mute" size={14}>
          {label}
        </T>
      )}
    </Row>
  )
}

export function Empty({ message, style }: { message: string; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  return (
    <View style={[{ borderWidth: 1, borderStyle: 'dashed', borderColor: t.line, padding: 18, alignItems: 'center' }, style]}>
      <T v="small" c="mute" size={14} style={{ textAlign: 'center' }}>
        {message}
      </T>
    </View>
  )
}

/** Sheet missing: every sheet-backed screen shows this instead of a raw error. Shows the pick's
 *  progress and any error right here, since this is where the user tapped. */
export function NeedsSheet() {
  const { sheetBusy, sheetError, pickSheet } = useApp()
  return (
    <View style={{ padding: 16 }}>
      <Card style={{ gap: 10 }}>
        <T v="serif">Pick your rankings sheet</T>
        <T v="small" c="ink2" size={14}>
          Download Tyler's sheet as Excel (Google Sheets: File → Download → Microsoft Excel), save it to Files or Drive, then pick it here. Pick it again whenever
          he updates it.
        </T>
        {sheetError && <ErrorBox message={sheetError} />}
        <Btn label={sheetBusy ? 'Reading the sheet…' : 'Pick the .xlsx'} kind="primary" big onPress={pickSheet} disabled={sheetBusy} />
      </Card>
    </View>
  )
}

// ---- formatting -------------------------------------------------------------------------------
// Commas by hand: Hermes may ship without Intl, where toLocaleString() drops the separators.
const commas = (n: number) => String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
export const num = (v: number) => (Math.round(v) < 0 ? '−' : '') + commas(v)
/** "+1,234" / "−1,234" / "0" */
export const signed = (v: number) => (Math.round(v) > 0 ? '+' : Math.round(v) < 0 ? '−' : '') + commas(v)
export const pad2 = (n: number) => String(n).padStart(2, '0')
export const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th']
