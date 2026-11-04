// Swipe a main screen sideways to move between the five tabs. It wraps each screen's content, so
// the header and tab bar don't take part, and Team, Player and Settings (not in TABS) are left alone.
//
// It only claims a drag once it is well past the distance at which a horizontal scroller grabs the
// touch, and it asks after anything deeper does, so pill rows, the stats table, sliders and the
// Players swipe cards keep their gestures.
import { useRef, type ReactNode } from 'react'
import { Animated, PanResponder, useWindowDimensions } from 'react-native'
import { TABS } from './TabBar'

const CLAIM_PX = 24
const FOLLOW = 0.25 // How far the screen trails the finger; a tab that isn't there drags less.
const FOLLOW_AT_END = 0.08
const COMMIT_WIDTH = 0.25
const FLICK_PX_PER_MS = 0.35

export default function SwipeTabs(props: { route: string; navigate: (name: string) => void; children: ReactNode }) {
  const { width } = useWindowDimensions()
  const x = useRef(new Animated.Value(0)).current
  const latest = useRef({ ...props, width })
  latest.current = { ...props, width }

  const neighbour = (dx: number) => TABS[TABS.findIndex(tab => tab.name === latest.current.route) + (dx < 0 ? 1 : -1)]
  const settle = () => Animated.timing(x, { toValue: 0, duration: 160, useNativeDriver: true }).start()

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.numberActiveTouches === 1 && Math.abs(g.dx) > CLAIM_PX && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        const past = g.dx - Math.sign(g.dx) * CLAIM_PX
        x.setValue(past * (neighbour(g.dx) ? FOLLOW : FOLLOW_AT_END))
      },
      onPanResponderRelease: (_, g) => {
        settle()
        const far = Math.abs(g.dx) > latest.current.width * COMMIT_WIDTH
        const flick = Math.abs(g.vx) > FLICK_PX_PER_MS && Math.sign(g.vx) === Math.sign(g.dx)
        const next = neighbour(g.dx)
        if (next && (far || flick)) latest.current.navigate(next.name)
      },
      onPanResponderTerminate: settle,
    }),
  ).current

  if (!TABS.some(tab => tab.name === props.route)) return <>{props.children}</>
  return (
    <Animated.View style={{ flex: 1, transform: [{ translateX: x }] }} {...pan.panHandlers}>
      {props.children}
    </Animated.View>
  )
}
