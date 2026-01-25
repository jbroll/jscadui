/**
 * Shared utility for triggering file downloads from Blob data.
 * Prevents memory leaks by revoking the object URL after download starts.
 */

/** Delay before revoking blob URL to allow download to start */
const REVOKE_DELAY_MS = 1000

/**
 * Trigger a file download from a Blob.
 * @param {Blob} blob - The blob data to download
 * @param {string} filename - The filename for the download
 */
export function downloadBlob(blob, filename) {
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.href = url
  link.download = filename
  link.click()
  // Revoke after delay to allow download to start
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
