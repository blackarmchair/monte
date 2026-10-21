// Web APIs the shared engine uses that React Native may lack. Imported first by the root layout.

// sleeperStandings fetches ESPN's injury return dates with AbortSignal.timeout(). Where that's
// missing the call throws, the engine catches it and silently projects without ESPN's estimates,
// so phone pick odds would quietly differ from desktop's.
if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as { timeout?: unknown }).timeout !== 'function') {
  ;(AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = (ms: number) => {
    const c = new AbortController()
    setTimeout(() => c.abort(), ms)
    return c.signal
  }
}

export {}
