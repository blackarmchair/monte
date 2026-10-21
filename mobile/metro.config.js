// Metro for Monte mobile. The app shares source with the desktop app rather than an npm package:
//   @monte/core/*        -> ../packages/core/src/*   (data builders, trade/draft maths, service)
//   sleeper-standings/*  -> ../../sleeperStandings/* (the pick-odds and PWOPR engine)
// The engine was written for Node, so fs / path / url / readline resolve to small shims in ./shims.
// This app is not an npm workspace (its React Native React must not meet the desktop's React),
// so Expo's automatic monorepo setup doesn't apply and the folders are wired up here.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const app = __dirname
const core = path.resolve(app, '../packages/core/src')
const engine = path.resolve(app, '../../sleeperStandings')

const config = getDefaultConfig(app)
config.watchFolders = [...(config.watchFolders ?? []), core, path.join(engine, 'dist')]

const SHIMS = {
  fs: path.join(app, 'shims/fs.js'),
  'node:fs': path.join(app, 'shims/fs.js'),
  path: path.join(app, 'shims/path.js'),
  'node:path': path.join(app, 'shims/path.js'),
  url: path.join(app, 'shims/url.js'),
  'node:url': path.join(app, 'shims/url.js'),
  readline: path.join(app, 'shims/readline.js'),
}
// Bare imports made from shared source (e.g. core's `fflate`) resolve as if made from the app,
// so they use this app's node_modules and never the desktop's.
const fromApp = path.join(app, 'package.json')

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@monte/core/')) return context.resolveRequest(context, path.join(core, moduleName.slice('@monte/core/'.length)), platform)
  if (moduleName.startsWith('sleeper-standings/')) return context.resolveRequest(context, path.join(engine, moduleName.slice('sleeper-standings/'.length)), platform)
  if (SHIMS[moduleName]) return { type: 'sourceFile', filePath: SHIMS[moduleName] }
  const bare = !moduleName.startsWith('.') && !path.isAbsolute(moduleName)
  if (bare && !context.originModulePath.startsWith(app + path.sep)) return context.resolveRequest({ ...context, originModulePath: fromApp }, moduleName, platform)
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
