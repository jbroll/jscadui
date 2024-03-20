export function addV1Shim(script){
  return `const csg = require('@jscad/csg')
const {circle, square, polygon, triangle} = csg.primitives2d
const {cube, sphere, cylinder, geodesicSphere, torus, polyhedron} = csg.primitives3d
const {union, difference, intersection} = csg.booleanOps
const {translate, center, scale, rotate, transform, mirror, expand, contract, minkowski, hull, chain_hull} = csg.transformations
const {extrudeInOrthonormalBasis, extrudeInPlane, extrude, linear_extrude, rotate_extrude, rotateExtrude, rectangular_extrude} = csg.extrusions
const {css2rgb, color, rgb2hsl, hsl2rgb, rgb2hsv, hsv2rgb, html2rgb, rgb2html} = csg.color
const {sin, cos, asin, acos, tan, atan, atan2, ceil, floor, abs, min, max, rands, log, lookup, pow, sign, sqrt, round} = csg.maths
const {vector_char, vector_text, vectorChar, vectorText} = csg.text
// lines above are a JS shim, to make .jscad scripts work as regular JS
// ------------------------------ JS SHIM HEADER ---------------------------------------------------------------------------------------
  
  ${script}


// ---------------------------- JS SHIM FOOTER -----------------------------------------------------------------------------------------
// this is footer of the JS shim, to export the main and getParameterDefinitions
module.exports = { main }
// some scripts will not have parameters, so we silently ignore the error line below would cause
try{ module.exports.getParameterDefinitions = getParameterDefinitions }catch(e){}
  `
}