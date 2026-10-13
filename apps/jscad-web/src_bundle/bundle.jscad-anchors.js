// The local anchors bundle the worker loads through the '@jbroll/jscad-anchors'
// alias, replacing the stale-pinned CDN dist whose geometry-bound storage
// predates tree nodes. Built from the pinned checkout's source at build time.
//
// Its internal require of '@jscad/modeling' stays external so anchors wraps
// whatever tree the alias maps in; the outer wrap no-ops on already-tagged
// nodes by the constant 'tree' basis rule.
module.exports = require('@jbroll/jscad-anchors')
