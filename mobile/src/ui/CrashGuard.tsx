// A screen that throws while rendering shows this instead of closing the app.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

export default class CrashGuard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    // Plain colours on purpose: the theme itself could be what failed.
    return (
      <View style={{ flex: 1, justifyContent: 'center', gap: 12, padding: 24, backgroundColor: '#141210' }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#F3EFE7' }}>This screen hit a problem.</Text>
        <Text style={{ fontSize: 14, color: '#B8B0A4' }}>{this.state.error.message}</Text>
        <Pressable accessibilityRole="button" onPress={() => this.setState({ error: null })} style={{ alignSelf: 'flex-start', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, backgroundColor: '#E8622C' }}>
          <Text style={{ fontWeight: '700', color: '#141210' }}>Try again</Text>
        </Pressable>
      </View>
    )
  }
}
