/**
 * Pipeline statistics display module
 * Handles formatting and display of timing and geometry stats
 */

/**
 * Format a number with K/M suffix for large values
 * @param {number} n
 * @returns {string}
 */
export function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

/**
 * Format milliseconds for display
 * @param {number} ms
 * @returns {string}
 */
export function formatMs(ms) {
  if (ms == null) return '—'
  if (ms >= 1000) return (ms / 1000).toFixed(2) + 's'
  return ms.toFixed(1) + 'ms'
}

/**
 * Count triangles and vertices from entities
 * @param {Array<{vertices?: ArrayLike<number>, indices?: ArrayLike<number>}>} entities
 * @returns {{triangles: number, vertices: number}}
 */
export function countGeometry(entities) {
  let triangles = 0
  let vertices = 0
  for (const e of entities) {
    if (e.indices) triangles += e.indices.length / 3
    if (e.vertices) vertices += e.vertices.length / 3
  }
  return { triangles, vertices }
}

/**
 * Update the pipeline stats display
 * @param {HTMLElement} statsContent - The container element for stats
 * @param {object} stats
 * @param {number} [stats.treeTime] - Operation tree building time (Manifold lazy ops)
 * @param {number} [stats.execTime] - Manifold evaluation time (forcing lazy ops)
 * @param {number} [stats.convTime] - Geometry conversion time (getMesh + format)
 * @param {number} [stats.renderTime] - Render time
 * @param {number} [stats.triangles] - Total triangle count
 * @param {number} [stats.vertices] - Total vertex count
 */
export function updatePipelineStats(statsContent, { treeTime, execTime, convTime, renderTime, triangles, vertices }) {
  // Clear existing content safely
  statsContent.textContent = ''

  // Helper to add a stat row using DOM APIs (defense in depth - no innerHTML)
  const addStatRow = (label, value) => {
    const row = document.createElement('div')
    row.className = 'stat-row'
    const labelSpan = document.createElement('span')
    labelSpan.className = 'stat-label'
    labelSpan.textContent = label
    const valueSpan = document.createElement('span')
    valueSpan.className = 'stat-value'
    valueSpan.textContent = value
    row.append(labelSpan, valueSpan)
    statsContent.appendChild(row)
  }

  const addSeparator = () => {
    const sep = document.createElement('div')
    sep.className = 'stat-separator'
    statsContent.appendChild(sep)
  }

  let hasTimingRows = false

  // Timing section - show tree time only if > 0.5ms (Manifold lazy eval)
  if (treeTime != null && treeTime > 0.5) {
    addStatRow('Tree', formatMs(treeTime))
    hasTimingRows = true
  }
  if (execTime != null) {
    addStatRow('Exec', formatMs(execTime))
    hasTimingRows = true
  }
  if (convTime != null) {
    addStatRow('Conv', formatMs(convTime))
    hasTimingRows = true
  }
  if (renderTime != null) {
    addStatRow('Render', formatMs(renderTime))
    hasTimingRows = true
  }

  // Separator and geometry section
  if ((triangles != null || vertices != null) && hasTimingRows) {
    addSeparator()
  }
  if (triangles != null) {
    addStatRow('Triangles', formatCount(triangles))
  }
  if (vertices != null) {
    addStatRow('Vertices', formatCount(vertices))
  }
}

/**
 * Create a progress handler
 * @param {HTMLProgressElement} progress - The progress element
 * @returns {(value?: number) => void}
 */
export function createProgressHandler(progress) {
  return (value) => {
    if (value == undefined) {
      progress.removeAttribute('value')
    } else {
      progress.value = value
    }
  }
}
