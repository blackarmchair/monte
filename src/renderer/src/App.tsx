// The desktop shell (hybrid 2b): a 248px sidebar with the wordmark, the league switcher, the five
// sections and Settings; a 72px top bar with the page title and a search that filters Players
// live; the page; a centred league modal and the toast. Player, Team and Settings push over a section.
import { useEffect, useState } from 'react'
import type { LeagueSummary, Settings } from '@shared/types'
import Onboarding from './Onboarding'
import { AppProvider, useApp, type Section } from './store'
import { TradeProvider, useTrade } from './tradeModel'
import { Check, ErrorBox, GradCard, Icon, LeagueAvatar, Loading, Stack2, type IconName } from './ui'
import League from './League'
import Lineup from './Lineup'
import Trade from './Trade'
import Players from './Players'
import Picks from './Picks'
import Player from './Player'
import Team from './Team'
import { teamLabel } from './names'
import SettingsPage from './Settings'

const SECTIONS: Array<{ id: Section; label: string; icon: IconName }> = [
  { id: 'league', label: 'League', icon: 'league' },
  { id: 'lineup', label: 'Lineup', icon: 'lineup' },
  { id: 'trade', label: 'Trade', icon: 'trade' },
  { id: 'players', label: 'Players', icon: 'players' },
  { id: 'picks', label: 'Picks', icon: 'picks' },
]

export function formatLabel(l: LeagueSummary): string {
  const parts = [`${l.total_rosters}-team`, l.superflex ? 'SF' : '1QB']
  if (l.tePremium > 0) parts.push(`${l.tePremium} TEP`)
  return parts.join(' · ')
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => void window.monte.getSettings().then(setSettings), [])
  if (!settings) return null
  if (!settings.userId)
    return (
      <Onboarding
        onDone={async user => setSettings(await window.monte.setSettings({ username: user.display_name, userId: user.user_id, displayName: user.display_name }))}
      />
    )
  return (
    <AppProvider settings={settings} setSettingsState={setSettings}>
      <TradeProvider>
        <Shell />
      </TradeProvider>
    </AppProvider>
  )
}

function Shell() {
  const app = useApp()
  const { count } = useTrade()
  const { leagues, selected, context, contextError, loadContext, section, page, go, playersUi, setPlayersUi, toast, hideToast } = app
  const [leaguesOpen, setLeaguesOpen] = useState(false)
  const league = leagues.find(l => l.league_id === selected)
  const me = context?.rosters.find(r => r.roster_id === context.myRosterId)
  const kicker = [context && context.week > 0 ? `wk ${context.week}` : null, me ? `${me.wins}-${me.losses}` : null, league ? formatLabel(league) : null]
    .filter(Boolean)
    .join(' · ')
  const title = page
    ? page.kind === 'player'
      ? page.name
      : page.kind === 'team'
      ? app.hide
        ? teamLabel(page.rid)
        : page.name
      : 'Settings'
    : SECTIONS.find(s => s.id === section)!.label

  let body: React.ReactNode
  if (page?.kind === 'settings') body = <SettingsPage />
  else if (contextError) body = <ErrorBox message={`Could not load league: ${contextError}`} onRetry={loadContext} />
  else if (!context) body = <Loading label={selected ? 'Loading league…' : 'Loading your leagues…'} />
  else if (page?.kind === 'player') body = <Player key={page.id} id={page.id} fallbackName={page.name} />
  else if (page?.kind === 'team') body = <Team key={page.rid} rid={page.rid} />
  else
    body = {
      league: <League key={context.league.league_id} />,
      lineup: <Lineup key={context.league.league_id} />,
      trade: <Trade key={context.league.league_id} />,
      players: <Players key={context.league.league_id} />,
      picks: <Picks key={context.league.league_id} />,
    }[section]

  return (
    <div className="app">
      <aside className="side">
        <div className="wordmark">Monte</div>
        <button className="lg-switch" onClick={() => setLeaguesOpen(true)} title="Switch league">
          <span className="stack" style={{ flex: 1, minWidth: 0 }}>
            <span className="trunc" style={{ fontWeight: 700, fontSize: 14 }}>
              {league?.name ?? 'Choose a league'}
            </span>
            <span className="trunc" style={{ fontSize: 12, color: 'var(--ink2)' }}>
              {kicker}
            </span>
          </span>
          <Icon name="chevronDown" size={14} stroke={2.4} style={{ color: 'var(--mute)' }} />
        </button>
        {SECTIONS.map(s => (
          <button key={s.id} className={`nav-item${!page && section === s.id ? ' on' : ''}`} onClick={() => go(s.id)}>
            <Icon name={s.icon} />
            <span style={{ flex: 1 }}>{s.label}</span>
            {s.id === 'trade' && count > 0 && <span className="nav-badge">{count}</span>}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className={`nav-item${page?.kind === 'settings' ? ' on' : ''}`} onClick={app.openSettings} style={{ color: 'var(--ink2)' }}>
          <Icon name="gear" stroke={1.7} />
          <span>Settings</span>
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          {page && (
            <button onClick={app.back} aria-label="Back" style={{ width: 40, height: 40, borderRadius: 20, background: 'var(--surf)', display: 'grid', placeItems: 'center' }}>
              <Icon name="back" stroke={2} />
            </button>
          )}
          <h1 className="trunc">{title}</h1>
          <label className="search-pill">
            <Icon name="search" size={18} stroke={2} style={{ color: 'var(--mute)' }} />
            <input
              placeholder="Search players"
              value={playersUi.q}
              onChange={e => {
                const q = e.target.value
                setPlayersUi(u => ({ ...u, q }))
                if (page || section !== 'players') go('players')
              }}
            />
          </label>
        </header>
        <div className="scroll" ref={app.scrollRef}>
          {body}
        </div>
      </main>

      {leaguesOpen && <LeaguesModal onClose={() => setLeaguesOpen(false)} />}
      {toast && (
        <div className="toast" role="status">
          <span className="msg">{toast.msg}</span>
          {toast.action && (
            <button
              className="btn sm primary"
              onClick={() => {
                const a = toast.action!
                hideToast()
                a.onClick()
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function LeaguesModal({ onClose }: { onClose: () => void }) {
  const { leagues, selected, selectLeague, leagueError, loadLeagues } = useApp()
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Leagues">
        <div className="modal-title" style={{ paddingBottom: 4 }}>
          Leagues
        </div>
        {leagueError && <ErrorBox message={leagueError} onRetry={loadLeagues} />}
        {leagues.map(l => (
          <GradCard
            key={l.league_id}
            color={null}
            minHeight={60}
            onClick={() => {
              selectLeague(l.league_id)
              onClose()
            }}
          >
            <LeagueAvatar name={l.name} src={l.avatar} />
            <Stack2 title={l.name} sub={formatLabel(l)} />
            <Check on={l.league_id === selected} off="transparent" size={28} />
          </GradCard>
        ))}
      </div>
    </div>
  )
}
