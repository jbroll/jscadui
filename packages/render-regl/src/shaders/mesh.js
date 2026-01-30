/**
 * Mesh shaders with Phong lighting
 * Supports both uniform color and per-vertex colors
 */

// Vertex shader for meshes (uniform color)
export const meshVert = `
precision mediump float;

uniform float camNear, camFar;
uniform mat4 model, view, projection;

attribute vec3 position, normal;

varying vec3 surfaceNormal, surfacePosition;
varying vec4 _worldSpacePosition;

void main() {
  surfacePosition = position;
  surfaceNormal = normal;
  vec4 worldSpacePosition = model * vec4(position, 1);
  _worldSpacePosition = worldSpacePosition;

  gl_Position = projection * view * model * vec4(position, 1);
}
`

// Fragment shader for meshes (uniform color)
export const meshFrag = `
precision mediump float;

varying vec3 surfaceNormal;
uniform float ambientLightAmount;
uniform float diffuseLightAmount;
uniform vec4 ucolor;
uniform vec3 eye;  // Camera position

varying vec4 _worldSpacePosition;

void main () {
  // Compute light direction from camera position toward surface (camera-attached light)
  vec3 lightDir = normalize(eye - _worldSpacePosition.xyz);

  vec3 ambient = ambientLightAmount * ucolor.rgb;
  float cosTheta = dot(normalize(surfaceNormal), lightDir);
  vec3 diffuse = diffuseLightAmount * ucolor.rgb * clamp(cosTheta, 0.0, 1.0);

  gl_FragColor = vec4((ambient + diffuse), ucolor.a);
}
`

// Vertex shader for meshes with vertex colors
export const vColorVert = `
precision mediump float;

uniform float camNear, camFar;
uniform mat4 model, view, projection, unormal;

attribute vec3 position, normal;
attribute vec4 color;

varying vec3 surfaceNormal, surfacePosition;
varying vec4 _worldSpacePosition;
varying vec4 vColor;

void main() {
  surfacePosition = (unormal * vec4(position, 1.0)).xyz;
  surfaceNormal = normalize((unormal * vec4(normal, 1.0)).xyz);
  vec4 worldSpacePosition = model * vec4(position, 1);
  _worldSpacePosition = worldSpacePosition;

  vColor = color;

  gl_Position = projection * view * model * vec4(position, 1);
}
`

// Fragment shader for meshes with vertex colors (includes specular)
export const vColorFrag = `
precision mediump float;

varying vec3 surfaceNormal, surfacePosition;

uniform float ambientLightAmount;
uniform float diffuseLightAmount;
uniform float specularLightAmount;

uniform vec3 eye;  // Camera position
uniform vec4 lightColor;
uniform float uMaterialShininess;

varying vec4 vColor;
uniform vec4 ucolor;
uniform float vColorToggler;

varying vec4 _worldSpacePosition;

void main () {
  vec4 endColor = vColor * vColorToggler + ucolor * (1.0 - vColorToggler);

  // Compute light direction from camera position (camera-attached light)
  vec3 lightDir = normalize(eye - _worldSpacePosition.xyz);
  vec3 normal = normalize(surfaceNormal);

  vec3 ambient = ambientLightAmount * endColor.rgb;

  float diffuseWeight = dot(normal, lightDir);
  vec3 diffuse = diffuseLightAmount * endColor.rgb * clamp(diffuseWeight, 0.0, 1.0);

  // Specular (Phong)
  vec4 specularColor = lightColor;
  vec3 eyeDirection = normalize(eye - _worldSpacePosition.xyz);
  vec3 reflectionDirection = reflect(-lightDir, normal);
  float specularLightWeight = pow(max(dot(reflectionDirection, eyeDirection), 0.0), uMaterialShininess);
  vec3 specular = specularColor.rgb * specularLightWeight * specularLightAmount;

  gl_FragColor = vec4((ambient + diffuse + specular), endColor.a);
}
`

// Vertex shader for flat shading (no normal attribute - computed in fragment shader)
export const flatVert = `
precision mediump float;

uniform mat4 model, view, projection;

attribute vec3 position;

varying vec4 _worldSpacePosition;

void main() {
  vec4 worldSpacePosition = model * vec4(position, 1);
  _worldSpacePosition = worldSpacePosition;
  gl_Position = projection * view * worldSpacePosition;
}
`

// Fragment shader for flat shading (computes normal from screen-space derivatives)
export const flatFrag = `
#extension GL_OES_standard_derivatives : enable
precision mediump float;

uniform float ambientLightAmount;
uniform float diffuseLightAmount;
uniform vec4 ucolor;
uniform vec3 eye;

varying vec4 _worldSpacePosition;

void main () {
  // Compute flat normal from screen-space derivatives of world position
  vec3 dx = dFdx(_worldSpacePosition.xyz);
  vec3 dy = dFdy(_worldSpacePosition.xyz);
  vec3 normal = normalize(cross(dx, dy));

  // Compute light direction from camera position (camera-attached light)
  vec3 lightDir = normalize(eye - _worldSpacePosition.xyz);

  vec3 ambient = ambientLightAmount * ucolor.rgb;
  float cosTheta = abs(dot(normal, lightDir));
  vec3 diffuse = diffuseLightAmount * ucolor.rgb * cosTheta;

  gl_FragColor = vec4(ambient + diffuse, ucolor.a);
}
`

export default {
  vert: meshVert,
  frag: meshFrag,
  vColorVert,
  vColorFrag,
  flatVert,
  flatFrag
}
