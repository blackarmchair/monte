// One job per worker: run a sleeperStandings engine off the main thread and post the result.
// sleeperStandings keeps a module-level mutable Config, so isolating each job in its own
// worker also keeps one league's run from leaking settings into another's.
import { parentPort, workerData } from 'node:worker_threads'
import { runEngineJob, type EngineJob } from '@monte/core/engine'

runEngineJob(workerData as EngineJob).then(
  value => parentPort!.postMessage({ ok: true, value }),
  e => parentPort!.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) }),
)
