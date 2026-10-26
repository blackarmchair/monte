// Settings (from the header gear): the rankings sheet, theme, Hide names, simulations, trade
// values, injury overrides (set on a player's Injury tab, listed and cleared here), and Sleeper.
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { Theme } from '@monte/core/types'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { Btn, Card, ErrorBox, Row, Seg, T, Toggle } from '@/ui/kit'
import { R, useTheme } from '@/ui/theme'
import SleeperConnect from './SleeperConnect'

const ago = (iso: string) => {
  const d = (Date.now() - Date.parse(iso)) / 86400000
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.floor(d)} days ago`
}

export default function Settings() {
  const t = useTheme()
  const { settings, setSettings, sheet, sheetError, sheetBusy, pickSheet, hide, switchUser, disconnectSleeper, context, openPlayer } = useApp()
  const [connecting, setConnecting] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  if (!settings) return null
  const injuries = settings.injuries ?? []
  const week = context?.week ?? 0
  const expired = injuries.filter(i => i.returnWeek != null && i.returnWeek <= week)
  const sorted = [...injuries].sort((a, b) => (a.returnWeek ?? 99) - (b.returnWeek ?? 99) || a.name.localeCompare(b.name))
  const stale = sheet?.pickedAt ? (Date.now() - Date.parse(sheet.pickedAt)) / 86400000 > 7 : false
  const line = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 18, backgroundColor: t.surf }
  const doImport = async () => {
    const r = await monte.bundledInjuries()
    if (!r.ok) return setMsg(r.error)
    const have = new Set(injuries.map(i => i.id))
    const fresh = r.value.filter(i => !have.has(i.id))
    await setSettings({ injuries: [...injuries, ...fresh] })
    setMsg(`Imported ${fresh.length} of ${r.value.length}.`)
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 28, gap: 10 }}>
      <Card radius={18} gap={6}>
        <T v="small" c="mute">
          Rankings sheet
        </T>
        {sheet ? (
          <>
            <T v="bold" size={16}>
              {sheet.name}
            </T>
            <T size={14} c="ink2">
              Picked {sheet.pickedAt ? ago(sheet.pickedAt) : '—'}. Pick it again whenever Tyler updates it.
            </T>
            {stale && (
              <T v="semi" size={14} c="warn">
                Over a week old. Re-download for this week's ranks.
              </T>
            )}
          </>
        ) : (
          <T size={14} c="ink2">
            None yet. In Google Sheets: File → Download → Microsoft Excel, save it to Files or Drive, then pick it here.
          </T>
        )}
        {sheetError && <ErrorBox message={sheetError} />}
        <Btn
          size="sm"
          label={sheetBusy ? 'Reading the sheet…' : sheet ? 'Pick a newer copy' : 'Pick the .xlsx'}
          kind={sheet ? 'secondary' : 'primary'}
          onPress={pickSheet}
          disabled={sheetBusy}
          style={{ marginTop: 4, minHeight: 40 }}
        />
      </Card>

      <View style={line}>
        <T v="semi" style={{ flex: 1 }}>
          Theme
        </T>
        <Seg<Theme>
          track={t.surf2}
          value={settings.theme ?? 'dark'}
          onChange={theme => setSettings({ theme })}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'Auto' },
          ]}
        />
      </View>
      <Pressable
        onPress={() => setSettings({ hideNames: !hide })}
        style={({ pressed }) => [line, { paddingVertical: 14, opacity: pressed ? 0.85 : 1 }]}
        accessibilityRole="switch"
        accessibilityState={{ checked: hide }}
      >
        <View style={{ flex: 1 }}>
          <T v="semi">Hide names</T>
          <T v="small" c="mute">
            Teams show as Team #n
          </T>
        </View>
        <Toggle on={hide} />
      </Pressable>
      <View style={line}>
        <View style={{ flex: 1 }}>
          <T v="semi">Simulations</T>
          <T v="small" c="mute">
            More is smoother, slower on phone
          </T>
        </View>
        <Seg<number>
          track={t.surf2}
          value={settings.sims}
          onChange={sims => setSettings({ sims })}
          options={[
            { value: 500, label: '500' },
            { value: 1000, label: '1k' },
            { value: 3000, label: '3k' },
          ]}
        />
      </View>
      <View style={line}>
        <View style={{ flex: 1 }}>
          <T v="semi">Trade values</T>
          <T v="small" c="mute">
            Your side: the sheet as-is, or at the market's level per position
          </T>
        </View>
        <Seg<'relative' | 'raw'>
          track={t.surf2}
          value={settings.tradeDelta ?? 'relative'}
          onChange={tradeDelta => setSettings({ tradeDelta })}
          options={[
            { value: 'relative', label: 'By pos' },
            { value: 'raw', label: 'Raw' },
          ]}
        />
      </View>

      <Card radius={18} gap={8}>
        <T v="small" c="mute">
          Injury overrides
        </T>
        {sorted.length === 0 ? (
          <T size={14} c="ink2">
            None. Monte is using Sleeper's tags and ESPN's return estimates. Set one from a player's Injury tab.
          </T>
        ) : (
          sorted.map(i => (
            <Row key={i.id} gap={10} style={{ minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: t.surf2 }}>
              <Pressable onPress={() => openPlayer(i.id, i.name)} style={{ flex: 1, minWidth: 0, paddingVertical: 8 }}>
                <T v="semi" lines={1}>
                  {i.name}{' '}
                  <T v="small" c="mute">
                    {i.pos} · {i.team}
                  </T>
                </T>
                <T v="small" c={expired.includes(i) ? 'mute' : 'warn'}>
                  {i.returnWeek == null ? 'Out for the season' : `Out until week ${i.returnWeek}`}
                </T>
              </Pressable>
              <Btn kind="link" label="Remove" onPress={() => void setSettings({ injuries: injuries.filter(x => x.id !== i.id) })} />
            </Row>
          ))
        )}
        <Row gap={14} wrap>
          {expired.length > 0 && <Btn kind="link" label={`Clear ${expired.length} expired`} onPress={() => void setSettings({ injuries: injuries.filter(i => !expired.includes(i)) })} />}
          {sorted.length === 0 && <Btn kind="link" label="Import from sleeperStandings config" onPress={doImport} />}
        </Row>
        {msg && (
          <T v="small" c="mute">
            {msg}
          </T>
        )}
      </Card>

      <Card radius={18} gap={8}>
        <T v="small" c="mute">
          Sleeper connection
        </T>
        {settings.sleeperLink ? (
          <>
            <T size={14} c="ink2">
              Connected{settings.sleeperLink.name && !hide ? ` as ${settings.sleeperLink.name}` : ''}. Monte can send trade offers and set your lineup in Sleeper.
              {settings.sleeperLink.expiresAt ? ` The session ends ${new Date(settings.sleeperLink.expiresAt).toLocaleDateString()}.` : ''}
            </T>
            <Btn size="sm" label="Disconnect" onPress={() => void disconnectSleeper()} style={{ minHeight: 40 }} />
          </>
        ) : connecting ? (
          <SleeperConnect onDone={() => setConnecting(false)} />
        ) : (
          <>
            <T size={14} c="ink2">
              Not connected. Connect Sleeper to send trade offers and set lineups straight from Monte.
            </T>
            <Btn size="sm" label="Connect Sleeper" onPress={() => setConnecting(true)} style={{ minHeight: 40 }} />
          </>
        )}
      </Card>

      <View style={[line, { paddingVertical: 14, borderRadius: R.card + 2 }]}>
        <View style={{ flex: 1 }}>
          <T v="small" c="mute">
            Sleeper account
          </T>
          <T v="bold">{hide ? 'You' : settings.displayName}</T>
        </View>
        <Btn size="sm" label="Switch user" onPress={switchUser} />
      </View>
    </ScrollView>
  )
}
