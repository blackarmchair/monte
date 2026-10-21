// Settings (from the header gear): the rankings sheet, injury overrides, theme, Hide names,
// simulations, trade values, and the Sleeper account.
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { Theme } from '@monte/core/types'
import { useApp } from '@/lib/store'
import { Icon } from '@/ui/icons'
import { Btn, Card, ErrorBox, Kicker, Seg, T, Toggle } from '@/ui/kit'
import { RADIUS, useTheme } from '@/ui/theme'
import SleeperConnect from './SleeperConnect'

const ago = (iso: string) => {
  const d = (Date.now() - Date.parse(iso)) / 86400000
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.floor(d)} days ago`
}

export default function Settings() {
  const t = useTheme()
  const { settings, setSettings, sheet, sheetError, sheetBusy, pickSheet, hide, switchUser, openOverrides, disconnectSleeper } = useApp()
  const [connecting, setConnecting] = useState(false)
  if (!settings) return null
  const injuries = settings.injuries ?? []
  const stale = sheet?.pickedAt ? (Date.now() - Date.parse(sheet.pickedAt)) / 86400000 > 7 : false
  const line = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, padding: 14, borderBottomWidth: 1, borderColor: t.line }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
      <Card style={{ gap: 8 }}>
        <Kicker>Rankings sheet</Kicker>
        {sheet ? (
          <>
            <T v="semi" size={16}>
              {sheet.name}
            </T>
            <T c="mute" size={14}>
              Picked {sheet.pickedAt ? ago(sheet.pickedAt) : '—'}. Pick it again whenever Tyler updates it.
            </T>
            {stale && (
              <T c="warn" size={14}>
                Over a week old. Re-download for this week's ranks.
              </T>
            )}
          </>
        ) : (
          <T c="ink2" size={14}>
            None yet. In Google Sheets: File → Download → Microsoft Excel, save it to Files or Drive, then pick it here.
          </T>
        )}
        {sheetError && <ErrorBox message={sheetError} />}
        <Btn label={sheetBusy ? 'Reading the sheet…' : sheet ? 'Pick a newer copy' : 'Pick the .xlsx'} kind={sheet ? 'outline' : 'primary'} onPress={pickSheet} disabled={sheetBusy} />
      </Card>

      <Pressable
        onPress={() => openOverrides()}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 14,
          borderWidth: 1,
          borderColor: t.line,
          borderRadius: RADIUS,
          backgroundColor: pressed ? t.card : t.card2,
        })}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Kicker>Injury overrides</Kicker>
          <T>{injuries.length ? `${injuries.length} active` : "None. Using Sleeper's tags and ESPN estimates."}</T>
        </View>
        <Icon name="chevronRight" color={t.mute} />
      </Pressable>

      <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: RADIUS, backgroundColor: t.card2 }}>
        <View style={line}>
          <T v="semi" style={{ flex: 1 }}>
            Theme
          </T>
          <Seg<Theme>
            value={settings.theme ?? 'light'}
            onChange={theme => setSettings({ theme })}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'Auto' },
            ]}
          />
        </View>
        <Pressable onPress={() => setSettings({ hideNames: !hide })} style={({ pressed }) => [line, pressed && { backgroundColor: t.card }]} accessibilityRole="switch" accessibilityState={{ checked: hide }}>
          <View style={{ flex: 1 }}>
            <T v="semi">Hide names</T>
            <T c="mute" size={14}>
              Show every team and league as Team #n, League #n
            </T>
          </View>
          <Toggle on={hide} />
        </Pressable>
        <View style={line}>
          <View style={{ flex: 1 }}>
            <T v="semi">Simulations</T>
            <T c="mute" size={14}>
              More is smoother, slower on phone
            </T>
          </View>
          <Seg<number>
            value={settings.sims}
            onChange={sims => setSettings({ sims })}
            options={[
              { value: 500, label: '500' },
              { value: 1000, label: '1k' },
              { value: 3000, label: '3k' },
            ]}
          />
        </View>
        <View style={[line, { borderBottomWidth: 0 }]}>
          <View style={{ flex: 1 }}>
            <T v="semi">Trade values</T>
            <T c="mute" size={14}>
              Your side: Tyler's sheet as-is, or at the market's level per position
            </T>
          </View>
          <Seg<'relative' | 'raw'>
            value={settings.tradeDelta ?? 'relative'}
            onChange={tradeDelta => setSettings({ tradeDelta })}
            options={[
              { value: 'relative', label: 'By pos' },
              { value: 'raw', label: 'Raw' },
            ]}
          />
        </View>
      </View>

      <Card style={{ gap: 10 }}>
        <Kicker>Trade offers</Kicker>
        {settings.sleeperLink ? (
          <>
            <T>
              Connected{settings.sleeperLink.name && !hide ? ` as ${settings.sleeperLink.name}` : ''}. Send in Sleeper proposes the trade for you.
              {settings.sleeperLink.expiresAt ? ` The session ends ${new Date(settings.sleeperLink.expiresAt).toLocaleDateString()}.` : ''}
            </T>
            <Btn kind="quiet" label="Disconnect" onPress={() => void disconnectSleeper()} />
          </>
        ) : connecting ? (
          <SleeperConnect onDone={() => setConnecting(false)} />
        ) : (
          <>
            <T c="mute" size={14}>
              Not connected. Connect Sleeper to send trade offers straight from Monte.
            </T>
            <Btn label="Connect Sleeper" onPress={() => setConnecting(true)} />
          </>
        )}
      </Card>

      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Kicker>Sleeper account</Kicker>
          <T v="semi" size={16}>
            {hide ? 'You' : settings.displayName}
          </T>
        </View>
        <Btn kind="quiet" label="Switch user" onPress={switchUser} />
      </Card>
    </ScrollView>
  )
}
