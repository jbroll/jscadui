import { messageProxy } from '@jscadui/postmessage'

// https://gomakethings.com/series/service-workers/

const _version = 'SW7'
const clientMap = {}
const searchParams = new URL(location.toString()).searchParams
const prefix = searchParams.get('prefix') || '/swfs/'
const initPath = prefix + 'init'
const debug = searchParams.get('debug')

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

    // Security: Validate clientId from URL matches the actual requesting client
    // This prevents cache poisoning attacks where an attacker crafts URLs with other clientIds
    if (event.clientId && urlClientId !== event.clientId) {
      event.respondWith(new Response('Unauthorized: clientId mismatch', { status: 403 }))
      return
    }

    path = path.substring(idx)

    const fetchFile = async () => {
      try {
        const clientWrapper = await getClientWrapper(urlClientId)
        const fileReq = new Request(path)

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

        // Request file from client and wait for response
        let resp
        try {
          resp = await clientWrapper.api.getFile({ path: path })
        } catch (getFileError) {
          console.error('getFile error:', getFileError)
          return new Response('Failed to get file: ' + path, { status: 500 })
        }

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

    // H21 fix: Track timeout and log errors that occur after timeout
    let timedOut = false
    const timeout = new Promise(resolve =>
      setTimeout(() => {
        timedOut = true
        resolve(new Response('timeout for ' + path, { status: 504 }))
      }, 5000)
    )

    // Wrap fetchFile to handle post-timeout errors
    const fetchWithErrorLogging = fetchFile().catch(err => {
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
