// Tool definitions the browser loop hands to the provider. Schemas match the
// studio server so prompts behave the same against either loop.
export const TOOLS = [
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
            'Bed name (mk3, mk4, mini, x1, p1, a1mini, ender3) or [x, y, z] in mm',
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
]