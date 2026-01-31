/**
 * Reload detection utilities
 * Prevents infinite reload loops when service worker fails
 */

const RELOAD_COOLDOWN_MS = 3000
const STORAGE_KEY = 'lastReload'

/**
 * Check if we should allow an automatic reload.
 * Returns true if enough time has passed since the last reload.
 * Updates the stored timestamp when returning true.
 *
 * @returns {boolean} True if reload is allowed
 */
export function shouldAllowReload() {
  const lastReload = localStorage.getItem(STORAGE_KEY)
  const now = Date.now()

  if (lastReload === null || now - parseInt(lastReload, 10) > RELOAD_COOLDOWN_MS) {
    localStorage.setItem(STORAGE_KEY, now.toString())
    return true
  }

  return false
}

/**
 * Clear the reload timestamp (e.g., after successful initialization)
 */
export function clearReloadTimestamp() {
  localStorage.removeItem(STORAGE_KEY)
}
