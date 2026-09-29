import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module without types
import { buildTools as loopTools } from '../../../../packages/agent-loop/src/tools.js'
import type { Provider, ProviderMessage, ToolDefinition } from '../src/providers/types.js'
import { runTurn } from '../src/agent/loop.js'
import { mountAgentRoutes } from '../src/agent/routes.js'
import { buildTools, TOOLS } from '../src/agent/tools.js'

const docs = (tools: ToolDefinition[]) => tools.find((t) => t.name === 'docs')?.description ?? ''

const recordingProvider = () => {
  const seen: ToolDefinition[][] = []
  const provider: Provider = {
    async *send(_messages: ProviderMessage[], tools: ToolDefinition[]) {
      seen.push(tools)
      yield { type: 'done', stopReason: 'end_turn' }
    },
  }
  return { provider, seen }
}

describe('server tools', () => {
  it('match the browser loop tools for each api', () => {
    expect(buildTools('fluent')).toEqual(loopTools('fluent'))
    expect(buildTools('modeling')).toEqual(loopTools('modeling'))
    expect(TOOLS).toEqual(buildTools('fluent'))
  })

  it('name only the chosen api in the docs description', () => {
    expect(docs(buildTools('fluent'))).toMatch(/jf\.cuboid/)
    expect(docs(buildTools('fluent'))).not.toMatch(/primitives|booleans|@jscad\/modeling/)
    expect(docs(buildTools('modeling'))).toMatch(/primitives\.roundedCuboid/)
    expect(docs(buildTools('modeling'))).not.toMatch(/fluent|\bjf\b/i)
  })

  it('runTurn sends the tools of its api, fluent by default', async () => {
    const { provider, seen } = recordingProvider()
    const conversation = { messages: [{ role: 'user' as const, content: 'hi' }] }
    await runTurn({ conversation, provider, requestTool: async () => '' })
    await runTurn({ conversation, provider, requestTool: async () => '', api: 'modeling' })
    expect(seen).toEqual([buildTools('fluent'), buildTools('modeling')])
  })

  it('the chat route takes api from the request body and refuses an unknown one', async () => {
    const { provider, seen } = recordingProvider()
    const app = express()
    app.use(express.json())
    mountAgentRoutes(app, { createProvider: () => provider })
    const body = { message: 'hi', provider: { kind: 'anthropic', model: 'm', apiKey: 'k' } }
    await request(app).post('/api/chat/p1').send({ ...body, api: 'modeling' })
    await request(app).post('/api/chat/p2').send(body)
    expect(seen).toEqual([buildTools('modeling'), buildTools('fluent')])
    const bad = await request(app).post('/api/chat/p3').send({ ...body, api: 'scad' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/api/)
  })
})
