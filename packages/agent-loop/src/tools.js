import { checkApi, DEFAULT_API } from './api.js'
import { viewInputSchema } from './viewSpec.js'

const DOCS_DESCRIPTION = {
  fluent:
    "Look up a jscad-fluent function's signature, options and defaults, or list a class's methods. Query a name (roundedCuboid, jf.cuboid, FluentGeom2.extrudeLinear, jscadText.text2d) or a namespace or class (jf, FluentGeom3, FluentGeom2), or params for the parameter conventions.",
  modeling:
    "Look up a JSCAD function's signature, options and defaults, or list a namespace. Query a name (roundedCuboid, primitives.roundedCuboid, extrusions.extrudeLinear, jscadText.text2d) or a namespace (primitives, booleans, transforms), or params for the parameter conventions.",
}

const BUILDS =
  'builds the project and returns the build report: saved (the file written, kept even when the build fails), ok, entry, error with its file, line and column, warnings, console output, params and, when it builds, the geometry (parts, boundingBox, dimensions in mm, volume in mm³, watertight, manifold, selfIntersecting).'

// Vision-only: only a model that reads images may be offered `view`, so the
// gated catalog adds this entry; `dispatchTool` serves it regardless, so a
// call still answers rather than failing as an unknown tool.
const VIEW_TOOL = {
  name: 'view',
  description:
    "Render the current model and look at it: ask for one to four views (each a preset, a lookAt point or part name, or a position with an offset) and get back an image per view with the camera finally used. The render is off-screen for this call only, so the user's own view never moves. Images are resent in later rounds, so ask for the fewest views that answer the question.",
  inputSchema: viewInputSchema,
}

export const buildTools = (api = DEFAULT_API, { vision = false } = {}) => [
  {
    name: 'glob',
    description: 'List project file paths (with sizes); pattern like **/*.js filters, omitted means all. Every message already carries text files + last build, so glob only for sizes or non-text.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'A glob pattern filtering the paths, such as **/*.js' },
        path: { type: 'string', description: 'A project directory to list, such as src' },
      },
      additionalProperties: false,
    },
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
    name: 'grep',
    description: 'Search project text files for a regex or plain text; answers path:line hits, at most 60, binary files skipped; include defaults to all text files; literal=true disables regex.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex or text to find, such as cube|box' },
        include: { type: 'array', items: { type: 'string' }, description: 'Files to search; defaults to all text files' },
        literal: { type: 'boolean', description: 'Treat pattern as plain text instead of a regex' },
      },
      required: ['pattern'],
      additionalProperties: false,
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
    name: 'delete',
    description: `Delete a project file, removing it from the project; the deletion is saved, so a reload mid-turn keeps it deleted. The answer heads with deleted. Then ${BUILDS} Deleting a file that is not there answers ok and changes nothing.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The project file path, such as main.js' },
      },
      required: ['path'],
    },
  },
  {
    name: 'execute',
    description:
      "Run a scratch JavaScript snippet beside the project files, to try an idea or log values. It is never saved and changes neither the project nor its build. A project file's main(values) runs with the other parameters at their defaults. Returns its console output, a summary of what its main() returns (parts, size, volume, and whether it is watertight, manifold and self-intersecting) or of module.exports without a main, and an error with its file, line and column.",
    inputSchema: {
      type: 'object',
      properties: { source: { type: 'string', description: 'The snippet, CommonJS like a project file' } },
      required: ['source'],
      additionalProperties: false,
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
        overlaps: { type: 'boolean', description: 'List every pair of parts whose bounding boxes overlap, with per-axis gap and distance; pairs past 50 are counted but not listed' },
        anchors: { type: 'boolean', description: "Include each part's named anchor frames" },
        section: {
          type: 'string',
          description: 'An axis cross-section: "x", "y", "z", or an offset like "z=5". Gives its area, size and each loop\'s outline as points in the section plane, holes marked, so no slicing in execute is needed',
        },
      },
    },
  },
  {
    name: 'check',
    description:
      'Check the current model: watertight, manifold, inside out, self-intersecting, open and non-manifold edge counts, where a few open edges are, and size in mm, for each part of an array too; the build report already gives watertight, manifold and self-intersecting for the whole. With a bed, also whether it fits. Pass a bed only when the user names a printer.',
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
  // Only a vision-capable model is offered the image-rendering tool.
  ...(vision === true ? [VIEW_TOOL] : []),
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
    description: DOCS_DESCRIPTION[checkApi(api)],
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'A function, class or namespace name, or several names, separated by commas' } },
      required: ['query'],
    },
  },
  {
    name: 'skill',
    description: 'Load a skill procedure by id; the prompt lists each id with its description, call with an id to read the full body.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The skill id, such as writing-plans' },
        id: { type: 'string', description: 'Alias of name: the skill id, such as writing-plans' },
      },
      requiredAny: ['name', 'id'],
    },
  },
  {
    name: 'question',
    description: 'Ask the user a clarifying question mid-turn instead of guessing; use for ambiguous sizes, printers or intent. The answer comes back as the tool result.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to show the user' },
        options: { type: 'array', items: { type: 'string' }, description: 'Suggested answers, if any' },
        header: { type: 'string', description: 'A short label shown above the question' },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'websearch',
    description: 'Search the web for reference values (part numbers, material data, datasheets) the project does not carry; answers title, url and snippet hits tagged with the serving provider.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query, such as 608 bearing dimensions' },
        count: { type: 'integer', description: 'How many hits to return; defaults to 8' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'webfetch',
    description: 'Fetch a URL already in the conversation through the relay and answer its capped text (markdown by default), with title, finalUrl and whether it was truncated. Use URLs the user or a tool already gave you; never construct URLs yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The http(s) URL to fetch, already given to you' },
        format: { type: 'string', enum: ['markdown', 'text'], description: 'The answer format; markdown by default' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
]

export const TOOLS = buildTools()

// Calls safe to run concurrently: they read state without saving.
// write/edit/delete/export save or expose download state and stay serial.
export const READ_ONLY = new Set(['glob', 'read', 'grep', 'measure', 'check', 'docs', 'skill', 'execute', 'view', 'question', 'websearch', 'webfetch'])
