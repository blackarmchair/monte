import { createContext, useContext, useState } from 'react'
import { createPortal } from 'react-dom'
import logoLight from './assets/logo-light.png'
import logoDark from './assets/logo-dark.png'
import type { Signal } from '@shared/types'

export function Segmented<T extends string | number>(props: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="seg">
      {props.options.map(o => (
        <button key={String(o.value)} className={o.value === props.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const sigClass = (s: Signal) => (s.startsWith('Over') ? 'over' : s.startsWith('Under') ? 'under' : 'neutral')
export const sigColor = (s: Signal) =>
  s.startsWith('Over') ? 'var(--pos)' : s.startsWith('Under') ? 'var(--neg)' : 'var(--muted)'

export function SignalPill({ s }: { s: Signal }) {
  return <span className={`pill ${sigClass(s)}`}>{s.replace(' (Strong)', ' ++')}</span>
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-inline">
      <span>{message}</span>
      {onRetry && (
        <button className="btn-secondary" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function SkeletonRows({ n = 8 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skeleton">
          <div style={{ width: `${55 + ((i * 37) % 40)}%` }} />
        </div>
      ))}
    </>
  )
}

export const pct = (x: number) => `${Math.round(x)}%`
export const timeStr = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })

// Sleeper's public CDN: headshots by player id, logos for team defenses (id is the team code).
// Not a documented API, so every avatar sits on an initials fallback: a 403 (fresh rookies,
// deep backups) or a moved path just leaves the initials showing.
const headshotUrl = (id: string) =>
  /^\d+$/.test(id) ? `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg` : `https://sleepercdn.com/images/team_logos/nfl/${id.toLowerCase()}.png`
/** ids that already 403'd this session, so re-renders don't refetch them */
const noHeadshot = new Set<string>()

const initialsOf = (name: string) => {
  const parts = name.replace(/\s+(Jr|Sr|II|III|IV|V)\.?$/i, '').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function PlayerAvatar({ id, name, size = 22 }: { id: string; name: string; size?: number }) {
  const [failed, setFailed] = useState<string | null>(() => (noHeadshot.has(id) ? id : null))
  const broken = failed === id || noHeadshot.has(id)
  return (
    <span className="pav" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden>
      {initialsOf(name)}
      {!broken && (
        <img
          src={headshotUrl(id)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => {
            noHeadshot.add(id)
            setFailed(id)
          }}
        />
      )}
    </span>
  )
}

/** "Hamilton Family FF" -> "HF"; a trailing number wins the second slot ("Tyler League 3" -> "T3",
 *  "Team #4" -> "T4"), so hidden names still read as distinct. */
export function teamInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean)
  const numeric = words.slice(1).find(w => /^\d+$/.test(w))
  return ((words[0]?.[0] ?? '?') + (numeric ?? words[1]?.[0] ?? '')).toUpperCase()
}

/** A team or league picture over its initials square. `src` is null when Sleeper has none or names
 *  are hidden: a manager's photo identifies them as well as their name does. */
export function TeamAvatar({ src, name, size = 30 }: { src: string | null | undefined; name: string; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <span className="initials tav" style={size === 30 ? undefined : { width: size, height: size, fontSize: Math.round(size * 0.37) }} aria-hidden>
      {teamInitials(name)}
      {src && failed !== src && <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(src)} />}
    </span>
  )
}

export type MoveAction = { label: string; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string }

/** Where the Next-move bar renders: App owns the element (under the header), views fill it. */
export const NextMoveHost = createContext<HTMLElement | null>(null)

/**
 * The "what should I do" bar under the header. Each view renders one from its own live state;
 * it portals into the shell so it sits outside the page's padding and spans the full width.
 */
export function NextMove({ head, sub, actions = [] }: { head: React.ReactNode; sub?: React.ReactNode; actions?: MoveAction[] }) {
  const host = useContext(NextMoveHost)
  if (!host) return null
  return createPortal(
    <div className="nextmove">
      <div className="nm-inner">
        <span className="nm-dot" />
        {/* Text wraps inside its own box so the buttons stay on the right as the window narrows. */}
        <span className="nm-text">
          <span className="head">{head}</span>
          {sub && <span className="sub">{sub}</span>}
        </span>
        {actions.length > 0 && (
          <span className="nm-actions">
            {actions.map(a => (
              <button key={a.label} className={a.primary ? 'nm-btn primary' : 'nm-btn'} onClick={a.onClick} disabled={a.disabled} title={a.title}>
                {a.label}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>,
    host,
  )
}

/** The app mark. The dark tile follows prefers-color-scheme, which Settings.theme drives through
 *  Electron's nativeTheme, so it switches with the rest of the palette. */
export function Logo() {
  return (
    <picture className="logo">
      <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
      <img src={logoLight} alt="Monte" draggable={false} />
    </picture>
  )
}
