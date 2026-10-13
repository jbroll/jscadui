import { lintTree } from '@jscadui/agent-loop'
import { syntaxTree } from '@codemirror/language'
import { linter } from '@codemirror/lint'

/**
 * The CodeMirror diagnostics of a document, from the API index.
 * @param {Array<object>} index api/index.json
 * @param {import('@codemirror/state').EditorState} state
 */
export const apiDiagnostics = (index, state) => lintTree(index, syntaxTree(state), { text: state.doc.toString() })

/**
 * The CodeMirror extensions the editor adds for API help.
 * @param {() => Promise<Array<object>>} loadIndex
 */
export const apiExtensions = (loadIndex) => [
  linter(async (view) => {
    let index
    try {
      index = await loadIndex()
    } catch {
      return []
    }
    return index ? apiDiagnostics(index, view.state) : []
  }),
]
