// A last-resort limit for work that has no deadline of its own. sleeperStandings' fetches have
// none, and a run that never settles leaves its screen busy forever.
export const ENGINE_DEADLINE_MS = 5 * 60 * 1000
export const ENGINE_TIMEOUT_MESSAGE = "The simulation didn't finish within 5 minutes, usually a stalled connection to Sleeper. Try again."

export function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([work, limit]).finally(() => clearTimeout(timer))
}
