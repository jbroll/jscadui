/**
 * Reload detection utilities
 * Prevents infinite reload loops when service worker fails
 */

const RELOAD_COOLDOWN_MS = 3000
const STORAGE_KEY = 'lastReload'
// C2 fix: Add max retry count to prevent infinite reload loops
const RETRY_COUNT_KEY = 'reloadRetryCount'
const MAX_RETRY_COUNT = 3

/**
 * Check if we should allow an automatic reload.
 * Returns true if enough time has passed since the last reload
 * AND we haven't exceeded the maximum retry count.
 * Updates the stored timestamp and retry count when returning true.
 *
 * @returns {boolean} True if reload is allowed
 */
export function shouldAllowReload() {
  const lastReload = localStorage.getItem(STORAGE_KEY)
  const retryCount = parseInt(localStorage.getItem(RETRY_COUNT_KEY) || '0', 10)
  const now = Date.now()

  // C2 fix: Check max retry count
  if (retryCount >= MAX_RETRY_COUNT) {
    console.error(`Service worker registration failed ${retryCount} times. Giving up on automatic reload.`)
    return false
  }

  if (lastReload === null || now - parseInt(lastReload, 10) > RELOAD_COOLDOWN_MS) {
    localStorage.setItem(STORAGE_KEY, now.toString())
    localStorage.setItem(RETRY_COUNT_KEY, (retryCount + 1).toString())
    return true
  }

  return false
}

/**
 * Clear the reload timestamp and retry count (e.g., after successful initialization)
 */
export function clearReloadTimestamp() {
  localStorage.removeItem(STORAGE_KEY)
  // C2 fix: Also clear retry count on successful init
  localStorage.removeItem(RETRY_COUNT_KEY)
}
