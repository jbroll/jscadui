import { describe, expect, it } from 'vitest'
import { applyEdit, applyWrite, listFiles, NO_ENTRY, projectPath, readFile, resolveEntry } from '../src/project.js'

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

describe('resolveEntry', () => {
  it('takes package.json main first, then index.js, then main.js', () => {
    const files = { 'main.js': 'm', 'index.js': 'i', 'src/box.js': 'b', 'package.json': '{"main":"./src/box.js"}' }
    expect(resolveEntry(files)).toBe('src/box.js')
    expect(resolveEntry({ 'main.js': 'm', 'index.js': 'i' })).toBe('index.js')
    expect(resolveEntry({ 'main.js': 'm', 'part.js': 'p' })).toBe('main.js')
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
