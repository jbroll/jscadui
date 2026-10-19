import { runTestFile, TEST_API } from '@jscadui/agent-loop/src/testPackage.js'
import { createConsoleCollector } from '@jscadui/agent-loop/src/consoleCapture.js'
import { isTestFile } from '@jscadui/agent-loop/src/project.js'
import { createReadFile } from './fileMap.js'

/**
 * The test files of a project, sorted by path. Only string sources run:
 * binary entries (ArrayBuffer views) are skipped.
 * @param {Record<string, string|ArrayBuffer>} [files] the project files
 * @returns {string[]} the sorted `test/` `.js` paths
 */
export const listTestFiles = (files = {}) =>
  Object.keys(files).filter((path) => isTestFile(path) && typeof files[path] === 'string').sort()

const readSource = (readFile, file) => {
  try {
    return readFile(file)
  } catch {
    return readFile(`http://project.local/${file}`)
  }
}

/**
 * Run a project's `test/` `.js` files against the `test` package and
 * collect the result. Each file runs through Task 4's `runTestFile`, so a
 * throw in one test fails that test only and later files still run. Console
 * output is captured per run and restored after; geometry is never loaded.
 * Bare `test`/`assert`/`assertPart` resolve as well as `require('test')`,
 * without shifting reported line numbers. `api` is reserved: when defined it
 * is exposed to test files as `require('api')`, for API-specific helpers.
 * Project requires (`./x`, `../x`, `/x`) resolve from the full `files` map,
 * so tests can import helpers and `main.js` instead of inlining them.
 * @param {Record<string, string|ArrayBuffer>} [files] the project files
 * @param {{api?: string}} [options] the api style the run was requested with
 * @returns {Promise<{ok:boolean, passed:number, failed:number, failures:Array<{file:string, test?:string, error:object}>,
 *   assertsByPart:Record<number,number>, console:string[], files:string[]}>}
 */
export const runTestFiles = async (files = {}, { api } = {}) => {
  const readFile = createReadFile(files, (path) => {
    throw new Error(`file not found ${path}`)
  })
  const collector = createConsoleCollector()
  const levels = ['log', 'info', 'warn', 'error', 'debug']
  const real = {}
  for (const level of levels) {
    real[level] = console[level]
    console[level] = (...args) => collector.capture(...args)
  }
  const saved = { test: globalThis.test, assert: globalThis.assert, assertPart: globalThis.assertPart }
  globalThis.test = TEST_API.test
  globalThis.assert = TEST_API.assert
  globalThis.assertPart = TEST_API.assertPart
  try {
    const names = listTestFiles(files)
    let passed = 0
    let failed = 0
    const failures = []
    const assertsByPart = {}
    for (const file of names) {
      let source
      try {
        source = readSource(readFile, file)
      } catch (error) {
        failed += 1
        failures.push({ file, error: { name: error?.name ?? 'Error', message: String(error?.message ?? error), file } })
        continue
      }
      if (typeof source !== 'string') continue
      const result = await runTestFile(source, { filename: file, files, ...(api === undefined ? {} : { api }) })
      passed += result.passed
      failed += result.failed
      for (const [index, count] of Object.entries(result.assertsByPart)) {
        assertsByPart[index] = (assertsByPart[index] ?? 0) + count
      }
      for (const test of result.tests.filter((entry) => !entry.ok)) {
        failures.push({ file, test: test.name, error: test.error })
      }
      for (const error of result.errors) {
        failures.push({ file, error })
      }
    }
    return { ok: failed === 0, passed, failed, failures, assertsByPart, console: collector.list(), files: names }
  } finally {
    for (const level of levels) console[level] = real[level]
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
  }
}
