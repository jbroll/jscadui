import jscad from '@jscad/modeling'
import type { Geom3 } from '@jscad/modeling/src/geometries/types'
import type * as _renderingDefaults from '@jscad/regl-renderer/types/rendering/renderDefaults'
import { light } from '@jscadui/themes'
import { useState } from 'react'

import { downloadGeometry } from './helpers'
import { Renderer } from './hooks/render'

const { intersect, subtract, union } = jscad.booleans
const { scale, translate } = jscad.transforms
const { cube, sphere } = jscad.primitives

const shape = union(
  subtract(cube({ size: 3 }), sphere({ radius: 2 })),
  intersect(sphere({ radius: 1.3 }), cube({ size: 2.1 })),
)
const shape2 = translate([0, 0, 1.5], shape)
const shape3 = scale([3, 3, 3], shape2)

function App() {
  const [solids] = useState<Geom3[]>([shape3])
  return (
    <div className="App">
      <h1>jscad ui</h1>
      <button onClick={() => downloadGeometry(shape3)}>Download</button>
      <Renderer
        solids={solids}
        height={500}
        width={800}
        options={{
          renderingOptions: {
            background: light.bg,
            meshColor: light.color,
          },
          gridOptions: {
            // color: light.grid1,
            // subColor: light.grid2,
          },
        }}
      />
    </div>
  )
}

export default App
