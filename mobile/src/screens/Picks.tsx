// Picks: where your picks land (Pick odds) and how the rookie draft went (Draft).
import { ScrollView, View } from 'react-native'
import { useApp } from '@/lib/store'
import { Seg, useTopOnFocus } from '@/ui/kit'
import { useTheme } from '@/ui/theme'
import DraftPanel from './Draft'
import PickOdds from './PickOdds'

export default function Picks() {
  const t = useTheme()
  const { picksSeg, setPicksSeg } = useApp()
  const scroll = useTopOnFocus<ScrollView>()
  return (
    <ScrollView ref={scroll} style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Seg
          fill
          value={picksSeg}
          onChange={v => {
            setPicksSeg(v)
            scroll.current?.scrollTo({ y: 0, animated: false })
          }}
          options={[
            { value: 'odds', label: 'Pick odds' },
            { value: 'draft', label: 'Draft' },
          ]}
        />
      </View>
      {picksSeg === 'odds' ? <PickOdds /> : <DraftPanel />}
    </ScrollView>
  )
}
