// Sign in to Sleeper on Sleeper's own page, inside the app. Monte never sees the password: once the
// page has saved its session token, Monte reads that and closes. Incognito, so nothing of the login
// stays in the web view: the token in secure storage is the only thing kept.
import { useRef } from 'react'
import { Modal, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { LOGIN_URL, loginMayVisit, READ_TOKEN_JS, TOKEN_POLL_MS, tokenFromStorage } from '@monte/core/sleeperLogin'
import { Btn, T } from '@/ui/kit'
import { useTheme } from '@/ui/theme'

export const signInAvailable = true

// Reports from Sleeper's own host only; loading again in the same page just starts over harmlessly.
const WATCH = `(function () {
  if (window.__monteWatch) return;
  window.__monteWatch = setInterval(function () {
    if (location.protocol !== 'https:' || (location.hostname !== 'sleeper.com' && location.hostname.slice(-12) !== '.sleeper.com')) return;
    var token = ${READ_TOKEN_JS};
    if (token) window.ReactNativeWebView.postMessage(token);
  }, ${TOKEN_POLL_MS});
})();
true;`

export default function SleeperLogin({ visible, onToken, onClose }: { visible: boolean; onToken: (token: string) => void; onClose: () => void }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const done = useRef(false)
  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => {
        done.current = false
      }}
    >
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: t.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 8 }}>
          <T v="bold" size={16}>
            Sign in to Sleeper
          </T>
          <Btn kind="link" label="Cancel" onPress={onClose} />
        </View>
        {visible && (
          <WebView
            source={{ uri: LOGIN_URL }}
            incognito
            originWhitelist={['https://*']}
            injectedJavaScript={WATCH}
            onShouldStartLoadWithRequest={r => loginMayVisit(r.url)}
            onMessage={e => {
              const token = tokenFromStorage(e.nativeEvent.data)
              if (!token || done.current) return
              done.current = true
              onToken(token)
            }}
          />
        )}
      </View>
    </Modal>
  )
}
