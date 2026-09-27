// it is possible to read binary data
// https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/Sending_and_Receiving_Binary_Data

// Burst guard: sync XHR cannot queue or back off, so a runaway model fails
// fast instead of hammering the CDN. Real throttling (fetch + concurrency
// limit) waits on the async module loading refactor.
const requestTimes = []
export const READ_FILE_BURST_LIMIT = 200
export const READ_FILE_BURST_WINDOW_MS = 1000
export const resetReadFileRateLimit = () => { requestTimes.length = 0 }

const checkBurst = () => {
  const now = Date.now()
  while (requestTimes.length && now - requestTimes[0] > READ_FILE_BURST_WINDOW_MS) requestTimes.shift()
  if (requestTimes.length >= READ_FILE_BURST_LIMIT) {
    throw new Error(`rate limited: more than ${READ_FILE_BURST_LIMIT} CDN requests in ${READ_FILE_BURST_WINDOW_MS}ms`)
  }
  requestTimes.push(now)
}

export const readFileWeb = (path, {base = '', output='text'}={}) => {
  checkBurst()
  const req = new XMLHttpRequest()
  // If path is already an absolute URL, ignore base parameter
  const isAbsoluteUrl = path.startsWith('http://') || path.startsWith('https://')
  let finalUrl = (base && !isAbsoluteUrl) ? new URL(path, base).href : path

  // CRITICAL FIX: Always resolve the URL against the worker's actual location origin
  // to prevent XHR from resolving it relative to the sourceURL context (which changes
  // based on what script is currently being evaluated with //# sourceURL directives)
  finalUrl = new URL(finalUrl, self.location.origin).href

  req.open('GET', finalUrl, 0) // sync

  if(output !== 'text'){
    // this hack was hard to find, and we can not use fetch because we need sync request
    // XHR binary charset opt by Marcus Granado 2006 [http://mgran.blogspot.com]
    req.overrideMimeType("text/plain; charset=x-user-defined");    
  }
  
  req.send()
  if (req.status === 0) {
    throw new Error(`network error fetching ${path}`)
  } else if (req.status === 404) {
    throw new Error(`file not found ${path}`)
  } else if (req.status !== 200) {
    throw new Error(`failed to fetch file ${path} ${req.status} ${req.statusText}`)
  }

  return output == 'text' ? req.responseText : req.response
}
