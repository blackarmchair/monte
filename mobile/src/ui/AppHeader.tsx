// The 56px header. On a tab: the league name with a chevron (opens the Leagues sheet) and the gear
// (Settings). On a pushed page (Team, Player, Settings): a round back button and the page title.
import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useApp } from '@/lib/store'
import LeaguesSheet from '@/screens/LeaguesSheet'
import { Icon } from './icons'
import { T } from './kit'
import { useOverlay } from './overlay'
import { useTheme } from './theme'

export const goBack = () => (router.canGoBack() ? router.back() : router.navigate('/'))

export default function AppHeader({ title }: { title?: string }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { leagues, selected } = useApp()
  const { openSheet } = useOverlay()
  const bar = { paddingTop: insets.top, backgroundColor: t.bg }

  if (title != null)
    return (
      <View style={bar}>
        <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, paddingRight: 16 }}>
          <Pressable
            onPress={goBack}
            hitSlop={6}
            style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surf, opacity: pressed ? 0.7 : 1 })}
            accessibilityLabel="Back"
          >
            <Icon name="back" size={20} color={t.ink} stroke={2} />
          </Pressable>
          <T v="bold" size={16} lines={1} style={{ flex: 1, paddingLeft: 8 }}>
            {title}
          </T>
        </View>
      </View>
    )

  const league = leagues.find(l => l.league_id === selected)
  return (
    <View style={bar}>
      <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 16, paddingRight: 6 }}>
        <Pressable
          onPress={() => openSheet(<LeaguesSheet />)}
          style={{ flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          accessibilityLabel="Switch league"
        >
          <T v="bold" size={17} lines={1} style={{ flexShrink: 1 }}>
            {league?.name ?? 'Choose a league'}
          </T>
          <Icon name="chevronDown" size={14} color={t.mute} stroke={2.4} />
        </Pressable>
        <Pressable onPress={() => router.navigate('/settings')} hitSlop={4} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Settings">
          <Icon name="gear" color={t.ink2} stroke={1.7} />
        </Pressable>
      </View>
    </View>
  )
}
