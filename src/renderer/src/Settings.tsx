// Settings (sidebar): the rankings file, theme, Hide names, simulations, trade values, injury
// overrides (set on a player's Injury tab, listed and cleared here), and the Sleeper account.
import { useState } from 'react'
import type { Theme } from '@shared/types'
import { useApp } from './store'
import { SleeperConnect } from './SleeperSend'
import { Btn, Link, Seg, Toggle } from './ui'

const daysOld = (iso: string) => (Date.now() - Date.parse(iso)) / 86400000
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const line: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderRadius: 18, background: 'var(--surf)' }
const block: React.CSSProperties = { padding: 18, borderRadius: 18, background: 'var(--surf)', display: 'flex', flexDirection: 'column', gap: 8 }

export default function Settings() {
  const { settings, setSettings, settingsSaved, sheet, sheetError, chooseSheet, resync, hide, switchUser, context, openPlayer } = useApp()
  const [connecting, setConnecting] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const injuries = settings.injuries ?? []
  const week = context?.week ?? 0
  const expired = injuries.filter(i => i.returnWeek != null && i.returnWeek <= week)
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
              <span className="trunc" style={{ fontWeight: 700, fontSize: 16 }} title={sheet.path}>
                {sheet.name}
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
            { value: 'raw', label: 'Tyler’s sheet' },
            { value: 'relative', label: 'Within position' },
          ]}
        />
      </div>
      <div style={line}>
        <span className="stack" style={{ flex: 1 }}>
          <span style={{ fontWeight: 600 }}>Rank board</span>
          <span className="small mute">Which of Tyler's boards the ranks on Players and player pages use</span>
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
        <span className="small mute">Sleeper connection</span>
        {settings.sleeperLink ? (
          <>
            <span className="sub" style={{ fontSize: 14 }}>
              Connected{settings.sleeperLink.name && !hide ? ` as ${settings.sleeperLink.name}` : ''}. Monte can send trade offers and set your lineup in Sleeper.
              {settings.sleeperLink.expiresAt ? ` The session ends ${new Date(settings.sleeperLink.expiresAt).toLocaleDateString()}.` : ''}
            </span>
            <div>
              <Btn size="sm" label="Disconnect" onClick={async () => settingsSaved(await window.monte.disconnectSleeper())} />
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
    </div>
  )
}
