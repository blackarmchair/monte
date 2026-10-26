// Leagues sheet (from the header): switch league; a check marks the current one.
import { View } from 'react-native'
import { useApp } from '@/lib/store'
import { formatLabel, leagueAbbr } from '@/ui/league'
import { Check, ErrorBox, GradCard, LeagueAvatar, Stack2, T } from '@/ui/kit'
import { useOverlay } from '@/ui/overlay'

export default function LeaguesSheet() {
  const { leagues, selected, selectLeague, leagueError, loadLeagues } = useApp()
  const { closeSheet } = useOverlay()
  return (
    <View style={{ gap: 8 }}>
      <T v="bold" size={20} style={{ paddingBottom: 4 }}>
        Leagues
      </T>
      {leagueError && <ErrorBox message={leagueError} onRetry={loadLeagues} />}
      {leagues.map(l => (
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
