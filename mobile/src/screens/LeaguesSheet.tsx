// Leagues sheet (from the header): switch league; a check marks the current one. Edit shows or hides leagues.
import { useState } from 'react'
import { View } from 'react-native'
import { useApp } from '@/lib/store'
import { formatLabel, leagueAbbr } from '@/ui/league'
import { Btn, Check, ErrorBox, GradCard, LeagueAvatar, Stack2, T } from '@/ui/kit'
import { useOverlay } from '@/ui/overlay'

export default function LeaguesSheet() {
  const { leagues, allLeagues, toggleLeagueHidden, selected, selectLeague, leagueError, loadLeagues } = useApp()
  const { closeSheet } = useOverlay()
  const [editing, setEditing] = useState(false)
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 4 }}>
        <T v="bold" size={20}>
          Leagues
        </T>
        {allLeagues.length > 1 && <Btn kind="link" label={editing ? 'Done' : 'Edit'} onPress={() => setEditing(e => !e)} />}
      </View>
      {leagueError && <ErrorBox message={leagueError} onRetry={loadLeagues} />}
      {editing && (
        <T v="small" c="mute">
          Untick a league to hide it. Hidden leagues stay out of Monte and send no alerts.
        </T>
      )}
      {editing &&
        allLeagues.map(l => (
          <GradCard key={l.league_id} color={null} minHeight={62} dim={l.hidden} accessibilityLabel={l.hidden ? `Show ${l.name}` : `Hide ${l.name}`} onPress={() => toggleLeagueHidden(l.league_id)}>
            <LeagueAvatar label={leagueAbbr(l.name)} src={l.avatar} />
            <Stack2 title={l.name} sub={l.hidden ? 'Hidden' : formatLabel(l)} />
            <Check on={!l.hidden} />
          </GradCard>
        ))}
      {!editing && leagues.map(l => (
        <GradCard
          key={l.league_id}
          color={null}
          minHeight={62}
          onPress={() => {
            selectLeague(l.league_id)
            closeSheet()
          }}
        >
          <LeagueAvatar label={leagueAbbr(l.name)} src={l.avatar} />
          <Stack2 title={l.name} sub={formatLabel(l)} />
          <Check on={l.league_id === selected} />
        </GradCard>
      ))}
    </View>
  )
}
