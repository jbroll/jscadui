import type { ToolDefinition } from '../providers/types.js'

// The modeling API the chat teaches; mirrors packages/agent-loop/src/api.js.
export const APIS = ['fluent', 'modeling'] as const
export type Api = (typeof APIS)[number]
export const DEFAULT_API: Api = 'fluent'
export const isApi = (value: unknown): value is Api => APIS.includes(value as Api)

// Kept equal to packages/agent-loop/src/tools.js by test/tools.test.ts.
const DOCS_DESCRIPTION: Record<Api, string> = {
  fluent:
    "Look up a jscad-fluent function's signature, options and defaults, or list a class's methods. Query a name (roundedCuboid, jf.cuboid, FluentGeom2.extrudeLinear, jscadText.text2d) or a namespace or class (jf, FluentGeom3, FluentGeom2), or params for the parameter conventions.",
  modeling:
    "Look up a JSCAD function's signature, options and defaults, or list a namespace. Query a name (roundedCuboid, primitives.roundedCuboid, extrusions.extrudeLinear, jscadText.text2d) or a namespace (primitives, booleans, transforms), or params for the parameter conventions.",
}

const BUILDS =
  'builds the project and returns the build report: saved (the file written, kept even when the build fails), ok, entry, error with its file, line and column, warnings, console output, params and, when it builds, the geometry (parts, boundingBox, dimensions in mm, volume in mm³, watertight, manifold, selfIntersecting).'

// The tools the agent may ask the browser to run. Every one executes in the user's browser: list,
// read, write and edit against the project files, the builds after write and edit and the run
// snippets through the compute frame, measure, check and export on the current build, and docs
// from the page's API index. `view` is not offered here; see docs/architecture.md's tool table.
// The server only relays inputs and results.
export const buildTools = (api: Api = DEFAULT_API): ToolDefinition[] => [
  {
    name: 'list',
    description: 'List the project files with their sizes in bytes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read',
    description: 'Read a project file, its lines numbered.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The project file path, such as main.js' },
        offset: { type: 'integer', description: 'The first line to show, from 1' },
        limit: { type: 'integer', description: 'How many lines to show' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write',
    description: `Write a whole project file, creating or replacing it; the write is saved. Then ${BUILDS}`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The project file path, such as main.js' },
        content: { type: 'string', description: 'The full file text' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit',
    description: `Replace oldString with newString in a project file; the edit is saved. oldString must match the file exactly, whitespace included, exactly once, unless replaceAll is true. Then ${BUILDS}`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The project file path, such as main.js' },
        oldString: { type: 'string', description: 'The text to replace, copied exactly from the file' },
        newString: { type: 'string', description: 'The text to put in its place' },
        replaceAll: { type: 'boolean', description: 'Replace every occurrence of oldString' },
      },
      required: ['path', 'oldString', 'newString'],
    },
  },
  {
    name: 'run',
    description:
      "Run a scratch JavaScript snippet beside the project files, to try an idea or log values. It is never saved and changes neither the project nor its build. A project file's main(values) runs with the other parameters at their defaults. Returns its console output, a summary of what its main() returns (or of module.exports without a main), and an error with its file, line and column.",
    inputSchema: {
      type: 'object',
      properties: { source: { type: 'string', description: 'The snippet, CommonJS like a project file' } },
      required: ['source'],
    },
  },
  {
    name: 'measure',
    description: 'Measure the current model geometry. Sizes, positions and gaps are in mm, volume in mm³, area in mm².',
    inputSchema: {
      type: 'object',
      properties: {
        parts: {
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description:
            'Index selectors into the array main() returns: "0", "1-3", "all", or an array of them (a JSON array string works too)',
        },
        between: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exactly two index selectors ("0" or "1-3") to measure the gap between; "all" works only in parts',
        },
        anchors: { type: 'boolean', description: "Include each part's named anchor frames" },
        section: {
          type: 'string',
          description: 'An axis cross-section: "x", "y", "z", or an offset like "z=5"',
        },
      },
    },
  },
  {
    name: 'check',
    description:
      'Check the current model: watertight, manifold, inside out, self-intersecting, open and non-manifold edge counts and size in mm, for each part of an array too; the build report already gives watertight, manifold and self-intersecting for the whole. With a bed, also whether it fits. Pass a bed only when the user names a printer.',
    inputSchema: {
      type: 'object',
      properties: {
        bed: {
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }, { type: 'object' }],
          description:
            'Printer bed: a name (mk3, mk4, mini, x1, p1, a1mini, ender3) or its size in mm as [x, y, z], {x, y, z}, or a JSON array string',
        },
      },
    },
  },
  {
    name: 'export',
    description: 'Export the current model in the given format; the result gives its size, not the file. The user downloads it from the app.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['stl', '3mf', 'obj', 'svg'], description: 'The export format' },
      },
      required: ['format'],
    },
  },
  {
    name: 'docs',
    description: DOCS_DESCRIPTION[api],
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'A function, class or namespace name, or several names, separated by commas' } },
      required: ['query'],
    },
  },
]

export const TOOLS = buildTools()