// A production index.html names its content-hashed entry, which hashes every
// bundle it loads, so that hash identifies the whole build (see hashAssets.js).
export const entryHash = (html, entry) =>
  html.match(new RegExp(`(?<![\\w-])${entry}\\.([0-9a-f]{8})\\.js`))?.[1] ?? null
