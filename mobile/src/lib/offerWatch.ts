// New-offer alerts on the phone: local notifications from a background check, with no server.
// Android runs the check when it chooses (15 minutes apart at best, with network and battery to
// spare) and not at all after a force-stop, so it also runs whenever the app comes to the front.
import * as BackgroundTask from 'expo-background-task'
import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { AppState } from 'react-native'
import { offerMessage } from '@monte/core/offerWatch'
import { monte } from './monte'

const TASK = 'monte-offer-check'
const CHANNEL = 'offers'
const INTERVAL_MIN = 15

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
})

async function checkAndNotify() {
  const { fresh, hideNames } = await monte.newOffers()
  for (const o of fresh) {
    const { title, body } = offerMessage(o, hideNames)
    await Notifications.scheduleNotificationAsync({ content: { title, body, data: { leagueId: o.leagueId } }, trigger: { channelId: CHANNEL } })
  }
}

// Must be defined at module scope: Android starts the task without any screen.
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
  const open = (r: Notifications.NotificationResponse | null) => {
    const leagueId = r?.notification.request.content.data?.leagueId
    if (typeof leagueId === 'string') openLeague(leagueId)
  }
  check()
  void Notifications.getLastNotificationResponseAsync().then(open)
  const state = AppState.addEventListener('change', s => s === 'active' && check())
  const tap = Notifications.addNotificationResponseReceivedListener(open)
  return () => {
    state.remove()
    tap.remove()
  }
}
