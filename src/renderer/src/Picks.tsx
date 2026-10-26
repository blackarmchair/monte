// Picks: where your picks land (Pick odds) and how the rookie draft went (Draft).
import { useApp } from './store'
import { Seg } from './ui'
import DraftPanel from './Draft'
import PickOdds from './PickOdds'

export default function Picks() {
  const { picksSeg, setPicksSeg, context } = useApp()
  return (
    <div className="page stack" style={{ gap: 20 }}>
      <div>
        <Seg
          lg
          value={picksSeg}
          onChange={setPicksSeg}
          options={[
            { value: 'odds', label: 'Pick odds' },
            { value: 'draft', label: context ? `${context.draftSeason} draft` : 'Draft' },
          ]}
        />
      </div>
      {picksSeg === 'odds' ? <PickOdds /> : <DraftPanel />}
    </div>
  )
}
