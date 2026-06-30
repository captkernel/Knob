import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Don't let a rejected IPC promise become a silent unhandled rejection.
window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] unhandled rejection:', e.reason)
})

// Catch any render-time error so a single component fault doesn't leave a blank
// white panel with no way out — show a clear, recoverable message instead.
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[renderer] React error:', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div
        style={{
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          textAlign: 'center',
          font: '14px Segoe UI, system-ui, sans-serif',
          color: '#fca5a5',
          background: 'rgb(16 16 22)',
          borderRadius: 24
        }}
      >
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Something went wrong</div>
          <div style={{ color: '#9ca3af', marginBottom: 16 }}>
            Knob hit an unexpected error. Reopen it from the tray, or reload below.
          </div>
          <button
            onClick={() => location.reload()}
            style={{
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.06)',
              color: '#e5e7eb',
              borderRadius: 10,
              padding: '8px 16px',
              cursor: 'pointer'
            }}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)

if (!window.knob) {
  // The preload bridge failed to load — render a clear message instead of a
  // blank window with a cryptic "cannot read getSnapshot of undefined".
  root.render(
    <div
      style={{
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        textAlign: 'center',
        font: '14px Segoe UI, system-ui, sans-serif',
        color: '#fca5a5',
        background: 'rgb(16 16 22)',
        borderRadius: 24
      }}
    >
      <div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Knob failed to start</div>
        <div style={{ color: '#9ca3af' }}>
          The app bridge didn’t load. Try restarting Knob from the tray, or reinstalling.
        </div>
      </div>
    </div>
  )
} else {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
}
