import { anthropicProvider } from './anthropic.js'
import { openaiProvider } from './openaiCompatible.js'

export type ProviderKind = 'anthropic' | 'openai'

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
}

export function createProvider(config: ProviderConfig): Provider {
  switch (config.kind) {
    case 'anthropic':
      return anthropicProvider(config)
    case 'openai':
      return openaiProvider(config)
    default:
      throw new Error(`createProvider: unknown kind '${config.kind}'`)
  }
}