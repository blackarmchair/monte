import { useEffect, useRef, useState } from 'react'
import type { ManualInjury, PlayerHit } from '@shared/types'

/**
 * Manual injury overrides. These outrank Sleeper's tag and ESPN's return estimate everywhere a
 * player's availability matters: the Pick Odds sim, PWOPR projections and Start/Sit. They are
 * per player, not per league — an injury is a fact about the player.
 */
export default function InjuriesPanel(props: {
  injuries: ManualInjury[]
  /** current NFL week, to flag entries whose return week has passed */
  week: number
  onChange: (next: ManualInjury[]) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PlayerHit[]>([])
  const [pick, setPick] = useState<PlayerHit | null>(null)
  const [season, setSeason] = useState(false)
  const [rw, setRw] = useState(Math.max(1, props.week + 1))
  const [note, setNote] = useState('')
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])
  // Debounced search over the cached Sleeper player DB.
  useEffect(() => {
    if (pick || q.trim().length < 2) return setHits([])
    const t = setTimeout(() => void window.monte.searchPlayers(q).then(r => setHits(r.ok ? r.value : [])), 150)
    return () => clearTimeout(t)
  }, [q, pick])

  const existing = new Set(props.injuries.map(i => i.id))
  const add = () => {
    if (!pick) return
    const entry: ManualInjury = {
      id: pick.id,
      name: pick.name,
      pos: pick.pos,
      team: pick.team,
      returnWeek: season ? null : rw,
      note: note.trim() || undefined,
      addedAt: new Date().toISOString(),
    }
    props.onChange([...props.injuries.filter(i => i.id !== pick.id), entry])
    setPick(null)
    setQ('')
    setNote('')
    setSeason(false)
    input.current?.focus()
  }
  const expired = props.injuries.filter(i => i.returnWeek != null && i.returnWeek <= props.week)
  const sorted = [...props.injuries].sort((a, b) => (a.returnWeek ?? 99) - (b.returnWeek ?? 99) || a.name.localeCompare(b.name))

  const doImport = async () => {
    const r = await window.monte.bundledInjuries()
    if (!r.ok) return setImportMsg(r.error)
    const fresh = r.value.filter(i => !existing.has(i.id))
    props.onChange([...props.injuries, ...fresh])
    setImportMsg(`Imported ${fresh.length} of ${r.value.length}.`)
  }

  return (
    <div className="modal-scrim" onMouseDown={e => e.target === e.currentTarget && props.onClose()}>
      <div className="modal panel" role="dialog" aria-label="Injury overrides">
        <div className="modal-head">
          <div>
            <div className="modal-title">Injury overrides</div>
            <div className="src">
              Out until a week, or for the season. These outrank Sleeper’s tag and ESPN’s estimate in Pick Odds, PWOPR and Start/Sit.
            </div>
          </div>
          <button className="link" onClick={props.onClose}>
            Done
          </button>
        </div>

        <div className="inj-add">
          {pick ? (
            <div className="inj-picked">
              <span>
                <b>{pick.name}</b> <span className="faint">{pick.pos} · {pick.team}</span>
              </span>
              <button className="link" onClick={() => setPick(null)}>
                change
              </button>
            </div>
          ) : (
            <div className="inj-search">
              <input
                ref={input}
                className="search"
                style={{ width: '100%' }}
                placeholder="Search a player…"
                value={q}
                onChange={e => setQ(e.target.value)}
              />
              {hits.length > 0 && (
                <div className="inj-hits">
                  {hits.map(h => (
                    <button key={h.id} onClick={() => setPick(h)}>
                      <span>
                        {h.name} <span className="faint">{h.pos} · {h.team}</span>
                      </span>
                      <span className="faint">{existing.has(h.id) ? 'listed' : h.injury}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="inj-controls">
            <label className="control">
              <input type="checkbox" checked={season} onChange={e => setSeason(e.target.checked)} /> Out for season
            </label>
            {!season && (
              <label className="control">
                Back in week
                <input className="search" type="number" min={1} max={18} value={rw} style={{ width: 64 }} onChange={e => setRw(Number(e.target.value) || 1)} />
              </label>
            )}
            <input className="search" placeholder="Note (optional)" value={note} style={{ flex: 1, minWidth: 140 }} onChange={e => setNote(e.target.value)} />
            <button className="btn-primary sm" disabled={!pick} onClick={add}>
              {pick && existing.has(pick.id) ? 'Update' : 'Add'}
            </button>
          </div>
        </div>

        {expired.length > 0 && (
          <div className="ss-warning" style={{ margin: '0 20px' }}>
            {expired.length} override{expired.length === 1 ? ' has' : 's have'} a return week that has already arrived ({expired.map(i => i.name).join(', ')}).{' '}
            <button className="link" onClick={() => props.onChange(props.injuries.filter(i => !expired.includes(i)))}>
              Clear expired
            </button>
          </div>
        )}

        <div className="inj-list">
          {sorted.length === 0 && (
            <div className="faint tr-empty">
              No overrides. Monte is using Sleeper’s tags and ESPN’s return estimates.{' '}
              <button className="link" onClick={doImport}>
                Import from sleeperStandings config
              </button>
            </div>
          )}
          {sorted.map(i => (
            <div key={i.id} className={`inj-row ${expired.includes(i) ? 'expired' : ''}`}>
              <span className="nm">
                {i.name} <span className="faint">{i.pos} · {i.team}</span>
                {i.note && <span className="inj-note">{i.note}</span>}
              </span>
              <span className={`status ${i.returnWeek == null ? 'neg' : expired.includes(i) ? 'muted' : 'warn'}`}>
                {i.returnWeek == null ? 'Season' : `Back wk ${i.returnWeek}`}
              </span>
              <button
                className="link"
                onClick={() => {
                  setPick({ id: i.id, name: i.name, pos: i.pos, team: i.team, injury: '' })
                  setSeason(i.returnWeek == null)
                  setRw(i.returnWeek ?? Math.max(1, props.week + 1))
                  setNote(i.note ?? '')
                }}
              >
                Edit
              </button>
              <button className="link" onClick={() => props.onChange(props.injuries.filter(x => x.id !== i.id))}>
                Remove
              </button>
            </div>
          ))}
          {importMsg && <div className="faint tr-empty">{importMsg}</div>}
        </div>
      </div>
    </div>
  )
}
