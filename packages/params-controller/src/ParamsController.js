/**
 * ParamsController - manages parameter state and class linking
 *
 * This controller handles:
 * - Tracking which params the user has modified
 * - Class change operations (join, unlink, move_group, join_group)
 * - Copying values between parts when joining classes
 * - Storing/restoring code-defined class values
 */

import { getLinkedParamPaths, getLinkedParts } from '@jscadui/params-core'

/** @typedef {import('@jscadui/params-core').ClassChangeMode} ClassChangeMode */
/** @typedef {import('@jscadui/params-core').ProxyState} ProxyState */

/**
 * Create a new params controller
 * @returns {ParamsController}
 */
export const createParamsController = () => {
  /** @type {Set<string>} */
  let userInteracted = new Set()

  /** @type {Object} */
  let params = {}

  /** @type {Object|null} */
  let proxyState = null

  /** @type {Object|null} - Original code-defined classes (before user modifications) */
  let codeClasses = null

  /** @type {Object.<string, Object>} - Original values per class (className -> {paramName: value}) */
  let codeClassValues = {}

  /**
   * Reset the controller state (call when loading a new script)
   */
  const reset = () => {
    userInteracted = new Set()
    params = {}
    proxyState = null
    codeClasses = null
    codeClassValues = {}
  }

  /**
   * Initialize from worker result after script load
   * @param {Object} result - Result from jscadScript
   */
  const initFromResult = (result) => {
    if (!result.proxyState) return

    proxyState = result.proxyState
    params = result.params || {}

    // Store original code-defined classes
    codeClasses = { ...result.proxyState.classes }

    // Store original values for each class
    codeClassValues = {}
    for (const [partPath, className] of Object.entries(result.proxyState.classes)) {
      if (!codeClassValues[className]) {
        codeClassValues[className] = extractPartValues(partPath, params)
      }
    }
  }

  /**
   * Extract leaf param values for a part (excludes nested parts, _class, hidden params)
   * @param {string} partPath
   * @param {Object} paramValues
   * @returns {Object}
   */
  const extractPartValues = (partPath, paramValues) => {
    const prefix = partPath + '.'
    const values = {}

    for (const [key, value] of Object.entries(paramValues)) {
      if (key.startsWith(prefix)) {
        const paramName = key.substring(prefix.length)
        if (!paramName.includes('.') && paramName !== '_class' && !paramName.startsWith('_')) {
          values[paramName] = value
        }
      }
    }
    return values
  }

  /**
   * Get types and classes as Maps
   * @returns {{typesMap: Map, classesMap: Map}}
   */
  const getMaps = () => {
    const typesMap = new Map(Object.entries(proxyState?.types || {}))

    // Build effective classes - merge code defaults with user overrides
    const classesMap = new Map(Object.entries(proxyState?.classes || {}))
    for (const path of userInteracted) {
      if (path.endsWith('._class')) {
        const partPath = path.slice(0, -7)
        classesMap.set(partPath, params[path])
      }
    }

    return { typesMap, classesMap }
  }

  /**
   * Handle a param value change
   * @param {string} paramPath
   * @param {unknown} value
   * @returns {string[]} - All paths that were updated (for UI sync)
   */
  const setParam = (paramPath, value) => {
    if (params[paramPath] === value) return []

    const { typesMap, classesMap } = getMaps()
    const linkedPaths = getLinkedParamPaths(typesMap, classesMap, paramPath)

    for (const path of linkedPaths) {
      params[path] = value
      userInteracted.add(path)
    }

    return linkedPaths
  }

  /**
   * Apply source values to target part (only matching params)
   * @param {Object} sourceValues - Object of paramName -> value
   * @param {string} targetPath - Target part path
   */
  const applyValuesToTarget = (sourceValues, targetPath) => {
    if (!sourceValues) return

    const targetParams = new Set(Object.keys(extractPartValues(targetPath, params)))
    const targetPrefix = targetPath + '.'

    for (const [paramName, value] of Object.entries(sourceValues)) {
      if (targetParams.has(paramName) && value !== undefined && value !== null) {
        const targetKey = targetPrefix + paramName
        params[targetKey] = value
        userInteracted.add(targetKey)
      }
    }
  }

  /**
   * Handle a class change
   * @param {string} partPath - The part whose class is changing
   * @param {string} newClass - The new class name
   * @param {ClassChangeMode} mode - How to change the class
   */
  const setClass = (partPath, newClass, mode) => {
    const { typesMap, classesMap } = getMaps()

    // Get parts in current class
    const currentClassParts = getLinkedParts(typesMap, classesMap, partPath)

    // Find parts already in target class
    let targetClassParts = []
    for (const [p, c] of classesMap) {
      if (c === newClass && typesMap.get(p) === typesMap.get(partPath)) {
        targetClassParts = getLinkedParts(typesMap, classesMap, p)
        break
      }
    }
    const sourceForValues = targetClassParts[0]

    // Helper to get values to apply when joining a class
    const getValuesToApply = () => {
      if (sourceForValues) {
        return extractPartValues(sourceForValues, params)
      }
      return codeClassValues[newClass]
    }

    switch (mode) {
      case 'unlink':
        // Move just this part to a new class (keeps values)
        params[`${partPath}._class`] = newClass
        userInteracted.add(`${partPath}._class`)
        break

      case 'move_group':
        // Move all parts in current class to new class (keeps values)
        for (const p of currentClassParts) {
          params[`${p}._class`] = newClass
          userInteracted.add(`${p}._class`)
        }
        break

      case 'join': {
        // Move this part to existing class (adopt target values)
        params[`${partPath}._class`] = newClass
        userInteracted.add(`${partPath}._class`)
        const valuesToApply = getValuesToApply()
        if (valuesToApply && sourceForValues !== partPath) {
          applyValuesToTarget(valuesToApply, partPath)
        }
        break
      }

      case 'join_group': {
        // Move all parts to existing class (adopt target values)
        const valuesToApply = getValuesToApply()
        for (const p of currentClassParts) {
          params[`${p}._class`] = newClass
          userInteracted.add(`${p}._class`)
          if (valuesToApply && sourceForValues !== p) {
            applyValuesToTarget(valuesToApply, p)
          }
        }
        break
      }
    }
  }

  /**
   * Update proxy state from worker result (after model run)
   * @param {ProxyState} newState
   */
  const updateProxyState = (newState) => {
    if (!newState) return

    // Build effective classes
    const effectiveClasses = { ...newState.classes }
    for (const path of userInteracted) {
      if (path.endsWith('._class')) {
        const partPath = path.slice(0, -7)
        effectiveClasses[partPath] = params[path]
      }
    }

    newState.classes = effectiveClasses
    proxyState = newState
  }

  /**
   * Get current state for UI
   */
  const getState = () => ({
    params,
    proxyState,
    codeClasses,
    userInteracted: [...userInteracted]
  })

  /**
   * Get params for worker call
   */
  const getWorkerParams = () => ({
    params: { ...params },
    userInteractedPaths: [...userInteracted]
  })

  return {
    reset,
    initFromResult,
    setParam,
    setClass,
    updateProxyState,
    getState,
    getWorkerParams,

    // Direct access for edge cases
    get params() { return params },
    set params(v) { params = v },
    get userInteracted() { return userInteracted },
    get proxyState() { return proxyState },
    get codeClasses() { return codeClasses },
    get codeClassValues() { return codeClassValues },
  }
}

/**
 * @typedef {ReturnType<typeof createParamsController>} ParamsController
 */
