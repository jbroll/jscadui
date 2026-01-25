import { expect, it } from 'vitest'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import { require } from '../src/require.js'
import { makeReadFileNode } from '../src/readFileNode.js'

import { transformcjs } from '@jscadui/transform-babel'

const __dirname = dirname(fileURLToPath(import.meta.url))
const base = 'fs:/'
const readFileNode = makeReadFileNode(join(__dirname, 'solo') + '/')

it('no_transform', () => {
  let script = require('./simple.js', null, readFileNode, base)
  expect(script.main({size:11})).toEqual('cube11')
})

it('transform esm', () => {
  let script = require('./simple.esm.js', transformcjs, readFileNode, base)
  expect(script.main({size:22})).toEqual('cube22')
})

it('transform typescript', () => {
  let script = require('./simple.ts', transformcjs, readFileNode, base)
  expect(script.main({size:33})).toEqual('cube33')
})
