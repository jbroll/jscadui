import { errorLocation } from './buildReport.js'

// The `require` specifier serving the shared assertion surface, in test files
// and in the model code they exercise alike.
const TEST_MODULE = 'test'

// The file name reported when the caller does not name one.
const DEFAULT_FILENAME = 'test.js'

// A probe-only file name, never a real test path, for calibrating the line
// offset below.
const PROBE_FILENAME = '__testPackage_probe__'

// `new Function` wraps its body (`function anonymous(...) {\n<body>\n}`), so a
// throw on body line N reports a larger line, by an engine-specific amount.
// The probe measures it once per engine: a one-line body throwing must report
// line 1, and whatever it reports instead is the offset to subtract.
let lineOffset = null

const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The innermost stack frame naming `file`, in V8's, Firefox's and Node's
// formats alike, or null when the stack names it nowhere.
const frameInFile = (error, file) => {
  const match = new RegExp(`${escapeRegExp(file)}:(\\d+):(\\d+)`).exec(String(error?.stack ?? ''))
  return match ? { line: Number(match[1]), column: Number(match[2]) } : null
}

const probeOffset = () => {
  try {
    new Function(`throw new Error('probe')\n//# sourceURL=${PROBE_FILENAME}`)()
  } catch (error) {
    const frame = frameInFile(error, PROBE_FILENAME)
    if (frame) return frame.line - 1
  }
  return 0
}

// A throw mapped to the `reportError` shape in `buildReport.js`: innermost
// test-file frame first (so a failing assert points at the assert, not at
// this package), then whatever `errorLocation` recovers, then the file name.
const mapError = (error, filename, offset) => {
  const frame = frameInFile(error, filename)
  const fallback = frame ? null : errorLocation(error, '')
  const file = frame ? filename : fallback.file ?? filename
  const line = frame ? frame.line - offset : fallback.line
  const column = frame ? frame.column : fallback.column
  return {
    ...(error && error.name ? { name: String(error.name) } : {}),
    message: String(error?.message ?? error),
    ...(file ? { file } : {}),
    ...(Number.isFinite(line) ? { line } : {}),
    ...(Number.isFinite(column) ? { column } : {}),
  }
}

const assertionError = (message) => {
  const error = new Error(message)
  error.name = 'AssertionError'
  return error
}

// The stack of runs in flight. Runs are synchronous, so this is one entry
// deep except when a test file runs another test file.
const runStack = []

const currentRun = (caller) => {
  const run = runStack[runStack.length - 1]
  if (!run) {
    const error = new Error(`${caller} must be called inside runTestFile, via require('test')`)
    error.name = 'TestApiError'
    throw error
  }
  return run
}

/**
 * Register and immediately run one test. A throw in `fn` (a failed assert or
 * any error) fails this test only; later tests still run. An async `fn`
 * fails: asserts resolve after the run and cannot be collected.
 * @param {string} name the test name
 * @param {Function} fn the test body
 */
export const test = (name, fn) => {
  const run = currentRun('test')
  if (typeof fn !== 'function') throw assertionError(`test '${String(name)}' needs a function`)
  const record = { name: String(name), ok: true }
  run.tests.push(record)
  try {
    const returned = fn()
    if (returned && typeof returned.then === 'function') {
      const error = new Error(`test '${record.name}' returned a promise; async tests are not supported here`)
      error.name = 'AsyncTestError'
      throw error
    }
  } catch (error) {
    record.ok = false
    record.error = mapError(error, run.filename, run.offset)
    run.failed += 1
    return
  }
  run.passed += 1
}

/**
 * Fail the current test unless `cond` is truthy.
 * @param {boolean} cond the condition under test
 * @param {string} [msg] the failure message
 */
export const assert = (cond, msg) => {
  currentRun('assert')
  if (!cond) throw assertionError(msg ?? 'assertion failed')
}

/**
 * Attribute one passing geometry assertion to a part. Only a passing call
 * counts: an invalid index or checks object throws instead.
 * @param {number} index the part index the checks describe
 * @param {object} checks the geometry expectations (volume, dims, bbox, ...)
 */
export const assertPart = (index, checks) => {
  const run = currentRun('assertPart')
  if (!Number.isInteger(index) || index < 0) {
    throw assertionError(`assertPart index must be a non-negative integer, got ${String(index)}`)
  }
  if (checks === null || typeof checks !== 'object' || Array.isArray(checks)) {
    throw assertionError('assertPart checks must be an object')
  }
  run.assertsByPart[index] = (run.assertsByPart[index] ?? 0) + 1
}

/**
 * The `require('test')` surface: `test`, `assert`, `assertPart`.
 * @type {{test:Function, assert:Function, assertPart:Function}}
 */
export const TEST_API = { test, assert, assertPart }

/**
 * Run one CommonJS test file against the `require('test')` surface and
 * collect the result synchronously: per-test pass/fail plus passing-assert
 * counts per part index. Environment-free: no Worker, no DOM, no builtins
 * beyond `Function` and stack parsing.
 * @param {string} source the test file source
 * @param {object} [api] extra `require` specifiers to values, plus the
 *   reserved `filename` naming the file in error reports (`test` always
 *   serves the built-in surface and cannot be overridden)
 * @returns {{passed:number, failed:number, assertsByPart:Record<number,number>,
 *   tests:Array<{name:string, ok:boolean, error?:object}>, errors:Array<object>}}
 */
export const runTestFile = (source, api = {}) => {
  const { filename = DEFAULT_FILENAME, ...modules } = api ?? {}
  if (lineOffset === null) lineOffset = probeOffset()
  const run = { filename, offset: lineOffset, passed: 0, failed: 0, assertsByPart: {}, tests: [], errors: [] }
  const require = (name) => {
    if (name === TEST_MODULE) return TEST_API
    if (Object.prototype.hasOwnProperty.call(modules, name)) return modules[name]
    const error = new Error(`cannot find module '${String(name)}'`)
    error.name = 'ModuleNotFoundError'
    throw error
  }
  let compiled
  try {
    compiled = new Function('require', 'module', 'exports', `${source}\n//# sourceURL=${filename}`)
  } catch (error) {
    run.errors.push({
      ...(error && error.name ? { name: String(error.name) } : {}),
      message: String(error?.message ?? error),
      file: filename,
    })
    run.failed += 1
    return resultOf(run)
  }
  runStack.push(run)
  try {
    const module = { exports: {} }
    compiled(require, module, module.exports)
  } catch (error) {
    run.errors.push(mapError(error, filename, run.offset))
    run.failed += 1
  } finally {
    runStack.pop()
  }
  return resultOf(run)
}

const resultOf = (run) => ({
  passed: run.passed,
  failed: run.failed,
  assertsByPart: run.assertsByPart,
  tests: run.tests,
  errors: run.errors,
})
