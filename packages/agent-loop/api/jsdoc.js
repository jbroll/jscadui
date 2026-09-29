const balanced = (text, open, close) => {
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === open) depth += 1
    else if (text[i] === close && --depth === 0) return i
  }
  return -1
}

const squash = (text) => text.replace(/\s+/g, ' ').trim()

export const parseParam = (body) => {
  let rest = body.trim()
  let type = ''
  if (rest.startsWith('{')) {
    const end = balanced(rest, '{', '}')
    type = rest.slice(1, end).trim()
    rest = rest.slice(end + 1).trimStart()
  }
  let name
  let value = null
  if (rest.startsWith('[')) {
    const end = balanced(rest, '[', ']')
    const inner = rest.slice(1, end)
    rest = rest.slice(end + 1)
    const eq = inner.indexOf('=')
    name = (eq === -1 ? inner : inner.slice(0, eq)).trim()
    if (eq !== -1) value = inner.slice(eq + 1).trim()
  } else {
    name = /^\S*/.exec(rest)[0]
    rest = rest.slice(name.length)
  }
  return { type, name, default: value, description: squash(rest.replace(/^\s*-\s*/, '')) }
}

export const parseBlock = (raw) => {
  const lines = raw.split('\n').map((line) => line.replace(/^\s*\*? ?/, ''))
  const description = []
  const tags = []
  for (const line of lines) {
    const tag = /^@(\w+)\s?(.*)$/.exec(line)
    if (tag) tags.push({ tag: tag[1], lines: [tag[2]] })
    else if (tags.length) tags[tags.length - 1].lines.push(line)
    else description.push(line)
  }
  const example = tags.find((t) => t.tag === 'example')
  const returns = tags.find((t) => t.tag === 'returns' || t.tag === 'return')
  return {
    description: squash(description.join(' ')),
    params: tags.filter((t) => t.tag === 'param').map((t) => parseParam(t.lines.join(' '))),
    returns: returns ? parseParam(returns.lines.join(' ')).type : '',
    example: example ? example.lines.join('\n').trim() || null : null,
  }
}

export const declarationOf = (source, name) => {
  const decl = new RegExp(`^[ \\t]*(?:export\\s+)?(?:async\\s+)?(const|let|var|function|class)\\s+${name}\\b(.*)$`, 'm').exec(source)
  if (!decl) return null
  const callable = decl[1] === 'function' || /=\s*(?:async\s*)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/.test(decl[2])
  let doc = null
  for (const block of source.matchAll(/\/\*\*([\s\S]*?)\*\//g)) {
    const end = block.index + block[0].length
    if (end <= decl.index && source.slice(end, decl.index).trim() === '') doc = parseBlock(block[1])
  }
  return { kind: callable ? 'function' : 'value', doc }
}

export const leadingBlock = (source) => {
  const block = /^\s*\/\*\*([\s\S]*?)\*\//.exec(source)
  return block ? parseBlock(block[1]) : null
}

export const firstSentence = (text) => {
  const end = text.search(/(?<!\b(?:e\.g|i\.e))\.(\s|$)/)
  const sentence = end === -1 ? text : text.slice(0, end + 1)
  return sentence.length > 120 ? `${sentence.slice(0, 117)}...` : sentence
}
