import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

// Mock the Renderer component since jsdom doesn't support WebGL
vi.mock('../hooks/render', () => ({
  Renderer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mock-renderer">{children}</div>
  ),
}))

import App from '../App'

test('loads and displays greeting', () => {
  render(<App />)
  expect(screen.getByText('jscad ui')).toBeInTheDocument()
})
