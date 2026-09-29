import type { ToolDefinition } from '../providers/types.js'

// The modeling API the chat teaches; mirrors packages/agent-loop/src/api.js.
export const APIS = ['fluent', 'modeling'] as const
export type Api = (typeof APIS)[number]
export const DEFAULT_API: Api = 'fluent'
export const isApi = (value: unknown): value is Api => APIS.includes(value as Api)

// Kept equal to packages/agent-loop/src/tools.js by test/tools.test.ts.
const DOCS_DESCRIPTION: Record<Api, string> = {
  fluent:
    "Look up a jscad-fluent function's signature, options and defaults, or list a class's methods. Query a name (roundedCuboid, jf.cuboid, FluentGeom2.extrudeLinear, jscadText.text2d) or a namespace or class (jf, FluentGeom3, FluentGeom2).",
  modeling:
    "Look up a JSCAD function's signature, options and defaults, or list a namespace. Query a name (roundedCuboid, primitives.roundedCuboid, extrusions.extrudeLinear, jscadText.text2d) or a namespace (primitives, booleans, transforms).",
}

// The tools the agent may ask the browser to run. Every one executes in the user's browser: eval,
// params, measure, check and export through the compute frame, writeModel against the project
// storage, and docs from the page's API index. `view` is not offered here; see
// docs/architecture.md's tool table. The server only relays inputs and results.
export const buildTools = (api: Api = DEFAULT_API): ToolDefinition[] => [
  {
    name: 'eval',
    description: 'Evaluate a new model source and return the resulting parameter definitions and geometry.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'The model source code to evaluate' },
        entry: { type: 'string', description: 'The entry file name (defaults to the current entry)' },
      },
      required: ['source'],
    },
  },
  {
    name: 'params',
    description: 'Return the current model parameter definitions and their values.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'measure',
    description: 'Measure the current model geometry.',
    inputSchema: {
      type: 'object',
      properties: {
        parts: { type: 'string', description: 'The part or parts to measure' },
        between: { type: 'array', items: { type: 'string' }, description: 'Measure between named parts' },
        anchors: { type: 'array', items: { type: 'string' }, description: 'Anchor points to include' },
        section: { type: 'string', description: 'Section to measure' },
      },
    },
  },
  {
    name: 'check',
    description: 'Check the current model against a print bed.',
    inputSchema: {
      type: 'object',
      properties: {
        bed: {
          description:
            'Printer bed: a name (mk3, mk4, mini, x1, p1, a1mini, ender3) or its size in mm as [x, y, z], {x, y, z}, or a JSON array string',
        },
        options: { type: 'object', description: 'Check options' },
      },
      required: ['bed'],
    },
  },
  {
    name: 'export',
    description: 'Export the current model in the given format.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['stl', '3mf', 'obj', 'svg'], description: 'The export format' },
      },
      required: ['format'],
    },
  },
  {
    name: 'writeModel',
    description: 'Replace the model source and create a new version.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'The full model source code' },
        entry: { type: 'string', description: 'The entry file name' },
        message: { type: 'string', description: 'A version message describing the change' },
      },
      required: ['source'],
    },
  },
  {
    name: 'docs',
    description: DOCS_DESCRIPTION[api],
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'A function, class or namespace name' } },
      required: ['query'],
    },
  },
]

export const TOOLS = buildTools()