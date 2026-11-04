// Signing in to Sleeper inside Monte: the user logs in on Sleeper's own page, in a window Monte
// opens, and Monte reads the session token the page saves. Monte never sees the password.
import { readToken } from './sleeperTrade'

export const LOGIN_URL = 'https://sleeper.com/login'
export const TOKEN_POLL_MS = 1000
/** Evaluates to whatever Sleeper's page has saved as its session token, or null. */
export const READ_TOKEN_JS = `localStorage.getItem('token')`

const hostOf = (url: string) => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' ? u.hostname : null
  } catch {
    return null
  }
}
const under = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

/** The token is only ever read from Sleeper's own site. */
export const isSleeperPage = (url: string) => {
  const host = hostOf(url)
  return !!host && under(host, 'sleeper.com')
}

/** Where the login window may go: Sleeper, plus the bot check its login form may show. */
export function loginMayVisit(url: string): boolean {
  const host = hostOf(url)
  return !!host && ['sleeper.com', 'sleeper.app', 'recaptcha.net', 'gstatic.com'].some(d => under(host, d)) ? true : !!host && host === 'www.google.com' && new URL(url).pathname.startsWith('/recaptcha')
}

/** A session token from what the page saved (it may be JSON-quoted), or null if it isn't one yet. */
export function tokenFromStorage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const token = raw.trim().replace(/^"|"$/g, '')
  return token.split('.').length === 3 && readToken(token) ? token : null
}
