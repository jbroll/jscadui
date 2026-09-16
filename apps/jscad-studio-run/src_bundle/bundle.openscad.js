/**
 * OpenSCAD transpiler bundle entry point.
 *
 * Bundled as an IIFE with globalName 'jscadui_openscad' so it can be
 * lazily loaded in the worker via importScripts('./bundle.openscad.js').
 *
 * Usage (inside worker):
 *   importScripts('./bundle.openscad.js')
 *   const { parse, transpile, j$ } = jscadui_openscad
 */
export { parse, transpile } from '@jscadui/openscad'
export { j$ } from '@jscadui/openscad-runtime'
