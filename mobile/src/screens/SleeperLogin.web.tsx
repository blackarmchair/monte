// The browser preview has no web view to sign in with, so it keeps pasting the token.
export const signInAvailable = false

export default function SleeperLogin(_props: { visible: boolean; onToken: (token: string) => void; onClose: () => void }) {
  return null
}
