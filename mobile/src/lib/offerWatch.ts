// Alerts on the phone (new offers, lineup trouble, waiver results, failing claims, trade deadlines):
// local notifications from a background check, with no server.
// Android runs the check when it chooses (15 minutes apart at best, with network and battery to
// spare) and not at all after a force-stop, so it also runs whenever the app comes to the front.
import * as BackgroundTask from 'expo-background-task'
import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { AppState, Linking } from 'react-native'
import { compareVersions } from '@monte/core/appUpdate'
import { offerMessage } from '@monte/core/offerWatch'
import { appVersion, unannouncedUpdate } from './appUpdate'
import { monte } from './monte'
import { cacheRead, cacheWrite } from './storage'

const TASK = 'monte-offer-check'
const CHANNEL = 'offers'
const UPDATE_CHANNEL = 'updates'
const ALERT_CHANNEL = 'alerts'
/** GitHub is asked about new versions at most this often, however often the check runs. */
const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000
let updateCheckedAt = 0
const INTERVAL_MIN = 15
/** The last tapped notification already acted on (Android keeps returning it on every launch). */
const HANDLED_KEY = 'notification-handled.txt'

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
})

/** A new version on GitHub, announced once. The tap opens its download. */
async function notifyUpdate() {
  if (Date.now() - updateCheckedAt < UPDATE_EVERY_MS) return
  updateCheckedAt = Date.now()
  const u = await unannouncedUpdate()
  if (!u) return
  await Notifications.setNotificationChannelAsync(UPDATE_CHANNEL, { name: 'App updates', importance: Notifications.AndroidImportance.DEFAULT })
  await Notifications.scheduleNotificationAsync({ content: { title: `Monte ${u.version} is ready`, body: 'Tap to download it.', data: { url: u.url } }, trigger: { channelId: UPDATE_CHANNEL } })
}

async function checkAndNotify() {
  await notifyUpdate().catch(() => undefined)
  const { fresh, all, hideNames } = await monte.newOffers()
  for (const o of fresh) {
    const { title, body } = offerMessage(o, hideNames)
    await Notifications.scheduleNotificationAsync({ content: { title, body, data: { leagueId: o.leagueId } }, trigger: { channelId: CHANNEL } })
  }
  const alerts = await monte.newAlerts(all)
  if (!alerts.length) return
  await Notifications.setNotificationChannelAsync(ALERT_CHANNEL, { name: 'Lineup, waivers and deadlines', importance: Notifications.AndroidImportance.HIGH })
  for (const m of alerts)
    await Notifications.scheduleNotificationAsync({ content: { title: m.title, body: m.body, data: m.leagueId ? { leagueId: m.leagueId } : {} }, trigger: { channelId: ALERT_CHANNEL } })
}

// Must be defined at module scope, and this file imported from index.ts (not a route): Android
// starts the task without any screen, and expo-router loads routes only when it renders them.
TaskManager.defineTask(TASK, async () => {
  try {
    await checkAndNotify()
    return BackgroundTask.BackgroundTaskResult.Success
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed
  }
})

/** Ask for permission and start checking. False means the system said no. */
export async function enableOfferAlerts(): Promise<boolean> {
  // Android 13 shows the permission prompt only once a channel exists.
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Trade offers', importance: Notifications.AndroidImportance.HIGH })
  const granted = (await Notifications.getPermissionsAsync()).granted || (await Notifications.requestPermissionsAsync()).granted
  if (!granted) return false
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: INTERVAL_MIN })
  return true
}

export async function disableOfferAlerts(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(TASK)) await BackgroundTask.unregisterTaskAsync(TASK)
}

/** While the app runs: check on each return to the front, and open the league a tapped alert is about. */
export function watchOffers(openLeague: (leagueId: string) => void): () => void {
  const check = () => void checkAndNotify().catch(() => undefined)
  // getLastNotificationResponseAsync returns the last tap on every launch, however old: acting on
  // it each time reopened a stale "Monte 1.7.1 is ready" download after 1.7.2 was out. So a tap is
  // handled once, and an update link only opens while its version is newer than this app.
  const open = async (r: Notifications.NotificationResponse | null) => {
    if (!r) return
    const id = r.notification.request.identifier
    if ((await cacheRead(HANDLED_KEY).catch(() => null)) === id) return
    await cacheWrite(HANDLED_KEY, id).catch(() => undefined)
    const data = r.notification.request.content.data
    if (typeof data?.url === 'string' && data.url.startsWith('https://github.com/')) {
      const version = /Monte-(\d+\.\d+\.\d+)\.apk$/i.exec(data.url)?.[1]
      if (!version || compareVersions(version, appVersion) > 0) void Linking.openURL(data.url)
      return
    }
    const leagueId = data?.leagueId
    if (typeof leagueId === 'string') openLeague(leagueId)
  }
  check()
  void Notifications.getLastNotificationResponseAsync().then(open)
  const state = AppState.addEventListener('change', s => s === 'active' && check())
  const tap = Notifications.addNotificationResponseReceivedListener(r => void open(r))
  return () => {
    state.remove()
    tap.remove()
  }
}
