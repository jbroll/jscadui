import { docsTool, hoverTarget, lintTree, lookupName } from '@jscadui/agent-loop'
import { javascriptLanguage } from '@codemirror/lang-javascript'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { linter } from '@codemirror/lint'
import { hoverTooltip, EditorView } from '@codemirror/view'

const PARSE_BUDGET_MS = 250

/**
 * The CodeMirror diagnostics of a document, from the API index.
 * @param {Array<object>} index api/index.json
 * @param {import('@codemirror/state').EditorState} state
 */
export const apiDiagnostics = (index, state) => {
  // A partial parse marks the unparsed rest as an error, so lint only a whole tree.
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS)
  return tree ? lintTree(index, tree, { text: state.doc.toString() }) : []
}

const previousNonSpace = (state, pos) => {
  const text = state.doc.sliceString(0, pos)
  let i = text.length
  while (i > 0 && /\s/.test(text[i - 1])) i -= 1
  return i > 0 ? text[i - 1] : ''
}

const calleeName = (callee, state) => {
  if (!callee) return null
  if (callee.type.name === 'VariableName') return state.sliceDoc(callee.from, callee.to)
  if (callee.type.name === 'MemberExpression') {
    const object = callee.firstChild
    const property = callee.lastChild
    if (object?.type.name === 'VariableName' && property?.type.name === 'PropertyName') return `${state.sliceDoc(object.from, object.to)}.${state.sliceDoc(property.from, property.to)}`
  }
  return null
}

// The options of an entry, following sameAs (a jf factory borrows its modeling function's).
const optionsFor = (index, entry) => {
  const source = entry.sameAs ? lookupName(index, entry.sameAs) : entry
  return source?.options ?? entry.options ?? []
}

// The entry whose options the object literal at `pos` is the first argument of.
const optionEntry = (index, state, pos) => {
  let node = syntaxTree(state).resolveInner(pos, -1)
  while (node && node.name !== 'ObjectExpression') node = node.parent
  if (!node) return null
  const argList = node.parent
  if (argList?.name !== 'ArgList') return null
  const call = argList.parent
  if (call?.name !== 'CallExpression') return null
  for (let child = argList.firstChild; child; child = child.nextSibling) {
    if (child.name === '(' || child.name === ',') continue
    if (child.from !== node.from || child.to !== node.to) return null
    break
  }
  return lookupName(index, calleeName(call.firstChild, state))
}

/**
 * The completions at the cursor: API names, or an option key inside an API call.
 * @param {Array<object>} index api/index.json
 * @param {import('@codemirror/autocomplete').CompletionContext} context
 */
export const completeApi = (index, context) => {
  const word = context.matchBefore(/[A-Za-z_$][\w$]*/)
  const before = previousNonSpace(context.state, context.pos)
  if (before === '{' || before === ',') {
    const entry = optionEntry(index, context.state, context.pos)
    if (entry) {
      const from = word ? word.from : context.pos
      const prefix = context.state.sliceDoc(from, context.pos)
      const options = optionsFor(index, entry)
        .filter((option) => option.name.startsWith(prefix))
        .map((option) => ({
          label: option.name,
          type: 'property',
          detail: `${option.type ?? ''}${option.default != null ? ` = ${option.default}` : ''}`,
          info: option.description,
        }))
      if (options.length) return { from, options, validFor: /^[\w$]*$/ }
    }
  }
  if (!word && !context.explicit) return null
  const from = word ? word.from : context.pos
  const prefix = context.state.sliceDoc(from, context.pos)
  const names = new Map()
  for (const entry of index) {
    if (entry.kind === 'function') {
      if (entry.name.startsWith('jf.')) names.set(entry.name, entry)
      else if (!entry.name.slice(0, entry.name.lastIndexOf('.')).includes('.')) names.set(entry.name.slice(entry.name.lastIndexOf('.') + 1), entry)
    } else if (entry.kind === 'namespace' && !entry.name.includes('.')) {
      names.set(entry.name, entry)
    }
  }
  const options = [...names.entries()]
    .filter(([label]) => label.startsWith(prefix))
    .map(([label, entry]) => ({ label, type: entry.kind === 'namespace' ? 'namespace' : 'function', detail: entry.signature, info: () => docsTool(index, entry.name) }))
  return options.length ? { from, options, validFor: /^[\w$]*$/ } : null
}

/**
 * The hover tooltip over the API names and option keys.
 * @param {() => Promise<Array<object>>} loadIndex
 */
export const apiHover = (loadIndex) => async (view, pos) => {
  let index
  try {
    index = await loadIndex()
  } catch {
    return null
  }
  const target = index ? hoverTarget(index, syntaxTree(view.state), pos, view.state.doc.toString()) : null
  if (!target) return null
  return {
    pos: target.from,
    end: target.to,
    create: () => {
      const dom = document.createElement('pre')
      dom.className = 'cm-jscad-doc'
      dom.textContent = target.text
      return { dom }
    },
  }
}

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
  javascriptLanguage.data.of({
    autocomplete: async (context) => {
      let index
      try {
        index = await loadIndex()
      } catch {
        return null
      }
      return index ? completeApi(index, context) : null
    },
  }),
  hoverTooltip(apiHover(loadIndex)),
  EditorView.baseTheme({
    '.cm-jscad-doc': { margin: '0', maxWidth: '42em', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.4' },
  }),
]
