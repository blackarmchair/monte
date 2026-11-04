// A screen that throws while rendering shows this instead of blanking the whole window.
import { Component, type ErrorInfo, type ReactNode } from 'react'

export default class CrashGuard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 32, maxWidth: 640 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>This screen hit a problem.</div>
        <div style={{ opacity: 0.75, overflowWrap: 'anywhere' }}>{this.state.error.message}</div>
        <div>
          <button className="btn primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    )
  }
}
