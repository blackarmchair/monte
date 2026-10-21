// Bottom tabs: League · Lineup · Trade · Players · Picks. Active = accent icon and label with a
// 2px accent bar on top; Trade carries a badge with the number of assets in the draft trade.
// Settings and Overrides are hidden routes, so the bar stays put on them with nothing active.
import { Pressable, Text, View } from 'react-native'
import type { BottomTabBarProps } from 'expo-router/js-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTrade } from '@/lib/trade'
import { Icon, type IconName } from './icons'
import { TAB_H } from './overlay'
import { font, useTheme } from './theme'

export const TABS: Array<{ name: string; label: string; icon: IconName }> = [
  { name: 'index', label: 'League', icon: 'league' },
  { name: 'lineup', label: 'Lineup', icon: 'lineup' },
  { name: 'trade', label: 'Trade', icon: 'trade' },
  { name: 'players', label: 'Players', icon: 'players' },
  { name: 'picks', label: 'Picks', icon: 'picks' },
]

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { count } = useTrade()
  const current = state.routes[state.index]?.name
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: t.line, backgroundColor: t.card, paddingHorizontal: 4, paddingBottom: insets.bottom }}>
      {TABS.map(tab => {
        const on = current === tab.name
        const color = on ? t.acc : t.mute
        const badge = tab.name === 'trade' ? count : 0
        return (
          <Pressable
            key={tab.name}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={badge ? `${tab.label}, ${badge} in trade` : tab.label}
            onPress={() => {
              const route = state.routes.find(r => r.name === tab.name)
              const ev = route && navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
              if (!ev?.defaultPrevented) navigation.navigate(tab.name)
            }}
            style={{ flex: 1, height: TAB_H, alignItems: 'center', justifyContent: 'center', gap: 3 }}
          >
            <View style={{ position: 'absolute', top: -1, left: '30%', right: '30%', height: 2, backgroundColor: on ? t.acc : 'transparent' }} />
            <Icon name={tab.icon} color={color} />
            <Text style={{ fontFamily: on ? font.sansSemi : font.sans, fontSize: 12, color }}>{tab.label}</Text>
            {badge > 0 && (
              <View
                style={{
                  position: 'absolute',
                  top: 5,
                  left: '50%',
                  marginLeft: 6,
                  minWidth: 18,
                  height: 18,
                  paddingHorizontal: 5,
                  borderRadius: 9,
                  backgroundColor: t.acc,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: font.sansSemi, fontSize: 11, color: '#fff' }}>{badge}</Text>
              </View>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}
