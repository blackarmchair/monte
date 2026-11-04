// Settings (sidebar): the rankings file, theme, Hide names, simulations, trade values, injury
// overrides (set on a player's Injury tab, listed and cleared here), the Sleeper account, and the
// app version with its update check.
import { injurySeason, isCurrentInjury, isExpiredInjury } from '@shared/injuries'
import TrackRecord from './TrackRecord'
import { useState } from 'react'
import type { Theme } from '@shared/types'
import { useApp } from './store'
import { SleeperConnect } from './SleeperSend'
import { UpdateRow } from './Update'
import { Btn, Link, Seg, Toggle } from './ui'

const daysOld = (iso: string) => (Date.now() - Date.parse(iso)) / 86400000
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const line: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderRadius: 18, background: 'var(--surf)' }
const block: React.CSSProperties = { padding: 18, borderRadius: 18, background: 'var(--surf)', display: 'flex', flexDirection: 'column', gap: 8 }

export default function Settings() {
  const { settings, setSettings, settingsSaved, sheet, sheetError, chooseSheet, setSheetLink, resync, hide, switchUser, context, openPlayer } = useApp()
  const [link, setLink] = useState(settings.sheetLink ?? '')
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const saveLink = async (value: string | null) => {
    setLinkBusy(true)
    setLinkError(null)
    const error = await setSheetLink(value)
    setLinkBusy(false)
    setLinkError(error)
    if (!error && !value) setLink('')
  }
  const [connecting, setConnecting] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const injuries = settings.injuries ?? []
  const week = context?.week ?? 0
  const season = context?.league.season
  const expired = injuries.filter(i => isExpiredInjury(i, season, week))
  const sorted = [...injuries].sort((a, b) => (a.returnWeek ?? 99) - (b.returnWeek ?? 99) || a.name.localeCompare(b.name))
  const doImport = async () => {
    const r = await window.monte.bundledInjuries()
    if (!r.ok) return setMsg(r.error)
    const have = new Set(injuries.map(i => i.id))
    const fresh = r.value.filter(i => !have.has(i.id))
    await setSettings({ injuries: [...injuries, ...fresh] })
    setMsg(`Imported ${fresh.length} of ${r.value.length}.`)
  }

  return (
    <div className="page stack" style={{ maxWidth: 640, gap: 10 }}>
      <div style={{ ...block, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <span className="stack" style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <span className="small mute">Rankings sheet</span>
          {sheet ? (
            <>
              <span className="trunc" style={{ fontWeight: 700, fontSize: 16 }} title={hide ? undefined : sheet.path}>
                {hide ? 'Your rankings sheet' : sheet.name}
              </span>
              <span className="sub" style={{ fontSize: 14 }}>
                Synced {clock(sheet.syncedAt)}. Monte watches the file and reloads when you download a newer copy.
              </span>
              {daysOld(sheet.modifiedAt) > 7 && (
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--warn)' }}>Downloaded {Math.floor(daysOld(sheet.modifiedAt))} days ago. Re-download for this week's ranks.</span>
              )}
            </>
          ) : (
            <span className="sub" style={{ fontSize: 14 }}>
              None yet. In Google Sheets: File → Download → Microsoft Excel, then choose the file.
            </span>
          )}
          {sheetError && <span style={{ fontSize: 14, color: 'var(--neg)' }}>{sheetError}</span>}
        </span>
        <span className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
          <Btn size="sm" kind={sheet ? 'secondary' : 'primary'} label={sheet ? 'Choose another' : 'Choose the .xlsx'} onClick={chooseSheet} />
          {sheet && <Link label="Resync" onClick={resync} />}
        </span>
      </div>

      <div style={line}>
        <span style={{ flex: 1, fontWeight: 600 }}>Theme</span>
        <Seg<Theme>
          onSurf
          value={settings.theme ?? 'dark'}
          onChange={theme => void setSettings({ theme })}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'Auto' },
          ]}
        />
      </div>
      <button style={{ ...line, padding: '14px 18px', width: '100%' }} onClick={() => void setSettings({ hideNames: !hide })} role="switch" aria-checked={hide}>
        <span className="stack" style={{ flex: 1 }}>
          <span style={{ fontWeight: 600 }}>Hide names</span>
          <span className="small mute">Teams show as Team #n, leagues as League #n</span>
        </span>
        <Toggle on={hide} />
      </button>
      <div style={line}>
        <span className="stack" style={{ flex: 1 }}>
          <span style={{ fontWeight: 600 }}>Simulations</span>
          <span className="small mute">More is smoother and slower</span>
        </span>
        <Seg<number>
          onSurf
          value={settings.sims}
          onChange={sims => void setSettings({ sims })}
          options={[
            { value: 1000, label: '1k' },
            { value: 3000, label: '3k' },
            { value: 10000, label: '10k' },
          ]}
        />
      </div>
      <div style={line}>
        <span className="stack" style={{ flex: 1 }}>
          <span style={{ fontWeight: 600 }}>Trade values</span>
          <span className="small mute">Your side: the sheet as-is, or at the market's level per position</span>
        </span>
        <Seg<'relative' | 'raw'>
          onSurf
          value={settings.tradeDelta ?? 'raw'}
          onChange={tradeDelta => void setSettings({ tradeDelta })}
          options={[
            { value: 'raw', label: 'Sheet' },
            { value: 'relative', label: 'Within position' },
          ]}
        />
      </div>
      <div style={line}>
        <span className="stack" style={{ flex: 1 }}>
          <span style={{ fontWeight: 600 }}>Rank board</span>
          <span className="small mute">Which of the sheet's boards the ranks on Players and player pages use</span>
        </span>
        <Seg<'league' | 'tep' | 'plain'>
          onSurf
          value={settings.rankBoard ?? 'league'}
          onChange={rankBoard => void setSettings({ rankBoard })}
          options={[
            { value: 'league', label: 'Match league' },
            { value: 'tep', label: 'TE premium' },
            { value: 'plain', label: 'No TE premium' },
          ]}
        />
      </div>

      <div style={block}>
        <span className="small mute">Injury overrides</span>
        {sorted.length === 0 ? (
          <span className="sub" style={{ fontSize: 14 }}>
            None. Monte is using Sleeper's tags and ESPN's return estimates. Set one from a player's Injury tab.
          </span>
        ) : (
          sorted.map(i => (
            <div key={i.id} className="row" style={{ gap: 10, minHeight: 48, padding: '0 14px', borderRadius: 14, background: 'var(--surf2)' }}>
              <button className="stack" style={{ flex: 1, minWidth: 0, padding: '6px 0' }} onClick={() => openPlayer(i.id, i.name)}>
                <span className="trunc" style={{ fontWeight: 600 }}>
                  {i.name} <span className="small mute">{i.pos} · {i.team}</span>
                </span>
                <span className="small" style={{ color: expired.includes(i) ? 'var(--mute)' : 'var(--warn)' }}>
                  {i.returnWeek == null ? 'Out for the season' : `Out until week ${i.returnWeek}`}
                  {!isCurrentInjury(i, season) && ` (${injurySeason(i)})`}
                </span>
              </button>
              <Link label="Remove" onClick={() => void setSettings({ injuries: injuries.filter(x => x.id !== i.id) })} />
            </div>
          ))
        )}
        <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
          {expired.length > 0 && <Link label={`Clear ${expired.length} expired`} onClick={() => void setSettings({ injuries: injuries.filter(i => !expired.includes(i)) })} />}
          {sorted.length === 0 && <Link label="Import from sleeperStandings config" onClick={doImport} />}
        </div>
        {msg && <span className="small mute">{msg}</span>}
      </div>

      <div style={block}>
        <span className="small mute">Keep the sheet current</span>
        <span className="sub" style={{ fontSize: 14 }}>
          {settings.sheetLink
            ? 'Monte checks your linked Google Sheet every 6 hours and updates when its data changes.'
            : 'Paste the Google Sheets link and Monte keeps the sheet current for you. The link must be viewable by anyone who has it.'}
        </span>
        <label className="field on-surf">
          <input placeholder="https://docs.google.com/spreadsheets/d/…" value={link} onChange={e => setLink(e.target.value)} />
        </label>
        {linkError && <span style={{ fontSize: 14, color: 'var(--neg)' }}>{linkError}</span>}
        <div className="row" style={{ gap: 8 }}>
          <Btn size="sm" label={linkBusy ? 'Checking…' : 'Use this link'} disabled={linkBusy || !link.trim()} onClick={() => void saveLink(link.trim())} />
          {settings.sheetLink && <Btn size="sm" label="Stop using the link" disabled={linkBusy} onClick={() => void saveLink(null)} />}
        </div>
      </div>

      <TrackRecord style={block} />

      <div style={block}>
        <span className="small mute">Sleeper connection</span>
        {settings.sleeperLink ? (
          <>
            <span className="sub" style={{ fontSize: 14 }}>
              Connected{settings.sleeperLink.name && !hide ? ` as ${settings.sleeperLink.name}` : ''}. Monte can send trade offers and set your lineup in Sleeper.
              {settings.sleeperLink.expiresAt ? ` The session ends ${new Date(settings.sleeperLink.expiresAt).toLocaleDateString()}.` : ''}
            </span>
            <span className="sub" style={{ fontSize: 14 }}>
              {settings.notifyOffers === false ? 'New-offer notifications are off.' : 'Monte notifies you of new trade offers in any league while it is running, checking every 5 minutes.'}
              {settings.keepRunning ? ' Closing the window keeps it running in the tray; quit from the tray icon.' : ''}
            </span>
            <div className="row" style={{ gap: 8 }}>
              <Btn size="sm" label="Disconnect" onClick={async () => settingsSaved(await window.monte.disconnectSleeper())} />
              <Btn size="sm" label={settings.notifyOffers === false ? 'Turn on notifications' : 'Turn off notifications'} onClick={() => void setSettings({ notifyOffers: settings.notifyOffers === false })} />
              <Btn size="sm" label={settings.keepRunning ? 'Quit when the window closes' : 'Keep running in the tray'} onClick={() => void setSettings({ keepRunning: !settings.keepRunning })} />
            </div>
          </>
        ) : connecting ? (
          <SleeperConnect
            onDone={s => {
              settingsSaved(s)
              setConnecting(false)
            }}
          />
        ) : (
          <>
            <span className="sub" style={{ fontSize: 14 }}>
              Not connected. Connect Sleeper to send trade offers and set lineups straight from Monte.
            </span>
            <div>
              <Btn size="sm" label="Connect Sleeper" onClick={() => setConnecting(true)} />
            </div>
          </>
        )}
      </div>

      <div style={{ ...line, padding: '14px 18px' }}>
        <span className="stack" style={{ flex: 1 }}>
          <span className="small mute">Sleeper account</span>
          <span style={{ fontWeight: 700 }}>{hide ? 'You' : settings.displayName}</span>
        </span>
        <Btn size="sm" label="Switch user" onClick={switchUser} />
      </div>
      <UpdateRow />
    </div>
  )
}
