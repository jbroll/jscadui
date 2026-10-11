import * as fflate from 'fflate'
import { isTrusted } from './trustedSources.js'
import { showPermissionDialog } from './trustedSourcesUI.js'

const gzipPrefix = 'data:application/gzip;base64,'

/** Ceiling on the inflated size of a `#data:` gzip link, in bytes. */
const GZIP_OUTPUT_LIMIT = 16 * 1024 * 1024

/**
 * Inflates a gzip payload with a hard ceiling on the output. The compressed
 * input is fed to fflate in small slices and each inflated slice is counted, so
 * a decompression bomb cannot allocate or spend time past the ceiling: the
 * stream is abandoned as soon as the running total passes it. A 4 KiB slice
 * inflates to at most ~4 MiB (deflate's ~1032:1 ceiling), so the work between
 * checks stays bounded even for a crafted stream.
 * @param {Uint8Array} data
 * @returns {string}
 */
const gunzipWithinLimit = (data) => {
  /** @type {Uint8Array[]} */
  const chunks = []
  let size = 0
  const gunzip = new fflate.Gunzip((chunk) => {
    size += chunk.length
    if (size > GZIP_OUTPUT_LIMIT) {
      throw new Error(`data: gzip payload inflates past the ${GZIP_OUTPUT_LIMIT / (1024 * 1024)} MiB limit`)
    }
    chunks.push(chunk)
  })
  const sliceSize = 4096
  for (let offset = 0; offset < data.length; offset += sliceSize) {
    gunzip.push(data.subarray(offset, offset + sliceSize), false)
  }
  gunzip.push(new Uint8Array(0), true)

  const out = new Uint8Array(size)
  let written = 0
  for (const chunk of chunks) {
    out.set(chunk, written)
    written += chunk.length
  }
  return new TextDecoder('utf-8').decode(out)
}

/**
 * @callback CompileFn
 * @param {string} script
 * @param {string} url
 * 
 * @callback ErrorFn
 * @param {unknown} error
 */

/** @type {(() => void) | null} */
let cleanupFn = null

/**
 * @param {CompileFn} compileFn
 * @param {ErrorFn} setError
 * @returns {unknown}
 */
export const init = (compileFn, setError) => {
  const load = loadFromUrl(compileFn, setError)
  window.addEventListener('hashchange', load) // on change

  // Store cleanup function
  cleanupFn = () => {
    window.removeEventListener('hashchange', load)
    cleanupFn = null
  }

  return load() // on load
}

/**
 * Cleanup event listeners added by init()
 */
export const destroy = () => {
  if (cleanupFn) cleanupFn()
}

/**
 * Check if URL needs trust verification (remote URLs only)
 * @param {string} url
 * @returns {boolean}
 */
const needsTrustCheck = (url) => {
  // Gzip data URLs are user-provided content, don't need trust check
  if (url.startsWith(gzipPrefix)) return false
  // A protocol-relative URL inherits the page scheme but names a remote host.
  if (url.startsWith('//')) return true
  // Relative URLs are same-origin (safe)
  if (url.startsWith('./') || url.startsWith('/') || !url.includes('://')) return false
  return true
}

/**
 * Handles a url passed in the anchor string
 * @param {CompileFn} compileFn
 * @param {ErrorFn} setError
 */
export const loadFromUrl = (compileFn, setError) => async () => {
  const url = window.location.hash.substring(1)
  if (url) {
    console.log('fetching script', url)

    // Check trust for remote URLs
    if (needsTrustCheck(url) && !isTrusted(url)) {
      const result = await showPermissionDialog(url)
      if (result === 'cancel') {
        console.log('User cancelled loading untrusted URL')
        return false
      }
      // If user chose trust_url or trust_domain, rule was already saved by dialog
    }

    try {
      const script = await fetchUrl(url)
      compileFn(script, url)
      return true
    } catch (err) {
      setError(err)
      return false  // M2 fix: Return false on error for consistent API
    }
  }
  return false  // M2 fix: Return false when no URL
}

/**
 * Rejects non-http(s) URLs and loopback, private and link-local hosts, so a
 * shared link cannot make the viewer's browser send requests into their own
 * network.
 * @param {string} urlString
 * @returns {boolean}
 */
export const isValidRemoteUrl = (urlString) => {
  try {
    const url = new URL(urlString)

    // Only allow http and https protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false
    }

    const hostname = url.hostname.toLowerCase()

    // Block localhost variations
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return false
    }

    // H9 fix: Block IPv6 private/local addresses
    // Remove brackets from IPv6 addresses for parsing
    const cleanHostname = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname

    if (cleanHostname.includes(':')) {
      // This is an IPv6 address
      const lowerV6 = cleanHostname.toLowerCase()

      // Block loopback (::1)
      if (lowerV6 === '::1') return false

      // Block link-local (fe80::/10)
      if (lowerV6.startsWith('fe8') || lowerV6.startsWith('fe9') ||
          lowerV6.startsWith('fea') || lowerV6.startsWith('feb')) return false

      // Block unique local addresses (fc00::/7 = fc00:: and fd00::)
      if (lowerV6.startsWith('fc') || lowerV6.startsWith('fd')) return false

      // Block IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
      // These can bypass IPv4 checks
      if (lowerV6.startsWith('::ffff:') || lowerV6.includes(':ffff:')) {
        // Extract the IPv4 part and validate it
        const ipv4Match = lowerV6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i) ||
                          lowerV6.match(/:ffff:(\d+\.\d+\.\d+\.\d+)$/i)
        if (ipv4Match) {
          // Re-validate the IPv4 portion
          const ipv4 = ipv4Match[1]
          if (!isValidRemoteUrl(`http://${ipv4}/`)) return false
        } else {
          // Can't parse the IPv4 part, block to be safe
          return false
        }
      }

      // Block site-local (deprecated but still check) fec0::/10
      if (lowerV6.startsWith('fec') || lowerV6.startsWith('fed') ||
          lowerV6.startsWith('fee') || lowerV6.startsWith('fef')) return false

      // Block unspecified address (::)
      if (lowerV6 === '::' || lowerV6 === '0:0:0:0:0:0:0:0') return false
    }

    // Block private IPv4 ranges
    // 10.0.0.0 - 10.255.255.255
    // 172.16.0.0 - 172.31.255.255
    // 192.168.0.0 - 192.168.255.255
    const ipParts = hostname.split('.').map(Number)
    if (ipParts.length === 4 && ipParts.every(n => !isNaN(n) && n >= 0 && n <= 255)) {
      if (ipParts[0] === 10) return false
      if (ipParts[0] === 172 && ipParts[1] >= 16 && ipParts[1] <= 31) return false
      if (ipParts[0] === 192 && ipParts[1] === 168) return false
      if (ipParts[0] === 169 && ipParts[1] === 254) return false // link-local
      if (ipParts[0] === 0) return false // current network
      if (ipParts[0] === 127) return false // loopback range 127.0.0.0/8
    }

    return true
  } catch {
    return false
  }
}

/**
 * Fetch a script by url. There is no server proxy: production Apache answers
 * any unknown path with the SPA's index.html, so a remote host must send CORS.
 * @param {string} url
 */
export const fetchUrl = async (url) => {
  if (url.startsWith(gzipPrefix)) {
    const bytes = base64ToArrayBuffer(url.substring(gzipPrefix.length))
    return gunzipWithinLimit(new Uint8Array(bytes))
  }

  // Allow relative URLs (same-origin, safe); a protocol-relative URL names a
  // remote host and goes through the remote checks below.
  const isRelativeUrl = (url.startsWith('./') || url.startsWith('/') || !url.includes('://')) && !url.startsWith('//')

  if (!isRelativeUrl && !isValidRemoteUrl(url)) {
    throw new Error('Invalid URL: only public http/https URLs are allowed')
  }

  const res = await fetch(url, { credentials: 'omit' }).catch((cause) => {
    throw new Error(`could not fetch ${url}: the host must allow cross-origin requests (CORS)`, { cause })
  })
  if (res.ok) {
    return await res.text()
  } else {
    throw new Error(`failed to load script from url ${url}`)
  }
}

/**
 * Converts a Base64 encoded string to an ArrayBuffer.
 * @param {string} base64 - base64 encoded string
 * @returns {ArrayBuffer} output ArrayBuffer
 */
const base64ToArrayBuffer = (base64) => {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer
}
