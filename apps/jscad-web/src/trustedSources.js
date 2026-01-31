/**
 * Trusted Sources Manager
 * Manages URL trust rules in localStorage for remote script loading.
 * No default trusted domains - all sources require explicit user approval.
 */

const STORAGE_KEY = 'jscad-trusted-sources'

// M1 fix: Maximum regex pattern length to prevent excessive backtracking
const MAX_PATTERN_LENGTH = 200

/**
 * M1 fix: Validate regex pattern to prevent ReDoS attacks.
 * Blocks patterns with nested quantifiers that can cause catastrophic backtracking.
 * @param {string} pattern
 * @returns {boolean}
 */
function isSafeRegexPattern(pattern) {
  // Limit pattern length
  if (pattern.length > MAX_PATTERN_LENGTH) return false

  // Block nested quantifiers like (a+)+, (a*)+, (a+)*, (a*)*, etc.
  // These patterns can cause exponential backtracking
  if (/(\([^)]*[+*][^)]*\))[+*]/.test(pattern)) return false

  // Block overlapping alternatives with quantifiers like (a|a)+
  // Simplified check - block repeated .* or .+ patterns
  if (/(\.\*){2,}|(\.\+){2,}/.test(pattern)) return false

  return true
}

/**
 * @typedef {object} TrustRule
 * @property {string} domain - Domain to match (e.g., "gist.githubusercontent.com")
 * @property {string} pathPattern - Regex pattern for path matching (e.g., ".*" or "/models/.*\\.js$")
 * @property {string} [id] - Unique identifier (auto-generated)
 */

/**
 * Generate a unique ID for a rule
 * @returns {string}
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/**
 * Load trust rules from localStorage
 * @returns {TrustRule[]}
 */
export function loadRules() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    const data = JSON.parse(stored)
    return Array.isArray(data.rules) ? data.rules : []
  } catch {
    return []
  }
}

/**
 * Save trust rules to localStorage
 * @param {TrustRule[]} rules
 */
export function saveRules(rules) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ rules }))
}

/**
 * Add a new trust rule
 * @param {string} domain
 * @param {string} pathPattern
 * @returns {TrustRule} The created rule
 */
export function addRule(domain, pathPattern) {
  const rules = loadRules()
  const rule = { id: generateId(), domain, pathPattern }
  rules.push(rule)
  saveRules(rules)
  return rule
}

/**
 * Update an existing rule
 * @param {string} id
 * @param {string} domain
 * @param {string} pathPattern
 * @returns {boolean} True if updated
 */
export function updateRule(id, domain, pathPattern) {
  const rules = loadRules()
  const idx = rules.findIndex(r => r.id === id)
  if (idx === -1) return false
  rules[idx] = { id, domain, pathPattern }
  saveRules(rules)
  return true
}

/**
 * Delete a rule by ID
 * @param {string} id
 * @returns {boolean} True if deleted
 */
export function deleteRule(id) {
  const rules = loadRules()
  const filtered = rules.filter(r => r.id !== id)
  if (filtered.length === rules.length) return false
  saveRules(filtered)
  return true
}

/**
 * Check if a URL is trusted based on saved rules
 * @param {string} urlString
 * @returns {boolean}
 */
export function isTrusted(urlString) {
  try {
    const url = new URL(urlString)
    const rules = loadRules()

    for (const rule of rules) {
      if (url.hostname === rule.domain || url.hostname.endsWith('.' + rule.domain)) {
        try {
          // M1 fix: Validate regex pattern before use to prevent ReDoS
          if (!isSafeRegexPattern(rule.pathPattern)) {
            console.warn('Skipping unsafe regex pattern:', rule.pathPattern)
            continue
          }
          const pathRegex = new RegExp(rule.pathPattern)
          if (pathRegex.test(url.pathname)) {
            return true
          }
        } catch {
          // Invalid regex, skip this rule
        }
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * Parse a URL and return domain and path for rule creation
 * @param {string} urlString
 * @returns {{ domain: string, path: string } | null}
 */
export function parseUrl(urlString) {
  try {
    const url = new URL(urlString)
    return { domain: url.hostname, path: url.pathname }
  } catch {
    return null
  }
}

/**
 * Create a rule that matches a specific URL exactly
 * @param {string} urlString
 * @returns {TrustRule | null}
 */
export function addRuleForUrl(urlString) {
  const parsed = parseUrl(urlString)
  if (!parsed) return null
  // Escape regex special chars in path for exact match
  const escapedPath = parsed.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return addRule(parsed.domain, '^' + escapedPath + '$')
}

/**
 * Create a rule that matches all paths on a domain
 * @param {string} urlString
 * @returns {TrustRule | null}
 */
export function addRuleForDomain(urlString) {
  const parsed = parseUrl(urlString)
  if (!parsed) return null
  return addRule(parsed.domain, '.*')
}

export default {
  loadRules,
  saveRules,
  addRule,
  updateRule,
  deleteRule,
  isTrusted,
  parseUrl,
  addRuleForUrl,
  addRuleForDomain
}
