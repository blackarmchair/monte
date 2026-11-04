import { Tabs } from 'expo-router/js-tabs'
import AppHeader from '@/ui/AppHeader'
import SwipeTabs from '@/ui/SwipeTabs'
import TabBar from '@/ui/TabBar'
import { useTheme } from '@/ui/theme'

// Five tabs, plus Team, Player and Settings as hidden routes: they push over the current tab with
// a back button, the tab bar stays, and tapping any tab leaves them. Team and Player draw their
// own header, since the title is the team or player.
export default function TabsLayout() {
  const t = useTheme()
  return (
    <Tabs
      tabBar={props => <TabBar {...props} />}
      backBehavior="history"
      // Every route shifts, not just the five tabs: a navigator with a mix of animated and still
      // routes leaves the outgoing screen sliding away over one that has already appeared.
      screenOptions={{ header: () => <AppHeader />, sceneStyle: { backgroundColor: t.bg }, animation: 'shift' }}
      screenLayout={({ route, navigation, children }) => (
        <SwipeTabs route={route.name} navigate={name => navigation.navigate(name)}>
          {children}
        </SwipeTabs>
      )}
    >
      <Tabs.Screen name="index" options={{ title: 'League' }} />
      <Tabs.Screen name="lineup" options={{ title: 'Lineup' }} />
      <Tabs.Screen name="trade" options={{ title: 'Trade' }} />
      <Tabs.Screen name="players" options={{ title: 'Players' }} />
      <Tabs.Screen name="picks" options={{ title: 'Picks' }} />
      <Tabs.Screen name="team" options={{ title: 'Team', headerShown: false }} />
      <Tabs.Screen name="player" options={{ title: 'Player', headerShown: false }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', header: () => <AppHeader title="Settings" /> }} />
    </Tabs>
  )
}
