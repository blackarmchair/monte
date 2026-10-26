// Bottom tabs on surf: League · Lineup · Trade · Players · Picks. The active tab gets an
// acc-tint pill behind its icon and a bold ink label; Trade carries a badge with the number of
// assets in the draft trade. Team, Player and Settings are hidden routes pushed over a tab, so the
// tab they were opened from stays lit.
import { useRef } from 'react'
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
  const route = state.routes[state.index]?.name
  const last = useRef('index')
  if (TABS.some(x => x.name === route)) last.current = route
  const current = last.current
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.surf, paddingHorizontal: 4, paddingTop: 2, paddingBottom: Math.max(insets.bottom, 8) }}>
      {TABS.map(tab => {
        const on = current === tab.name
        const color = on ? t.ink : t.mute
        const badge = tab.name === 'trade' ? count : 0
        return (
          <Pressable
            key={tab.name}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={badge ? `${tab.label}, ${badge} in trade` : tab.label}
            onPress={() => {
              const r = state.routes.find(x => x.name === tab.name)
              const ev = r && navigation.emit({ type: 'tabPress', target: r.key, canPreventDefault: true })
              if (!ev?.defaultPrevented) navigation.navigate(tab.name)
            }}
            style={{ flex: 1, height: TAB_H - 4, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 4 }}
          >
            <View style={{ width: 52, height: 30, borderRadius: 15, backgroundColor: on ? t.accTint : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={tab.icon} color={color} stroke={1.8} />
            </View>
            <Text style={{ fontFamily: on ? font.sansBold : font.sansMed, fontSize: 12, color }}>{tab.label}</Text>
            {badge > 0 && (
              <View
                style={{
                  position: 'absolute',
                  top: 2,
                  left: '50%',
                  marginLeft: 10,
                  minWidth: 18,
                  height: 18,
                  paddingHorizontal: 5,
                  borderRadius: 9,
                  backgroundColor: t.acc,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: font.sansBold, fontSize: 11, color: t.accInk }}>{badge}</Text>
              </View>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}
