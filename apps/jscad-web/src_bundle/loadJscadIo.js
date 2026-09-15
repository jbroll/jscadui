// The io bundle is registered as the '@jscad/io' module alias (see
// apps/jscad-web/bundles.js), which resolves to its absolute /build/ URL
// with no base/root needed. A relative path here would resolve against the
// worker's bare origin instead, dropping the /build/ prefix.
export const loadJscadIo = (require, readFile) => require('@jscad/io', null, readFile)
