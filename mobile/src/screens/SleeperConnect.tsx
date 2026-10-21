// Connect Sleeper: paste the session token from a signed-in sleeper.com so Monte can send trade
// offers. Used in Settings and, when needed, right in the trade review sheet.
import { useState } from 'react'
import { View } from 'react-native'
import { useApp } from '@/lib/store'
import { Btn, ErrorBox, Field, T } from '@/ui/kit'

export default function SleeperConnect({ onDone }: { onDone?: () => void }) {
  const { connectSleeper } = useApp()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setError(null)
    const err = await connectSleeper(token)
    setBusy(false)
    if (err) return setError(err)
    setToken('')
    onDone?.()
  }
  return (
    <View style={{ gap: 10 }}>
      <T c="ink2" size={14}>
        Sleeper has no public way to send a trade, so Monte uses your Sleeper session, the way Sleeper's own website does. On a computer, sign in at
        sleeper.com, open the developer tools (F12) → Application → Local Storage → https://sleeper.com, and copy the value of <T v="semi" size={14}>token</T>.
        Paste it here.
      </T>
      <T c="mute" size={13}>
        The token can act as you on Sleeper. Monte keeps it in this phone's secure storage and uses it only to send offers you confirm. Disconnect any time in
        Settings; signing out of sleeper.com also ends it.
      </T>
      <Field value={token} onChangeText={setToken} placeholder="Paste the token" autoCapitalize="none" secureTextEntry onSubmitEditing={go} />
      {error && <ErrorBox message={error} />}
      <Btn big full kind="primary" label={busy ? 'Checking with Sleeper…' : 'Connect Sleeper'} disabled={busy || !token.trim()} onPress={go} />
    </View>
  )
}
