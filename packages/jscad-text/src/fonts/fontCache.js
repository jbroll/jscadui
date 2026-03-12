/**
 * fontCache.js — Node.js font cache utility.
 *
 * Downloads Liberation fonts from CDN to ~/.cache/jscadui/fonts/ on first use,
 * then registers the local paths with FontMap so TTFLoader can load them synchronously.
 *
 * Usage (e.g. in run-jscad.js or a vitest globalSetup):
 *
 *   import { ensureLiberationFonts } from '@jscadui/jscad-text/fontCache'
 *   await ensureLiberationFonts()
 *   // Now resolveFont('Liberation Serif') returns a local file path
 *
 * This module is Node.js-only. Do not import it in browser code.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { STATIC_FONT_MAP, registerNodeFont } from './FontMap.js'

/** Default cache directory: ~/.cache/jscadui/fonts/ */
export const DEFAULT_CACHE_DIR = join(homedir(), '.cache', 'jscadui', 'fonts')

/**
 * Ensure all Liberation font variants are available locally.
 *
 * - Checks ~/.cache/jscadui/fonts/ for each Liberation font
 * - Downloads any missing fonts from the CDN (one-time, first run only)
 * - Registers all local paths with FontMap via registerNodeFont()
 *
 * Safe to call on every startup — no-ops if fonts are already cached.
 *
 * @param {string} [cacheDir] - override cache directory
 * @returns {Promise<{downloaded: string[], cached: string[]}>}
 */
export async function ensureLiberationFonts(cacheDir = DEFAULT_CACHE_DIR) {
  mkdirSync(cacheDir, { recursive: true })

  const downloaded = []
  const cached = []

  for (const [, url] of Object.entries(STATIC_FONT_MAP)) {
    if (typeof url !== 'string' || !url.startsWith('https://cdn.jsdelivr.net/npm/@typopro/')) continue

    const filename = url.split('/').pop()
    const localPath = join(cacheDir, filename)

    if (existsSync(localPath)) {
      cached.push(filename)
    } else {
      process.stderr.write(`[jscad-text] Downloading font: ${filename}\n`)
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`)
      const bytes = await response.arrayBuffer()
      await writeFile(localPath, Buffer.from(bytes))
      downloaded.push(filename)
    }

    registerNodeFont(url, localPath)
  }

  return { downloaded, cached }
}

/**
 * Register any Liberation fonts that are already in the cache, without downloading.
 * Fast synchronous check — use this on startup if you don't want auto-download.
 *
 * @param {string} [cacheDir] - override cache directory
 * @returns {string[]} list of registered font filenames
 */
export function registerCachedFonts(cacheDir = DEFAULT_CACHE_DIR) {
  const registered = []

  for (const [, url] of Object.entries(STATIC_FONT_MAP)) {
    if (typeof url !== 'string' || !url.startsWith('https://cdn.jsdelivr.net/npm/@typopro/')) continue

    const filename = url.split('/').pop()
    const localPath = join(cacheDir, filename)

    if (existsSync(localPath)) {
      registerNodeFont(url, localPath)
      registered.push(filename)
    }
  }

  return registered
}
