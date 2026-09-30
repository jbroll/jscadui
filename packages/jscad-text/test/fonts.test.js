import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import jscad from '@jscad/modeling'
import { init, text2d, resolveFont, fontList, STATIC_FONT_MAP } from '../src/index.js'
import { registerInstalledFonts } from '../src/fonts/fontCache.js'
import { LIBERATION_SANS_URL } from '../src/fonts/FontMap.js'

const NPM_CDN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^/@]+)@(\d+\.\d+\.\d+)\//
const devDependencies = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).devDependencies
const urls = [...new Set([LIBERATION_SANS_URL, ...Object.values(STATIC_FONT_MAP)])].filter((v) => v.startsWith('https:'))

let installed
beforeAll(() => {
  init(jscad)
  installed = registerInstalledFonts()
})

describe('the static font map', () => {
  it.each(urls)('pins %s to an npm package version this package installs', (url) => {
    const [, name, version] = NPM_CDN.exec(url) ?? []
    expect(name).toBeDefined()
    expect(devDependencies[name]).toBe(version)
  })

  it('finds every font file in the installed packages', () => {
    expect(installed.missing).toEqual([])
    expect(installed.registered.sort()).toEqual([...urls].sort())
  })

  it.each(Object.keys(STATIC_FONT_MAP))('renders %s synchronously from a local file', (name) => {
    const source = resolveFont(name)
    expect(source.startsWith('/')).toBe(true)
    expect(existsSync(source)).toBe(true)
    expect(jscad.geometries.geom2.toSides(text2d('Ag', { font: name })).length).toBeGreaterThan(0)
  })

  it('serves a font URL from the installed package too', () => {
    const url = STATIC_FONT_MAP['Liberation Sans:style=Bold']
    expect(resolveFont(url)).toMatch(/node_modules\/@typopro\/dtp-liberation\/TypoPRO-LiberationSans-Bold\.ttf$/)
    expect(jscad.geometries.geom2.toSides(text2d('A', { font: url })).length).toBeGreaterThan(0)
  })
})

describe('fontList', () => {
  it('names each family once, with its styles', () => {
    expect(fontList(['Lato', 'Lato:style=Bold', 'Lato:style=Italic', 'Oswald'])).toBe('Lato (Bold, Italic), Oswald')
  })

  it('lists a style whose family has no plain entry', () => {
    expect(fontList(['Foo:style=Bold'])).toBe('Foo (Bold)')
  })
})

describe('an unknown font name', () => {
  it('throws naming the available fonts and how to write a style', () => {
    expect(() => resolveFont('Comic Sans MS')).toThrow(/Font "Comic Sans MS" not found/)
    expect(() => resolveFont('Comic Sans MS')).toThrow(/Liberation Sans \(Bold, Italic, Bold Italic\)/)
    expect(() => resolveFont('Comic Sans MS')).toThrow(/"Liberation Sans:style=Bold"/)
    expect(() => resolveFont('Comic Sans MS')).toThrow(/Roboto \(Bold, Italic\)/)
  })
})
