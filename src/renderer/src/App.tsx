import { useCallback, useEffect, useRef, useState } from 'react'
import type { BBResult, LeagueContext, LeagueSummary, PickOddsOpts, PWOPRResult, RanksFileInfo, Settings, Theme } from '@shared/types'
import Onboarding from './Onboarding'
import OverviewView from './OverviewView'
import PicksView from './PicksView'
import PwoprView from './PwoprView'
import StartSitView from './StartSitView'
import DraftView from './DraftView'
import RanksView from './RanksView'
import TradesView, { EMPTY_TRADE, type TradeState, type TradeUi } from './TradesView'
import { anonBB, anonContext, leagueLabel } from './names'
import InjuriesPanel from './InjuriesPanel'
import type { ManualInjury } from '@shared/types'
import { InlineError, Logo, NextMoveHost, TeamAvatar } from './ui'

type Tab = 'overview' | 'picks' | 'pwopr' | 'trades' | 'startsit' | 'draft' | 'ranks'
const TABS: Array<{ id: Tab; label: string; ready: boolean }> = [
  { id: 'overview', label: 'Overview', ready: true },
  { id: 'picks', label: 'Pick Odds', ready: true },
  { id: 'pwopr', label: 'PWOPR', ready: true },
  { id: 'trades', label: 'Trades', ready: true },
  { id: 'startsit', label: 'Start/Sit', ready: true },
  { id: 'draft', label: 'Draft', ready: true },
  { id: 'ranks', label: 'Ranks', ready: true },
]

export type { Run } from '@shared/types'
import type { Run } from '@shared/types'
type Runs<T> = Record<string, Run<T>>

export function formatLabel(l: LeagueSummary): string {
  const parts = [`${l.total_rosters}-team`, l.superflex ? 'SF' : '1QB']
  if (l.tePremium > 0) parts.push(`${l.tePremium} TEP`)
  return parts.join(' · ')
}

/** At or below this window width the sidebar collapses to the 68px rail, which leaves every
 *  screen's two- and three-column layouts room to sit side by side down to the 1100px minimum. */
const RAIL_BREAKPOINT = 1366

const daysOld = (iso: string) => (Date.now() - Date.parse(iso)) / 86400000
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** The sheet status popover: what the collapsed sidebar button opens. Replaces the old
 *  Rankings Sheet and Injury Overrides cards. */
function SyncPopover(props: {
  info: RanksFileInfo | null
  error: string | null
  injuries: number
  user: string
  left: number
  onChoose: () => void
  onResync: () => void
  onInjuries: () => void
  onSwitchUser: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!ref.current?.contains(t) && !t.closest('.sync-btn')) props.onClose()
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const { info } = props
  return (
    <div className="sync-pop" ref={ref} style={{ left: props.left }}>
      <div className="eyebrow">Rankings sheet</div>
      {info ? (
        <>
          <div className="file">{info.name}</div>
          <div className="sub">Dynasty + weekly ranks · synced {clock(info.syncedAt)}</div>
          {daysOld(info.modifiedAt) > 7 && (
            <div className="warn">Downloaded {Math.floor(daysOld(info.modifiedAt))} days ago. Re-download for this week's ranks.</div>
          )}
        </>
      ) : (
        <div className="sub">None yet. In Google Sheets: File → Download → Microsoft Excel, then choose the file here.</div>
      )}
      {props.error && <div className="warn">{props.error}</div>}
      <div className="sub">
        {props.injuries === 0
          ? 'No injury overrides. Using Sleeper tags and ESPN estimates.'
          : `${props.injuries} injury override${props.injuries === 1 ? '' : 's'}`}
      </div>
      <div className="actions">
        {info && (
          <button className="btn-sm" onClick={props.onResync}>
            Resync
          </button>
        )}
        <button className="btn-sm" onClick={props.onChoose}>
          {info ? 'Change' : 'Choose file'}
        </button>
        <button className="btn-sm" onClick={props.onInjuries}>
          {props.injuries ? 'Edit overrides' : 'Add override'}
        </button>
      </div>
      <div className="user-row">
        <span>{props.user}</span>
        <button className="link" onClick={props.onSwitchUser}>
          Switch user
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [leagues, setLeagues] = useState<LeagueSummary[]>([])
  const [leagueError, setLeagueError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [context, setContext] = useState<LeagueContext | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [bb, setBB] = useState<Runs<BBResult>>({})
  const [pw, setPW] = useState<Runs<PWOPRResult>>({})
  const [sheet, setSheet] = useState<RanksFileInfo | null>(null)
  const [sheetError, setSheetError] = useState<string | null>(null)
  const [trade, setTrade] = useState<TradeState>(EMPTY_TRADE)
  const [tradeUi, setTradeUi] = useState<TradeUi>({ right: 'deals', pos: 'All' })
  const [ovSel, setOvSel] = useState<number | null>(null)
  const [injOpen, setInjOpen] = useState(false)
  // Collapsed rail on narrow windows. Resizing across the breakpoint re-applies it; the user's
  // toggle wins until the next crossing.
  const [sideOpen, setSideOpen] = useState(() => window.innerWidth > RAIL_BREAKPOINT)
  useEffect(() => {
    let wide = window.innerWidth > RAIL_BREAKPOINT
    const onResize = () => {
      const now = window.innerWidth > RAIL_BREAKPOINT
      if (now !== wide) setSideOpen(now)
      wide = now
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const [syncOpen, setSyncOpen] = useState(false)
  const [nmHost, setNmHost] = useState<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  /** latest pick-odds request per league: a slow run must not overwrite a newer one */
  const bbSeq = useRef<Record<string, number>>({})

  useEffect(() => {
    void window.monte.getSettings().then(setSettings)
    void window.monte.ranksFileInfo().then(r => (r.ok ? setSheet(r.value) : setSheetError(r.error)))
    return window.monte.onRanksFileChanged(info => {
      setSheet(info)
      setSheetError(info ? null : 'The file moved or could not be read.')
    })
  }, [])

  const loadLeagues = useCallback(() => {
    if (!settings?.userId) return
    setLeagueError(null)
    void window.monte.listLeagues(settings.userId).then(r => {
      if (!r.ok) return setLeagueError(r.error)
      setLeagues(r.value)
      const keep = r.value.find(l => l.league_id === settings.lastLeagueId)
      setSelected(s => s ?? (keep ?? r.value[0])?.league_id ?? null)
    })
  }, [settings?.userId])
  useEffect(loadLeagues, [loadLeagues])

  const loadContext = useCallback(() => {
    if (!selected || !settings?.userId) return
    setContext(null)
    setContextError(null)
    setTrade(EMPTY_TRADE)
    setOvSel(null)
    void window.monte.leagueContext(selected, settings.userId).then(r => {
      if (r.ok) setContext(r.value)
      else setContextError(r.error)
    })
  }, [selected, settings?.userId])
  useEffect(() => {
    if (selected) void window.monte.setSettings({ lastLeagueId: selected })
    loadContext()
  }, [loadContext, selected])

  const runBB = useCallback(async (leagueId: string, opts: PickOddsOpts) => {
    const seq = (bbSeq.current[leagueId] ?? 0) + 1
    bbSeq.current[leagueId] = seq
    setBB(m => ({ ...m, [leagueId]: { ...m[leagueId], busy: true, error: undefined } }))
    const r = await window.monte.runPickOdds(leagueId, opts)
    if (bbSeq.current[leagueId] !== seq) return
    // A run with no what-if results is the baseline that what-if runs are compared against.
    const baseline = r.ok && !Object.values(opts.forced ?? {}).some(w => w.length)
    setBB(m => ({
      ...m,
      [leagueId]: r.ok ? { result: r.value, base: baseline ? r.value : m[leagueId]?.base } : { ...m[leagueId], busy: false, error: r.error },
    }))
  }, [])
  const runPW = useCallback(async (leagueId: string) => {
    setPW(m => ({ ...m, [leagueId]: { ...m[leagueId], busy: true, error: undefined } }))
    const r = await window.monte.runPwopr(leagueId)
    setPW(m => ({ ...m, [leagueId]: r.ok ? { result: r.value } : { ...m[leagueId], busy: false, error: r.error } }))
  }, [])

  if (!settings) return null
  if (!settings.userId)
    return (
      <Onboarding
        onDone={async user =>
          setSettings(await window.monte.setSettings({ username: user.display_name, userId: user.user_id, displayName: user.display_name }))
        }
      />
    )

  const switchUser = async () => {
    setSyncOpen(false)
    setLeagues([])
    setSelected(null)
    setContext(null)
    setBB({})
    setPW({})
    setSettings(await window.monte.setSettings({ userId: undefined, username: undefined, displayName: undefined }))
  }

  const chooseSheet = async () => {
    const r = await window.monte.chooseRanksFile()
    if (!r.ok) return setSheetError(r.error)
    if (r.value) {
      setSheet(r.value)
      setSheetError(null)
    }
  }
  const resync = async () => {
    const r = await window.monte.ranksFileInfo()
    if (r.ok) {
      setSheet(r.value)
      setSheetError(null)
    } else setSheetError(r.error)
  }

  const hide = !!settings.hideNames
  // League names identify people too ("Hamilton Family…"), so Hide names covers them: numbered
  // by their order in the user's Sleeper list, which keeps the numbers stable.
  const shownLeagues = hide ? leagues.map((l, i) => ({ ...l, name: leagueLabel(i), avatar: null })) : leagues
  const league = shownLeagues.find(l => l.league_id === selected)
  const injuries = settings.injuries ?? []
  // Overrides change who can play, so every cached sim/board is stale; Start/Sit reloads too.
  const saveInjuries = async (next: ManualInjury[]) => {
    setSettings(await window.monte.setSettings({ injuries: next }))
    setBB({})
    setPW({})
  }
  const injSig = injuries.map(i => `${i.id}:${i.returnWeek ?? 'S'}`).join(',')
  // Every view reads names from here, so hiding them is one switch rather than one per screen.
  const ctx = context && hide ? anonContext(context) : context
  const bbFor = (k: string): Run<BBResult> => {
    const r = bb[k] ?? {}
    return hide ? { ...anonBB(r), base: r.base && anonBB({ result: r.base }).result } : r
  }
  // Overview and Trades price picks off the real odds, not whatever what-if Pick Odds last ran.
  const bbBaseFor = (k: string) => {
    const r = bbFor(k)
    return r.base ? { ...r, result: r.base } : r
  }
  const sheetVersion = sheet ? `${sheet.path}|${sheet.modifiedAt}|${sheet.syncedAt}` : undefined

  const go = (t: Tab) => {
    setTab(t)
    setSyncOpen(false)
    bodyRef.current?.scrollTo(0, 0)
  }
  // Click-throughs into Trades from Overview, Pick Odds and PWOPR. Your asset goes to Give; anyone
  // else's goes to Get with their team as partner (a different partner replaces the Get list).
  const myRid = context?.myRosterId ?? null
  const sendToTrade = (assetId: string, owner: number) => {
    if (owner === myRid) setTrade(t => (t.give.includes(assetId) ? t : { ...t, give: [...t.give, assetId] }))
    else {
      setTrade(t =>
        t.partner !== owner ? { ...t, partner: owner, get: [assetId] } : t.get.includes(assetId) ? t : { ...t, get: [...t.get, assetId] },
      )
      setTradeUi(u => ({ ...u, right: 'roster' }))
    }
    go('trades')
  }
  /** Open Trades with the best suggested deal that brings back a `pos` loaded in the builder. */
  const findTargets = (pos: string) => {
    setTrade(EMPTY_TRADE)
    setTradeUi({ right: 'deals', pos, load: true })
    go('trades')
  }
  /** Open Trades with `assetId` (yours) as the give and the best deal for it loaded. */
  const shop = (assetId: string) => {
    setTrade({ give: [assetId], get: [], partner: null })
    setTradeUi({ right: 'deals', pos: 'All', load: true })
    go('trades')
  }
  const tradeWith = (owner: number) => {
    setTrade(t => ({ ...t, partner: owner, get: t.partner === owner ? t.get : [] }))
    setTradeUi(u => ({ ...u, right: 'roster' }))
    go('trades')
  }
  const viewTeam = (rid: number) => {
    setOvSel(rid)
    go('overview')
  }
  const me = context?.rosters.find(r => r.roster_id === context.myRosterId)
  const id = context?.league.league_id
  const sheetTone = sheetError || !sheet ? 'neg' : daysOld(sheet.modifiedAt) > 7 ? 'warn' : 'pos'
  const themeOpts: Array<{ value: Theme; label: string }> = [
    { value: 'light', label: sideOpen ? 'Light' : 'L' },
    { value: 'dark', label: sideOpen ? 'Dark' : 'D' },
    { value: 'system', label: sideOpen ? 'Auto' : 'A' },
  ]

  return (
    <div className="app">
      <aside className={`sidebar ${sideOpen ? '' : 'collapsed'}`}>
        <div className="brand">
          <Logo />
          {sideOpen && (
            <div style={{ minWidth: 0 }}>
              <div className="wordmark">Monte</div>
              <small>dynasty desk</small>
            </div>
          )}
        </div>
        <div className="league-list">
          {sideOpen && <div className="eyebrow section">Leagues</div>}
          {leagueError && sideOpen && <InlineError message={leagueError} onRetry={loadLeagues} />}
          {shownLeagues.map(l => (
            <button
              key={l.league_id}
              className={`league-item ${l.league_id === selected ? 'active' : ''}`}
              onClick={() => setSelected(l.league_id)}
              title={l.name}
            >
              <TeamAvatar src={l.avatar} name={l.name} />
              {sideOpen && (
                <div style={{ minWidth: 0 }}>
                  <div className="name">{l.name}</div>
                  <div className="meta">{formatLabel(l)}</div>
                </div>
              )}
            </button>
          ))}
        </div>
        <div className="sidebar-foot">
          <button className="sync-btn" onClick={() => setSyncOpen(o => !o)} title={sheet ? `Rankings sheet: ${sheet.name}` : 'Rankings sheet'}>
            <span className={`sync-dot ${sheetTone}`} />
            {sideOpen && (
              <span className="sync-text">
                <span className="file">{sheet?.name ?? 'No rankings sheet'}</span>
                <span className="sub">
                  {sheet ? `synced ${clock(sheet.syncedAt)}` : 'choose a file'} ·{' '}
                  {injuries.length ? `${injuries.length} injury override${injuries.length === 1 ? '' : 's'}` : 'no injury overrides'}
                </span>
              </span>
            )}
          </button>
          <div className={`theme-seg ${sideOpen ? '' : 'stack'}`}>
            {themeOpts.map(o => (
              <button
                key={o.value}
                className={(settings.theme ?? 'light') === o.value ? 'on' : ''}
                title={o.value === 'system' ? 'Follow the system theme' : undefined}
                onClick={async () => setSettings(await window.monte.setSettings({ theme: o.value }))}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button className="collapse-btn" onClick={() => setSideOpen(o => !o)} title={sideOpen ? 'Collapse the sidebar' : 'Expand the sidebar'}>
            {sideOpen ? '« Collapse' : '»'}
          </button>
        </div>
      </aside>
      {syncOpen && (
        <SyncPopover
          info={sheet}
          error={sheetError}
          injuries={injuries.length}
          user={hide ? 'You' : settings.displayName ?? ''}
          left={(sideOpen ? 256 : 68) + 8}
          onChoose={chooseSheet}
          onResync={resync}
          onInjuries={() => {
            setSyncOpen(false)
            setInjOpen(true)
          }}
          onSwitchUser={switchUser}
          onClose={() => setSyncOpen(false)}
        />
      )}

      <main className="main">
        <header className="header">
          <div className="header-inner">
            <div className="title">
              <h1>{league?.name ?? 'No league selected'}</h1>
              {league && (
                <span className="meta">
                  {formatLabel(league)}
                  {context && context.week > 0 && ` · week ${context.week}`}
                  {me && ` · you’re ${me.wins}-${me.losses}`}
                </span>
              )}
            </div>
            <nav className="tabs">
              <button
                className={`names-toggle ${hide ? 'on' : ''}`}
                title={hide ? 'Show usernames, team and league names' : 'Hide usernames, team and league names (Team #1, League #1, …)'}
                onClick={async () => setSettings(await window.monte.setSettings({ hideNames: !hide }))}
              >
                {hide ? 'Show names' : 'Hide names'}
              </button>
              {TABS.map(t => (
                <button
                  key={t.id}
                  className={`tab ${tab === t.id ? 'active' : ''}`}
                  disabled={!t.ready}
                  title={t.ready ? undefined : 'Coming in a later phase'}
                  onClick={() => go(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        </header>
        <div className="body" ref={bodyRef}>
          <div className="nextmove-host" ref={setNmHost} />
          <div className="body-inner">
            <NextMoveHost.Provider value={nmHost}>
              {contextError && <InlineError message={`Could not load league: ${contextError}`} onRetry={loadContext} />}
              {!context && !contextError && selected && <div className="meta-line">Loading league…</div>}
              {context && id && tab === 'overview' && (
                <OverviewView
                  key={id}
                  context={ctx!}
                  bb={bbBaseFor(id)}
                  runBB={() => runBB(id, { sims: settings.sims, strengthCV: settings.strengthCV })}
                  sheetVersion={sheetVersion}
                  hideNames={hide}
                  selected={ovSel}
                  onSelect={setOvSel}
                  onAsset={sendToTrade}
                  onFindTargets={findTargets}
                  onTradeWith={tradeWith}
                  onPickOdds={() => go('picks')}
                />
              )}
              {context && id && tab === 'trades' && (
                <TradesView
                  key={id}
                  context={ctx!}
                  settings={settings}
                  bb={bbBaseFor(id)}
                  runBB={() => runBB(id, { sims: settings.sims, strengthCV: settings.strengthCV })}
                  trade={trade}
                  setTrade={setTrade}
                  ui={tradeUi}
                  setUi={setTradeUi}
                  onSettings={async patch => setSettings(await window.monte.setSettings(patch))}
                  sheetVersion={sheetVersion}
                  hideNames={hide}
                />
              )}
              {context && id && tab === 'picks' && (
                <PicksView
                  key={id}
                  context={ctx!}
                  settings={settings}
                  run={bbFor(id)}
                  onRun={opts => runBB(id, opts)}
                  onSettings={async patch => setSettings(await window.monte.setSettings(patch))}
                  onShop={shop}
                />
              )}
              {context && id && tab === 'startsit' && settings.userId && (
                <StartSitView key={id} context={ctx!} userId={settings.userId} sheetVersion={`${sheetVersion ?? ''}|${injSig}`} hideNames={hide} />
              )}
              {context && id && tab === 'ranks' && settings.userId && (
                <RanksView key={id} context={ctx!} userId={settings.userId} sheetVersion={sheetVersion} hideNames={hide} />
              )}
              {context && id && tab === 'draft' && settings.userId && (
                <DraftView key={id} context={ctx!} userId={settings.userId} sheetVersion={sheetVersion} hideNames={hide} />
              )}
              {context && id && tab === 'pwopr' && (
                <PwoprView
                  key={id}
                  context={ctx!}
                  run={pw[id] ?? {}}
                  onRun={() => runPW(id)}
                  onTarget={sendToTrade}
                  onLineup={() => go('startsit')}
                  onViewTeam={viewTeam}
                />
              )}
            </NextMoveHost.Provider>
          </div>
        </div>
      </main>
      {injOpen && <InjuriesPanel injuries={injuries} week={context?.week ?? 0} onChange={saveInjuries} onClose={() => setInjOpen(false)} />}
    </div>
  )
}
