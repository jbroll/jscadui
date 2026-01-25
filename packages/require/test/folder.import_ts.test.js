import { expect, it } from 'vitest'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import { require } from '../src/require.js'
import { makeReadFileNode } from '../src/readFileNode.js'

import { transformcjs } from '@jscadui/transform-babel'

const __dirname = dirname(fileURLToPath(import.meta.url))
const base = 'fs:/'
const readFileNode = makeReadFileNode(join(__dirname, 'folder/import_ts') + '/')

it('no_transform', () => {
  let script = require('./index.js', transformcjs, readFileNode, base)
  expect(script.main({size:11})).toEqual('cube11')
})
