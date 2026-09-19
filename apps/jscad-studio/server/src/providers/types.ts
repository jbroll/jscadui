import { anthropicProvider } from './anthropic.js'
import { openaiProvider } from './openaiCompatible.js'

// Yields every `data:` payload of an SSE stream; `event:` names and blank separators are noise.
export async function* ssePayloads(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.startsWith('data:')) yield line.slice(5).trim()
    }
  }
  if (buffer.startsWith('data:')) yield buffer.slice(5).trim()
}

export type ProviderKind = 'anthropic' | 'openai' | 'opencode-go'

export const PROVIDER_BASE_URLS: Record<ProviderKind, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  'opencode-go': 'https://opencode.ai/zen/go',
}

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

// Shared conversation shape both adapters translate to their wire format. Tool results come back as
// a 'tool' message so the agent loop can append them without provider-specific code.
export type ProviderMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'done'; stopReason: string }

export interface Provider {
  send(messages: ProviderMessage[], tools: ToolDefinition[]): AsyncIterable<ProviderEvent>
}

export interface ProviderConfig {
  kind: ProviderKind
  apiKey: string
  model: string
  baseUrl?: string
  sessionId?: string
}

export function createProvider(config: ProviderConfig): Provider {
  if (!config.apiKey) throw new Error('createProvider: apiKey is required')
  switch (config.kind) {
    case 'anthropic':
      return anthropicProvider(config)
    case 'openai':
    case 'opencode-go':
      return openaiProvider(config)
    default:
      throw new Error(`createProvider: unknown kind '${config.kind}'`)
  }
}
