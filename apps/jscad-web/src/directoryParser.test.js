/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isExecutable, fetchDirectoryListing } from './directoryParser.js'

// ── helpers ────────────────────────────────────────────────────────────────

function mockFetch(html, { ok = true, status = 200 } = {}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(html),
  }))
}

function apacheHtml(...links) {
  const rows = links.map(href => `<a href="${href}">${href}</a>`).join('\n')
  return `<html><body><pre>${rows}</pre></body></html>`
}

beforeEach(() => vi.restoreAllMocks())

// ── isExecutable ───────────────────────────────────────────────────────────

describe('isExecutable', () => {
  it('returns true for .js', () => expect(isExecutable('model.js')).toBe(true))
  it('returns true for .scad', () => expect(isExecutable('part.scad')).toBe(true))
  it('returns false for .html', () => expect(isExecutable('index.html')).toBe(false))
  it('returns false for .stl', () => expect(isExecutable('model.stl')).toBe(false))
  it('returns false for .png', () => expect(isExecutable('image.png')).toBe(false))
  it('returns false for bare directory name', () => expect(isExecutable('mydir/')).toBe(false))
  it('returns false for empty string', () => expect(isExecutable('')).toBe(false))
})

// ── fetchDirectoryListing ──────────────────────────────────────────────────

describe('fetchDirectoryListing', () => {
  it('returns empty dirs and files for a listing with no links', async () => {
    mockFetch('<html><body><pre></pre></body></html>')
    expect(await fetchDirectoryListing('/examples/')).toEqual({ dirs: [], files: [] })
  })

  it('identifies .js files', async () => {
    mockFetch(apacheHtml('model.js'))
    const { files, dirs } = await fetchDirectoryListing('/examples/')
    expect(files).toEqual(['model.js'])
    expect(dirs).toEqual([])
  })

  it('identifies .scad files', async () => {
    mockFetch(apacheHtml('part.scad'))
    const { files } = await fetchDirectoryListing('/examples/')
    expect(files).toContain('part.scad')
  })

  it('identifies directories (trailing slash)', async () => {
    mockFetch(apacheHtml('subdir/'))
    const { dirs, files } = await fetchDirectoryListing('/examples/')
    expect(dirs).toEqual(['subdir'])
    expect(files).toEqual([])
  })

  it('strips trailing slash from directory names', async () => {
    mockFetch(apacheHtml('my-dir/'))
    const { dirs } = await fetchDirectoryListing('/examples/')
    expect(dirs[0]).toBe('my-dir')
  })

  it('handles multiple files and directories together', async () => {
    mockFetch(apacheHtml('bosl/', 'basic/', 'gear.example.js', 'clock.example.js'))
    const { dirs, files } = await fetchDirectoryListing('/examples/')
    expect(dirs).toEqual(['bosl', 'basic'])
    expect(files).toEqual(['gear.example.js', 'clock.example.js'])
  })

  it('filters out ../ parent navigation link', async () => {
    mockFetch(apacheHtml('../', 'model.js'))
    const { dirs, files } = await fetchDirectoryListing('/examples/')
    expect(dirs).toEqual([])
    expect(files).toEqual(['model.js'])
  })

  it('filters out ?sort query-string links', async () => {
    mockFetch(`<html><body><pre>
      <a href="?C=N&amp;O=D">Name</a>
      <a href="model.js">model.js</a>
    </pre></body></html>`)
    const { files } = await fetchDirectoryListing('/examples/')
    expect(files).toEqual(['model.js'])
  })

  it('filters out https:// absolute URLs', async () => {
    mockFetch(apacheHtml('https://external.com/model.js', 'local.js'))
    const { files } = await fetchDirectoryListing('/examples/')
    expect(files).toEqual(['local.js'])
  })

  it('filters out root-relative paths pointing to a different directory', async () => {
    mockFetch(apacheHtml('/other/path.js', 'local.js'))
    const { files } = await fetchDirectoryListing('/examples/')
    expect(files).toEqual(['local.js'])
  })

  it('handles serve-index absolute hrefs for files', async () => {
    // serve-index (used by live-server) generates absolute paths like /examples/foo.js
    mockFetch(apacheHtml('/examples/model.js', '/examples/part.scad'))
    const { files, dirs } = await fetchDirectoryListing('/examples/')
    expect(files).toEqual(['model.js', 'part.scad'])
    expect(dirs).toEqual([])
  })

  it('handles serve-index absolute hrefs for directories (no trailing slash)', async () => {
    mockFetch(apacheHtml('/examples/bosl', '/examples/basic'))
    const { dirs, files } = await fetchDirectoryListing('/examples/')
    expect(dirs).toEqual(['bosl', 'basic'])
    expect(files).toEqual([])
  })

  it('handles mixed serve-index listing with dirs and files', async () => {
    mockFetch(apacheHtml('/examples/bosl', '/examples/STLImport', '/examples/gear.example.js'))
    const { dirs, files } = await fetchDirectoryListing('/examples/')
    expect(dirs).toContain('bosl')
    expect(dirs).toContain('STLImport')
    expect(files).toEqual(['gear.example.js'])
  })

  it('filters out non-executable files (.html, .txt, .stl)', async () => {
    mockFetch(apacheHtml('index.html', 'readme.txt', 'model.stl', 'model.js'))
    const { files } = await fetchDirectoryListing('/examples/')
    expect(files).toEqual(['model.js'])
  })

  it('decodes percent-encoded filenames', async () => {
    mockFetch(apacheHtml('my%20model.js'))
    const { files } = await fetchDirectoryListing('/examples/')
    expect(files).toEqual(['my model.js'])
  })

  it('throws when fetch returns a non-OK status', async () => {
    mockFetch('', { ok: false, status: 404 })
    await expect(fetchDirectoryListing('/missing/')).rejects.toThrow('404')
  })

  it('propagates network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    await expect(fetchDirectoryListing('/examples/')).rejects.toThrow('network error')
  })
})
