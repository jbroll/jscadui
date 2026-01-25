import * as fflate from 'fflate'

const gzipPrefix = 'data:application/gzip;base64,'

/**
 * @callback CompileFn
 * @param {string} script
 * @param {string} url
 * 
 * @callback ErrorFn
 * @param {unknown} error
 */

/**
 * @param {CompileFn} compileFn 
 * @param {ErrorFn} setError 
 * @returns {unknown}
 */
export const init = (compileFn, setError) => {
  const load = loadFromUrl(compileFn, setError)
  window.addEventListener('hashchange', load) // on change
  return load() // on load
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
    // load from /remote
    try {
      const script = await fetchUrl(url)
      compileFn(script, url)
      return true
    } catch (err) {
      setError(err)
    }
  }
}

/**
 * Validates that a URL is safe to fetch (no localhost, private IPs, or non-http protocols)
 * @param {string} urlString
 * @returns {boolean}
 */
const isValidRemoteUrl = (urlString) => {
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

    // Block private IP ranges (basic check)
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
    }

    return true
  } catch {
    return false
  }
}

/**
 * Try to fetch a url directly, but if that fails (due to CORS)
 * then fallback to fetching via server proxy.
 * @param {string} url
 */
const fetchUrl = async (url) => {
  if (url.startsWith(gzipPrefix)) {
    const bytes = base64ToArrayBuffer(url.substring(gzipPrefix.length))
    const dec = fflate.gunzipSync(new Uint8Array(bytes))
    return new TextDecoder("utf-8").decode(dec)
  }

  // Validate URL before fetching to prevent SSRF attacks
  if (!isValidRemoteUrl(url)) {
    throw new Error('Invalid URL: only public http/https URLs are allowed')
  }

  // Try to fetch url directly
  const res = await fetch(url).catch(() => {
    // Failed to fetch directly, try proxy
    // URL encode the parameter to prevent injection
    return fetch(`/remote?url=${encodeURIComponent(url)}`)
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
