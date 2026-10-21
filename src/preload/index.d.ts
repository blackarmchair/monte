import type { MonteApi } from '@monte/core/types'

declare global {
  interface Window {
    monte: MonteApi
  }
}
