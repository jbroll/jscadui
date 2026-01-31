/**
 * Instanced mesh shaders for efficient rendering of duplicate geometry
 * Uses WebGL 2 instancing with ANGLE_instanced_arrays fallback
 */

/**
 * Vertex shader for instanced mesh rendering
 * Instance matrices are passed as 4 vec4 attributes (one per column)
 */
export const instancedMeshVert = `
precision highp float;

// Per-vertex attributes
attribute vec3 position, normal;

// Per-instance attributes (matrix columns)
attribute vec4 instanceMatrix0;
attribute vec4 instanceMatrix1;
attribute vec4 instanceMatrix2;
attribute vec4 instanceMatrix3;

// Global uniforms
uniform mat4 view, projection;
uniform vec3 lightDirection;

// Varyings for fragment shader
varying vec3 vNormal;
varying vec3 vLightDir;
varying vec3 vViewDir;

void main() {
  // Reconstruct instance model matrix from columns
  mat4 instanceModel = mat4(
    instanceMatrix0,
    instanceMatrix1,
    instanceMatrix2,
    instanceMatrix3
  );

  // Transform position by instance matrix then view/projection
  vec4 worldPos = instanceModel * vec4(position, 1.0);
  gl_Position = projection * view * worldPos;

  // Transform normal by instance matrix (ignoring translation)
  // H5 note: This only works correctly for uniform scaling and rotation.
  // For non-uniform scaling, normals would need transpose(inverse(mat3(instanceModel)))
  // which is expensive in GLSL. Most CAD models use uniform scaling.
  mat3 normalMatrix = mat3(instanceModel);
  vNormal = normalize(normalMatrix * normal);

  // Light direction (camera-attached light)
  vLightDir = normalize(lightDirection);

  // H5 fix: Correct camera position extraction from view matrix
  // View matrix transforms world->eye, so camera pos = -transpose(R) * t
  // where R = mat3(view) and t = view[3].xyz
  vec3 cameraPos = -vec3(
    dot(view[0].xyz, view[3].xyz),
    dot(view[1].xyz, view[3].xyz),
    dot(view[2].xyz, view[3].xyz)
  );
  vViewDir = normalize(cameraPos - worldPos.xyz);
}
`

/**
 * Fragment shader for instanced mesh rendering
 * Same Blinn-Phong lighting as regular mesh shader
 */
export const instancedMeshFrag = `
precision highp float;

uniform vec4 color;
uniform vec3 lightColor;
uniform float ambientAmount, diffuseAmount, specularAmount, shininess;

varying vec3 vNormal;
varying vec3 vLightDir;
varying vec3 vViewDir;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(vLightDir);
  vec3 viewDir = normalize(vViewDir);

  // Ambient
  vec3 ambient = ambientAmount * color.rgb;

  // Diffuse (Lambertian)
  float diff = max(dot(normal, lightDir), 0.0);
  vec3 diffuse = diffuseAmount * diff * color.rgb;

  // Specular (Blinn-Phong)
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, halfDir), 0.0), shininess);
  vec3 specular = specularAmount * spec * lightColor;

  vec3 result = ambient + diffuse + specular;
  gl_FragColor = vec4(result, color.a);
}
`

/**
 * Vertex shader for instanced mesh with per-vertex colors
 */
export const instancedVColorVert = `
precision highp float;

// Per-vertex attributes
attribute vec3 position, normal;
attribute vec4 vcolor;

// Per-instance attributes (matrix columns)
attribute vec4 instanceMatrix0;
attribute vec4 instanceMatrix1;
attribute vec4 instanceMatrix2;
attribute vec4 instanceMatrix3;

// Global uniforms
uniform mat4 view, projection;
uniform vec3 lightDirection;

// Varyings
varying vec3 vNormal;
varying vec3 vLightDir;
varying vec3 vViewDir;
varying vec4 vColor;

void main() {
  // Reconstruct instance model matrix from columns
  mat4 instanceModel = mat4(
    instanceMatrix0,
    instanceMatrix1,
    instanceMatrix2,
    instanceMatrix3
  );

  // Transform position
  vec4 worldPos = instanceModel * vec4(position, 1.0);
  gl_Position = projection * view * worldPos;

  // Transform normal (H5 note: only correct for uniform scaling)
  mat3 normalMatrix = mat3(instanceModel);
  vNormal = normalize(normalMatrix * normal);

  // Light and view directions
  vLightDir = normalize(lightDirection);
  // H5 fix: Correct camera position extraction
  vec3 cameraPos = -vec3(
    dot(view[0].xyz, view[3].xyz),
    dot(view[1].xyz, view[3].xyz),
    dot(view[2].xyz, view[3].xyz)
  );
  vViewDir = normalize(cameraPos - worldPos.xyz);

  // Pass through vertex color
  vColor = vcolor;
}
`

/**
 * Fragment shader for instanced mesh with per-vertex colors
 */
export const instancedVColorFrag = `
precision highp float;

uniform vec3 lightColor;
uniform float ambientAmount, diffuseAmount, specularAmount, shininess;

varying vec3 vNormal;
varying vec3 vLightDir;
varying vec3 vViewDir;
varying vec4 vColor;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(vLightDir);
  vec3 viewDir = normalize(vViewDir);

  // Ambient
  vec3 ambient = ambientAmount * vColor.rgb;

  // Diffuse
  float diff = max(dot(normal, lightDir), 0.0);
  vec3 diffuse = diffuseAmount * diff * vColor.rgb;

  // Specular
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, halfDir), 0.0), shininess);
  vec3 specular = specularAmount * spec * lightColor;

  vec3 result = ambient + diffuse + specular;
  gl_FragColor = vec4(result, vColor.a);
}
`
