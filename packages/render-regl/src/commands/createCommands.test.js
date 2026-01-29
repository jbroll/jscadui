import { describe, expect, it } from 'vitest'

import { createDrawCommands } from './createCommands.js'
import drawMesh from './drawMesh.js'
import drawLines from './drawLines.js'
import drawMeshInstanced from './drawMeshInstanced.js'

describe('createDrawCommands', () => {
  it('should return an object with draw command factories', () => {
    const commands = createDrawCommands()

    expect(typeof commands).toBe('object')
    expect(commands).not.toBeNull()
  })

  it('should include drawMesh command', () => {
    const commands = createDrawCommands()

    expect(commands.drawMesh).toBeDefined()
    expect(commands.drawMesh).toBe(drawMesh)
  })

  it('should include drawLines command', () => {
    const commands = createDrawCommands()

    expect(commands.drawLines).toBeDefined()
    expect(commands.drawLines).toBe(drawLines)
  })

  it('should include drawMeshInstanced command', () => {
    const commands = createDrawCommands()

    expect(commands.drawMeshInstanced).toBeDefined()
    expect(commands.drawMeshInstanced).toBe(drawMeshInstanced)
  })

  it('should include drawGrid command (using drawLines)', () => {
    const commands = createDrawCommands()

    expect(commands.drawGrid).toBeDefined()
    expect(commands.drawGrid).toBe(drawLines)
  })

  it('should include drawAxis command (using drawLines)', () => {
    const commands = createDrawCommands()

    expect(commands.drawAxis).toBeDefined()
    expect(commands.drawAxis).toBe(drawLines)
  })

  it('should have all expected commands', () => {
    const commands = createDrawCommands()
    const expectedCommands = ['drawMesh', 'drawLines', 'drawMeshInstanced', 'drawGrid', 'drawAxis']

    expectedCommands.forEach(cmd => {
      expect(commands[cmd]).toBeDefined()
    })
  })
})
