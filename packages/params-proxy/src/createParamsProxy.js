/**
 * @typedef {Object} ParamDefinition
 * @property {string} path - Full dot-notation path (e.g., 'front.left.radius')
 * @property {string} name - Property name (e.g., 'radius')
 * @property {string} parent - Parent path (e.g., 'front.left')
 * @property {unknown} default - Default value
 * @property {string} type - Inferred type ('number', 'int', 'checkbox', 'text', 'choice')
 * @property {boolean} hidden - Whether param is hidden (starts with _)
 * @property {number} [min] - Minimum value for numbers
 * @property {number} [max] - Maximum value for numbers
 * @property {number} [step] - Step value for numbers
 * @property {string} [caption] - Display label
 * @property {string[]} [values] - For choice type
 * @property {string[]} [captions] - Display labels for choices
 */

/**
 * @typedef {Object} PartNode
 * @property {string} path - Full dot-notation path
 * @property {string} name - Segment name (last part of path)
 * @property {string} [type] - Part type/kind (e.g., 'Wheel', 'Axle')
 * @property {string} [partClass] - Part class for linking (e.g., 'all-wheels')
 * @property {Object<string, PartNode>} children - Child parts
 * @property {ParamDefinition[]} params - Parameters at this level
 */

/**
 * @typedef {Object} ProxyState
 * @property {ParamDefinition[]} discovered - All discovered parameters
 * @property {Set<string>} userInteracted - Paths the user has explicitly changed
 * @property {Object} uiValues - Current UI values (flat object with dot-notation keys)
 * @property {Map<string, string>} types - Part types by path (from _type assignments)
 * @property {Map<string, string>} classes - Part classes by path (from _class assignments)
 */

/**
 * Infer parameter type from value
 * @param {unknown} value
 * @returns {string}
 */
const inferType = (value) => {
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'number'
  if (typeof value === 'string') return 'text'
  // Arrays are NOT automatically choice - choice requires explicit 'values' in definition
  // Arrays like [r,g,b] colors should remain as 'unknown' type
  if (Array.isArray(value)) return 'unknown'
  return 'unknown'
}

/**
 * Check if value is a parameter definition object
 * @param {unknown} value
 * @returns {value is {default: unknown}}
 */
const isDefinition = (value) => {
  return value !== null && typeof value === 'object' && 'default' in value
}

/**
 * Extract definition properties from value
 * @param {unknown} value
 * @returns {{default: unknown, type: string, min?: number, max?: number, step?: number, caption?: string, values?: string[], captions?: string[]}}
 */
const extractDefinition = (value) => {
  if (isDefinition(value)) {
    // Determine type: explicit > inferred from step > inferred from default
    let type = value.type
    if (!type) {
      // If step is defined and not an integer, use 'number' type
      if (typeof value.step === 'number' && !Number.isInteger(value.step)) {
        type = 'number'
      } else {
        type = inferType(value.default)
      }
    }
    return {
      default: value.default,
      type,
      min: value.min,
      max: value.max,
      step: value.step,
      caption: value.caption,
      values: value.values,
      captions: value.captions,
    }
  }
  return {
    default: value,
    type: inferType(value),
  }
}

/**
 * Get value from flat object using dot-notation path
 * @param {Object} obj
 * @param {string} path
 * @returns {unknown}
 */
const getByPath = (obj, path) => {
  if (!path) return undefined
  return obj[path]
}

/**
 * Create a params proxy that auto-discovers parameters
 *
 * @param {ProxyState} state - Shared state across all proxies
 * @param {string} [path=''] - Current path in the hierarchy
 * @returns {Proxy}
 */
export const createParamsProxy = (state, path = '') => {
  const { discovered, userInteracted, uiValues } = state
  const defaults = {}
  const children = {}
  const discoveredPaths = new Set(discovered.map(d => d.path))

  const proxy = new Proxy({}, {
    get(target, prop) {
      // Internal properties
      if (prop === '_path') return path
      if (prop === '_state') return state
      if (prop === '_defaults') return defaults
      if (prop === '_isParamsProxy') return true

      // Symbol handling (for console.log, etc.)
      if (typeof prop === 'symbol') return undefined

      const propStr = String(prop)
      const fullPath = path ? `${path}.${propStr}` : propStr

      // Discover on first access
      if (!discoveredPaths.has(fullPath)) {
        discoveredPaths.add(fullPath)
        // Don't add to discovered yet - wait for set to know the type
        // Or add as unknown if never set
      }

      // UI value takes precedence (if user interacted)
      if (userInteracted.has(fullPath)) {
        const uiVal = getByPath(uiValues, fullPath)
        if (uiVal !== undefined) return uiVal
      }

      // Return code-set value
      if (propStr in defaults) {
        return defaults[propStr]
      }

      // Auto-create child proxy for sub-parts
      if (!(propStr in children)) {
        children[propStr] = createParamsProxy(state, fullPath)
      }
      return children[propStr]
    },

    set(target, prop, value) {
      if (typeof prop === 'symbol') return true

      const propStr = String(prop)
      const fullPath = path ? `${path}.${propStr}` : propStr

      // Handle special _type property - sets the part type/kind
      if (propStr === '_type' && typeof value === 'string') {
        state.types.set(path, value)
        return true
      }

      // Handle special _class property - sets the part class for linking
      // Also register it as a hidden parameter so it can be edited in UI
      if (propStr === '_class' && typeof value === 'string') {
        state.classes.set(path, value)
        // Register as hidden param for UI editing
        if (!discoveredPaths.has(fullPath)) {
          discoveredPaths.add(fullPath)
          discovered.push({
            path: fullPath,
            name: propStr,
            parent: path,
            hidden: true,
            default: value,
            type: 'text',
          })
        }
        return true
      }

      // Extract the actual value and definition
      const def = extractDefinition(value)

      // Register for UI discovery (always, even if user has interacted)
      if (!discoveredPaths.has(fullPath)) {
        discoveredPaths.add(fullPath)
        discovered.push({
          path: fullPath,
          name: propStr,
          parent: path,
          hidden: propStr.startsWith('_'),
          ...def,
        })
      } else {
        // Update existing discovery with new info if this is a richer definition
        const existing = discovered.find(d => d.path === fullPath)
        if (existing && existing.type === 'unknown') {
          Object.assign(existing, def)
        }
      }

      // If user has interacted with this value, don't update the default
      if (userInteracted.has(fullPath)) {
        return true
      }

      defaults[propStr] = def.default
      return true
    },

    has(target, prop) {
      if (typeof prop === 'symbol') return false
      const propStr = String(prop)
      return propStr in defaults || propStr in children
    },

    ownKeys(target) {
      return [...new Set([...Object.keys(defaults), ...Object.keys(children)])]
    },

    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === 'symbol') return undefined
      const propStr = String(prop)
      if (propStr in defaults || propStr in children) {
        return { enumerable: true, configurable: true, value: proxy[prop] }
      }
      return undefined
    },
  })

  return proxy
}

/**
 * Create a fresh proxy state
 * @param {Object} [uiValues={}] - Initial UI values
 * @param {Set<string>} [userInteracted] - Paths user has interacted with
 * @returns {ProxyState}
 */
export const createProxyState = (uiValues = {}, userInteracted = new Set()) => ({
  discovered: [],
  userInteracted,
  uiValues,
  types: new Map(),
  classes: new Map(),
})

/**
 * Build a tree structure from flat discovered params
 * @param {ParamDefinition[]} discovered
 * @param {Map<string, string>} [types] - Optional types map from state
 * @param {Map<string, string>} [classes] - Optional classes map from state
 * @returns {PartNode}
 */
export const buildParamTree = (discovered, types = new Map(), classes = new Map()) => {
  const root = { path: '', name: 'root', type: types.get(''), partClass: classes.get(''), children: {}, params: [] }
  const nodes = { '': root }

  // First pass: create all nodes
  for (const item of discovered) {
    // Ensure all ancestor nodes exist
    const parts = item.path.split('.')
    let currentPath = ''
    for (let i = 0; i < parts.length - 1; i++) {
      const prevPath = currentPath
      currentPath = currentPath ? `${currentPath}.${parts[i]}` : parts[i]
      if (!nodes[currentPath]) {
        const name = parts[i]
        nodes[currentPath] = {
          path: currentPath,
          name,
          type: types.get(currentPath),
          partClass: classes.get(currentPath),
          children: {},
          params: []
        }
        nodes[prevPath].children[name] = nodes[currentPath]
      }
    }
  }

  // Second pass: add params to their parent nodes
  for (const item of discovered) {
    const parentPath = item.parent
    if (!nodes[parentPath]) {
      nodes[parentPath] = { path: parentPath, name: parentPath.split('.').pop() || 'root', children: {}, params: [] }
    }
    nodes[parentPath].params.push(item)
  }

  return root
}

/**
 * Convert discovered params to flat parameter definitions for params-form
 * @param {ParamDefinition[]} discovered
 * @param {boolean} [includeHidden=false]
 * @returns {import('@jscadui/format-common').ParameterDefinition[]}
 */
export const toParamDefinitions = (discovered, includeHidden = false) => {
  const tree = buildParamTree(discovered)
  const result = []

  const walk = (node, depth = 0) => {
    // Add group for this node if it has params or children
    if (node.path && (node.params.length > 0 || Object.keys(node.children).length > 0)) {
      result.push({
        name: `_group_${node.path}`,
        type: 'group',
        caption: node.name,
      })
    }

    // Add params
    for (const param of node.params) {
      if (param.hidden && !includeHidden) continue
      // Skip unknown types (like color arrays) that can't be rendered
      if (param.type === 'unknown') continue

      result.push({
        name: param.path,  // Use full path as name
        type: param.type === 'int' ? 'int' : param.type,
        caption: param.caption || param.name,
        initial: param.default,
        min: param.min,
        max: param.max,
        step: param.step,
        values: param.values,
        captions: param.captions,
      })
    }

    // Recurse into children
    for (const child of Object.values(node.children)) {
      walk(child, depth + 1)
    }
  }

  walk(tree)
  return result
}

/**
 * Extract current values from discovered params
 * @param {ParamDefinition[]} discovered
 * @returns {Object}
 */
export const extractDefaults = (discovered) => {
  const result = {}
  for (const param of discovered) {
    result[param.path] = param.default
  }
  return result
}

/**
 * Get breadcrumb segments for a path
 * @param {string} path - Dot-notation path (e.g., 'front.left.wheel')
 * @param {Map<string, string>} [types] - Optional types map
 * @returns {{path: string, name: string, type?: string}[]}
 */
export const getBreadcrumbs = (path, types = new Map()) => {
  const breadcrumbs = [{ path: '', name: 'root', type: types.get('') }]

  if (!path) return breadcrumbs

  const parts = path.split('.')
  let currentPath = ''

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}.${part}` : part
    breadcrumbs.push({
      path: currentPath,
      name: part,
      type: types.get(currentPath)
    })
  }

  return breadcrumbs
}

/**
 * Get a node from the tree by path
 * @param {PartNode} tree - The root tree node
 * @param {string} path - Dot-notation path
 * @returns {PartNode | null}
 */
export const getNodeByPath = (tree, path) => {
  if (!path) return tree

  const parts = path.split('.')
  let node = tree

  for (const part of parts) {
    if (!node.children[part]) return null
    node = node.children[part]
  }

  return node
}

/**
 * Get params for a specific path (current level only, not descendants)
 * @param {ParamDefinition[]} discovered
 * @param {string} path - Parent path to filter by
 * @param {boolean} [includeHidden=false]
 * @returns {ParamDefinition[]}
 */
export const getParamsAtPath = (discovered, path, includeHidden = false) => {
  return discovered.filter(d => {
    if (d.parent !== path) return false
    if (d.hidden && !includeHidden) return false
    return true
  })
}

/**
 * Get child part names at a specific path
 * @param {PartNode} tree
 * @param {string} path
 * @returns {string[]}
 */
export const getChildParts = (tree, path) => {
  const node = getNodeByPath(tree, path)
  if (!node) return []
  return Object.keys(node.children)
}

/**
 * Get all unique classes for a given type
 * @param {Map<string, string>} types - Types map (path -> type)
 * @param {Map<string, string>} classes - Classes map (path -> class)
 * @param {string} type - The type to filter by
 * @returns {string[]} - Array of unique class names for that type
 */
export const getClassesForType = (types, classes, type) => {
  const result = new Set()
  for (const [path, partClass] of classes) {
    if (types.get(path) === type) {
      result.add(partClass)
    }
  }
  return [...result]
}

/**
 * Get all paths that share the same class and type
 * @param {Map<string, string>} types - Types map (path -> type)
 * @param {Map<string, string>} classes - Classes map (path -> class)
 * @param {string} path - The path to find linked parts for
 * @returns {string[]} - Array of paths that share the same class and type (including the input path)
 */
export const getLinkedParts = (types, classes, path) => {
  const partType = types.get(path)
  const partClass = classes.get(path)

  // If no class is set, this part is not linked to anything
  if (!partClass) return [path]

  const result = []
  for (const [p, c] of classes) {
    if (c === partClass && types.get(p) === partType) {
      result.push(p)
    }
  }
  return result
}

/**
 * Get the parameter paths that should be updated when a linked param changes
 * @param {Map<string, string>} types - Types map (path -> type)
 * @param {Map<string, string>} classes - Classes map (path -> class)
 * @param {string} paramPath - The full param path (e.g., 'front.left.radius')
 * @returns {string[]} - Array of param paths to update (e.g., ['front.left.radius', 'front.right.radius', ...])
 */
export const getLinkedParamPaths = (types, classes, paramPath) => {
  // Split into part path and param name
  const lastDot = paramPath.lastIndexOf('.')
  if (lastDot === -1) return [paramPath] // Root-level param, no linking

  const partPath = paramPath.substring(0, lastDot)
  const paramName = paramPath.substring(lastDot + 1)

  // Params starting with '_' are instance-private, no linking (except _class which shouldn't go through here)
  if (paramName.startsWith('_')) return [paramPath]

  // Get all parts linked to this one
  const linkedParts = getLinkedParts(types, classes, partPath)

  // Return the same param name for each linked part
  return linkedParts.map(p => `${p}.${paramName}`)
}
