import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { exitCode, fetchCiResults, parseIndex, renderViews, sciPath } from './fetch-ci-results.js'

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
      readFileSync: () => '',
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

describe('exitCode', () => {
  it('is non-zero for a mismatched render or the scp fallback, zero otherwise', () => {
    expect(exitCode({ renders: { mismatched: ['c.renders/toy-caboose-1/side.png'] } })).toBe(1)
    expect(exitCode({ fallback: 'scp' })).toBe(1)
    expect(exitCode({ renders: { mismatched: [] } })).toBe(0)
    expect(exitCode({ fallback: 'listed', renders: { mismatched: [] } })).toBe(0)
    expect(exitCode({})).toBe(0)
  })
})

describe('a complex pass', () => {
  const png = Buffer.from('png bytes')
  const sha = createHash('sha256').update(png).digest('hex')
  const complexFile = (views) => JSON.stringify({ suite: 'complex', results: [{ render: { views } }] })
  const view = (name, digest = sha) => ({ name, path: `c.renders/toy-caboose-1/${name}.png`, sha256: digest })
  const fakeFs = () => {
    const written = {}
    const removed = []
    return {
      written,
      removed,
      fs: {
        existsSync: () => false,
        mkdirSync: vi.fn(),
        writeFileSync: (path, content) => {
          written[path] = content
        },
        readdirSync: () => ['a.renders', 'c.renders', 'c.json'],
        rmSync: (path) => removed.push(path),
      },
    }
  }

  it('copies each view checked against its sha256 and removes an older pass renders', () => {
    const run = (_sci, args) => (args[2] === 'eval-results/index.txt' ? 'c.json\n' : complexFile([view('iso-front'), view('side', 'f'.repeat(64))]))
    const runBytes = vi.fn(() => png)
    const { fs, written, removed } = fakeFs()
    const log = vi.fn()
    const out = fetchCiResults('job1', { sci: '/bin/sci', dataDir: '/data/results', run, runBytes, fs, log })
    expect(runBytes).toHaveBeenCalledWith('/bin/sci', ['artifact', 'job1', 'eval-results/c.renders/toy-caboose-1/iso-front.png'])
    expect(written['/data/results/c.renders/toy-caboose-1/iso-front.png']).toBe(png)
    expect(Object.keys(written)).not.toContain('/data/results/c.renders/toy-caboose-1/side.png')
    expect(out.renders).toEqual({ fetched: 1, mismatched: ['c.renders/toy-caboose-1/side.png'] })
    expect(removed).toEqual(['/data/results/a.renders'])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('did not match their sha256'))
  })

  it('names the path and logs the expected and actual hash for each mismatched render', () => {
    const wrongSha = 'f'.repeat(64)
    const run = (_sci, args) => (args[2] === 'eval-results/index.txt' ? 'c.json\n' : complexFile([view('side', wrongSha)]))
    const runBytes = vi.fn(() => png)
    const { fs } = fakeFs()
    const log = vi.fn()
    const out = fetchCiResults('job1', { sci: '/bin/sci', dataDir: '/data/results', run, runBytes, fs, log })
    expect(out.renders.mismatched).toEqual(['c.renders/toy-caboose-1/side.png'])
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`c.renders/toy-caboose-1/side.png did not match its sha256 (expected ${wrongSha}, got ${sha})`))
  })

  it('keeps a complex file\'s renders dir on a resumed fetch (the file already exists) and still fetches a missing render', () => {
    const run = (_sci, args) => (args[2] === 'eval-results/index.txt' ? 'c.json\n' : (() => { throw new Error(`unexpected fetch of ${args[2]}`) })())
    const runBytes = vi.fn(() => png)
    const written = {}
    const removed = []
    const fs = {
      existsSync: (path) => path === '/data/results/c.json',
      mkdirSync: vi.fn(),
      writeFileSync: (path, content) => {
        written[path] = content
      },
      readFileSync: () => complexFile([view('iso-front')]),
      readdirSync: () => ['a.renders', 'c.renders', 'c.json'],
      rmSync: (path) => removed.push(path),
    }
    const out = fetchCiResults('job1', { sci: '/bin/sci', dataDir: '/data/results', run, runBytes, fs })
    expect(out.fetched).toEqual([])
    expect(written['/data/results/c.renders/toy-caboose-1/iso-front.png']).toBe(png)
    expect(removed).toEqual(['/data/results/a.renders'])
  })

  it('never fetches a render path that leaves the results directory', () => {
    expect(renderViews(complexFile([{ name: 'x', path: '../../etc/passwd', sha256: sha }, { name: 'y', path: 'c.renders/../x.png', sha256: sha }]))).toEqual([])
    expect(renderViews('{"results":[]}')).toEqual([])
    expect(renderViews('not json')).toEqual([])
  })
})
