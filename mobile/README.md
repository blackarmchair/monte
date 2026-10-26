# Monte mobile

The Monte dynasty desk on your phone, built with Expo (SDK 57) and Expo Router. It shares its data
layer with the desktop app: everything in `../packages/core` (Sleeper and FantasyCalc fetching,
the screen builders, trade and draft maths) and the `../../sleeperStandings` pick-odds / PWOPR
engine run in the app itself. There is no server.

## Run it on your phone

1. Install **Expo Go** from the App Store or Play Store. Expo Go runs exactly one SDK version, and
   the store builds were on SDK 57 when this app was set up (SDK 58 had just come out). If Expo Go
   ever says "install the latest version", the store app and this project are on different SDKs:
   check which SDK the store's Expo Go supports and move the project to it with
   `npx expo install expo@^<sdk> && npx expo install --fix`.
2. Make sure `../../sleeperStandings` is built (`npm run build` there), as for the desktop app.
3. In this folder:

   ```sh
   npm install
   npx expo start
   ```

4. Scan the QR code: with the Camera app on iPhone, or from inside Expo Go on Android. The phone
   and computer must be on the same Wi-Fi. If they can't see each other (guest Wi-Fi, VPN), use
   `npx expo start --tunnel`.

First launch asks for your Sleeper username, as the desktop app does.

## Install it for real (Android APK)

A standalone, signed APK: no Expo Go, no computer needed once installed.

1. One-time: the release key is in `%USERPROFILE%\.monte-keys\` and its settings in
   `%USERPROFILE%\.gradle\gradle.properties` (`MONTE_UPLOAD_*`, read by
   `plugins/withReleaseSigning.js`). **Back both up**: an update installs over the app only if
   it's signed with the same key.
2. Regenerate the native project when native config changes (new native package, app.json):
   `npx expo prebuild --platform android --no-install`.
3. Build from a short path, since Windows' 260-character limit breaks the C++ step from
   `C:\home\_standaloneApps\…`. Map the folder that holds both `monte` and `sleeperStandings`:

   ```powershell
   subst M: C:\home\_standaloneApps
   cd M:\monte\mobile\android
   .\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a
   subst M: /D
   ```

   If a build from the long path ran first, delete `android\app\.cxx` and `android\app\build`.
4. The APK is `android/app/build/outputs/apk/release/app-release.apk`. Install it with
   `adb install -r` over USB, or copy it to the phone and open it (allow installs from that
   app when Android asks). Bump `versionCode` in app.json for each new release.

## The rankings sheet

Phones have no folder Monte can watch, so the sheet is picked rather than synced:

1. In Google Sheets: File → Download → Microsoft Excel (.xlsx). On a phone, open the sheet in the
   browser or Sheets app and use Share & export → Save as Excel.
2. Save it to Files (iPhone) or Downloads/Drive (Android).
3. In Monte: the gear in the header → Settings → **Pick the .xlsx** (or the same button on any screen that needs it).
   Monte reads it with expo-file-system's own picker; expo-document-picker's cached copy can't be
   read inside Expo Go ("Missing 'READ' permission").

Pick it again whenever Tyler updates it. Monte keeps a copy, so the original can be deleted.

## Layout

The UX follows the hybrid design handoff (direction 2b, warm skin, dark first): five tabs,
rounded cards tinted by team or NFL colour, Sleeper headshots, heat-coloured cells, no dividers.

- `src/app/`: routes. Tabs are League, Lineup, Trade, Players and Picks; Team, Player and
  Settings are hidden tab routes pushed over a tab (back button in the header, tab bar stays).
- `src/screens/`: one component per screen, plus the bottom sheets (leagues, trade partner and
  picker, trade review, what-if, pick, draft pick). Players merges the superflex board (Value)
  with PWOPR (Usage); Picks holds Pick odds and Draft. Injury overrides are set on a player's
  Injury tab and listed in Settings. The Player page's Stats tab reads Sleeper's per-player
  weekly stats.
- `src/lib/monte.ts`: the phone's host for `@monte/core`, mirroring the desktop's `window.monte`.
- `src/lib/store.tsx`: app state, ported from the desktop's `App.tsx`.
- `src/lib/trade.tsx`: the trade being built and its valuation, shared by the Trade tab, its
  sticky verdict bar, the tab badge, and "add to trade" everywhere else.
- `src/ui/`: theme (warm tokens, oklab mixing, gradient cards, heat scale, NFL colours), the kit, the header and tab bar, and the overlay hosts
  (one bottom sheet, one toast).
- `metro.config.js`, `babel.config.js`, `shims/`: let Metro bundle the shared core and the
  Node-built engine (aliases, `fs`/`path`/`url`/`readline` stand-ins, `import.meta` rewrite).

## Gestures

- Lineup: tap a player, then a highlighted slot or player to swap; tap him again to cancel.
  "Sim out" (in the hint line) zeroes the selected starter.
- Players: swipe a row left for Trade for / Offer / Claim; long-press to add him to the trade.
- Teams and players open as full pages; pickers, the trade review and pick details open in the
  bottom sheet (tap the scrim to close).

## Sending trades

Sleeper has no public write API or pre-filled trade link. **Send in Sleeper** proposes the trade
through the same undocumented GraphQL mutation Sleeper's own site uses
(`packages/core/src/sleeperTrade.ts`), with the user's Sleeper session token:

- Connect once (Settings → Trade offers, or when sending): copy `token` from a signed-in
  sleeper.com's Local Storage and paste it. Monte checks it belongs to the signed-in account and
  keeps it in the phone's secure storage (expo-secure-store), never in settings.
- Every send goes through a confirm step listing both sides. The offer reaches a real person; in
  leagues with no trade review period, their accepting it completes the trade.
- Sleeper's reply is compared with what was sent; any difference is shown so the offer can be
  withdrawn in Sleeper. A refused token disconnects and asks to connect again.
- Sleeper can change or close this mutation without notice.

## Differences from desktop

- Pick Odds defaults to 1,000 simulations (Settings), since the sim runs on the phone.
- `npx expo start --web` runs a browser preview, which is handy for layout checks. It keeps the
  workbook in browser storage.
