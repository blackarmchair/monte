// Release builds signed with Monte's own key instead of the template's debug key, so `expo
// prebuild` can regenerate android/ without losing it. The key and its passwords live outside the
// repo, in ~/.gradle/gradle.properties:
//
//   MONTE_UPLOAD_STORE_FILE=C:/Users/<you>/.monte-keys/monte-release.keystore
//   MONTE_UPLOAD_STORE_PASSWORD=...
//   MONTE_UPLOAD_KEY_ALIAS=monte
//   MONTE_UPLOAD_KEY_PASSWORD=...
//
// Without them, release builds fall back to the debug key (installable, but not updatable from a
// build signed with the real key).
const { withAppBuildGradle } = require('expo/config-plugins')

const RELEASE_CONFIG = `
        release {
            if (project.hasProperty('MONTE_UPLOAD_STORE_FILE')) {
                storeFile file(MONTE_UPLOAD_STORE_FILE)
                storePassword MONTE_UPLOAD_STORE_PASSWORD
                keyAlias MONTE_UPLOAD_KEY_ALIAS
                keyPassword MONTE_UPLOAD_KEY_PASSWORD
            }
        }`

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, cfg => {
    let g = cfg.modResults.contents
    if (!g.includes('MONTE_UPLOAD_STORE_FILE')) {
      // Add a release signing config next to the template's debug one.
      g = g.replace(/(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/, `$1${RELEASE_CONFIG}`)
      // Point the release build type at it (the template signs release with debug).
      g = g.replace(
        /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
        "$1signingConfig project.hasProperty('MONTE_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
      )
    }
    cfg.modResults.contents = g
    return cfg
  })
}
