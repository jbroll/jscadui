// Both the app shell and the compute frame name build-time origins in their CSP
// metas; __DEV_CONNECT__ is empty in production so a visitor's own machine is
// not reachable.
export const fillHtmlOrigins = (content, { appOrigin, runOrigin, relayOrigin = appOrigin, dev }) => content
  .replaceAll('__RUN_ORIGIN__', runOrigin)
  .replaceAll('__APP_ORIGIN__', appOrigin)
  .replaceAll('__RELAY_ORIGIN__', relayOrigin)
  .replaceAll('__DEV_CONNECT__', dev ? 'http://localhost:*' : '')

export const fillFrameHtml = (content, { appOrigin, runOrigin, dev }) =>
  fillHtmlOrigins(content, { appOrigin, runOrigin, dev })
