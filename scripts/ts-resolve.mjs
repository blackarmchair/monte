// Lets the parity scripts run the app's TypeScript directly (node --experimental-strip-types):
// the app imports siblings without an extension, as the bundler expects, and plain Node does not
// resolve those. This adds ".ts" to an extensionless relative import.
import { register } from 'node:module'

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if ((spec.startsWith('./') || spec.startsWith('../')) && !/\.[cm]?[jt]s$/.test(spec)) {
    try { return await next(spec + '.ts', ctx) } catch {}
  }
  return next(spec, ctx)
}`),
)
