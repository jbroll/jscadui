/**
 * fontCache.js — Node.js local copies of the static font map's CDN fonts.
 *
 * Node cannot load a URL synchronously, so text2d there needs each CDN URL
 * registered against a local file (registerNodeFont). Two sources:
 *
 *   registerInstalledFonts()   every static map font, from the npm packages the
 *                              CDN URLs name (no network; needs them installed)
 *   ensureLiberationFonts()    the Liberation fonts, downloaded once to
 *                              ~/.cache/jscadui/fonts/ (run-jscad.js, ci/test)
 *
 * This module is Node.js-only. Do not import it in browser code.
 */

import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { LIBERATION_SANS_URL, STATIC_FONT_MAP, registerNodeFont } from './FontMap.js'

/** Default cache directory: ~/.cache/jscadui/fonts/ */
export const DEFAULT_CACHE_DIR = join(homedir(), '.cache', 'jscadui', 'fonts')

const LIBERATION_PREFIX = 'https://cdn.jsdelivr.net/npm/@typopro/dtp-liberation@'
const NPM_CDN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^/@]+)@([^/]+)\/(.+)$/

const liberationUrls = () =>
  [...new Set(Object.values(STATIC_FONT_MAP))].filter((url) => typeof url === 'string' && url.startsWith(LIBERATION_PREFIX))

/**
 * Register the installed copy of every jsDelivr npm URL in the static font
 * map, so text2d loads each font synchronously from node_modules. A package
 * counts only at the exact version its URL names.
 *
 * @param {string} [from] - module URL whose node_modules resolution finds the packages
 * @returns {{registered: string[], missing: string[]}} the URLs served locally and those not
 */
export function registerInstalledFonts(from = import.meta.url) {
  const require = createRequire(from)
  const registered = []
  const missing = []
  for (const url of new Set([LIBERATION_SANS_URL, ...Object.values(STATIC_FONT_MAP)])) {
    const match = typeof url === 'string' && NPM_CDN.exec(url)
    if (!match) continue
    const [, name, version, file] = match
    let path = null
    try {
      const manifest = require.resolve(`${name}/package.json`)
      if (JSON.parse(readFileSync(manifest, 'utf8')).version === version) path = join(dirname(manifest), file)
    } catch {
      // not installed
    }
    if (path && existsSync(path)) {
      registerNodeFont(url, path)
      registered.push(url)
    } else {
      missing.push(url)
    }
  }
  return { registered, missing }
}

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

  for (const url of liberationUrls()) {
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

  for (const url of liberationUrls()) {
    const filename = url.split('/').pop()
    const localPath = join(cacheDir, filename)

    if (existsSync(localPath)) {
      registerNodeFont(url, localPath)
      registered.push(filename)
    }
  }

  return registered
}
