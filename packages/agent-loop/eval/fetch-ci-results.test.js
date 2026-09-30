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

  it('falls back to a directory listing when eval-results/index.txt is missing but sci artifact can list it', () => {
    const run = vi.fn((sci, args) => {
      if (args[2] === 'eval-results/index.txt') throw new Error('404 Not Found: eval-results/index.txt')
      if (args[2] === 'eval-results') return 'a.json\nb.json\n'
      throw new Error(`unexpected args ${args}`)
    })
    const { fs } = fakeFs()
    const { files, fetched, fallback } = fetchCiResults('job1', { sci: '/bin/sci', dataDir: '/data/results', run, fs })
    expect(fallback).toBe('listed')
    expect(files).toEqual(['a.json', 'b.json'])
    expect(fetched).toEqual([])
  })

  it('prints an scp message naming the job worktree when sci artifact cannot list the directory', () => {
    const run = vi.fn((sci, args) => {
      if (args[0] === 'artifact') throw new Error('404 Not Found: not a file')
      if (args[0] === 'path') return '/data/ci-workspace/jscadui-job1\n'
      throw new Error(`unexpected args ${args}`)
    })
    const { fs } = fakeFs()
    const log = vi.fn()
    const { files, fetched, fallback, worktree } = fetchCiResults('job1', { sci: '/bin/sci', dataDir: '/data/results', run, fs, log })

    expect(fallback).toBe('scp')
    expect(files).toEqual([])
    expect(fetched).toEqual([])
    expect(worktree).toBe('/data/ci-workspace/jscadui-job1')
    expect(run).toHaveBeenCalledWith('/bin/sci', ['path', 'job1'])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('scp <ci-host>:/data/ci-workspace/jscadui-job1/eval-results/*.json'))
  })

  it('still prints a usable message when sci path also fails', () => {
    const run = vi.fn(() => {
      throw new Error('server unreachable')
    })
    const { fs } = fakeFs()
    const log = vi.fn()
    const { fallback, worktree } = fetchCiResults('job1', { sci: '/bin/sci', dataDir: '/data/results', run, fs, log })

    expect(fallback).toBe('scp')
    expect(worktree).toBe('')
    expect(log).toHaveBeenCalledWith(expect.stringContaining("job job1's worktree"))
  })
})
