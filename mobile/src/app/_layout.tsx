import '@/lib/polyfills'
import { View } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import { IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans'
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium, IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono'
import { SourceSerif4_400Regular, SourceSerif4_400Regular_Italic } from '@expo-google-fonts/source-serif-4'
import { AppProvider, useApp } from '@/lib/store'
import { TradeProvider } from '@/lib/trade'
import { OverlayProvider, SheetHost, ToastHost } from '@/ui/overlay'
import { useTheme } from '@/ui/theme'
import Onboarding from '@/screens/Onboarding'

export default function RootLayout() {
  const [loaded] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
    SourceSerif4_400Regular,
    SourceSerif4_400Regular_Italic,
  })
  if (!loaded) return null
  return (
    <OverlayProvider>
      <AppProvider>
        <TradeProvider>
          <Shell />
        </TradeProvider>
      </AppProvider>
    </OverlayProvider>
  )
}

function Shell() {
  const { settings } = useApp()
  const t = useTheme()
  if (!settings) return <View style={{ flex: 1, backgroundColor: t.bg }} />
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      {!settings.userId ? (
        <Onboarding />
      ) : (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      )}
      <ToastHost />
      <SheetHost />
    </View>
  )
}
