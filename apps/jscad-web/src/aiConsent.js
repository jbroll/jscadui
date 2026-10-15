// Consent for the AI chat: one versioned terms record gates every turn. The
// stored record `localStorage['jscad-ai.tos'] = {version, at, recordOwnChats}`
// is the source of truth; `localStorage['jscad-ai.log']` is the Phase 1 mirror
// (`'off'` when opted out, absent means on) rewritten whenever the user
// answers the recording question. On divergence the `.tos` record wins.
//
// `recordOwnChats` is the only persisted bit beyond `jscad-ai.log`: bumping
// `TOS_VERSION` re-blocks turns without deleting the old record, so the gate
// can pre-check the user's last recording choice.

export const TOS_VERSION = 1

const TOS_KEY = 'jscad-ai.tos'
const LOG_KEY = 'jscad-ai.log'
const LOG_OFF = 'off'

export const TOS_TITLE = 'Before you chat'
export const TOS_INTRO = 'One acceptance covers every turn until this notice changes. See the privacy note in docs/architecture.md.'
export const TOS_LINK = { href: 'https://github.com/jbroll/jscadui/blob/main/apps/jscad-web/docs/architecture.md#privacy', text: 'privacy note' }
export const TOS_REQUIRED_MESSAGE = 'Accept the terms to send a message.'
export const DEMO_NOTICE_MESSAGE = 'Demo sessions are always recorded. Accept the demo notice to send a message.'

// Mandatory acknowledgements, in the order the gate renders them.
export const ACKS = [
  { key: 'code-execution', text: 'Agents run generated JavaScript in workers in this browser.' },
  {
    key: 'provider-sharing',
    text: 'Prompts, project files in context, and outputs are sent to the chosen inference provider. That provider might train on session data.',
  },
  {
    key: 'demo-recorded',
    demo: true,
    text: 'Demo sessions are always recorded to improve jscad-web and cannot be opted out.',
  },
]

export const RECORDING_TEXT = 'Save my chats to help improve jscad-web.'

const store = () => globalThis.localStorage ?? null

// A storage-blocked browser cannot persist consent; the gate just reappears,
// which is the safe direction.
const readItem = (key) => {
  try {
    return store()?.getItem(key) ?? null
  } catch {
    return null
  }
}

const writeItem = (key, value) => {
  try {
    if (value === null) store()?.removeItem(key)
    else store()?.setItem(key, value)
  } catch {
    // Leave the record absent: the next turn asks again.
  }
}

/**
 * The stored consent record, or null when absent or corrupt. A record from an
 * older `TOS_VERSION` is returned as-is so the gate can pre-check it.
 * @returns {{version?:number, at?:number, recordOwnChats?:boolean}|null}
 */
export const getTos = () => {
  const raw = readItem(TOS_KEY)
  if (!raw) return null
  try {
    const record = JSON.parse(raw)
    return record && typeof record === 'object' ? record : null
  } catch {
    return null
  }
}

/** True while the current `TOS_VERSION` has not been accepted. */
export const needsTos = () => getTos()?.version !== TOS_VERSION

// `recordOwnChats` is the source of truth; `jscad-ai.log` answers only when
// `.tos` carries no boolean (fresh install or a pre-TOS user).
export const getRecordOwnChats = () => {
  const record = getTos()
  if (typeof record?.recordOwnChats === 'boolean') return record.recordOwnChats
  return readItem(LOG_KEY) !== LOG_OFF
}

const mirrorLog = (on) => writeItem(LOG_KEY, on ? null : LOG_OFF)

/**
 * Rewrites the recording choice in both keys. Never accepts the terms on a
 * fresh install: with no `.tos` record only the `.log` mirror is written, so
 * the gate still asks.
 * @param {boolean} on
 */
export const setRecordOwnChats = (on) => {
  const value = on === true
  const record = getTos()
  if (record) writeItem(TOS_KEY, JSON.stringify({ ...record, recordOwnChats: value }))
  mirrorLog(value)
  return value
}

/**
 * Records acceptance of the current `TOS_VERSION`, stamped with the recording
 * choice shown pre-checked in the gate.
 * @param {boolean} recordOwnChats
 */
export const acceptTos = (recordOwnChats) => {
  const value = recordOwnChats === true
  writeItem(TOS_KEY, JSON.stringify({ version: TOS_VERSION, at: Date.now(), recordOwnChats: value }))
  mirrorLog(value)
  return getTos()
}

// Phase 2 shipped `shared` selections; the demo provider is the same thing with
// a `demo` flag, so a leftover `shared` selection is treated as demo.
export const isDemoSelection = (selection) => selection?.demo === true || typeof selection?.shared === 'string'

/**
 * Whether a turn may run for this selection, and if not why the gate must be
 * answered first: `'tos'` (the version is unaccepted) or `'demo-notice'` (the
 * user opted out of recording, and demo turns always record).
 * @param {{demo?:boolean, shared?:string, baseUrl?:string}|null} [selection]
 * @returns {{ok:true}|{ok:false, reason:'tos'|'demo-notice'}}
 */
export const checkTurn = (selection) => {
  if (needsTos()) return { ok: false, reason: 'tos' }
  if (isDemoSelection(selection) && getRecordOwnChats() === false) return { ok: false, reason: 'demo-notice' }
  return { ok: true }
}

/**
 * The gate rows for a selection, in dialog order: code-execution → sharing +
 * trains-generic → demo-always-recorded (demo only) → our-recording opt-in. A
 * custom base URL calls the provider directly, so its turn is never recorded
 * and the recording question is skipped.
 * @param {{demo?:boolean, shared?:string, baseUrl?:string}|null} [selection]
 * @returns {Array<{key:string, kind:'ack'|'recording', text:string, required:boolean, checked:boolean, locked:boolean}>}
 */
export const consentRows = (selection) => {
  const demo = isDemoSelection(selection)
  const rows = ACKS.filter((ack) => !ack.demo || demo).map((ack) => ({
    key: ack.key,
    kind: 'ack',
    text: ack.text,
    required: true,
    checked: false,
    locked: false,
  }))
  if (!selection?.baseUrl) {
    rows.push({
      key: 'recordOwnChats',
      kind: 'recording',
      text: RECORDING_TEXT,
      required: false,
      // Demo always records, so the box is checked and locked; otherwise the
      // last choice (fresh installs record) is shown pre-checked.
      checked: demo || getRecordOwnChats(),
      locked: demo,
    })
  }
  return rows
}

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// One gate at a time: a second Send while it is open answers the same promise.
let openGate = null

/**
 * Opens the gate for a selection and resolves true once the user accepts (which
 * writes the consent record) or false when they decline or click the backdrop.
 * @param {{demo?:boolean, shared?:string, baseUrl?:string}|null} [selection]
 * @returns {Promise<boolean>}
 */
export const openConsentGate = (selection) => {
  if (openGate) return openGate
  openGate = new Promise((resolve) => {
    const rows = consentRows(selection)
    const overlay = el('div', 'confirm-overlay tos-gate')
    const box = el('div', 'confirm-box')
    box.append(el('h2', 'confirm-title', TOS_TITLE))
    const intro = el('p', 'confirm-message')
    const [before, after] = TOS_INTRO.split(TOS_LINK.text)
    const link = el('a', 'tos-link', TOS_LINK.text)
    link.href = TOS_LINK.href
    link.target = '_blank'
    link.rel = 'noreferrer'
    intro.append(before ?? '', link, after ?? '')
    box.append(intro)

    const list = el('div', 'tos-rows')
    const inputs = new Map()
    const accept = el('button', 'confirm-ok', 'Accept')
    accept.type = 'button'
    accept.disabled = true
    const sync = () => {
      accept.disabled = rows.some((row) => row.required && !inputs.get(row.key).checked)
    }
    for (const row of rows) {
      const label = el('label', 'tos-row')
      label.dataset.tos = row.key
      const input = el('input', 'tos-ack')
      input.type = 'checkbox'
      input.checked = row.checked === true
      input.disabled = row.locked === true
      input.addEventListener('change', sync)
      label.append(input, el('span', 'tos-row-text', row.text))
      inputs.set(row.key, input)
      list.append(label)
    }
    box.append(list)

    const actions = el('div', 'confirm-actions')
    const decline = el('button', 'confirm-cancel', 'Decline')
    decline.type = 'button'
    actions.append(decline, accept)
    box.append(actions)
    overlay.append(box)

    const done = (value) => {
      overlay.remove()
      openGate = null
      resolve(value)
    }
    accept.addEventListener('click', () => {
      const recording = inputs.get('recordOwnChats')
      acceptTos(recording ? recording.checked : getRecordOwnChats())
      done(true)
    })
    decline.addEventListener('click', () => done(false))
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) done(false)
    })
    document.body.append(overlay)
    sync()
    accept.focus?.()
  })
  return openGate
}
