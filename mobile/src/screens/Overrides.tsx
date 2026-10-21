// Injury overrides: mark a player out until a week or for the season. They outrank Sleeper's tag
// and ESPN's return estimate in Pick odds, Usage and Lineup, and are per player, not per league.
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { ManualInjury, PlayerHit } from '@monte/core/types'
import { monte } from '@/lib/monte'
import { useApp } from '@/lib/store'
import { Btn, Empty, Field, Notice, Row, Seg, T } from '@/ui/kit'
import { font, RADIUS, useTheme } from '@/ui/theme'

export default function Overrides() {
  const t = useTheme()
  const { settings, setSettings, context, overridePrefill, setOverridePrefill } = useApp()
  const injuries = settings?.injuries ?? []
  const week = context?.week ?? 0
  const first = Math.max(1, week + 1)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PlayerHit[]>([])
  const [pick, setPick] = useState<PlayerHit | null>(null)
  const [season, setSeason] = useState(false)
  const [rwSet, setRwSet] = useState<number | null>(null)
  const rw = rwSet ?? first
  const [msg, setMsg] = useState<string | null>(null)

  // Opened from a player sheet: start with him picked.
  useEffect(() => {
    if (!overridePrefill) return
    setPick(overridePrefill)
    setQ(overridePrefill.name)
    setOverridePrefill(null)
  }, [overridePrefill]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search over the cached Sleeper player table.
  useEffect(() => {
    if (pick || q.trim().length < 2) return setHits([])
    const id = setTimeout(() => void monte.searchPlayers(q).then(r => setHits(r.ok ? r.value.slice(0, 6) : [])), 200)
    return () => clearTimeout(id)
  }, [q, pick])

  const save = (next: ManualInjury[]) => setSettings({ injuries: next })
  const existing = new Set(injuries.map(i => i.id))
  const add = () => {
    if (!pick) return
    const entry: ManualInjury = { id: pick.id, name: pick.name, pos: pick.pos, team: pick.team, returnWeek: season ? null : rw, addedAt: new Date().toISOString() }
    void save([...injuries.filter(i => i.id !== pick.id), entry])
    setPick(null)
    setQ('')
    setSeason(false)
    setRwSet(null)
  }
  const expired = injuries.filter(i => i.returnWeek != null && i.returnWeek <= week)
  const sorted = [...injuries].sort((a, b) => (a.returnWeek ?? 99) - (b.returnWeek ?? 99) || a.name.localeCompare(b.name))
  const doImport = async () => {
    const r = await monte.bundledInjuries()
    if (!r.ok) return setMsg(r.error)
    const fresh = r.value.filter(i => !existing.has(i.id))
    await save([...injuries, ...fresh])
    setMsg(`Imported ${fresh.length} of ${r.value.length}.`)
  }
  const stepBtn = (label: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.line, borderRadius: RADIUS, backgroundColor: pressed ? t.card : 'transparent' })}
    >
      <T size={18}>{label}</T>
    </Pressable>
  )

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <T c="mute" size={14}>
        Mark a player out until a week or for the season. These outrank Sleeper's tag and ESPN's estimate in Pick odds, Usage and Lineup.
      </T>

      <View style={{ padding: 14, gap: 10, borderWidth: 1, borderColor: t.line, borderRadius: RADIUS, backgroundColor: t.card2 }}>
        <Field
          value={q}
          onChangeText={v => {
            setQ(v)
            setPick(null)
          }}
          placeholder="Search a player"
          boxStyle={{ minHeight: 46, backgroundColor: t.bg }}
        />
        {!pick &&
          hits.map(h => (
            <Pressable
              key={h.id}
              onPress={() => {
                setPick(h)
                setQ(h.name)
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                minHeight: 44,
                paddingHorizontal: 10,
                borderWidth: 1,
                borderColor: t.line,
                borderRadius: RADIUS,
                backgroundColor: pressed ? t.card : t.bg,
              })}
            >
              <T lines={1} style={{ flex: 1 }}>
                {h.name}
              </T>
              <T v="small" c="mute">
                {h.pos} · {h.team}
                {existing.has(h.id) ? ' · listed' : h.injury ? ` · ${h.injury}` : ''}
              </T>
            </Pressable>
          ))}
        <Seg
          fill
          value={season ? 'season' : 'week'}
          onChange={v => setSeason(v === 'season')}
          options={[
            { value: 'week', label: 'Back in a week' },
            { value: 'season', label: 'Out for season' },
          ]}
        />
        {!season && (
          <Row gap={12}>
            <T style={{ flex: 1 }}>Back in week</T>
            {stepBtn('−', () => setRwSet(Math.max(first, rw - 1)))}
            <T v="mono" size={20} style={{ width: 28, textAlign: 'center', fontFamily: font.mono }}>
              {rw}
            </T>
            {stepBtn('+', () => setRwSet(Math.min(18, rw + 1)))}
          </Row>
        )}
        <Btn big full kind="primary" label={pick ? `${existing.has(pick.id) ? 'Update' : 'Add'} override for ${pick.name}` : 'Pick a player'} disabled={!pick} onPress={add} />
      </View>

      {expired.length > 0 && (
        <View style={{ gap: 6 }}>
          <Notice message={`${expired.length} override${expired.length === 1 ? ' has' : 's have'} a return week that has already arrived.`} />
          <Btn label="Clear expired" onPress={() => void save(injuries.filter(i => !expired.includes(i)))} />
        </View>
      )}

      {sorted.length === 0 ? (
        <>
          <Empty message="No overrides. Monte is using Sleeper's tags and ESPN's return estimates." />
          <Btn kind="link" label="Import from sleeperStandings config" onPress={doImport} />
        </>
      ) : (
        sorted.map(i => (
          <Row key={i.id} gap={12} style={{ paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: t.line, borderRadius: RADIUS, backgroundColor: t.card2 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T v="semi" lines={1}>
                {i.name}{' '}
                <T v="small" c="mute">
                  {i.pos} · {i.team}
                </T>
              </T>
              <T v="small" c={expired.includes(i) ? 'mute' : 'warn'}>
                {i.returnWeek == null ? 'Out for the season' : `Out until week ${i.returnWeek}`}
              </T>
            </View>
            <Btn kind="quiet" label="Remove" onPress={() => void save(injuries.filter(x => x.id !== i.id))} />
          </Row>
        ))
      )}
      {msg && (
        <T v="small" c="mute">
          {msg}
        </T>
      )}
    </ScrollView>
  )
}
