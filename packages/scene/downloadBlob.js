/**
 * Shared utility for triggering file downloads from Blob data.
 * Prevents memory leaks by revoking the object URL after download starts.
 */

/** Default delay before revoking blob URL to allow download to start */
const DEFAULT_REVOKE_DELAY_MS = 1000

/**
 * Trigger a file download from a Blob.
 * L10 fix: Made revokeDelay configurable with default for large file support
 * @param {Blob} blob - The blob data to download
 * @param {string} filename - The filename for the download
 * @param {number} [revokeDelay] - Delay in ms before revoking URL (default: 1000ms, increase for large files)
 */
export function downloadBlob(blob, filename, revokeDelay = DEFAULT_REVOKE_DELAY_MS) {
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.href = url
  link.download = filename
  link.click()
  // Revoke after delay to allow download to start
  setTimeout(() => URL.revokeObjectURL(url), revokeDelay)
}
