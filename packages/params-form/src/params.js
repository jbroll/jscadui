const GROUP_SELECTOR = 'DIV[type="group"]'
const INPUT_SELECTOR = 'INPUT, SELECT'
const BUTTON_SELECTOR = 'BUTTON'

export const querySelector = (el, selector) => el.querySelector(selector)
export const forQS = (el, selector, cb) => el.querySelectorAll(selector).forEach(cb)
export const forEachInput = (el, cb) => forQS(el, INPUT_SELECTOR, cb)
export const forEachGroup = (el, cb) => forQS(el, GROUP_SELECTOR, cb)
export const forEachButton = (el, cb) => forQS(el, BUTTON_SELECTOR, cb)

const numeric = { number: 1, float: 1, int: 1, range: 1, slider: 1 }

// M23 fix: Pre-compile regex to avoid creating it on every loop iteration
// L12 fix: Support negative numbers
const NUMERIC_STRING_REGEX = /^-?(\d+|\d+\.\d+)$/

/**
 * Escape HTML special characters to prevent XSS attacks.
 *
 * SECURITY NOTE (FALSE POSITIVE): This module uses innerHTML for performance with
 * string concatenation, but ALL user-controlled values are sanitized through this
 * escapeHtml() function before interpolation. DO NOT add string interpolation
 * without escaping - XSS vulnerability risk.
 *
 * @param {unknown} str - Value to escape (will be converted to string)
 * @returns {string} - Escaped string safe for HTML attribute/content use
 */
const escapeHtml = (str) => {
  if (str === null || str === undefined) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function applyRange(inp) {
  forEachInput(inp.parentNode,inp2=>{
    if(inp != inp2) inp2.value = inp.value
  })
}

export const genParams = ({
  params,
  target,
  callback,
  startAnim,
  pauseAnim: _pauseAnim,
  storedValues = {},
  buttons = ['reset', 'save', 'load', 'edit', 'link'],
}) => {
  const initialValues = {}
  /** @type {Array<{el: Element, type: string, handler: EventListener}>} */
  const listeners = []

  /**
   * @param {Element} el
   * @param {string} type
   * @param {EventListener} handler
   */
  const addListener = (el, type, handler) => {
    el.addEventListener(type, handler)
    listeners.push({ el, type, handler })
  }
  const funcs = {
    group: () => '',
    choice: inputChoice,
    radio: inputRadio,
    // TODO radio similar options as choice
    checkbox: function ({ name, value }) {
      const checkedStr = value === 'checked' || value === true ? 'checked' : ''
      return `<input type="checkbox" name="${escapeHtml(name)}" ${checkedStr}/>`
    }
  }

  function inputRadio({ name, type, captions, value, values }) {
    if (!captions) captions = values

    let ret = '<div type="radio">'

    for (let i = 0; i < values.length; i++) {
      const checked = value == values[i] || value == captions[i] ? 'checked' : ''
      ret += `<label><input type="radio" _type="${escapeHtml(type)}" name="${escapeHtml(name)}" numeric="${
        typeof values[0] == 'number' ? '1' : '0'
      }" value="${escapeHtml(values[i])}" ${checked}/>${escapeHtml(captions[i])}</label>`
    }
    return ret + '</div>'
  }

  function inputChoice({ name, type, captions, value, values }) {
    if (!captions) captions = values

    let ret = `<select _type="${escapeHtml(type)}" name="${escapeHtml(name)}" numeric="${typeof values[0] == 'number' ? '1' : '0'}">`

    for (let i = 0; i < values.length; i++) {
      const checked = value == values[i] || value == captions[i] ? 'selected' : ''
      ret += `<option value="${escapeHtml(values[i])}" ${checked}>${escapeHtml(captions[i])}</option>`
    }
    return ret + '</select>'
  }

  function inputDefault(def) {
    const { name, type, min, max, placeholder, live, fps } = def
    let { value, step } = def
    // L16 fix: Use separate variable for sanitized fps value
    const safeFps = fps <= 0 ? 1 : fps
    if(!step && safeFps) step = 1/safeFps

    if (value === null || value === undefined) value = numeric[type] ? 0 : ''
    let inputType = type
    if (type == 'int' || type == 'float') inputType = 'number'
    if (type == 'range' || type == 'slider') inputType = 'range'
    let str = `<input _type="${escapeHtml(type)}" type="${inputType}" name="${escapeHtml(name)}"`
    if (step !== undefined) str += ` step="${escapeHtml(step)}"`
    if (min !== undefined) str += ` min="${escapeHtml(min)}"`
    if (max !== undefined) str += ` max="${escapeHtml(max)}"`
    if (value !== undefined) str += ` value="${escapeHtml(value)}"`
    str += ` live="${live ? 1 : 0}"`
    if (placeholder !== undefined) str += ` placeholder="${escapeHtml(placeholder)}"`
    return str + '/>'
  }

  let html = ''
  let closed = false
  const missing = {}

  params.forEach(def => {
    const { type, name, fps, live } = def
    let { caption } = def

    if (!caption) caption = name

    // Construct the initial value
    let value = def.initial
    if (def['default'] !== undefined) value = def['default']
    if (type == 'checkbox' && def.checked !== undefined) value = def.checked
    def.value = initialValues[name] = value
    if (storedValues[name] !== undefined) {
      def.value = storedValues[name]
    }

    if (type == 'group') {
      const ch = caption[0]
      closed = def.value == 'closed'
      if (ch === '>' || ch === '+') {
        caption = caption.substring(1).trim()
        closed = true
      }
    }
    def.closed = closed

    html += `<div class="form-line ${fps ? 'param-anim-area':''}" type="${escapeHtml(def.type)}" closed="${closed ? 1 : 0}" `
    if (type == 'group') html += ` name="${escapeHtml(name)}"`
    html += `">`

    // label
    html += `<label`
    if (type == 'group') html += ` name="${escapeHtml(name)}"`
    html += `>${escapeHtml(caption)}</label>`

    // value
    let valHtml = ``
    if (type == 'slider' || type == 'range'){
      if(fps) valHtml += `<button action="play" code="${escapeHtml(name)}">P</button>`
      valHtml += `<input name="${escapeHtml(name)}" value="${escapeHtml(value)}" live="${live ? 1 : 0}"/>`
    }

    //
    //console.log(type)
    //
    html += valHtml

    // L17 fix: Check for missing type before applying default fallback
    const inputFunc = funcs[type]
    if (!inputFunc) missing[type] = 1
    html += (inputFunc || inputDefault)(def)

    html += '</div>\n'
  })

  const missingKeys = Object.keys(missing)
  if (missingKeys.length) console.log('missing param impl', missingKeys)

  function _callback(source = 'change', inp, name) {
    if(name == 'fps' && target.anims?.length && parseFloat(inp.value) <=0){
      inp.value = inp.step || '1'
    }
    const out = getParams(target)
    if(out.fps && target.anims?.length){
      target.anims.forEach(inp=>inp.setAttribute('step', 1/out.fps))
    }
    callback(out, source)
  }

  html += '<div class="jscad-param-buttons"><div>'
  buttons.forEach(button => {
    const { id, name } = typeof button === 'string' ? { id: button, name: button } : button
    html += `<button action="${escapeHtml(id)}"><b>${escapeHtml(name)}</b></button>`
  })
  html += '</div></div>'

  target.innerHTML = html

  /** @param {"running" | ""} status */
  function animStatus(status){
    forEachInput(target, inp => {
      const p = inp.parentNode
      const button = querySelector(p,'BUTTON[action]')
      if(button){
        button.innerHTML = status == 'running' ? 'S' : 'P'
      }
      // TODO change button to play/pause depending on animation status
    })
  }

  function setSomeValues(v){
    setValue(v, true)
  }

  /**
   * @param {unknown} v 
   * @param {boolean} [skipUndefined]
   */
  function setValue(v, skipUndefined){
    forEachInput(target, inp => {
      const name = inp.getAttribute('name')
      if(name){
        if(skipUndefined && v[name] === undefined) return
        inp.value = v[name]
        applyRange(inp)
      }
    })
  }
  target.anims = []
  forEachInput(target, inp => {
    const p = inp.parentNode
    const name = inp.getAttribute('name')
    const type = inp.getAttribute('type')
    // only if there is animation and we have a fps input, and no min defined
    if(name == 'fps' && target.anims?.length && !inp.min){
      inp.min = inp.step || '1'
    }
    if(type == 'range') target.anims.push(inp)
    inp.def = params.find(def=>def.name == name)
    // live value for attribute is set to 1 regardless if config used 1 or true
    const isLiveInput = inp.getAttribute('live') === '1'
    // we listen to live changes to update value preview
    // and also then we can trigger param event if live option is chosen
    addListener(inp, 'input', function () {
      applyRange(inp)
      if (isLiveInput) _callback('live', inp, name)
    })
    // regular input we only react on change
    if (!isLiveInput){
      addListener(inp, 'change', () => _callback('change', inp, name))
    }
    const button = querySelector(p,'BUTTON[action]')
    if(button && !button.clickAdded){
      addListener(button, 'click', () => {
        startAnim(inp.def, inp.value)
      })
      button.clickAdded = 1
    } 
  })

  function groupClick(evt) {
    let groupDiv = evt.target
    if (groupDiv.tagName === 'LABEL') groupDiv = groupDiv.parentNode
    const closed = groupDiv.getAttribute('closed') == '1' ? '0' : '1'
    do {
      groupDiv.setAttribute('closed', closed)
      groupDiv = groupDiv.nextElementSibling
    } while (groupDiv && groupDiv.getAttribute('type') != 'group')
    _callback('group', groupDiv,'')
  }

  forEachGroup(target, div => {
    addListener(div, 'click', groupClick)
  })

  /**
   * Clean up all event listeners. Call when the form is removed/recreated.
   */
  const destroy = () => {
    for (const { el, type, handler } of listeners) {
      el.removeEventListener(type, handler)
    }
    listeners.length = 0
  }

  return {animStatus, setValue, setSomeValues, destroy}
}

export const getParams = target => {
  const params = {}
  if (!target) return params

  forEachGroup(target, elem => {
    const name = elem.getAttribute('name')
    params[name] = elem.getAttribute('closed') == '1' ? 'closed' : ''
  })

  forEachInput(target, elem => {
    const name = elem.name
    let value = elem.value
    if (elem.tagName == 'INPUT') {
      if (elem.type == 'checkbox') value = elem?.checked
      if (elem.type == 'file') value = elem.files?.[0]
      if (elem.type == 'range' || elem.type == 'color') applyRange(elem)
    }

    if (numeric[elem.getAttribute('type')] || elem.getAttribute('numeric') == '1') {
      value = parseFloat(String(value || 0))
    } else if (value && typeof value === 'string' && NUMERIC_STRING_REGEX.test(value.trim())) {
      // M23 fix: Use pre-compiled regex
      value = parseFloat(String(value || 0))
    }
    if (elem.type == 'radio' && !elem.checked) return // skip if not checked radio button

    params[name] = value
  })
  return params
}
