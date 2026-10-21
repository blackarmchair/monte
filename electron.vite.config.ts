import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// packages/core is shared with the mobile app and imported as source: '@monte/core/*' everywhere,
// and '@shared/*' in the renderer (its older name, kept so the views didn't all change).
const core = resolve('packages/core/src')

export default defineConfig({
  main: {
    resolve: { alias: { '@monte/core': core } },
    // sleeper-standings is a local ESM package (../sleeperStandings); bundle it into main
    // rather than externalising it, so the CJS main bundle never has to require() ESM.
    build: { externalizeDeps: { exclude: ['sleeper-standings'] } },
  },
  preload: {
    resolve: { alias: { '@monte/core': core } },
  },
  renderer: {
    resolve: { alias: { '@shared': core, '@monte/core': core } },
    plugins: [react()],
  },
})
