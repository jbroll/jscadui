import { describe, expect, it } from 'vitest'
import { applyDelete, applyEdit, applyWrite, buildFiles, isTestFile, isTestOrNotesPath, listFiles, NO_ENTRY, pickEntry, projectPath, readFile, resolveEntry, SEARCH_LIMIT, searchFiles } from '../src/project.js'

const thrown = (fn) => {
  try {
    fn()
  } catch (error) {
    return { name: error.name, message: error.message }
  }
  throw new Error('did not throw')
}

describe('projectPath', () => {
  it('normalizes leading ./ and /, and doubled slashes', () => {
    expect(projectPath('./main.js')).toBe('main.js')
    expect(projectPath('/lib//part.js')).toBe('lib/part.js')
  })

  it('refuses a path that leaves the project or names nothing', () => {
    expect(thrown(() => projectPath('../x.js')).name).toBe('PathError')
    expect(thrown(() => projectPath('a/../../x.js')).message).toMatch(/leaves the project/)
    expect(thrown(() => projectPath('')).name).toBe('PathError')
    expect(thrown(() => projectPath('./')).name).toBe('PathError')
    expect(thrown(() => projectPath(undefined)).name).toBe('PathError')
  })
})

describe('pickEntry', () => {
  const pkg = (main) => JSON.stringify({ main })
  const all = ['a.js', 'car.js', 'car.ts', 'index.js', 'index.ts', 'main.js', 'package.json', 'src/box.js']

  it('takes package.json main before every named file', () => {
    expect(pickEntry(all, { folder: 'car', packageJson: pkg('src/box.js'), anyJs: true })).toBe('src/box.js')
  })

  it('resolves main as the path, then <main>.js, then <main>/index.js', () => {
    expect(pickEntry(['box', 'box.js'], { packageJson: pkg('box') })).toBe('box')
    expect(pickEntry(['box.js', 'box/index.js'], { packageJson: pkg('./box') })).toBe('box.js')
    expect(pickEntry(['lib/index.js'], { packageJson: pkg('lib') })).toBe('lib/index.js')
  })

  it('keeps a main that names no file', () => {
    expect(pickEntry(['index.js'], { packageJson: pkg('gone.js'), anyJs: true })).toBe('gone.js')
  })

  it('ignores a package.json that is not JSON, has no main, or whose main leaves the folder', () => {
    expect(pickEntry(['main.js'], { packageJson: 'not json' })).toBe('main.js')
    expect(pickEntry(['main.js'], { packageJson: '{"name":"x"}' })).toBe('main.js')
    expect(pickEntry(['main.js'], { packageJson: pkg('../x.js') })).toBe('main.js')
  })

  it('then index.js, index.ts, main.js, <folder>.js, <folder>.ts, in that order', () => {
    const order = ['index.js', 'index.ts', 'main.js', 'car.js', 'car.ts']
    order.forEach((expected, i) => expect(pickEntry(order.slice(i), { folder: 'car' })).toBe(expected))
  })

  it('names <folder> files only when a folder is given, and only at the top level', () => {
    expect(pickEntry(['car.js'])).toBeNull()
    expect(pickEntry(['parts/car.js', 'parts/index.js'], { folder: 'car' })).toBeNull()
  })

  it('with anyJs falls back to the shallowest .js, then the first by name', () => {
    expect(pickEntry(['lib/a.js', 'z.js', 'b.js', 'b.ts'], { anyJs: true })).toBe('b.js')
    expect(pickEntry(['x/z.js', 'x/y/a.js', 'w/b.js'], { anyJs: true })).toBe('w/b.js')
    expect(pickEntry(['part.js'])).toBeNull()
    expect(pickEntry(['part.scad', 'README.md'], { anyJs: true })).toBeNull()
  })
})

describe('resolveEntry', () => {
  it('takes package.json main first, then index.js, then main.js', () => {
    const files = { 'main.js': 'm', 'index.js': 'i', 'src/box.js': 'b', 'package.json': '{"main":"./src/box.js"}' }
    expect(resolveEntry(files)).toBe('src/box.js')
    expect(resolveEntry({ 'main.js': 'm', 'index.js': 'i' })).toBe('index.js')
    expect(resolveEntry({ 'main.js': 'm', 'part.js': 'p' })).toBe('main.js')
    expect(resolveEntry({ 'main.js': 'm', 'index.ts': 'i' })).toBe('index.ts')
  })

  it('passes over binary files', () => {
    expect(resolveEntry({ 'index.js': new ArrayBuffer(1), 'main.js': 'm' })).toBe('main.js')
  })

  it('resolves a main without its extension, or a directory, as Node does', () => {
    expect(resolveEntry({ 'package.json': '{"main":"box"}', 'box.js': 'b' })).toBe('box.js')
    expect(resolveEntry({ 'package.json': '{"main":"lib"}', 'lib/index.js': 'l' })).toBe('lib/index.js')
  })

  it('keeps a main that names no file, so the build reports it missing', () => {
    expect(resolveEntry({ 'package.json': '{"main":"gone.js"}', 'main.js': 'm' })).toBe('gone.js')
  })

  it('ignores a package.json without a usable main', () => {
    expect(resolveEntry({ 'package.json': '{"name":"x"}', 'main.js': 'm' })).toBe('main.js')
    expect(resolveEntry({ 'package.json': 'not json', 'main.js': 'm' })).toBe('main.js')
  })

  it('is null for a project with no entry', () => {
    expect(resolveEntry({})).toBeNull()
    expect(resolveEntry({ 'part.js': 'p' })).toBeNull()
    expect(NO_ENTRY).toMatch(/main\.js.*index\.js.*package\.json/)
  })

  it('never resolves a test/ or notes/ path as the entry', () => {
    expect(resolveEntry({ 'test/index.js': 't' })).toBeNull()
    expect(resolveEntry({ 'test/index.js': 't', 'main.js': 'm' })).toBe('main.js')
    expect(resolveEntry({ 'notes/plan.md': 'n', 'test/a.js': 't' })).toBeNull()
    expect(resolveEntry({ 'package.json': '{"main":"test/index.js"}', 'test/index.js': 't', 'main.js': 'm' })).toBe('main.js')
    expect(resolveEntry({ 'package.json': '{"main":"test/index.js"}', 'test/index.js': 't' })).toBeNull()
    expect(resolveEntry({ 'package.json': '{"main":"notes/plan.md"}', 'notes/plan.md': 'n' })).toBeNull()
  })

  it('shares one normalized test/notes predicate across the gate and the filters', () => {
    expect(isTestOrNotesPath('./test/a.js')).toBe(true)
    expect(isTestOrNotesPath('/notes/plan.md')).toBe(true)
    expect(isTestOrNotesPath('test.js')).toBe(false)
    expect(isTestOrNotesPath('main.js')).toBe(false)
    expect(buildFiles({ './test/a.js': 't', 'notes/plan.md': 'n', 'main.js': 'm' })).toEqual({ 'main.js': 'm' })
    expect(isTestFile('./test/a.js')).toBe(true)
    expect(isTestFile('test.js')).toBe(false)
    expect(isTestFile('notes/a.js')).toBe(false)
  })
})

describe('listFiles', () => {
  it('lists paths sorted, with sizes in bytes', () => {
    expect(listFiles({ 'b.js': 'é', 'a.js': 'abc', 'part.stl': new ArrayBuffer(4) })).toEqual({
      ok: true,
      files: [
        { path: 'a.js', size: 3 },
        { path: 'b.js', size: 2 },
        { path: 'part.stl', size: 4 },
      ],
    })
  })
})

describe('readFile', () => {
  const files = { 'main.js': 'one\ntwo\nthree\n', 'empty.js': '' }

  it('numbers lines like cat -n', () => {
    expect(readFile(files, { path: 'main.js' })).toBe('     1\tone\n     2\ttwo\n     3\tthree')
  })

  it('shows lines from offset, limit of them, and says where to read on', () => {
    expect(readFile(files, { path: './main.js', offset: 2, limit: 1 })).toBe('     2\ttwo\n… (main.js: lines 2-2 of 3; read on with offset 3)')
    expect(readFile(files, { path: 'main.js', offset: 3 })).toBe('     3\tthree')
  })

  it('says a file is empty, and fails for a missing file or an offset past the end', () => {
    expect(readFile(files, { path: 'empty.js' })).toBe('(empty.js is empty)')
    expect(thrown(() => readFile(files, { path: 'gone.js' }))).toEqual({ name: 'FileNotFoundError', message: 'no file gone.js in the project; list shows the files' })
    expect(thrown(() => readFile(files, { path: 'main.js', offset: 9 })).message).toMatch(/past the end of main.js, which has 3 lines/)
  })

  it('refuses a binary file that list shows, saying why', () => {
    const withFont = { 'main.js': 'x', 'fonts/Sans.ttf': new ArrayBuffer(8) }
    expect(thrown(() => readFile(withFont, { path: 'fonts/Sans.ttf' }))).toEqual({ name: 'BinaryFileError', message: 'fonts/Sans.ttf is a binary file; read and edit work on text files' })
  })
})

describe('applyWrite', () => {
  it('writes a new or existing file into a new map', () => {
    const files = { 'main.js': 'old' }
    const out = applyWrite(files, { path: './part.js', content: 'p' })
    expect(out).toEqual({ files: { 'main.js': 'old', 'part.js': 'p' }, path: 'part.js' })
    expect(files).toEqual({ 'main.js': 'old' })
    expect(applyWrite(files, { path: 'main.js', content: '' }).files['main.js']).toBe('')
  })

  it('refuses content that is not a string', () => {
    expect(thrown(() => applyWrite({}, { path: 'main.js' })).message).toMatch(/content must be/)
  })
})

describe('applyDelete', () => {
  const files = { 'main.js': 'm', 'helper.js': 'h' }

  it('removes an existing file into a new map', () => {
    expect(applyDelete(files, { path: './helper.js' })).toEqual({ files: { 'main.js': 'm' }, path: 'helper.js', deleted: true })
    expect(files).toEqual({ 'main.js': 'm', 'helper.js': 'h' })
    expect(applyDelete(files, { path: 'main.js' })).toEqual({ files: { 'helper.js': 'h' }, path: 'main.js', deleted: true })
  })

  it('is a success no-op for a missing file', () => {
    expect(applyDelete(files, { path: 'gone.js' })).toEqual({ files: { 'main.js': 'm', 'helper.js': 'h' }, path: 'gone.js', deleted: false })
  })

  it('refuses a path that leaves the project or names no file', () => {
    expect(thrown(() => applyDelete(files, { path: '../x.js' })).name).toBe('PathError')
    expect(thrown(() => applyDelete(files, { path: '' })).name).toBe('PathError')
    expect(thrown(() => applyDelete(files, {})).name).toBe('PathError')
  })
})

describe('applyEdit', () => {
  const files = { 'main.js': 'const a = 1\nconst b = 1\n' }

  it('replaces a unique oldString', () => {
    expect(applyEdit(files, { path: 'main.js', oldString: 'a = 1', newString: 'a = 2' }).files['main.js']).toBe('const a = 2\nconst b = 1\n')
  })

  it('treats $ patterns in newString literally', () => {
    expect(applyEdit(files, { path: 'main.js', oldString: 'a = 1', newString: "a = '$&$1'" }).files['main.js']).toBe("const a = '$&$1'\nconst b = 1\n")
  })

  it('fails when oldString is missing, and when it is not unique unless replaceAll', () => {
    expect(thrown(() => applyEdit(files, { path: 'main.js', oldString: 'c = 1', newString: 'c = 2' }))).toEqual({
      name: 'EditError',
      message: 'oldString is not in main.js; copy it from the file exactly, including whitespace and indentation',
    })
    expect(thrown(() => applyEdit(files, { path: 'main.js', oldString: '= 1', newString: '= 2' })).message).toBe(
      'oldString occurs 2 times in main.js; include more surrounding lines to make it unique, or pass replaceAll: true',
    )
    expect(applyEdit(files, { path: 'main.js', oldString: '= 1', newString: '= 2', replaceAll: true }).files['main.js']).toBe('const a = 2\nconst b = 2\n')
  })

  it('fails for a missing file, an empty oldString, or no change', () => {
    expect(thrown(() => applyEdit(files, { path: 'x.js', oldString: 'a', newString: 'b' })).name).toBe('FileNotFoundError')
    expect(thrown(() => applyEdit(files, { path: 'main.js', oldString: '', newString: 'b' })).message).toMatch(/use write/)
    expect(thrown(() => applyEdit(files, { path: 'main.js', oldString: 'a', newString: 'a' })).name).toBe('EditError')
    expect(thrown(() => applyEdit(files, { path: 'main.js', oldString: 'a' })).name).toBe('EditError')
  })
})

describe('searchFiles', () => {
  it('finds hits with path:line numbering and caps overflow', () => {
    const files = { 'main.js': 'cube\nbox\ncube box\n', 'lib.js': 'nothing\n' }
    const out = searchFiles(files, { pattern: 'cube' })
    expect(out).toContain('main.js:1: cube')
    expect(out).toContain('main.js:3: cube box')
    expect(out).not.toContain('lib.js')
  })

  it('sorts by path, searches only the named paths, and skips binary files', () => {
    const files = { 'b.js': 'cube\n', 'a.js': 'cube\n', 'part.stl': new ArrayBuffer(4) }
    expect(searchFiles(files, { pattern: 'cube' })).toBe('a.js:1: cube\nb.js:1: cube')
    expect(searchFiles(files, { pattern: 'cube', paths: ['b.js'] })).toBe('b.js:1: cube')
    expect(searchFiles(files, { pattern: 'nomatch' })).toBe('(no hits for nomatch)')
  })

  it('caps hits at SEARCH_LIMIT and says how many more', () => {
    const text = Array.from({ length: SEARCH_LIMIT + 3 }, () => 'cube').join('\n')
    const out = searchFiles({ 'main.js': text }, { pattern: 'cube' })
    expect(out.split('\n')).toHaveLength(SEARCH_LIMIT + 1)
    expect(out.endsWith(`… (3 more hits; narrow the pattern)`)).toBe(true)
  })

  it('treats the pattern as a regex and refuses an empty pattern or an invalid one', () => {
    const files = { 'main.js': 'cube\nbox\n' }
    expect(searchFiles(files, { pattern: 'cube|box' })).toBe('main.js:1: cube\nmain.js:2: box')
    expect(thrown(() => searchFiles(files, { pattern: '' }))).toEqual({ name: 'SearchError', message: 'pattern must be a non-empty string such as cube' })
    expect(thrown(() => searchFiles(files, { pattern: '[' })).message).toMatch(/not a valid regex/)
  })

  it('refuses a search path that leaves the project', () => {
    expect(thrown(() => searchFiles({ 'main.js': 'cube' }, { pattern: 'cube', paths: ['../x.js'] })).name).toBe('PathError')
  })
})
