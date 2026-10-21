// Leagues sheet (from the header): switch league; a check marks the current one.
import { Pressable, View } from 'react-native'
import { useApp } from '@/lib/store'
import { formatLabel, leagueAbbr } from '@/ui/league'
import { Icon } from '@/ui/icons'
import { ErrorBox, LeagueSquare, T } from '@/ui/kit'
import { useOverlay } from '@/ui/overlay'
import { useTheme } from '@/ui/theme'

export default function LeaguesSheet() {
  const t = useTheme()
  const { leagues, selected, selectLeague, leagueError, loadLeagues } = useApp()
  const { closeSheet } = useOverlay()
  return (
    <View>
      <T v="semi" size={18} style={{ paddingBottom: 10 }}>
        Leagues
      </T>
      {leagueError && <ErrorBox message={leagueError} onRetry={loadLeagues} />}
      {leagues.map(l => {
        const on = l.league_id === selected
        return (
          <Pressable
            key={l.league_id}
            onPress={() => {
              selectLeague(l.league_id)
              closeSheet()
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              minHeight: 60,
              paddingHorizontal: 10,
              borderBottomWidth: 1,
              borderColor: t.line,
              backgroundColor: on || pressed ? t.card : 'transparent',
            })}
          >
            <LeagueSquare label={leagueAbbr(l.name)} src={l.avatar} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T v="semi" lines={1}>
                {l.name}
              </T>
              <T v="small" c="mute">
                {formatLabel(l)}
              </T>
            </View>
            {on && <Icon name="check" color={t.acc} size={20} stroke={2} />}
          </Pressable>
        )
      })}
    </View>
  )
}
