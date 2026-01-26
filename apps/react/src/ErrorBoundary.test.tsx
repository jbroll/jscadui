import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorBoundary, IsRecoverablePredicate } from './ErrorBoundary'

// Component that throws an error
function ThrowError({ error }: { error: Error }): JSX.Element {
  if (error) throw error
  return <></>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // Suppress React error boundary console errors in tests
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Test content</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('Test content')).toBeInTheDocument()
  })

  it('renders error UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowError error={new Error('Test error')} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Error details')).toBeInTheDocument()
  })

  it('shows Try Again button for recoverable errors', () => {
    render(
      <ErrorBoundary>
        <ThrowError error={new Error('Network timeout')} />
      </ErrorBoundary>
    )
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
  })

  it('hides Try Again button for WebGL errors', () => {
    render(
      <ErrorBoundary>
        <ThrowError error={new Error('WebGL not supported')} />
      </ErrorBoundary>
    )
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument()
    expect(screen.getByText(/WebGL initialization failed/)).toBeInTheDocument()
  })

  it('hides Try Again button for webgl errors (case insensitive)', () => {
    render(
      <ErrorBoundary>
        <ThrowError error={new Error('WEBGL context lost')} />
      </ErrorBoundary>
    )
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument()
  })

  it('shows error message in details', () => {
    render(
      <ErrorBoundary>
        <ThrowError error={new Error('Specific error message')} />
      </ErrorBoundary>
    )
    // Open the details
    fireEvent.click(screen.getByText('Error details'))
    expect(screen.getByText('Specific error message')).toBeInTheDocument()
  })

  it('hides Try Again button for context lost errors', () => {
    render(
      <ErrorBoundary>
        <ThrowError error={new Error('GPU context lost')} />
      </ErrorBoundary>
    )
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument()
  })

  describe('custom isRecoverable predicate', () => {
    it('uses custom predicate when provided', () => {
      // Custom predicate that marks all errors as non-recoverable
      const customPredicate: IsRecoverablePredicate = () => false

      render(
        <ErrorBoundary isRecoverable={customPredicate}>
          <ThrowError error={new Error('Any error')} />
        </ErrorBoundary>
      )
      expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument()
    })

    it('custom predicate can override default WebGL behavior', () => {
      // Custom predicate that treats WebGL errors as recoverable
      const customPredicate: IsRecoverablePredicate = () => true

      render(
        <ErrorBoundary isRecoverable={customPredicate}>
          <ThrowError error={new Error('WebGL not supported')} />
        </ErrorBoundary>
      )
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
    })

    it('custom predicate receives the error object', () => {
      const customPredicate = vi.fn().mockReturnValue(true)

      render(
        <ErrorBoundary isRecoverable={customPredicate}>
          <ThrowError error={new Error('Custom error')} />
        </ErrorBoundary>
      )

      expect(customPredicate).toHaveBeenCalled()
      expect(customPredicate.mock.calls[0][0]).toBeInstanceOf(Error)
      expect(customPredicate.mock.calls[0][0].message).toBe('Custom error')
    })

    it('custom predicate can check error name', () => {
      const customPredicate: IsRecoverablePredicate = (error) => {
        return error.name !== 'FatalError'
      }

      const fatalError = new Error('Something bad')
      fatalError.name = 'FatalError'

      render(
        <ErrorBoundary isRecoverable={customPredicate}>
          <ThrowError error={fatalError} />
        </ErrorBoundary>
      )
      expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument()
    })
  })
})
