// Picks: where your picks land (Pick odds). The rookie draft has its own section (Draft).
import PickOdds from './PickOdds'

export default function Picks() {
  return (
    <div className="page stack" style={{ gap: 20 }}>
      <PickOdds />
    </div>
  )
}
