/**
 * Default rendering parameters
 * Matches Three.js visual output for consistency across renderers
 */

export default {
  // Background color (white)
  background: [1, 1, 1, 1],

  // Default mesh/line color (JSCAD blue)
  meshColor: [0, 0.6, 1, 1],

  // Light color (white with slight warm tint)
  lightColor: [1, 1, 1, 1],

  // Light direction in view space (matches Three.js light at position 50,0,100)
  // X=right, Y=up, Z=toward viewer - so light from right-front, level
  lightDirection: [0.45, 0.0, 0.9],

  // Light position (for positional lights if needed)
  lightPosition: [100, 200, 100],

  // Ambient light contribution (Three.js uses 0.5 * 0xeeeeee color ≈ 0.47)
  ambientLightAmount: 0.45,

  // Diffuse light contribution (Three.js uses 0.7 * 0xeeeef4 color ≈ 0.65)
  diffuseLightAmount: 0.65,

  // Specular light contribution (16% specular highlights)
  specularLightAmount: 0.16,

  // Material shininess for specular highlights
  materialShininess: 8.0
}
