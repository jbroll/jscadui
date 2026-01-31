
/** @typedef {import('@jscadui/worker').JscadWorker} JscadWorker*/


export class AnimRunner {
  /**
   *
   * @param {JscadWorker} worker
   */
  constructor(worker, options = {}) {
    /** @type {JscadWorker} */
    this.worker = worker
    this.options = options
    /** @type {number | null} */
    this.currentTimeout = null
    /** @type {number} C1 fix: Generation counter to detect stale results */
    this.generation = 0
  }

  pause() {
    this.shouldPause = true
    this.running = false // C5 fix: also set running to false
    // C1 fix: increment generation to invalidate in-flight worker responses
    this.generation++
    // C6 fix: clear any pending timeout
    if (this.currentTimeout !== null) {
      clearTimeout(this.currentTimeout)
      this.currentTimeout = null
    }
  }

  isRunning() {
    return this.running
  }

  async start(def, value, params) {
    this.running = true
    this.shouldPause = false
    // C1 fix: Capture current generation at start
    const startGeneration = this.generation

    const { fps: _fps, min = 0, max, loop, name } = def
    let fps = _fps
    if (params.fps) fps = params.fps
    // H6 fix: validate fps to prevent division by zero
    if (!fps || fps <= 0 || !Number.isFinite(fps)) {
      console.error('Animation fps must be a positive finite number, got:', fps)
      this.running = false
      return
    }
    const step = 1 / fps
    const minMaxDelta = max - min
    const fpsMs = 1000 / fps - 1
    // M7 fix: handle NaN from parseFloat
    value = parseFloat(value)
    if (!Number.isFinite(value)) value = min
    value += step

    let lastTime, now, delta, resp, paramValues, times
    lastTime = now = Date.now()
    let t = value
    let dir = loop == 'reverse' ? 1 : 0

    try {
      while (!this.shouldPause) {
        if (t > max) {
          while (t > max) t -= minMaxDelta

          if (loop == 'reverse') {
            dir *= -1
          } else if (loop != 'restart') {
            // end animation
            break
          }
        }

        times = { [name]: (dir == 1) ? t : max - t }
        paramValues = { ...params, ...times }
        resp = await this.worker.jscadMain({ params: paramValues, skipLog: true })
        // C1 fix: Check if animation was stopped while worker was running
        if (this.generation !== startGeneration) {
          console.log(`Animation stopped (generation ${startGeneration} -> ${this.generation}), discarding result`)
          break
        }
        if (this.shouldPause) break

        now = Date.now()
        delta = now - lastTime
        if (delta < fpsMs) {
          await this.waitTime(fpsMs - delta - 1)
          if (this.shouldPause) {
            console.log('Animation stopped between generating frame for ' + name + '=' + times[name] + ' and rendering it. Discarding the result.')
            break
          }
        }
        lastTime = Date.now()
        t += step
        this.options?.handleEntities?.(resp, paramValues, times)
      }
    } catch (err) {
      console.error('Animation error:', err)
    }
    this.running = false
    this.options?.handleEnd?.()
  }

  /**
   * Wait for a specified time (C6 fix: track timeout for cancellation)
   * @param {number} ms
   * @returns {Promise<void>}
   */
  waitTime(ms) {
    return new Promise(resolve => {
      this.currentTimeout = setTimeout(() => {
        this.currentTimeout = null
        resolve()
      }, ms)
    })
  }
}