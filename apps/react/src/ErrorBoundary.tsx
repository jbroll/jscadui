import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  /** Check if error is likely non-recoverable (e.g., missing WebGL support) */
  isRecoverable(): boolean {
    const message = this.state.error?.message?.toLowerCase() ?? ''
    // WebGL support issues are typically not recoverable without browser/driver changes
    return !message.includes('webgl')
  }

  render() {
    if (this.state.hasError) {
      const recoverable = this.isRecoverable()
      return (
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <h2>Something went wrong</h2>
          <p>
            {!recoverable
              ? 'WebGL initialization failed. Please check your browser supports WebGL.'
              : 'An error occurred while rendering the 3D view.'}
          </p>
          {recoverable && (
            <button
              onClick={this.handleRetry}
              style={{
                marginTop: '10px',
                padding: '8px 16px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
          )}
          <details style={{ marginTop: '10px', textAlign: 'left' }}>
            <summary>Error details</summary>
            <pre style={{ fontSize: '12px', overflow: 'auto' }}>
              {this.state.error?.message}
            </pre>
          </details>
        </div>
      )
    }

    return this.props.children
  }
}
