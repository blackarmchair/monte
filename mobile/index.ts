// The app's entry. Android starts the background alert check without rendering any screen, and
// expo-router only loads a route file (src/app/_layout.tsx included) when it renders one. With the
// task defined from there, a background start had no expo-task-manager handler ("No task registered
// for key expo-task-manager") and the check never ran: alerts came only when the app was opened.
// So the task is defined here, before the router.
import './src/lib/polyfills'
import './src/lib/offerWatch'
import 'expo-router/entry'
