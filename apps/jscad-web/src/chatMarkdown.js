// Markdown for assistant replies, built as DOM nodes so model output can never
// become markup. Unsupported syntax stays literal text.

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const SAFE_URL = /^https?:\/\//i
const COPIED_MS = 1500

const h = (tag, className) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

const escapable = (c) => c !== undefined && /[\\`*_[\]()#+\-.!|~<>]/.test(c)
const wordChar = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

// Index of the closing delimiter for an emphasis run opened at `from`, or -1.
const closeEmphasis = (text, from, delim) => {
  for (let i = from; i <= text.length - delim.length; i++) {
    if (text[i] === '\\') { i++; continue }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > 0) i = end
      continue
    }
    if (!text.startsWith(delim, i) || /\s/.test(text[i - 1])) continue
    const after = text[i + delim.length]
    if (delim.length === 1 && after === delim) { i++; continue }
    if (delim[0] === '_' && wordChar(after)) continue
    return i
  }
  return -1
}

const inline = (text, parent) => {
  let buf = ''
  const flush = () => {
    if (buf) parent.append(buf)
    buf = ''
  }
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '\\' && escapable(text[i + 1])) {
      buf += text[i + 1]
      i += 2
      continue
    }
    if (c === '`') {
      const run = text.slice(i).match(/^`+/)[0]
      const end = text.indexOf(run, i + run.length)
      if (end > 0) {
        flush()
        const code = h('code')
        const body = text.slice(i + run.length, end)
        code.textContent = /^ .* $/.test(body) ? body.slice(1, -1) : body
        parent.append(code)
        i = end + run.length
        continue
      }
      buf += run
      i += run.length
      continue
    }
    if (c === '[') {
      const m = text.slice(i).match(/^\[([^\]]+)\]\(([^)\s]+)\)/)
      if (m && SAFE_URL.test(m[2])) {
        flush()
        const a = h('a')
        a.href = m[2]
        a.target = '_blank'
        a.rel = 'noreferrer'
        inline(m[1], a)
        parent.append(a)
        i += m[0].length
        continue
      }
    }
    if (c === '*' || c === '_') {
      const delim = text[i + 1] === c ? c + c : c
      const next = text[i + delim.length]
      const opens = next !== undefined && !/\s/.test(next) && !(c === '_' && wordChar(text[i - 1]))
      const end = opens ? closeEmphasis(text, i + delim.length + 1, delim) : -1
      if (end > 0) {
        flush()
        const node = h(delim.length === 2 ? 'strong' : 'em')
        inline(text.slice(i + delim.length, end), node)
        parent.append(node)
        i = end + delim.length
        continue
      }
      buf += delim
      i += delim.length
      continue
    }
    buf += c
    i++
  }
  flush()
  return parent
}

const copyButton = (code) => {
  const button = h('button', 'chat-code-copy')
  button.type = 'button'
  button.textContent = 'Copy'
  button.setAttribute('aria-label', 'Copy code')
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent)
      button.textContent = 'Copied'
    } catch {
      button.textContent = 'Copy failed'
    }
    setTimeout(() => { button.textContent = 'Copy' }, COPIED_MS)
  })
  return button
}

const codeBlock = (lang, body) => {
  const wrap = h('div', 'chat-code')
  const pre = h('pre')
  const code = h('code', lang ? `language-${lang}` : '')
  code.textContent = body
  pre.append(code)
  wrap.append(copyButton(code), pre)
  return wrap
}

const cells = (line) => {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

const isTableStart = (lines, i) => lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && TABLE_SEP.test(lines[i + 1])

const table = (head, sep, rows) => {
  const align = cells(sep).map((s) => (s.startsWith(':') && s.endsWith(':') ? 'center' : s.endsWith(':') ? 'right' : s.startsWith(':') ? 'left' : ''))
  const row = (line, tag) => {
    const tr = h('tr')
    const values = cells(line)
    align.forEach((a, k) => {
      const cell = inline(values[k] ?? '', h(tag))
      if (a) cell.style.textAlign = a
      tr.append(cell)
    })
    return tr
  }
  const wrap = h('div', 'chat-table')
  const t = h('table')
  const thead = h('thead')
  thead.append(row(head, 'th'))
  const tbody = h('tbody')
  for (const line of rows) tbody.append(row(line, 'td'))
  t.append(thead, tbody)
  wrap.append(t)
  return wrap
}

const startsBlock = (line) => FENCE.test(line) || HEADING.test(line) || LIST_ITEM.test(line)

// Items sit at the first line's indent; deeper lines belong to the item above.
const list = (lines) => {
  const indent = lines[0].match(LIST_ITEM)[1].length
  const first = lines[0].match(LIST_ITEM)[2]
  const ordered = /\d/.test(first)
  const node = h(ordered ? 'ol' : 'ul')
  if (ordered && parseInt(first, 10) !== 1) node.setAttribute('start', String(parseInt(first, 10)))
  const items = []
  for (const line of lines) {
    const m = line.match(LIST_ITEM)
    if (m && m[1].length <= indent) items.push([m[3]])
    else items.at(-1).push(line.replace(new RegExp(`^ {0,${indent + 2}}`), ''))
  }
  for (const body of items) {
    const li = h('li')
    let k = 1
    while (k < body.length && !startsBlock(body[k])) k++
    inline(body.slice(0, k).join('\n'), li)
    if (k < body.length) li.append(blocks(body.slice(k)))
    node.append(li)
  }
  return node
}

const blocks = (lines) => {
  const out = document.createDocumentFragment()
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    const fence = line.match(FENCE)
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`)
      const body = []
      i++
      while (i < lines.length && !close.test(lines[i])) body.push(lines[i++])
      i++
      out.append(codeBlock(fence[2], body.join('\n')))
      continue
    }
    const heading = line.match(HEADING)
    if (heading) {
      out.append(inline(heading[2], h(`h${heading[1].length}`)))
      i++
      continue
    }
    if (isTableStart(lines, i)) {
      const head = line
      const sep = lines[i + 1]
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(lines[i++])
      out.append(table(head, sep, rows))
      continue
    }
    if (LIST_ITEM.test(line)) {
      const [, lead, marker] = line.match(LIST_ITEM)
      const indent = lead.length
      const ordered = /\d/.test(marker)
      const body = [line]
      i++
      while (i < lines.length) {
        const next = lines[i]
        if (!next.trim()) {
          const after = lines[i + 1]
          if (after === undefined || !(/^ +\S/.test(after) || LIST_ITEM.test(after))) break
          i++
          continue
        }
        const m = next.match(LIST_ITEM)
        if (m ? m[1].length < indent || (m[1].length === indent && /\d/.test(m[2]) !== ordered) : !/^ /.test(next) && startsBlock(next)) break
        body.push(next)
        i++
      }
      out.append(list(body))
      continue
    }
    const para = [line]
    i++
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !isTableStart(lines, i)) para.push(lines[i++])
    out.append(inline(para.join('\n'), h('p')))
  }
  return out
}

export const renderMarkdown = (text) => blocks(String(text ?? '').replace(/\r\n?/g, '\n').split('\n'))

// Streaming re-renders the whole reply from its accumulated text, at most once
// per frame; `around` wraps each render (the chat measures scroll-follow there).
export const createMarkdownStream = (node, { schedule = (fn) => requestAnimationFrame(fn), around = (fn) => fn() } = {}) => {
  let text = ''
  let queued = false
  const render = () => {
    queued = false
    around(() => node.replaceChildren(renderMarkdown(text)))
  }
  return {
    append(chunk) {
      text += chunk
      if (queued) return
      queued = true
      schedule(() => { if (queued) render() })
    },
    flush() { if (queued) render() },
  }
}
