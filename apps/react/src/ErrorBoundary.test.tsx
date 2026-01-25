import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

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
})
