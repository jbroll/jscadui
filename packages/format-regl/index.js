
const white = [1, 1, 1, 1]
export function CommonToRegl () {
  let SEQ = 0
  function _CSG2Regl (obj, scene, meshColor) {
    let { vertices, indices = [], normals, color=meshColor, colors, isTransparent = false, opacity } = obj
    const { transforms } = obj
    const objType = obj.type || 'mesh'

    const visuals = {
      show: true,
      color,
      transparent: isTransparent || (color?.length>3 && color[3] <1),
      useVertexColors: !!(colors && colors.length)
    }
    // regl requires normals even for lines - create default up-facing normals
    if(!normals) {
      const vertCount = vertices.length / 3
      normals = new Float32Array(vertices.length)
      for(let i = 0; i < vertCount; i++){
        // Default normal pointing up (0, 0, 1)
        normals[i * 3] = 0
        normals[i * 3 + 1] = 0
        normals[i * 3 + 2] = 1
      }
    }

    const geometry = { positions: vertices, transforms }

    if (indices && indices.length) geometry.indices = indices
    if (normals) geometry.normals = normals

    let _colors
    if (colors && colors.length) {
      const vertexCount = Math.floor(vertices.length / 3)
      // Check if colors has 3 components (RGB) or 4 components (RGBA) per vertex
      const hasAlpha = colors.length >= vertexCount * 4
      if (!hasAlpha) {
        // Convert RGB to RGBA
        const colorVertexCount = Math.floor(colors.length / 3)
        const count = Math.min(colorVertexCount, vertexCount)
        _colors = new Float32Array(vertexCount * 4)
        for (let v = 0; v < count; v++) {
          const ci = v * 3
          const di = v * 4
          _colors[di] = colors[ci]
          _colors[di + 1] = colors[ci + 1]
          _colors[di + 2] = colors[ci + 2]
          _colors[di + 3] = 1
        }
        // Fill remaining with white
        for (let v = count; v < vertexCount; v++) {
          const di = v * 4
          _colors[di] = 1
          _colors[di + 1] = 1
          _colors[di + 2] = 1
          _colors[di + 3] = 1
        }
      } else {
        _colors = colors
      }
    }
    // if (color && color[3] == 0.2) color[3] = 0.45
    // if (color && color[3] == 0.1) color[3] = 0.3

    let _opacity
    switch (objType) {
      case 'mesh':
        visuals.drawCmd = 'drawMesh'
        break
      case 'lines':
        visuals.drawCmd = 'drawLines'
        if (!indices || !indices.length) {
          // Create sequential indices without mutating input
          const len = Math.floor(vertices.length / 3)
          geometry.indices = Array.from({ length: len }, (_, i) => i)
        }
        _opacity = (color ? color[3] : 0) || opacity || 1
        // mesh = new LinesMesh('lines', scene, null, undefined, undefined, useVertexColor, useVertexAlpha || _opacity < 1, material)
        if (color) geometry.color = color
        if (_colors) {
          geometry.colors = _colors
          // geometry.color = white
        }

        break
    }
    //    if (transforms && !isInstanced) mesh.applyMatrix4({ elements: transforms })
    return { geometry, visuals, transparent:visuals.transparent }
  }

  return _CSG2Regl
}
