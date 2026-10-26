import { Tabs } from 'expo-router/js-tabs'
import AppHeader from '@/ui/AppHeader'
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
      screenOptions={{ header: () => <AppHeader />, sceneStyle: { backgroundColor: t.bg } }}
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
