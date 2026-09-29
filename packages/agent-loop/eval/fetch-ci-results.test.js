import { describe, expect, it, vi } from 'vitest'
import { fetchCiResults, parseIndex, sciPath } from './fetch-ci-results.js'

describe('parseIndex', () => {
  it('splits lines, trims and drops blanks', () => {
    expect(parseIndex('a.json\n b.json \n\n c.json\n')).toEqual(['a.json', 'b.json', 'c.json'])
  })
  it('is empty for an empty index', () => {
    expect(parseIndex('')).toEqual([])
    expect(parseIndex('\n\n')).toEqual([])
  })
})

describe('sciPath', () => {
  it('resolves beside the repo checkout by default', () => {
    expect(sciPath({}, '/home/u/src/jscadui')).toBe('/home/u/src/simple-ci/sci')
  })
  it('is overridden by SCI', () => {
    expect(sciPath({ SCI: '/custom/sci' }, '/home/u/src/jscadui')).toBe('/custom/sci')
  })
})

const fakeFs = (existing = []) => {
  const written = {}
  return {
    calls: written,
    fs: {
      existsSync: (path) => existing.includes(path),
      mkdirSync: vi.fn(),
      writeFileSync: (path, content) => {
        written[path] = content
      },
    },
  }
}

describe('fetchCiResults', () => {
  it('fetches the index, then each listed file, writing it under dataDir', () => {
    const run = vi.fn((sci, args) => {
      if (args[2] === 'eval-results/index.txt') return 'a.json\nb.json\n'
      if (args[2] === 'eval-results/a.json') return '{"a":1}'
      if (args[2] === 'eval-results/b.json') return '{"b":1}'
      throw new Error(`unexpected args ${args}`)
    })
    const { fs, calls } = fakeFs()
    const { files, fetched } = fetchCiResults('job1', { sci: '/bin/sci', dataDir: '/data/results', run, fs })

    expect(run).toHaveBeenCalledWith('/bin/sci', ['artifact', 'job1', 'eval-results/index.txt'])
    expect(run).toHaveBeenCalledWith('/bin/sci', ['artifact', 'job1', 'eval-results/a.json'])
    expect(run).toHaveBeenCalledWith('/bin/sci', ['artifact', 'job1', 'eval-results/b.json'])
    expect(files).toEqual(['a.json', 'b.json'])
    expect(fetched).toEqual(['a.json', 'b.json'])
    expect(calls).toEqual({
      '/data/results/a.json': '{"a":1}',
      '/data/results/b.json': '{"b":1}',
    })
  })

  it('never calls sci for a file already present in dataDir', () => {
    const run = vi.fn((sci, args) => {
      if (args[2] === 'eval-results/index.txt') return 'a.json\nb.json\n'
      if (args[2] === 'eval-results/b.json') return '{"b":1}'
      throw new Error(`unexpected fetch of ${args[2]}`)
    })
    const { fs, calls } = fakeFs(['/data/results/a.json'])
    const { fetched } = fetchCiResults('job1', { sci: '/bin/sci', dataDir: '/data/results', run, fs })

    expect(fetched).toEqual(['b.json'])
    expect(calls).toEqual({ '/data/results/b.json': '{"b":1}' })
  })

  it('creates dataDir before writing', () => {
    const run = vi.fn(() => '')
    const { fs } = fakeFs()
    fetchCiResults('job1', { sci: '/bin/sci', dataDir: '/data/results', run, fs })
    expect(fs.mkdirSync).toHaveBeenCalledWith('/data/results', { recursive: true })
  })

  it('returns no fetched files for an empty index', () => {
    const run = vi.fn(() => '')
    const { fs } = fakeFs()
    const { files, fetched } = fetchCiResults('job1', { sci: '/bin/sci', dataDir: '/data/results', run, fs })
    expect(files).toEqual([])
    expect(fetched).toEqual([])
  })
})
