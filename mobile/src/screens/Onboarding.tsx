// First run: find the Sleeper account by username, then pick the league to start in.
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { Image } from 'expo-image'
import type { LeagueSummary } from '@monte/core/types'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { formatLabel, leagueAbbr } from '@/ui/league'
import { Icon } from '@/ui/icons'
import { Btn, ErrorBox, Field, GradCard, LeagueAvatar, Stack2, T } from '@/ui/kit'
import { useTheme } from '@/ui/theme'

export default function Onboarding() {
  const t = useTheme()
  const { setSettings } = useApp()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<{ user: { user_id: string; display_name: string }; leagues: LeagueSummary[] } | null>(null)

  const go = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    const u = await monte.findUser(name.trim())
    if (!u.ok) {
      setBusy(false)
      return setError(u.error)
    }
    const ls = await monte.listLeagues(u.value.user_id)
    setBusy(false)
    if (!ls.ok) return setError(ls.error)
    setFound({ user: u.value, leagues: ls.value })
  }
  const enter = (leagueId?: string) =>
    found &&
    setSettings({ username: found.user.display_name, userId: found.user.user_id, displayName: found.user.display_name, lastLeagueId: leagueId })

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, gap: 32, paddingHorizontal: 24, paddingTop: 96, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Image source={t.dark ? require('../../assets/splash-icon-dark.png') : require('../../assets/splash-icon.png')} style={{ width: 48, height: 48 }} />
          <View>
            <T v="bold" size={30} style={{ lineHeight: 32 }}>
              Monte
            </T>
            <T c="mute" size={14}>
              dynasty desk
            </T>
          </View>
        </View>

        {!found ? (
          <View style={{ gap: 12 }}>
            <T v="head">Enter your Sleeper username to load your leagues.</T>
            <Field value={name} onChangeText={setName} onSubmitEditing={go} placeholder="Sleeper username" autoCapitalize="none" returnKeyType="go" boxStyle={{ minHeight: 52, borderRadius: 26 }} />
            {error && <ErrorBox message={error} />}
            <Btn full size="lg" kind="primary" label={busy ? 'Looking up…' : 'Continue'} onPress={go} disabled={busy || !name.trim()} />
            <T c="mute" size={14}>
              Monte reads leagues from Sleeper. Nothing is sent without you asking.
            </T>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <T v="head">
              Found {found.leagues.length} league{found.leagues.length === 1 ? '' : 's'} for {found.user.display_name}.
            </T>
            <T c="mute" size={14}>
              {found.leagues.length ? 'Pick one to start. You can switch from the header any time.' : 'No dynasty leagues this season. Check the username.'}
            </T>
            <View style={{ gap: 8 }}>
              {found.leagues.map(l => (
                <GradCard key={l.league_id} color={null} minHeight={64} onPress={() => enter(l.league_id)}>
                  <LeagueAvatar label={leagueAbbr(l.name)} src={l.avatar} />
                  <Stack2 title={l.name} sub={formatLabel(l)} />
                  <Icon name="chevronRight" size={18} color={t.mute} />
                </GradCard>
              ))}
            </View>
            <Btn kind="link" label="Use a different username" onPress={() => setFound(null)} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
