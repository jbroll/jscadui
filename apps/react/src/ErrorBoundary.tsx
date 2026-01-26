import { Component, ErrorInfo, ReactNode } from 'react'

/**
 * Predicate function to determine if an error is recoverable.
 * @param error - The error that was caught
 * @returns true if the error is recoverable (show retry button), false otherwise
 */
export type IsRecoverablePredicate = (error: Error) => boolean

interface Props {
  children: ReactNode
  /**
   * Custom predicate to determine if an error is recoverable.
   * If not provided, uses default logic that checks for WebGL-related errors.
   */
  isRecoverable?: IsRecoverablePredicate
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

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  /**
   * Default predicate for determining if an error is recoverable.
   * Checks error message and name for known non-recoverable patterns.
   */
  static defaultIsRecoverable(error: Error): boolean {
    const message = error.message?.toLowerCase() ?? ''
    const name = error.name?.toLowerCase() ?? ''

    // WebGL support issues are typically not recoverable without browser/driver changes
    if (message.includes('webgl') || name.includes('webgl')) {
      return false
    }

    // Context lost errors are usually not recoverable
    if (message.includes('context lost')) {
      return false
    }

    return true
  }

  /** Check if error is likely recoverable */
  isRecoverable(): boolean {
    const error = this.state.error
    if (!error) return true

    // Use custom predicate if provided, otherwise use default
    const predicate = this.props.isRecoverable ?? ErrorBoundary.defaultIsRecoverable
    return predicate(error)
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
