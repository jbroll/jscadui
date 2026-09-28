// Deployed and launcher builds serve /api/relay on their own origin; the dev
// server has none, and production trusts its origin.
export const relayOrigin = ({ dev, appOrigin, env = process.env }) =>
  env.RELAY_ORIGIN || (dev ? 'https://jscad.rkroll.com' : appOrigin)
