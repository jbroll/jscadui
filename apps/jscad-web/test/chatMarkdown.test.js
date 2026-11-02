// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createMarkdownStream, renderMarkdown } from '../src/chatMarkdown.js'

const render = (text) => {
  const div = document.createElement('div')
  div.append(renderMarkdown(text))
  return div
}

describe('renderMarkdown blocks', () => {
  it('splits paragraphs on blank lines and keeps single line breaks', () => {
    const div = render('first line\nsecond line\n\nnext para')
    const ps = div.querySelectorAll('p')
    expect(ps).toHaveLength(2)
    expect(ps[0].textContent).toBe('first line\nsecond line')
    expect(ps[1].textContent).toBe('next para')
  })

  it('renders headings by level', () => {
    const div = render('# Top\n### Third\nbody')
    expect(div.querySelector('h1').textContent).toBe('Top')
    expect(div.querySelector('h3').textContent).toBe('Third')
    expect(div.querySelector('p').textContent).toBe('body')
  })

  it('renders fenced code with its language and no markdown inside', () => {
    const div = render('Here:\n```js\nconst a = **1**\n<b>x</b>\n```\nafter')
    const code = div.querySelector('pre code')
    expect(code.textContent).toBe('const a = **1**\n<b>x</b>')
    expect(code.className).toBe('language-js')
    expect(div.querySelector('pre b')).toBeNull()
    expect(div.querySelectorAll('p')).toHaveLength(2)
  })

  it('renders an unclosed fence as code to the end, as while streaming', () => {
    const div = render('```\nline 1\nline 2')
    expect(div.querySelector('pre code').textContent).toBe('line 1\nline 2')
  })

  it('renders unordered and ordered lists, nested by indent', () => {
    const div = render('- one\n- two\n  - two a\n- three\n\n3. c\n4. d')
    const ul = div.querySelector('ul')
    expect([...ul.children].map((li) => li.firstChild.textContent)).toEqual(['one', 'two', 'three'])
    expect(ul.children[1].querySelector('ul li').textContent).toBe('two a')
    const ol = div.querySelector('ol')
    expect(ol.getAttribute('start')).toBe('3')
    expect([...ol.children].map((li) => li.textContent)).toEqual(['c', 'd'])
  })

  it('renders a GFM pipe table with alignment', () => {
    const div = render('| Part | Size |\n|:---|---:|\n| bolt | **M3** |\n| nut | M4 |')
    expect([...div.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Part', 'Size'])
    const rows = div.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('td:last-child strong').textContent).toBe('M3')
    expect(rows[0].children[1].style.textAlign).toBe('right')
  })

  it('leaves a pipe line without a separator row as a paragraph', () => {
    const div = render('a | b')
    expect(div.querySelector('table')).toBeNull()
    expect(div.querySelector('p').textContent).toBe('a | b')
  })
})

describe('renderMarkdown inline', () => {
  it('renders bold, italic and inline code', () => {
    const p = render('a **bold** and *it* and _it2_ and `x * y`').querySelector('p')
    expect(p.querySelector('strong').textContent).toBe('bold')
    expect([...p.querySelectorAll('em')].map((e) => e.textContent)).toEqual(['it', 'it2'])
    expect(p.querySelector('code').textContent).toBe('x * y')
  })

  it('keeps snake_case and lone asterisks literal', () => {
    const p = render('use my_var_name and 2 * 3 * 4').querySelector('p')
    expect(p.querySelector('em')).toBeNull()
    expect(p.textContent).toBe('use my_var_name and 2 * 3 * 4')
  })

  it('renders http and https links opening in a new tab', () => {
    const a = render('see [the docs](https://openjscad.xyz/docs/)').querySelector('a')
    expect(a.href).toBe('https://openjscad.xyz/docs/')
    expect(a.textContent).toBe('the docs')
    expect(a.target).toBe('_blank')
    expect(a.rel).toBe('noreferrer')
  })

  it('keeps a javascript: link as text', () => {
    const div = render('[click](javascript:alert(1))')
    expect(div.querySelector('a')).toBeNull()
    expect(div.textContent).toBe('[click](javascript:alert(1))')
  })

  it('keeps HTML-looking text as text', () => {
    const div = render('<script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(div.querySelector('script, img')).toBeNull()
    expect(div.textContent).toBe('<script>alert(1)</script> <img src=x onerror=alert(1)>')
  })

  it('honours backslash escapes', () => {
    expect(render('\\*not em\\*').querySelector('p').textContent).toBe('*not em*')
  })
})

describe('code block copy', () => {
  it('copies the block text and says Copied', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const div = render('```\ncube({ size: 10 })\n```')
    const button = div.querySelector('.chat-code-copy')
    expect(button.textContent).toBe('Copy')
    button.click()
    expect(writeText).toHaveBeenCalledWith('cube({ size: 10 })')
    await vi.waitFor(() => expect(button.textContent).toBe('Copied'))
  })
})

describe('createMarkdownStream', () => {
  it('re-renders the accumulated text once per frame and on flush', () => {
    const frames = []
    const node = document.createElement('div')
    const around = vi.fn((fn) => fn())
    const stream = createMarkdownStream(node, { schedule: (fn) => frames.push(fn), around })
    stream.append('**bo')
    stream.append('ld** and')
    expect(frames).toHaveLength(1)
    expect(node.textContent).toBe('')
    frames.shift()()
    expect(node.querySelector('strong').textContent).toBe('bold')
    stream.append(' `code`')
    stream.flush()
    expect(node.querySelector('code').textContent).toBe('code')
    frames.shift()()
    expect(around).toHaveBeenCalledTimes(2)
  })
})
