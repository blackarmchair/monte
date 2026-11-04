// Connect Sleeper: sign in on Sleeper's own page (or paste the session token from a signed-in
// sleeper.com) so Monte can send trade offers and set lineups. Used in Settings and, when needed, right in the trade sheet or Lineup.
import { useState } from 'react'
import { View } from 'react-native'
import { useApp } from '@/lib/store'
import { Btn, ErrorBox, Field, T } from '@/ui/kit'
import SleeperLogin, { signInAvailable } from './SleeperLogin'

export default function SleeperConnect({ onDone }: { onDone?: () => void }) {
  const { connectSleeper } = useApp()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pasting, setPasting] = useState(!signInAvailable)
  const [loggingIn, setLoggingIn] = useState(false)
  const connect = async (value: string) => {
    setBusy(true)
    setError(null)
    const err = await connectSleeper(value)
    setBusy(false)
    if (err) return setError(err)
    setToken('')
    onDone?.()
  }
  const go = () => connect(token)
  return (
    <View style={{ gap: 10 }}>
      <T c="ink2" size={14}>
        Sleeper has no public way to send a trade, so Monte uses your Sleeper session, the way Sleeper's own website does.{signInAvailable ? " Sign in on Sleeper's own page. Monte never sees your password." : ''}
      </T>
      <T c="mute" size={13}>
        Your session can act as you on Sleeper. Monte keeps it in this phone's secure storage and uses it only for what you do from Monte: answering and sending offers, setting lineups, and checking for new offers. Disconnect any time in Settings; signing out of sleeper.com also ends it.
      </T>
      {error && <ErrorBox message={error} />}
      {!pasting && (
        <>
          <Btn full size="lg" kind="primary" label={busy ? 'Checking with Sleeper…' : 'Sign in to Sleeper'} disabled={busy} onPress={() => setLoggingIn(true)} />
          <Btn kind="link" label="Paste a token instead" disabled={busy} onPress={() => setPasting(true)} />
        </>
      )}
      {pasting && (
        <>
          <T c="ink2" size={14}>
            On a computer, sign in at sleeper.com, open the developer tools (F12) → Application → Local Storage → https://sleeper.com, and copy the value of <T v="semi" size={14}>token</T>.
          </T>
          <Field value={token} onChangeText={setToken} placeholder="Paste the token" autoCapitalize="none" secureTextEntry onSubmitEditing={go} />
          <Btn full size="lg" kind="primary" label={busy ? 'Checking with Sleeper…' : 'Connect Sleeper'} disabled={busy || !token.trim()} onPress={go} />
          {signInAvailable && <Btn kind="link" label="Sign in instead" disabled={busy} onPress={() => setPasting(false)} />}
        </>
      )}
      <SleeperLogin
        visible={loggingIn}
        onClose={() => setLoggingIn(false)}
        onToken={value => {
          setLoggingIn(false)
          void connect(value)
        }}
      />
    </View>
  )
}
