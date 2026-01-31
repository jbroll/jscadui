import { messageProxy } from '@jscadui/postmessage'

// https://gomakethings.com/series/service-workers/

const _version = 'SW7'
const clientMap = {}
const searchParams = new URL(location.toString()).searchParams
const prefix = searchParams.get('prefix') || '/swfs/'
const initPath = prefix + 'init'
const debug = searchParams.get('debug')

// H11 fix: Periodically clean up disconnected clients from clientMap
// This prevents unbounded memory growth as clients connect and disconnect
const CLEANUP_INTERVAL = 60000 // 1 minute
let lastCleanup = Date.now()

const cleanupDisconnectedClients = async () => {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now

  const activeClients = await clients.matchAll({ includeUncontrolled: true })
  const activeClientIds = new Set(activeClients.map(c => c.id))

  for (const clientId of Object.keys(clientMap)) {
    if (!activeClientIds.has(clientId)) {
      // Client no longer exists, clean up its resources
      const wrapper = clientMap[clientId]
      // Destroy postmessage handler if it has cleanup method
      wrapper?.api?.destroy?.()
      // Delete the cache for this client
      caches.delete(prefix + clientId).catch(() => {})
      delete clientMap[clientId]
      if (debug) console.log('Cleaned up disconnected client:', clientId)
    }
  }
}

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim())
})

self.addEventListener('install', () => {
  // https://gomakethings.com/how-to-immediately-activate-a-service-worker-with-vanilla-js/
  self.skipWaiting()
})

/** Create a client wrapper, or return one from cache. It is important to know
 * that cache can disappear (likely due to browser suspending the worker when idle).
 * page calling init will create a cached instance, but if dev tools in chrome
 * are nto open, after about 10 seconds, looks like cache is gone (likely worker got suspended)
 *
 * @param {string} clientId
 * @returns
 */
const getClientWrapper = async clientId => {
  let clientWrapper = clientMap[clientId]
  if (!clientWrapper) {
    try {
      clientWrapper = clientMap[clientId] = { api: messageProxy(await clients.get(clientId), {}, { debug }) }
      clientWrapper.cache = await caches.open(prefix + clientId)
    } catch (error) {
      console.error('Failed to create client wrapper:', error)
      throw error
    }
  }
  return clientWrapper
}

self.addEventListener('fetch', async event => {
  // H11 fix: Trigger cleanup of disconnected clients (non-blocking)
  cleanupDisconnectedClients().catch(() => {})

  const urlPath = event.request.url
  const requestUrl = new URL(urlPath)

  // Security: Only handle requests from same origin
  if (requestUrl.origin !== self.location.origin) {
    return
  }

  let path = requestUrl.pathname
  if (path === initPath) {
    // this procedure allows tab-page-client to know it's clientId
    // that way urls in worker can have clientId in path to preperly route file requests
    const clientId = event.clientId
    event.respondWith(new Response(clientId))
    getClientWrapper(clientId)
  } else if (path.startsWith(prefix)) {
    path = path.substring(prefix.length)
    const idx = path.indexOf('/')
    const urlClientId = path.substring(0, idx)

    // H12 fix: Enhanced client ID validation
    // Validate clientId format (should be a valid service worker client ID)
    // Client IDs are typically UUIDs or similar identifier strings
    if (!urlClientId || urlClientId.length < 8 || urlClientId.length > 128 ||
        !/^[a-zA-Z0-9_-]+$/.test(urlClientId)) {
      event.respondWith(new Response('Invalid client ID format', { status: 400 }))
      return
    }

    // Security: Validate clientId from URL matches the actual requesting client
    // This prevents cache poisoning attacks where an attacker crafts URLs with other clientIds
    if (event.clientId) {
      // Direct client ID comparison when we have event.clientId
      if (urlClientId !== event.clientId) {
        event.respondWith(new Response('Unauthorized: clientId mismatch', { status: 403 }))
        return
      }
    } else {
      // H12 fix: When event.clientId is unavailable (e.g., navigation requests),
      // verify the client exists before proceeding
      const existingClient = await clients.get(urlClientId)
      if (!existingClient) {
        event.respondWith(new Response('Unauthorized: unknown client', { status: 403 }))
        return
      }
    }

    path = path.substring(idx)

    // C5 fix: Track timeout state for early exit
    let timedOut = false

    const fetchFile = async () => {
      try {
        const clientWrapper = await getClientWrapper(urlClientId)
        const fileReq = new Request(path)

        // C5 fix: Check if timed out before proceeding
        if (timedOut) return null

        // Check cache first
        let rCached
        try {
          rCached = await clientWrapper.cache.match(fileReq)
        } catch (cacheError) {
          console.error('Cache match error:', cacheError)
        }

        if (rCached) {
          return rCached
        }

        // C5 fix: Check if timed out before requesting from client
        if (timedOut) return null

        // Request file from client and wait for response
        let resp
        try {
          resp = await clientWrapper.api.getFile({ path: path })
        } catch (getFileError) {
          console.error('getFile error:', getFileError)
          return new Response('Failed to get file: ' + path, { status: 500 })
        }

        // C5 fix: Check if timed out before final cache access
        if (timedOut) return null

        // Only check cache after getFile confirms success
        if (resp === 'ok') {
          try {
            rCached = await clientWrapper.cache.match(fileReq)
          } catch (cacheError) {
            console.error('Cache match error after getFile:', cacheError)
          }
        }

        return rCached || new Response(path + ' not found', { status: 404 })
      } catch (error) {
        console.error('Fetch handler error:', error)
        return new Response('Internal error: ' + error.message, { status: 500 })
      }
    }

    const timeout = new Promise(resolve =>
      setTimeout(() => {
        timedOut = true
        resolve(new Response('timeout for ' + path, { status: 504 }))
      }, 5000)
    )

    // Wrap fetchFile to handle post-timeout errors and null returns
    const fetchWithErrorLogging = fetchFile().then(result => {
      // C5 fix: If result is null, timeout already handled response
      if (result === null) {
        return new Response('Request cancelled due to timeout', { status: 504 })
      }
      return result
    }).catch(err => {
      if (timedOut) {
        console.error('Error after timeout for', path, ':', err)
      }
      return new Response('Error fetching ' + path, { status: 500 })
    })

    event.respondWith(Promise.race([fetchWithErrorLogging, timeout]))
  }
})

self.addEventListener('message', async event => {
  if (event.data?.type == 'CLAIM_CLIENTS') { // handling hard refresh
    await self.clients.claim();
    event.ports[0].postMessage(true)
  } else {
    const client = clientMap[event.source.id]
    if (client) client.api.onmessage(event)
  }
})
