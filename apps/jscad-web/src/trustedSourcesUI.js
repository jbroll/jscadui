/**
 * Trusted Sources UI Components
 * Permission dialog and CRUD settings for managing trusted URL sources.
 */

import {
  loadRules,
  addRule,
  updateRule,
  deleteRule,
  parseUrl,
  addRuleForUrl,
  addRuleForDomain
} from './trustedSources.js'

/**
 * Show permission dialog for untrusted URL
 * @param {string} url - The URL requesting permission
 * @returns {Promise<'allow_once' | 'trust_url' | 'trust_domain' | 'cancel'>}
 */
export function showPermissionDialog(url) {
  return new Promise(resolve => {
    const parsed = parseUrl(url)
    if (!parsed) {
      resolve('cancel')
      return
    }

    // H1 fix: Build dialog using DOM methods instead of innerHTML
    const overlay = document.createElement('div')
    overlay.className = 'trust-dialog-overlay'

    const dialog = document.createElement('div')
    dialog.className = 'trust-dialog'

    const h3 = document.createElement('h3')
    h3.textContent = 'Load script from untrusted source?'
    dialog.appendChild(h3)

    const urlP = document.createElement('p')
    urlP.className = 'trust-url'
    urlP.textContent = url
    dialog.appendChild(urlP)

    const optionsDiv = document.createElement('div')
    optionsDiv.className = 'trust-options'

    const options = [
      { value: 'allow_once', text: 'Load once (don\'t remember)', checked: true },
      { value: 'trust_url', text: 'Trust this exact URL', checked: false },
      { value: 'trust_domain', text: `Trust all scripts from `, domain: parsed.domain, checked: false }
    ]

    options.forEach(opt => {
      const label = document.createElement('label')
      const input = document.createElement('input')
      input.type = 'radio'
      input.name = 'trust-option'
      input.value = opt.value
      input.checked = opt.checked
      label.appendChild(input)
      if (opt.domain) {
        label.appendChild(document.createTextNode(opt.text))
        const strong = document.createElement('strong')
        strong.textContent = opt.domain
        label.appendChild(strong)
      } else {
        label.appendChild(document.createTextNode(opt.text))
      }
      optionsDiv.appendChild(label)
    })
    dialog.appendChild(optionsDiv)

    const buttonsDiv = document.createElement('div')
    buttonsDiv.className = 'trust-buttons'

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'trust-cancel'
    cancelBtn.textContent = 'Cancel'

    const allowBtn = document.createElement('button')
    allowBtn.className = 'trust-allow'
    allowBtn.textContent = 'Allow'

    buttonsDiv.appendChild(cancelBtn)
    buttonsDiv.appendChild(allowBtn)
    dialog.appendChild(buttonsDiv)

    overlay.appendChild(dialog)

    // M4 fix: Store listener reference for cleanup from all exit paths
    const onKeydown = e => {
      if (e.key === 'Escape') {
        cleanup()
        resolve('cancel')
      }
    }

    const cleanup = () => {
      document.removeEventListener('keydown', onKeydown)
      overlay.remove()
    }

    cancelBtn.onclick = () => {
      cleanup()
      resolve('cancel')
    }

    allowBtn.onclick = () => {
      const selected = overlay.querySelector('input[name="trust-option"]:checked')
      const value = selected?.value || 'allow_once'
      cleanup()

      // Save rule if user chose to trust
      if (value === 'trust_url') {
        addRuleForUrl(url)
      } else if (value === 'trust_domain') {
        addRuleForDomain(url)
      }

      resolve(value)
    }

    // Close on overlay click
    overlay.onclick = e => {
      if (e.target === overlay) {
        cleanup()
        resolve('cancel')
      }
    }

    document.addEventListener('keydown', onKeydown)
    document.body.appendChild(overlay)
  })
}

/**
 * Show CRUD dialog for managing trusted sources
 * H1 fix: Refactored to use DOM methods instead of innerHTML for user content
 */
export function showTrustedSourcesDialog() {
  const overlay = document.createElement('div')
  overlay.className = 'trust-dialog-overlay'

  // M4 fix: Store listener for cleanup from all exit paths
  const onKeydown = e => {
    if (e.key === 'Escape') {
      cleanup()
    }
  }

  const cleanup = () => {
    document.removeEventListener('keydown', onKeydown)
    overlay.remove()
  }

  const createRuleElement = (rule) => {
    const ruleEl = document.createElement('div')
    ruleEl.className = 'trust-rule'
    ruleEl.dataset.id = rule.id

    const ruleInfo = document.createElement('div')
    ruleInfo.className = 'rule-info'

    const domainSpan = document.createElement('span')
    domainSpan.className = 'rule-domain'
    domainSpan.textContent = rule.domain

    const pathSpan = document.createElement('span')
    pathSpan.className = 'rule-path'
    pathSpan.textContent = rule.pathPattern

    ruleInfo.appendChild(domainSpan)
    ruleInfo.appendChild(pathSpan)

    const actionsDiv = document.createElement('div')
    actionsDiv.className = 'rule-actions'

    const editBtn = document.createElement('button')
    editBtn.className = 'rule-edit'
    editBtn.title = 'Edit'
    editBtn.textContent = 'Edit'
    editBtn.onclick = () => enterEditMode(ruleEl, rule)

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'rule-delete'
    deleteBtn.title = 'Delete'
    deleteBtn.textContent = 'Delete'
    deleteBtn.onclick = () => {
      deleteRule(rule.id)
      render()
    }

    actionsDiv.appendChild(editBtn)
    actionsDiv.appendChild(deleteBtn)

    ruleEl.appendChild(ruleInfo)
    ruleEl.appendChild(actionsDiv)

    return ruleEl
  }

  const enterEditMode = (ruleEl, rule) => {
    ruleEl.innerHTML = ''

    const domainInput = document.createElement('input')
    domainInput.type = 'text'
    domainInput.className = 'edit-domain'
    domainInput.value = rule.domain

    const pathInput = document.createElement('input')
    pathInput.type = 'text'
    pathInput.className = 'edit-path'
    pathInput.value = rule.pathPattern

    const saveBtn = document.createElement('button')
    saveBtn.className = 'edit-save'
    saveBtn.textContent = 'Save'
    saveBtn.onclick = () => {
      const newDomain = domainInput.value.trim()
      const newPath = pathInput.value.trim()
      if (newDomain) {
        updateRule(rule.id, newDomain, newPath || '.*')
      }
      render()
    }

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'edit-cancel'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.onclick = () => render()

    ruleEl.appendChild(domainInput)
    ruleEl.appendChild(pathInput)
    ruleEl.appendChild(saveBtn)
    ruleEl.appendChild(cancelBtn)
  }

  const render = () => {
    overlay.innerHTML = ''

    const dialog = document.createElement('div')
    dialog.className = 'trust-dialog trust-dialog-wide'

    const h3 = document.createElement('h3')
    h3.textContent = 'Trusted Sources'
    dialog.appendChild(h3)

    const descP = document.createElement('p')
    descP.className = 'trust-description'
    descP.textContent = 'Scripts from trusted sources load without prompting. Use domain and path regex patterns to control access.'
    dialog.appendChild(descP)

    const rulesList = document.createElement('div')
    rulesList.className = 'trust-rules-list'

    const rules = loadRules()
    if (rules.length === 0) {
      const noRules = document.createElement('p')
      noRules.className = 'no-rules'
      noRules.textContent = 'No trusted sources configured. URLs will prompt for permission.'
      rulesList.appendChild(noRules)
    } else {
      rules.forEach(rule => {
        rulesList.appendChild(createRuleElement(rule))
      })
    }
    dialog.appendChild(rulesList)

    const addForm = document.createElement('div')
    addForm.className = 'trust-add-form'

    const addDomainInput = document.createElement('input')
    addDomainInput.type = 'text'
    addDomainInput.className = 'add-domain'
    addDomainInput.placeholder = 'Domain (e.g., example.com)'

    const addPathInput = document.createElement('input')
    addPathInput.type = 'text'
    addPathInput.className = 'add-path'
    addPathInput.placeholder = 'Path regex (e.g., .* or /models/.*\\.js$)'

    const addBtn = document.createElement('button')
    addBtn.className = 'add-rule'
    addBtn.textContent = 'Add Rule'
    addBtn.onclick = () => {
      const domain = addDomainInput.value.trim()
      const path = addPathInput.value.trim() || '.*'
      if (domain) {
        addRule(domain, path)
        render()
      }
    }

    addForm.appendChild(addDomainInput)
    addForm.appendChild(addPathInput)
    addForm.appendChild(addBtn)
    dialog.appendChild(addForm)

    const buttonsDiv = document.createElement('div')
    buttonsDiv.className = 'trust-buttons'

    const closeBtn = document.createElement('button')
    closeBtn.className = 'trust-close'
    closeBtn.textContent = 'Close'
    closeBtn.onclick = () => cleanup()

    buttonsDiv.appendChild(closeBtn)
    dialog.appendChild(buttonsDiv)

    overlay.appendChild(dialog)
  }

  render()

  // Close on overlay click
  overlay.onclick = e => {
    if (e.target === overlay) cleanup()
  }

  document.addEventListener('keydown', onKeydown)
  document.body.appendChild(overlay)
}

/**
 * CSS styles for trusted sources dialogs
 */
export const trustedSourcesStyles = `
.trust-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.trust-dialog {
  background: white;
  border-radius: 8px;
  padding: 20px;
  max-width: 500px;
  width: 90%;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.trust-dialog-wide {
  max-width: 600px;
}

.trust-dialog h3 {
  margin: 0 0 12px 0;
  font-size: 18px;
  color: #333;
}

.trust-url {
  background: #f5f5f5;
  padding: 8px 12px;
  border-radius: 4px;
  word-break: break-all;
  font-family: monospace;
  font-size: 12px;
  margin: 12px 0;
}

.trust-description {
  color: #666;
  font-size: 13px;
  margin: 0 0 16px 0;
}

.trust-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 16px 0;
}

.trust-options label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
}

.trust-options label:hover {
  background: #f0f0f0;
}

.trust-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.trust-buttons button {
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid #ccc;
  background: white;
  cursor: pointer;
  font-size: 14px;
}

.trust-buttons button:hover {
  background: #f0f0f0;
}

.trust-allow {
  background: #4CAF50 !important;
  color: white !important;
  border-color: #4CAF50 !important;
}

.trust-allow:hover {
  background: #45a049 !important;
}

.trust-rules-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin: 12px 0;
}

.no-rules {
  padding: 20px;
  text-align: center;
  color: #888;
  font-style: italic;
}

.trust-rule {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #eee;
}

.trust-rule:last-child {
  border-bottom: none;
}

.rule-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rule-domain {
  font-weight: 500;
  color: #333;
}

.rule-path {
  font-family: monospace;
  font-size: 12px;
  color: #666;
}

.rule-actions {
  display: flex;
  gap: 4px;
}

.rule-actions button {
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid #ccc;
  border-radius: 3px;
  background: white;
  cursor: pointer;
}

.rule-actions button:hover {
  background: #f0f0f0;
}

.rule-delete:hover {
  background: #ffebee !important;
  border-color: #ef5350 !important;
  color: #c62828 !important;
}

.trust-add-form {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}

.trust-add-form input {
  flex: 1;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
}

.trust-add-form button {
  padding: 8px 12px;
  background: #2196F3;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.trust-add-form button:hover {
  background: #1976D2;
}

.trust-rule input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 13px;
}

.trust-rule .edit-save,
.trust-rule .edit-cancel {
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid #ccc;
  border-radius: 3px;
  background: white;
  cursor: pointer;
}

.trust-rule .edit-save {
  background: #4CAF50;
  color: white;
  border-color: #4CAF50;
}
`

export default {
  showPermissionDialog,
  showTrustedSourcesDialog,
  trustedSourcesStyles
}
