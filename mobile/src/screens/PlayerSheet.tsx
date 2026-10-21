// Player sheet (from Players, or a team's roster): his value read or his usage gap, then the
// action — trade for him, offer him, or mark him injured.
import { Linking, View } from 'react-native'
import { useApp } from '@/lib/store'
import { marketTag, mineOf, useAddToTrade, useTrade } from '@/lib/trade'
import { useOverlay } from '@/ui/overlay'
import { Btn, PlayerAvatar, Row, T, Tiles, num } from '@/ui/kit'
import { useTheme } from '@/ui/theme'

export type PlayerRef = { id: string; name: string; pos: string; team: string; age: number | null; owner: number | null }

/** usage and projection bars run 0–25 PPG */
const PPG_SCALE = 25
const n1 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(1))
const sgn1 = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`

export default function PlayerSheet({ player }: { player: PlayerRef }) {
  const t = useTheme()
  const { pw, context, openOverrides } = useApp()
  const { byId, me, teamName } = useTrade()
  const { closeSheet } = useOverlay()
  const add = useAddToTrade()
  const asset = byId.get(player.id)
  const owner = asset?.owner ?? player.owner
  const usage = pw.result?.rows.find(r => r.player_id === player.id)
  const tag = asset ? marketTag(asset) : null
  const tagColor = tag?.tone === 'acc' ? t.acc : tag?.tone === 'pos' ? t.pos : t.mute
  const where = owner == null ? 'free agent' : owner === me ? 'on your team' : `on ${teamName(owner)}`
  const last = player.name.split(' ').slice(-1)[0]
  const gap = usage?.delta ?? null

  return (
    <View style={{ gap: 14 }}>
      <Row gap={12}>
        <PlayerAvatar id={player.id} name={player.name} size={56} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T v="title" size={28}>
            {player.name}
          </T>
          <T v="small" c="mute" size={14}>
            {[player.pos, player.team, player.age ? `age ${player.age}` : null, where].filter(Boolean).join(' · ')}
          </T>
        </View>
      </Row>

      {asset ? (
        <Tiles
          items={[
            { k: 'Sheet', v: num(mineOf(asset)) },
            { k: 'Market', v: asset.market == null ? '—' : num(asset.val) },
            { k: 'Read', v: tag!.label, color: tagColor },
          ]}
        />
      ) : usage ? (
        <Tiles
          items={[
            { k: 'Usage', v: n1(usage.usagePPG) },
            { k: 'Proj', v: n1(usage.sleeperPPG) },
            { k: 'Gap', v: gap == null ? '—' : sgn1(gap), color: gap == null ? undefined : gap > 0 ? t.pos : t.neg },
          ]}
        />
      ) : (
        <T v="small" c="mute" size={14}>
          Not on Tyler's sheet or the usage board.
        </T>
      )}

      {usage && usage.usagePPG != null && usage.sleeperPPG != null && gap != null && (
        <View style={{ gap: 6 }}>
          <T c="ink2" size={14}>
            Usage {n1(usage.usagePPG)} PPG vs projection {n1(usage.sleeperPPG)}: {gap > 0 ? 'room to grow' : 'running hot'} ({sgn1(gap)}).
          </T>
          <View style={{ height: 10, backgroundColor: t.chip }}>
            <View
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${(Math.min(usage.usagePPG, usage.sleeperPPG) / PPG_SCALE) * 100}%`,
                width: `${(Math.abs(gap) / PPG_SCALE) * 100}%`,
                backgroundColor: gap > 0 ? t.pos : t.neg,
              }}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T v="small" c="mute" size={12}>
              0 PPG
            </T>
            <T v="small" c="mute" size={12}>
              {PPG_SCALE} PPG
            </T>
          </View>
        </View>
      )}

      {owner != null && asset ? (
        <Btn big full kind="primary" label={owner === me ? 'Offer in a trade' : `Trade for ${last}`} onPress={() => add(asset.id, owner, asset.name)} />
      ) : owner == null && context ? (
        <Btn big full label="Claim in Sleeper ↗" onPress={() => void Linking.openURL(`https://sleeper.com/leagues/${context.league.league_id}/players`)} />
      ) : null}
      <Btn
        big
        full
        kind="quiet"
        label="Add injury override"
        onPress={() => {
          closeSheet()
          openOverrides({ id: player.id, name: player.name, pos: player.pos, team: player.team, injury: '' })
        }}
      />
    </View>
  )
}
