export const fillFrameHtml = (content, { appOrigin, runOrigin, dev }) => content
  .replaceAll('__RUN_ORIGIN__', runOrigin)
  .replaceAll('__APP_ORIGIN__', appOrigin)
  .replaceAll('__DEV_CONNECT__', dev ? 'http://localhost:*' : '')
