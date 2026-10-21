// App-wide overlays: one bottom sheet (every detail view opens in it) and one toast. The provider
// holds the state; the hosts render inside the app's providers so sheet content can use them.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { font, FLOAT_RADIUS, SHEET_RADIUS, useTheme } from './theme'

/** The tab bar's height above the bottom inset; floating bars and the toast sit above it. */
export const TAB_H = 58
const TOAST_MS = 2800

type Toast = { msg: string; action?: { label: string; onPress: () => void } }
type Overlay = {
  sheet: ReactNode | null
  openSheet: (content: ReactNode) => void
  closeSheet: () => void
  toast: Toast | null
  showToast: (msg: string, action?: Toast['action']) => void
  hideToast: () => void
}

const Ctx = createContext<Overlay | null>(null)

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<ReactNode | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const showToast = useCallback((msg: string, action?: Toast['action']) => {
    clearTimeout(timer.current)
    setToast({ msg, action })
    timer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])
  const hideToast = useCallback(() => {
    clearTimeout(timer.current)
    setToast(null)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  const value = useMemo(
    () => ({ sheet, openSheet: (c: ReactNode) => setSheet(c), closeSheet: () => setSheet(null), toast, showToast, hideToast }),
    [sheet, toast, showToast, hideToast],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useOverlay(): Overlay {
  const o = useContext(Ctx)
  if (!o) throw new Error('useOverlay outside OverlayProvider')
  return o
}

/** The bottom sheet: scrim (tap to close), grabber, up to 88% of the screen, scrolls inside. */
export function SheetHost() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const { sheet, closeSheet } = useOverlay()
  // Keep the last content on screen while the sheet slides away.
  const [shown, setShown] = useState<ReactNode | null>(null)
  const [visible, setVisible] = useState(false)
  const y = useRef(new Animated.Value(height)).current
  const fade = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (sheet) {
      setShown(sheet)
      setVisible(true)
      Animated.parallel([
        Animated.timing(y, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start()
    } else if (visible) {
      Animated.parallel([
        Animated.timing(y, { toValue: height, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(({ finished }) => {
        // A sheet opened mid-close interrupts this; it must not then hide the new one.
        if (!finished) return
        setVisible(false)
        setShown(null)
      })
    }
  }, [sheet]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={closeSheet}>
      {/* The sheet rides up with the keyboard, so a field in it (Connect Sleeper) stays visible. */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(12,10,8,0.5)', opacity: fade }}>
          <Pressable style={{ flex: 1 }} onPress={closeSheet} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          style={{
            maxHeight: height * 0.88,
            backgroundColor: t.bg,
            borderTopWidth: 1,
            borderColor: t.line,
            borderTopLeftRadius: SHEET_RADIUS,
            borderTopRightRadius: SHEET_RADIUS,
            transform: [{ translateY: y }],
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 30,
            shadowOffset: { width: 0, height: -8 },
            elevation: 16,
          }}
        >
          <Pressable onPress={closeSheet} hitSlop={8} style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 14 }} accessibilityLabel="Close">
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: t.line }} />
          </Pressable>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 + insets.bottom }} keyboardShouldPersistTaps="handled">
            {shown}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/** The toast: above the tab bar, 2.8s, with an optional action. */
export function ToastHost() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { toast, hideToast } = useOverlay()
  if (!toast) return null
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: TAB_H + insets.bottom + 16,
        zIndex: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 48,
        paddingVertical: 8,
        paddingLeft: 14,
        paddingRight: 8,
        backgroundColor: t.ink,
        borderRadius: FLOAT_RADIUS,
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 6 },
        elevation: 12,
      }}
    >
      <Text style={{ flex: 1, fontFamily: font.sans, fontSize: 14, color: t.bg }}>{toast.msg}</Text>
      {toast.action && (
        <Pressable
          onPress={() => {
            const a = toast.action!
            hideToast()
            a.onPress()
          }}
          hitSlop={8}
          style={{ minHeight: 36, paddingHorizontal: 12, justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: font.sansSemi, fontSize: 14, color: t.accSoft }}>{toast.action.label}</Text>
        </Pressable>
      )}
    </View>
  )
}
