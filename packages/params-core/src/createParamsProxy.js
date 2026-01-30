/**
 * Supported parameter types for UI rendering
 * @typedef {'text'|'int'|'number'|'slider'|'checkbox'|'color'|'choice'|'radio'|'date'|'email'|'url'|'password'|'group'|'unknown'} ParamType
 */

/**
 * @typedef {Object} ParamDefinition
 * @property {string} path - Full dot-notation path (e.g., 'front.left.radius')
 * @property {string} name - Property name (e.g., 'radius')
 * @property {string} parent - Parent path (e.g., 'front.left')
 * @property {unknown} default - Default value
 * @property {ParamType} type - Parameter type for UI rendering
 * @property {boolean} hidden - Whether param is hidden (starts with _)
 *
 * Numeric properties (int, number, slider, date)
 * @property {number} [min] - Minimum value
 * @property {number} [max] - Maximum value
 * @property {number} [step] - Step/increment value
 *
 * Display properties
 * @property {string} [label] - Display label
 * @property {string} [placeholder] - Placeholder text for inputs
 *
 * Choice/radio properties
 * @property {(string|number)[]} [values] - Selectable values
 * @property {string[]} [captions] - Display labels for values
 *
 * Text input properties
 * @property {number} [size] - Input width in characters
 * @property {number} [maxLength] - Maximum characters allowed
 *
 * Slider/animation properties
 * @property {boolean} [live] - Update in real-time while dragging
 *
 * Constraint properties
 * @property {boolean} [constrained] - Value was set by parent, show as read-only
 *
 * Group properties
 * @property {'open'|'closed'} [initialState] - Initial collapsed state for groups
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
 * @property {Set<string>} discoveredPaths - Set of discovered paths (shared across proxies for efficiency)
 * @property {Set<string>} userInteracted - Paths the user has explicitly changed
 * @property {Object} uiValues - Current UI values (flat object with dot-notation keys)
 * @property {Map<string, string>} types - Part types by path (from _type assignments)
 * @property {Map<string, string>} classes - Part classes by path (from _class assignments)
 */

/**
 * @typedef {'unlink'|'move_group'|'join'|'join_group'} ClassChangeMode
 * - 'unlink': Move just this part to a new class (keeps values)
 * - 'move_group': Move all parts in current class to a new class (keeps values)
 * - 'join': Move just this part to an existing class (adopts target values)
 * - 'join_group': Move all parts in current class to an existing class (adopts target values)
 */

/**
 * Convert a plain object to a Map, or return the Map if already one
 * @param {Map|Object} obj
 * @returns {Map}
 */
export const toMap = (obj) => {
  if (obj instanceof Map) return obj
  return new Map(Object.entries(obj || {}))
}

/**
 * Infer parameter type from value
 * @param {unknown} value
 * @returns {string}
 */
export const inferType = (value) => {
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
export const isDefinition = (value) => {
  return value !== null && typeof value === 'object' && 'default' in value
}

/**
 * Extract definition properties from value, preserving all UI hints
 * @param {unknown} value
 * @returns {Partial<ParamDefinition>}
 */
export const extractDefinition = (value) => {
  if (isDefinition(value)) {
    // Determine type: explicit > inferred from values array > inferred from step > inferred from default
    let type = value.type
    if (!type) {
      // If values array is present, it's a choice type
      if (Array.isArray(value.values)) {
        type = 'choice'
      }
      // If step is defined and not an integer, use 'number' type
      else if (typeof value.step === 'number' && !Number.isInteger(value.step)) {
        type = 'number'
      } else {
        type = inferType(value.default)
      }
    }

    // Normalize float to number
    if (type === 'float') {
      type = 'number'
    }

    // Build result with all supported properties
    const result = {
      default: value.default,
      type,
    }

    // Numeric properties
    if (value.min !== undefined) result.min = value.min
    if (value.max !== undefined) result.max = value.max

    // Step: use explicit value, or default based on type (int=1, number=0.1)
    if (value.step !== undefined) {
      result.step = value.step
    } else if (type === 'int') {
      result.step = 1
    } else if (type === 'number') {
      result.step = 0.1
    }

    // Display properties - use 'label' as the standard property name
    if (value.label !== undefined) result.label = value.label
    if (value.placeholder !== undefined) result.placeholder = value.placeholder

    // Choice/radio properties
    if (value.values !== undefined) result.values = value.values
    if (value.captions !== undefined) result.captions = value.captions

    // Text input properties
    if (value.size !== undefined) result.size = value.size
    if (value.maxLength !== undefined) result.maxLength = value.maxLength

    // Slider/live properties
    if (value.live !== undefined) result.live = value.live

    // Group properties
    if (value.initial === 'closed') result.initialState = 'closed'
    else if (value.initialState !== undefined) result.initialState = value.initialState

    return result
  }

  // For plain values (not definition objects), infer type and set default step
  // Mark as constrained since a specific value was passed (not a definition)
  const type = inferType(value)
  const result = {
    default: value,
    type,
    constrained: true,  // Value was passed in, not defined as a parameter
  }

  // Set default step for numeric types
  if (type === 'int') {
    result.step = 1
  } else if (type === 'number') {
    result.step = 0.1
  }

  return result
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
  const { discovered, discoveredPaths, userInteracted, uiValues } = state
  const defaults = {}
  const children = {}

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

      // Special properties - return from state maps
      if (propStr === '_type') return state.types.get(path)
      if (propStr === '_class') return state.classes.get(path)

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

      // In flat mode (legacy scripts), return undefined for unknown properties
      // This preserves compatibility with the `params.prop || default` pattern
      if (state.mode === 'flat') {
        return undefined
      }

      // Auto-create child proxy for sub-parts (hierarchical mode)
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
        // Update existing discovery with new info
        const existing = discovered.find(d => d.path === fullPath)
        if (existing) {
          if (def.constrained) {
            // New value is constrained (plain value passed in) - mark as constrained
            // This overrides any previous slider definition
            existing.constrained = true
            existing.default = def.default
          } else if (existing.constrained) {
            // Existing is constrained, new is a definition - update UI hints but preserve value
            // Copy display properties (label, min, max, step) but NOT default or constrained
            const { default: _default, constrained: _constrained, ...uiHints } = def
            Object.assign(existing, uiHints)
          } else if (existing.type === 'unknown') {
            // Not constrained and type unknown - full update
            Object.assign(existing, def)
          }
        }
      }

      // If user has interacted with this value, don't update the runtime default
      if (userInteracted.has(fullPath)) {
        return true
      }

      // If existing is constrained and new is a definition, preserve constrained value
      const existing = discovered.find(d => d.path === fullPath)
      if (existing?.constrained && !def.constrained) {
        // Definition is trying to overwrite constrained value - ignore the default
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

    ownKeys(_target) {
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
 * @param {Object} [options={}] - Options
 * @param {'flat'|'hierarchical'} [options.mode='hierarchical'] - Proxy mode:
 *   - 'hierarchical': Create child proxies for unknown properties (for nested parts)
 *   - 'flat': Return undefined for unknown properties (for legacy scripts)
 * @returns {ProxyState}
 */
export const createProxyState = (uiValues = {}, userInteracted = new Set(), options = {}) => ({
  discovered: [],
  discoveredPaths: new Set(),  // Shared set to track discovered paths efficiently
  userInteracted,
  uiValues,
  types: new Map(),
  classes: new Map(),
  mode: options.mode || 'hierarchical',
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
        label: param.label || param.name,
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
 * Get all types from a classes map
 * @param {Map<string, string>} types - Types map (path -> type)
 * @param {Map<string, string>} classes - Classes map (path -> class)
 * @returns {string[]} - Array of unique types that have classes
 */
export const getTypesFromClasses = (types, classes) => {
  const result = new Set()
  for (const [path] of classes) {
    const type = types.get(path)
    if (type) result.add(type)
  }
  return [...result]
}

/**
 * Group parts by their class
 * @param {Map<string, string>} classes - Classes map (path -> class)
 * @returns {Map<string, string[]>} - Map from class name to array of paths
 */
export const groupByClass = (classes) => {
  const result = new Map()
  for (const [path, cls] of classes) {
    if (!result.has(cls)) {
      result.set(cls, [])
    }
    result.get(cls).push(path)
  }
  return result
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

/**
 * Convert legacy getParameterDefinitions format to proxy-friendly params object
 *
 * Legacy format:
 *   [
 *     { name: 'radius', type: 'number', initial: 2.0, min: 1.0, max: 10.0, caption: 'Radius:' },
 *     { name: 'group1', type: 'group', caption: 'Group 1' },
 *     { name: 'checkbox', type: 'checkbox', checked: true, caption: 'Checkbox:' },
 *   ]
 *
 * Proxy format (params object):
 *   {
 *     radius: { default: 2.0, type: 'number', min: 1.0, max: 10.0, caption: 'Radius:' },
 *     checkbox: { default: true, type: 'checkbox', caption: 'Checkbox:' },
 *   }
 *
 * @param {Array<{name: string, type?: string, initial?: unknown, checked?: boolean, min?: number, max?: number, step?: number, caption?: string, values?: unknown[], captions?: string[]}>} legacyDefs
 * @param {string} [prefix=''] - Optional prefix for nested parts (e.g., 'front.left')
 * @returns {Object} - Params object with definition objects
 */
export const convertLegacyDefs = (legacyDefs, prefix = '') => {
  const params = {}

  for (const def of legacyDefs) {
    // Skip groups - they're UI-only and don't map to params
    if (def.type === 'group') continue

    const name = def.name
    const _path = prefix ? `${prefix}.${name}` : name

    // Determine default value
    let defaultValue = def.initial
    if (def.type === 'checkbox') {
      defaultValue = def.checked ?? def.initial ?? false
    } else if (defaultValue === undefined) {
      // Provide sensible defaults based on type
      switch (def.type) {
        case 'int':
        case 'number':
        case 'float':
        case 'slider':
          defaultValue = def.min ?? 0
          break
        case 'text':
        case 'email':
        case 'url':
        case 'password':
        case 'date':
          defaultValue = ''
          break
        case 'choice':
        case 'radio':
          defaultValue = def.values?.[0] ?? ''
          break
        case 'color':
          defaultValue = '#000000'
          break
        default:
          defaultValue = ''
      }
    }

    // Build the definition object
    const paramDef = {
      default: defaultValue,
      type: def.type || inferType(defaultValue),
    }

    // Copy over optional properties
    if (def.min !== undefined) paramDef.min = def.min
    if (def.max !== undefined) paramDef.max = def.max
    if (def.step !== undefined) paramDef.step = def.step
    if (def.caption) paramDef.label = def.caption
    if (def.values) paramDef.values = def.values
    if (def.captions) paramDef.captions = def.captions

    // Normalize float to number
    if (paramDef.type === 'float') {
      paramDef.type = 'number'
    }

    // Ensure slider has min/max defaults
    if (paramDef.type === 'slider') {
      if (paramDef.min === undefined) paramDef.min = 0
      if (paramDef.max === undefined) paramDef.max = 100
    }

    // Set default step for numeric types if not specified
    if (paramDef.step === undefined) {
      if (paramDef.type === 'int') {
        paramDef.step = 1
      } else if (paramDef.type === 'number' || paramDef.type === 'slider') {
        paramDef.step = 0.1
      }
    }

    params[name] = paramDef
  }

  return params
}

/**
 * Extract default values from legacy parameter definitions
 * @param {Array<{name: string, type?: string, initial?: unknown, checked?: boolean}>} legacyDefs
 * @param {string} [prefix=''] - Optional prefix for nested parts
 * @returns {Object} - Flat object with default values (dot-notation keys if prefix provided)
 */
export const extractLegacyDefaults = (legacyDefs, prefix = '') => {
  const converted = convertLegacyDefs(legacyDefs)
  const defaults = {}
  for (const [name, def] of Object.entries(converted)) {
    const key = prefix ? `${prefix}.${name}` : name
    defaults[key] = def.default
  }
  return defaults
}

/**
 * Wrap a legacy JSCAD module (one that exports main + getParameterDefinitions)
 * so it works seamlessly with the params proxy system.
 *
 * Usage in a model:
 *   const LegacyWheel = wrapLegacyModule(require('./legacy-wheel'))
 *
 *   const Car = (params) => {
 *     return [
 *       LegacyWheel(params.frontLeft),  // params.frontLeft gets legacy defs auto-merged
 *       LegacyWheel(params.frontRight),
 *     ]
 *   }
 *
 * @param {Object} module - The required module with main and optionally getParameterDefinitions
 * @param {Function} module.main - The main function
 * @param {Function} [module.getParameterDefinitions] - Legacy parameter definitions function
 * @returns {Function} - Wrapped function that accepts a params proxy
 */
/**
 * Inject legacy parameter definitions into a params proxy.
 * This assigns each converted definition to the proxy, triggering
 * the proxy's set handler to register the params for discovery.
 *
 * @param {Object} params - The params proxy to inject into
 * @param {Object} proxyDefs - Converted definitions from convertLegacyDefs
 */
export const injectLegacyDefs = (params, proxyDefs) => {
  if (!params || !proxyDefs) return

  // Check if params is actually a proxy by looking for the marker
  const isProxy = params._isParamsProxy === true

  for (const [name, def] of Object.entries(proxyDefs)) {
    if (isProxy) {
      // Assign the full definition object to trigger proxy's set handler
      // This registers the param with type, min, max, caption, etc.
      params[name] = def
    }
  }
}

export const wrapLegacyModule = (module) => {
  const { main, getParameterDefinitions } = module

  if (!main) {
    throw new Error('wrapLegacyModule: module must export a main function')
  }

  // If no getParameterDefinitions, just return main as-is
  if (!getParameterDefinitions) {
    return main
  }

  // Get legacy definitions (call once and cache)
  let legacyDefs = null
  let proxyDefs = null

  const wrappedMain = (params) => {
    // Lazy-load definitions on first call
    if (!legacyDefs) {
      legacyDefs = getParameterDefinitions()
      proxyDefs = convertLegacyDefs(legacyDefs)
    }

    // Inject legacy defs into the params proxy to register them for discovery
    injectLegacyDefs(params, proxyDefs)

    // Now call main - params proxy already has the defs registered
    return main(params)
  }

  // Expose the legacy definitions for inspection
  wrappedMain.getParameterDefinitions = getParameterDefinitions
  wrappedMain.getLegacyDefs = () => {
    if (!legacyDefs) legacyDefs = getParameterDefinitions()
    return legacyDefs
  }
  wrappedMain.getProxyDefs = () => {
    if (!proxyDefs) {
      if (!legacyDefs) legacyDefs = getParameterDefinitions()
      proxyDefs = convertLegacyDefs(legacyDefs)
    }
    return proxyDefs
  }

  return wrappedMain
}
