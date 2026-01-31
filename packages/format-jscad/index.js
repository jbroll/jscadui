/**
 * @param {Float32Array} points 
 * @param {[number,number,number?]} p 
 * @param {number} i 
 */
const setPoints = (points, p, i) => {
  points[i++] = p[0]
  points[i++] = p[1]
  points[i++] = p[2] || 0
}

/**
 * @param {import("@jscadui/format-common").CSGPolygons} csg 
 * @returns {import("@jscadui/format-common").JscadMeshEntityRaw}
 */
function CSG2Vertices (csg) {
  let vLen = 0; let iLen = 0

  let hasVertexColors// v1 colors support
  for (const poly of csg.polygons) {// v1 colors support
    // Skip degenerate polygons (need at least 3 vertices for a triangle)
    if (!poly.vertices || poly.vertices.length < 3) continue
    if(poly.shared?.color) hasVertexColors = true
    const len = poly.vertices.length
    vLen += len * 3
    iLen += 3 * (len - 2)
  }
  
  const vertices = new Float32Array(vLen)
  const normals = new Float32Array(vLen)
  // Use Uint32Array when vertex count exceeds 65535 (Uint16 max value)
  // vLen is total floats (vertices * 3), so divide by 3 to get vertex count
  const indices = vLen / 3 > 65535 ? new Uint32Array(iLen) : new Uint16Array(iLen)
  let colors
  let color
  let vertOffset = 0
  let indOffset = 0
  let posOffset = 0
  let first = 0

  if(hasVertexColors){// v1 colors support
    const lastColor = [1,0.5,0.5,1]
    // H6 fix: colors should be per-vertex (matching vertices array), not per-index
    // vLen is vertex count * 3 floats, so we need vLen/3 colors * 4 components
    const vertexCount = vLen / 3
    colors = new Float32Array(vertexCount * 4)
    let colorOffset = 0
    for (const poly of csg.polygons) {
      // Skip degenerate polygons (need at least 3 vertices for a triangle)
      if (!poly.vertices || poly.vertices.length < 3) continue
      color = poly.shared?.color || lastColor
      const count = poly.vertices.length
      // Write one color per vertex in this polygon
      for(let i = 0; i < count; i++){
        colors[colorOffset++] = color[0]
        colors[colorOffset++] = color[1]
        colors[colorOffset++] = color[2]
        colors[colorOffset++] = color[3] ?? 1
      }
  	}
  }

  /**
   * @param {import("@jscadui/format-common").CSGPolygons['polygons'][0]['vertices']} vertices
   * @returns { [number,number,number][]}
   */
  const normalizeVertexFormat = (vertices) => {
    if (!vertices || vertices.length === 0) return []
    if ('pos' in vertices[0]) {//converting v1 polygon with pos:{x,y,z} to number array
      return (/** @type {import("@jscadui/format-common").CSGPolygonOldVertices} */ (vertices)).map(({ pos }) => {
        return [pos.x, pos.y, pos.z]
      })
    } else {
      return (/** @type {[number,number,number][]} */ (vertices))
    }
  }

  vertOffset = 0
  for (const poly of csg.polygons) {
    const arr = normalizeVertexFormat(poly.vertices)
    // Skip degenerate polygons (need at least 3 vertices for a triangle)
    if (arr.length < 3) continue
    const normal = calculateNormal(arr)
    const len = arr.length
    first = posOffset
    vertices.set(arr[0], vertOffset)
    normals.set(normal, vertOffset)
    vertOffset += 3
    vertices.set(arr[1], vertOffset)
    normals.set(normal, vertOffset)
    vertOffset += 3
    posOffset += 2
    for (let i = 2; i < len; i++) {
      vertices.set(arr[i], vertOffset)
      normals.set(normal, vertOffset)

      indices[indOffset++] = first
      indices[indOffset++] = first + i -1
      indices[indOffset++] = first + i
      vertOffset += 3
      posOffset += 1
    }
  }

  return { type: 'mesh', vertices, indices, normals, colors, isTransparent:hasVertexColors }
}

/**
 * @param {[number,number,number][]} vertices 
 * @returns {[number,number,number]}
 */
const calculateNormal = (vertices) => {
  const v0 = vertices[0]
  const v1 = vertices[1]
  const v2 = vertices[2]

  const Ax = v1[0] - v0[0]
  const Ay = v1[1] - v0[1]
  const Az = v1[2] - v0[2]

  const Bx = v2[0] - v0[0]
  const By = v2[1] - v0[1]
  const Bz = v2[2] - v0[2]

  const Nx = Ay * Bz - Az * By
  const Ny = Az * Bx - Ax * Bz
  const Nz = Ax * By - Ay * Bx

  const len = Math.hypot(Nx, Ny, Nz)
  // L8 fix: Use epsilon threshold to handle near-degenerate polygons
  // that could cause very large or NaN values from division
  if (len < 1e-10) return [0, 0, 1]
  return [Nx / len, Ny / len, Nz / len]
}

/**
 * @param {import("@jscadui/format-common").CSGLine} csg 
 * @returns {import("@jscadui/format-common").JscadLineEntityRaw}
 */
function CSG2LineVertices (csg) {
  let vLen = csg.points.length * 3
  if (csg.isClosed) vLen += 3

  const vertices = new Float32Array(vLen)

  csg.points.forEach((p, idx) => setPoints(vertices, p, idx * 3))

  if (csg.isClosed) {
    setPoints(vertices, csg.points[0], vertices.length - 3)
  }
  return { type: 'line', vertices }
}

/**
 * @param {import("@jscadui/format-common").CSGItem & import("@jscadui/format-common").CSGLineSegments} csg 
 * @returns {import("@jscadui/format-common").JscadLinesEntityRaw}
 */
function CSGSides2LineSegmentsVertices (csg) {
  const vLen = csg.sides.length * 6

  const vertices = new Float32Array(vLen)
  csg.sides.forEach((side, idx) => {
    const i = idx * 6
    setPoints(vertices, side[0], i)
    setPoints(vertices, side[1], i + 3)
  })
  return { type: 'lines', vertices }
}

/**
 * @param {import("@jscadui/format-common").CsgContourOrOutlineValue} values  
 * @returns {import("@jscadui/format-common").JscadLinesEntityRaw}
 */
const CSGOutlines2LineSegmentsVertices = (values) => {
  const numPoints = values.reduce((acc, outline) => acc + outline.length, 0)
  const vLen = numPoints * 6

  const vertices = new Float32Array(vLen)
  let idx = 0
  values.forEach((outline) => {
    let prev = outline[outline.length - 1]
    outline.forEach((vert) => {
      setPoints(vertices, prev, idx * 6)
      setPoints(vertices, vert, idx * 6 + 3)
      prev = vert
      idx++
    })
  })
  return { type: 'lines', vertices }
}

/**
 * @template TData
 * @template TOptions
 * @param {(data:TData,options:TOptions)=>import("@jscadui/format-common").JscadMainEntityRaw} func 
 * @param {TData} data 
 * @param {Object} cacheKey 
 * @param {import("@jscadui/format-common").JscadTransferable[]} transferable 
 * @param {Map<number,import("@jscadui/format-common").JscadMainEntity> | false | undefined} unique 
 * @param {TOptions} options 
 * @returns {import("@jscadui/format-common").JscadMainEntity}
 */
function CSGCached (func, data, cacheKey, transferable, unique, options) {
  cacheKey = cacheKey || data

  let geo = JscadToCommon.cache.get(cacheKey)
  if (!geo) {
    geo = (/** @type {import("@jscadui/format-common").JscadMainEntity} */(func(data, options)))
    geo.id = JscadToCommon.sequence++

    // fill transferable array for postMessage optimization
    if (transferable) {
      if ('vertices' in geo) transferable.push(geo.vertices)
      if ('indices' in geo && geo.indices !== undefined) transferable.push(geo.indices)
      if ('normals' in geo && geo.normals !== undefined) transferable.push(geo.normals)
    }

    JscadToCommon.cache.set(cacheKey, geo)
  }
  // fill unique map for exports that reuse stuff like 3mf
  if (unique) unique.set(geo.id, geo)

  return geo
}

/** Prepare lists of geometries grouped by type with format suitable for webgl if possible or type:unknown.
 * @param {(import("@jscadui/format-common").CSGItem | import("@jscadui/format-common").JscadMeshEntity)[] | undefined} list
 * @param {import("@jscadui/format-common").JscadTransferable[]} transferable
 * @param {boolean | undefined} useInstances
 * @returns {import("@jscadui/format-common").JscadResultsByType} object separating converted geometries by type: line,lines,mesh,instance,unknown
 */
JscadToCommon.prepare = (list, transferable, useInstances) => {
  /** @type {import("@jscadui/format-common").JscadResultsByType} */
  const map = { line: [], lines: [], mesh: [], instance: [], unknown: [], all: [], unique: new Map() }

  const instanceMap = new Map()
  /**
   * @param {import("@jscadui/format-common").JscadMainEntity} data 
   */
  const add = data => {
    map[data.type].push(data)
    map.all.push(data)
  }

  /**
   * @param {(import("@jscadui/format-common").CSGItem | import("@jscadui/format-common").JscadMeshEntity)[] } list 
   */
  const extract = list => {
    list.forEach(csg => {
      if (!csg) return
      if (csg instanceof Array) {
        extract(csg)
      } else {
        const obj = JscadToCommon(csg, transferable, map.unique)
        // Skip null returns (e.g., empty transform wrappers)
        if (!obj) return
        // transparency in instanced mesh is problematic
        // transparent objects need ordering,  and that breaks thing for rendering instances
        if (useInstances && obj.type === 'mesh' && obj.id && (!csg.color || csg.color.length === 3 || csg.color[3] === 1)) {
          // Create composite key from mesh id and color to ensure different colors don't share instances
          const colorKey = csg.color ? csg.color.slice(0, 3).join(',') : 'default'
          const instanceKey = `${obj.id}:${colorKey}`
          let old = instanceMap.get(instanceKey)
          if (!old) {
            old = { csg, ...obj, list: [] }
            instanceMap.set(instanceKey, old)
          }
          old.list.push(csg)
        } else {
          add({ csg, ...obj })
        }
      }
    })
  }

  if (list) extract(list)
  instanceMap.forEach(data => {
    if (data.list.length === 1) {
      delete data.list
    } else {
      data.type = 'instance'
    }
    add(data)
  })

  return map
}

/**
 * @param {import("@jscadui/format-common").CSGItem | import("@jscadui/format-common").JscadMeshEntity} csg 
 * @param {import("@jscadui/format-common").JscadTransferable[]} transferable 
 * @param {Map<number,import("@jscadui/format-common").JscadMainEntity> | false | undefined} unique 
 * @param {unknown} [options]
 * @returns {import("@jscadui/format-common").JscadMainEntity}
 */
export function JscadToCommon (csg, transferable, unique, options) {
  if (csg instanceof Array) return csg.map(csg2 => JscadToCommon(csg2, transferable, unique, options))
  if (typeof csg !== 'object') throw new Error('invalid jscad geometry, not an object')

  // Skip plain objects that only have transforms and no actual geometry data
  // These are empty transform wrappers that can't be rendered
  // IMPORTANT: Only skip plain objects (constructor === Object), not class instances
  // Class instances like ManifoldGeom3 have getters for vertices/indices/normals
  // that won't show up in Object.keys() but are valid geometry
  const ownKeys = Object.keys(csg)
  if (ownKeys.length === 1 && ownKeys[0] === 'transforms' && csg.constructor === Object) {
    return null
  }

  /** @type {import("@jscadui/format-common").JscadMainEntity} */
  let obj

  // Check 'vertices' FIRST - this is the fast path for objects that already have
  // the common format (e.g., ManifoldGeom3). This avoids triggering expensive
  // polygon conversion on objects that have both polygons and vertices getters.
  if ('vertices' in csg) {
    // Extract data into a plain object - class instances with getters can't be
    // serialized through postMessage, so we need to read the values here.
    const vertices = csg.vertices
    const indices = csg.indices
    const normals = csg.normals
    const type = csg.type

    // Use vertices array as cache key since the object itself may be a class instance
    obj = JscadToCommon.cache.get(vertices)
    if (!obj) {
      obj = { type, vertices, indices, normals }
      obj.id = JscadToCommon.sequence++
      JscadToCommon.cache.set(vertices, obj)
      if (transferable) {
        transferable.push(vertices)
        if (indices) transferable.push(indices)
        if (normals) transferable.push(normals)
      }
    }
    if (unique) unique.set(obj.id, obj)
  } else if ('polygons' in csg) {
    obj = CSGCached(CSG2Vertices, csg, csg.polygons, transferable, unique, options)
  } else if ('sides' in csg && !('points' in csg)) {
    obj = CSGCached(CSGSides2LineSegmentsVertices, csg, csg.sides, transferable, unique, options)
  } else if ('outlines' in csg) {
    obj = CSGCached(CSGOutlines2LineSegmentsVertices, csg.outlines, csg.outlines, transferable, unique, options)
  } else if ('contours' in csg) {
    obj = CSGCached(CSGOutlines2LineSegmentsVertices, csg.contours, csg.contours, transferable, unique, options)
  } else if ('points' in csg) {
    obj = CSGCached(CSG2LineVertices, csg, csg.points, transferable, unique, options)
  }

  if ('color' in csg || csg.transforms) obj = { ...obj }
  if(csg.color) obj.color = csg.color
  if(csg.transforms) obj.transforms = csg.transforms

  if (!obj || !obj.type) {
    // throw new Error('invalid jscad geometry')
    console.error('invalid jscad geometry', csg)
    obj = { ...obj, csg, type: 'unknown' }
  }
  return obj
}

/**
 * @param {(import("@jscadui/format-common").CSGItem | import("@jscadui/format-common").JscadMeshEntity)[]} csg 
 * @param {import("@jscadui/format-common").JscadTransferable[]} transferable 
 * @param {Map<number,import("@jscadui/format-common").JscadMainEntity> | false |  undefined} unique 
 * @param {unknown} [options]
 * @returns {import("@jscadui/format-common").JscadMainEntity[]}
 */
JscadToCommon.ConvertMulti = (csg, transferable, unique, options) => {
  return csg.map(csg2 => JscadToCommon(csg2, transferable, unique, options))
}


/** @type {WeakMap<Object,import("@jscadui/format-common").JscadMainEntity> } */
JscadToCommon.cache = new WeakMap()
JscadToCommon.sequence = 1

JscadToCommon.clearCache = () => {
  JscadToCommon.cache = new WeakMap()
  JscadToCommon.sequence = 1
}
