// Pick-odds seeding. Every simulation runs on the saved seed, so the same inputs give the same
// odds; a new seed is drawn only when the user asks for one.
import type { BBResult } from './types'

/** A fresh pick-odds seed, for the explicit "New seed" action only. */
export const newSeed = (): number => 1 + Math.floor(Math.random() * 2147483646)

/**
 * True when two pick-odds runs used the same seed, sim count, projection error and model, so
 * they differ only by their what-if results and comparing them isolates the toggle.
 */
export const sameRunParams = (a: BBResult, b: BBResult): boolean =>
  a.seed === b.seed && a.simulations === b.simulations && a.strengthCV === b.strengthCV && a.model === b.model
