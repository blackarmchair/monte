// Monte's desktop building blocks, to the hybrid handoff (2b, warm): gradient cards tinted by team
// or NFL colour, heat-coloured cells, Sleeper headshots over initials, round pill controls and no
// dividers. Colours are CSS variables, mixed in oklab as the handoff's color-mix() does.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useApp } from './store'

// ---- colour -------------------------------------------------------------------------------
/** Fantasy team colours: avatars and team / pick / draft card gradients. Stable per roster slot. */
export const TEAM_COLORS = ['#D98B5F', '#6FB08A', '#7E98C9', '#C98585', '#B8AE6A', '#9D86C4', '#64A9B5', '#C9A061', '#8FB06F', '#B97FA6', '#9AA0AE', '#D1A36F']
export const teamColor = (rosterId: number) => TEAM_COLORS[(Math.max(1, rosterId) - 1) % TEAM_COLORS.length]

/** NFL team colours, for player gradients and the team chip on the player page. */
export const NFL: Record<string, string> = {
  ARI: '#97233F', ATL: '#A71930', BAL: '#4B2E9B', BUF: '#00338D', CAR: '#0085CA', CHI: '#C83803', CIN: '#FB4F14', CLE: '#FF3C00',
  DAL: '#2C5BA8', DEN: '#FB4F14', DET: '#0076B6', GB: '#2E6B45', HOU: '#A71930', IND: '#1D5BAA', JAX: '#007A8C', KC: '#E31837',
  LAC: '#0080C6', LAR: '#2853B5', LV: '#8A8D8F', MIA: '#008E97', MIN: '#4F2683', NE: '#C60C30', NO: '#B3995D', NYG: '#2347A8',
  NYJ: '#18704F', PHI: '#0B6E6E', PIT: '#FFB612', SEA: '#69BE28', SF: '#AA0000', TB: '#D50A0A', TEN: '#4B92DB', WAS: '#8C2131',
}
export const nflColor = (team: string | null | undefined) => (team && NFL[team]) || 'var(--mute)'

/** The gradient card: the colour fading into the card from the left by 72%. */
export const grad = (c: string) => `linear-gradient(100deg, color-mix(in oklab, ${c} var(--gs), var(--card)) 0%, var(--card) 72%)`
/** The player hero's stronger, steeper gradient. */
export const heroGrad = (c: string) => `linear-gradient(160deg, color-mix(in oklab, ${c} 55%, var(--card)) 0%, var(--card) 75%)`
/** Selected / yours: a 2px accent ring; a candidate (or a quieter "yours") gets 1px. */
export const RING = 'inset 0 0 0 2px var(--acc)'
export const RING_THIN = 'inset 0 0 0 1px var(--acc)'
export const RING_SOFT = 'inset 0 0 0 1px color-mix(in oklab, var(--acc) 50%, transparent)'

/** Electron drives prefers-color-scheme from Settings.theme; heat text needs to know which. */
export function useDark(): boolean {
  const q = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setDark(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return dark
}

export type Heat = { bg: string; fg: string }
/** Heat cell for v in 0 (bad) … 1 (good): bad, through mid, to good. */
export function heatOf(v: number, dark: boolean): Heat {
  const x = Math.max(0, Math.min(1, v))
  const bg = x >= 0.5 ? `color-mix(in oklab, var(--good) ${Math.round((x - 0.5) * 200)}%, var(--mid))` : `color-mix(in oklab, var(--bad) ${Math.round((0.5 - x) * 200)}%, var(--mid))`
  return { bg, fg: Math.abs(x - 0.5) > (dark ? 0.36 : 0.2) ? 'var(--on-color)' : 'var(--ink)' }
}
/** heat(v) and rank(r, n) bound to the current theme. */
export function useHeat() {
  const dark = useDark()
  return {
    heat: (v: number) => heatOf(v, dark),
    rank: (r: number | null | undefined, n: number): Heat => (r == null ? { bg: 'var(--surf2)', fg: 'var(--mute)' } : heatOf(1 - (r - 1) / Math.max(1, n - 1), dark)),
  }
}

// ---- icons --------------------------------------------------------------------------------
const PATHS = {
  league: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  lineup: 'M4 6h16M4 12h16M4 18h10',
  trade: 'M4 8h15l-4-4M20 16H5l4 4',
  players: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8',
  picks: 'M4 20h16M7 20v-6M12 20V8M17 20V11',
  back: 'M15 5l-7 7 7 7',
  chevronDown: 'M6 9l6 6 6-6',
  search: 'M11 4.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13zM20 20l-4.2-4.2',
  // a cog: a toothed ring around the centre circle (drawn separately)
  gear: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
} as const
export type IconName = keyof typeof PATHS
export function Icon({ name, size = 20, stroke = 1.8, style }: { name: IconName; size?: number; stroke?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', ...style }}>
      {name === 'gear' && <circle cx={12} cy={12} r={3} />}
      <path d={PATHS[name]} />
    </svg>
  )
}

// ---- faces --------------------------------------------------------------------------------
const initialsOf = (name: string) => {
  const parts = name.replace(/\s+(Jr|Sr|II|III|IV|V)\.?$/i, '').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
/** "Hamilton Family FF" -> "HF"; a trailing number wins the second slot ("Team #4" -> "T4"). */
export function teamInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean)
  const numeric = words.slice(1).find(w => /^\d+$/.test(w))
  if (words.length === 1) return words[0].replace(/\d+$/, '').slice(0, 2).toUpperCase() || words[0].slice(0, 2).toUpperCase()
  return ((words[0]?.[0] ?? '?') + (numeric ?? words[1]?.[0] ?? '')).toUpperCase()
}
// Sleeper's CDN: thumbs in lists, the full cut-out on the player page, logos for defenses.
// Not a documented API, so every picture sits on an initials fallback.
export const headshotUrl = (id: string, full = false) =>
  /^\d+$/.test(id) ? `https://sleepercdn.com/content/nfl/players/${full ? '' : 'thumb/'}${id}.jpg` : `https://sleepercdn.com/images/team_logos/nfl/${id.toLowerCase()}.png`
/** urls that already failed this session, so re-renders don't refetch them */
const failed = new Set<string>()

function Img({ src }: { src: string | null | undefined }) {
  const [, setTick] = useState(0)
  if (!src || failed.has(src)) return null
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => {
        failed.add(src)
        setTick(x => x + 1)
      }}
    />
  )
}

/** A player's Sleeper headshot in a circle, over his initials. */
export function Headshot({ id, name, size = 44 }: { id: string | null | undefined; name: string; size?: number }) {
  return (
    <span className="face" style={{ width: size, height: size, fontSize: size >= 44 ? 13 : 12 }} aria-hidden>
      {initialsOf(name)}
      {!!id && <Img src={headshotUrl(id)} />}
    </span>
  )
}

/** A team: a circle in its colour with dark initials, and its Sleeper avatar on top when it has one
 *  (Hide names strips avatars, so the initials show). */
export function TeamAvatar({ rid, name, size = 42, src }: { rid: number; name: string; size?: number; src?: string | null }) {
  const { context } = useApp()
  const avatar = src !== undefined ? src : context?.rosters.find(r => r.roster_id === rid)?.avatar
  return (
    <span className="face team" style={{ width: size, height: size, background: teamColor(rid), fontSize: size >= 56 ? 18 : size >= 40 ? 13 : 12 }} aria-hidden>
      {teamInitials(name)}
      <Img src={avatar} />
    </span>
  )
}

/** A league's Sleeper avatar over its initials. */
export function LeagueAvatar({ name, src, size = 40 }: { name: string; src: string | null | undefined; size?: number }) {
  return (
    <span className="face" style={{ width: size, height: size, fontSize: 12, color: 'var(--ink)' }} aria-hidden>
      {teamInitials(name)}
      <Img src={src} />
    </span>
  )
}

// ---- controls ------------------------------------------------------------------------------
export function Seg<V extends string | number>(props: { value: V; options: Array<{ value: V; label: string }>; onChange: (v: V) => void; onSurf?: boolean; lg?: boolean }) {
  return (
    <div className={`seg${props.onSurf ? ' on-surf' : ''}${props.lg ? ' lg' : ''}`} role="tablist">
      {props.options.map(o => (
        <button key={String(o.value)} role="tab" aria-selected={o.value === props.value} className={o.value === props.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Pills<V extends string>(props: { value: V; options: Array<{ value: V; label: string }>; onChange: (v: V) => void }) {
  return (
    <div className="pills">
      {props.options.map(o => (
        <button key={o.value} className={`pill${o.value === props.value ? ' on' : ''}`} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Btn(props: { label: string; onClick: () => void; kind?: 'primary' | 'secondary'; size?: 'sm' | 'lg'; disabled?: boolean; title?: string; style?: CSSProperties; bg?: string }) {
  return (
    <button
      className={`btn${props.kind === 'primary' ? ' primary' : ''}${props.size ? ` ${props.size}` : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      style={props.bg ? { background: props.bg, ...props.style } : props.style}
    >
      {props.label}
    </button>
  )
}
export const Link = (props: { label: string; onClick: () => void; disabled?: boolean; style?: CSSProperties }) => (
  <button className="link" onClick={props.onClick} disabled={props.disabled} style={props.style}>
    {props.label}
  </button>
)

/** On/off switch: 46×28 track in acc (on) or surf2 (off). */
export function Toggle({ on }: { on: boolean }) {
  return (
    <span style={{ width: 46, height: 28, flex: 'none', borderRadius: 14, background: on ? 'var(--acc)' : 'var(--surf2)', position: 'relative' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
    </span>
  )
}

/** A − value + stepper. */
export function Stepper(props: { value: number; onDec: () => void; onInc: () => void }) {
  const b = (label: string, onClick: () => void) => (
    <button onClick={onClick} aria-label={label === '−' ? 'Earlier' : 'Later'} style={{ width: 40, height: 40, borderRadius: 20, background: 'var(--surf2)', fontSize: 18, textAlign: 'center' }}>
      {label}
    </button>
  )
  return (
    <span className="row" style={{ gap: 10 }}>
      {b('−', props.onDec)}
      <span className="num" style={{ width: 26, textAlign: 'center', fontWeight: 700, fontSize: 18 }}>
        {props.value}
      </span>
      {b('+', props.onInc)}
    </span>
  )
}

/** The +/✓ toggle on roster rows, or a ✓ check circle. */
export function Check({ on, plus, off = 'var(--surf2)', size = 34, onClick, label }: { on: boolean; plus?: boolean; off?: string; size?: number; onClick?: () => void; label?: string }) {
  const style: CSSProperties = {
    width: size,
    height: size,
    flex: 'none',
    borderRadius: size / 2,
    background: on ? 'var(--acc)' : off,
    color: on ? 'var(--acc-ink)' : 'var(--ink)',
    fontSize: size >= 34 ? 16 : 14,
    fontWeight: 700,
    display: 'grid',
    placeItems: 'center',
  }
  const mark = on ? '✓' : plus ? '+' : ''
  return onClick ? (
    <button style={style} onClick={onClick} aria-label={label} aria-pressed={on}>
      {mark}
    </button>
  ) : (
    <span style={style}>{mark}</span>
  )
}

// ---- cards and data -------------------------------------------------------------------------
/**
 * A list card: a row tinted by `color` (team or NFL colour) fading into the card, or plain surf
 * when `color` is null. `ring` marks it selected or yours.
 */
export function GradCard(props: {
  children: ReactNode
  color: string | null
  ring?: string
  dim?: boolean
  onClick?: () => void
  minHeight?: number
  style?: CSSProperties
  title?: string
  /** a div that is clickable (it holds its own buttons) rather than a button */
  div?: boolean
}) {
  const style: CSSProperties = {
    minHeight: props.minHeight ?? 64,
    background: props.color ? grad(props.color) : 'var(--surf)',
    boxShadow: props.ring,
    opacity: props.dim ? 0.35 : 1,
    ...props.style,
  }
  if (!props.onClick || props.div)
    return (
      <div className={`gcard${props.onClick ? ' click' : ''}`} style={style} onClick={props.onClick} title={props.title}>
        {props.children}
      </div>
    )
  return (
    <button className="gcard" style={style} onClick={props.onClick} title={props.title}>
      {props.children}
    </button>
  )
}

/** Name over a meta line, truncating: the middle of almost every card. */
export function Stack2(props: { title: ReactNode; sub?: ReactNode; size?: number; right?: ReactNode; titleStyle?: CSSProperties; subStyle?: CSSProperties }) {
  return (
    <span className="stack" style={{ flex: 1, minWidth: 0 }}>
      <span className="row" style={{ gap: 8, minWidth: 0 }}>
        <span className="trunc" style={{ fontWeight: 700, fontSize: props.size ?? 15, ...props.titleStyle }}>
          {props.title}
        </span>
        {props.right}
      </span>
      {props.sub != null && props.sub !== '' && (
        <span className="sub trunc" style={props.subStyle}>
          {props.sub}
        </span>
      )}
    </span>
  )
}

export function HeatChip({ label, colors, minWidth = 64, height = 34, size = 15, style }: { label: string; colors: Heat; minWidth?: number; height?: number; size?: number; style?: CSSProperties }) {
  return (
    <span
      className="num"
      style={{
        minWidth,
        height,
        padding: '0 10px',
        flex: 'none',
        borderRadius: height >= 32 ? 10 : 9,
        background: colors.bg,
        color: colors.fg,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: size,
        ...style,
      }}
    >
      {label}
    </span>
  )
}

/** Heat tiles in a row: small key over a big value (team ranks, roster change after a trade). */
export function HeatTiles({ items, size = 22, cols }: { items: Array<{ k: string; v: string; colors: Heat }>; size?: number; cols?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols ?? items.length}, 1fr)`, gap: size >= 20 ? 8 : 6 }}>
      {items.map(x => (
        <div key={x.k} style={{ padding: size >= 20 ? '12px 8px' : '10px 4px', borderRadius: size >= 20 ? 14 : 12, background: x.colors.bg, color: x.colors.fg, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.8 }}>{x.k}</span>
          <span className="num" style={{ fontSize: size, fontWeight: 700, lineHeight: 1.1 }}>
            {x.v}
          </span>
        </div>
      ))}
    </div>
  )
}

/** A tile on surf: small mute key over a big number. */
export function StatTile(props: { k: string; v: string; color?: string; size?: number; sub?: string; bg?: string }) {
  return (
    <div style={{ padding: 18, borderRadius: 18, background: props.bg ?? 'var(--surf)', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span className="small mute">{props.k}</span>
      <span className="num trunc" style={{ fontSize: props.size ?? 30, fontWeight: 700, color: props.color }}>
        {props.v}
      </span>
      {props.sub && <span className="sub">{props.sub}</span>}
    </div>
  )
}

/** Small status tag: Out (bad), IR / Q / D (warn), Taxi (mid). */
export function Tag({ label, tone }: { label: string; tone: 'bad' | 'warn' | 'mid' | 'acc' }) {
  const bg = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : tone === 'acc' ? 'var(--acc)' : 'var(--mid)'
  const fg = tone === 'mid' ? 'var(--ink2)' : tone === 'acc' ? 'var(--acc-ink)' : 'var(--on-color)'
  return <span style={{ padding: '2px 8px', borderRadius: 8, background: bg, color: fg, fontSize: 12, fontWeight: 700, flex: 'none' }}>{label}</span>
}

/** Mini histogram: one bar per slot, the projected one in the accent. */
export function Histogram({ dist, at, height }: { dist: number[]; at: number; height: number }) {
  const mx = Math.max(...dist, 1e-9)
  return (
    <span style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }}>
      {dist.map((p, i) => (
        <span key={i} style={{ flex: 1, height: Math.max(2, (p / mx) * height), borderRadius: 2, background: i + 1 === at ? 'var(--acc)' : 'color-mix(in oklab, var(--ink) 30%, transparent)' }} />
      ))}
    </span>
  )
}

/** One team's full slot distribution, with percentages and slot numbers. */
export function DistBars({ dist, at, height = 140 }: { dist: number[]; at: number; height?: number }) {
  const mx = Math.max(...dist, 1e-9)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height, paddingTop: 6 }}>
      {dist.map((p, i) => (
        <div key={i} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--mute)' }}>{p >= 0.01 ? `${Math.round(p * 100)}%` : ''}</span>
          <span style={{ width: '100%', height: Math.max(3, (p / mx) * (height - 46)), borderRadius: '5px 5px 2px 2px', background: i + 1 === at ? 'var(--acc)' : 'var(--surf2)' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--mute)' }}>{i + 1}</span>
        </div>
      ))}
    </div>
  )
}

export const SectionTitle = ({ title, right }: { title: string; right?: ReactNode }) => (
  <div className="row" style={{ justifyContent: 'space-between', gap: 10, paddingBottom: 2 }}>
    <span className="title-l">{title}</span>
    {right}
  </div>
)

// ---- states ---------------------------------------------------------------------------------
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card row" style={{ gap: 12, color: 'var(--neg)', fontSize: 14 }}>
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && <Btn size="sm" label="Retry" onClick={onRetry} />}
    </div>
  )
}

/** A short line on a surf card: warnings, tips, roster-full notes. */
export function Notice({ message, tone = 'warn', bg }: { message: string; tone?: 'warn' | 'mute' | 'pos' | 'acc'; bg?: string }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 14, background: bg ?? 'var(--surf)', color: tone === 'mute' ? 'var(--ink2)' : `var(--${tone})`, fontSize: 14, fontWeight: 600 }}>
      {message}
    </div>
  )
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="row" style={{ gap: 10, padding: '28px 0', justifyContent: 'center', color: 'var(--mute)', fontSize: 14 }}>
      <span className="spinner" />
      {label}
    </div>
  )
}

export const Empty = ({ message }: { message: string }) => (
  <div className="card mute" style={{ textAlign: 'center', fontSize: 14 }}>
    {message}
  </div>
)

/** No rankings file yet: every sheet-backed screen shows this instead of an error. */
export function NeedsSheet() {
  const { sheetError, chooseSheet } = useApp()
  return (
    <div className="hero" style={{ maxWidth: 640 }}>
      <div style={{ fontSize: 26, fontWeight: 700 }}>Choose your rankings sheet</div>
      <div className="sub" style={{ fontSize: 15 }}>
        Download Tyler's sheet as Excel (Google Sheets: File → Download → Microsoft Excel) and choose the file. Monte watches it and reloads whenever you download a
        newer copy.
      </div>
      {sheetError && <div style={{ color: 'var(--neg)', fontSize: 14 }}>{sheetError}</div>}
      <div style={{ paddingTop: 6 }}>
        <Btn kind="primary" label="Choose the .xlsx" onClick={chooseSheet} />
      </div>
    </div>
  )
}

// ---- formatting -------------------------------------------------------------------------------
export const num = (v: number) => Math.round(v).toLocaleString().replace('-', '−')
/** "+1,234" / "−1,234" / "0" */
export const signed = (v: number) => (Math.round(v) > 0 ? '+' : Math.round(v) < 0 ? '−' : '') + Math.round(Math.abs(v)).toLocaleString()
/** 12345 -> "12.3k", 850 -> "850" */
export const kfmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))
export const pad2 = (n: number) => String(n).padStart(2, '0')
export const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th']
