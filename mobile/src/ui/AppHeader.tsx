// The one-line header. On a tab: league square, league name (serif) and a meta line; tapping it
// opens the Leagues sheet, the gear pushes Settings. On a pushed screen: back arrow and title.
import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useApp } from '@/lib/store'
import LeaguesSheet from '@/screens/LeaguesSheet'
import { Icon } from './icons'
import { LeagueSquare, T } from './kit'
import { formatLabel, leagueAbbr } from './league'
import { useOverlay } from './overlay'
import { useTheme } from './theme'

export default function AppHeader({ title }: { title?: string }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { leagues, selected, context } = useApp()
  const { openSheet } = useOverlay()
  const bar = { paddingTop: insets.top, backgroundColor: t.bg, borderBottomWidth: 1, borderColor: t.line }

  if (title)
    return (
      <View style={bar}>
        <View style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6 }}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))}
            hitSlop={6}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            accessibilityLabel="Back"
          >
            <Icon name="back" color={t.ink} stroke={1.8} />
          </Pressable>
          <T v="semi" size={18}>
            {title}
          </T>
        </View>
      </View>
    )

  const league = leagues.find(l => l.league_id === selected)
  const me = context?.rosters.find(r => r.roster_id === context.myRosterId)
  const meta = league
    ? [formatLabel(league), context && context.week > 0 ? `wk ${context.week}` : null, me ? `you're ${me.wins}-${me.losses}` : null].filter(Boolean).join(' · ')
    : ''
  return (
    <View style={bar}>
      <View style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 6 }}>
        <Pressable
          onPress={() => openSheet(<LeaguesSheet />)}
          style={{ flex: 1, minWidth: 0, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }}
          accessibilityLabel="Switch league"
        >
          <LeagueSquare label={league ? leagueAbbr(league.name) : 'M'} src={league?.avatar} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <T v="serif" size={20} lines={1} style={{ flexShrink: 1 }}>
                {league?.name ?? 'Choose a league'}
              </T>
              <Icon name="chevronDown" size={14} color={t.mute} stroke={2} />
            </View>
            {!!meta && (
              <T v="small" c="mute" lines={1}>
                {meta}
              </T>
            )}
          </View>
        </Pressable>
        <Pressable onPress={() => router.navigate('/settings')} hitSlop={4} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Settings">
          <Icon name="gear" color={t.ink2} />
        </Pressable>
      </View>
    </View>
  )
}
