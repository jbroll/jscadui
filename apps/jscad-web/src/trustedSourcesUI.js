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

    const overlay = document.createElement('div')
    overlay.className = 'trust-dialog-overlay'
    overlay.innerHTML = `
      <div class="trust-dialog">
        <h3>Load script from untrusted source?</h3>
        <p class="trust-url">${escapeHtml(url)}</p>
        <div class="trust-options">
          <label>
            <input type="radio" name="trust-option" value="allow_once" checked>
            Load once (don't remember)
          </label>
          <label>
            <input type="radio" name="trust-option" value="trust_url">
            Trust this exact URL
          </label>
          <label>
            <input type="radio" name="trust-option" value="trust_domain">
            Trust all scripts from <strong>${escapeHtml(parsed.domain)}</strong>
          </label>
        </div>
        <div class="trust-buttons">
          <button class="trust-cancel">Cancel</button>
          <button class="trust-allow">Allow</button>
        </div>
      </div>
    `

    const cleanup = () => {
      overlay.remove()
    }

    overlay.querySelector('.trust-cancel').onclick = () => {
      cleanup()
      resolve('cancel')
    }

    overlay.querySelector('.trust-allow').onclick = () => {
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

    // Close on Escape
    const onKeydown = e => {
      if (e.key === 'Escape') {
        cleanup()
        resolve('cancel')
        document.removeEventListener('keydown', onKeydown)
      }
    }
    document.addEventListener('keydown', onKeydown)

    document.body.appendChild(overlay)
  })
}

/**
 * Show CRUD dialog for managing trusted sources
 */
export function showTrustedSourcesDialog() {
  const overlay = document.createElement('div')
  overlay.className = 'trust-dialog-overlay'

  const renderRules = () => {
    const rules = loadRules()
    const rulesHtml = rules.length === 0
      ? '<p class="no-rules">No trusted sources configured. URLs will prompt for permission.</p>'
      : rules.map(rule => `
          <div class="trust-rule" data-id="${rule.id}">
            <div class="rule-info">
              <span class="rule-domain">${escapeHtml(rule.domain)}</span>
              <span class="rule-path">${escapeHtml(rule.pathPattern)}</span>
            </div>
            <div class="rule-actions">
              <button class="rule-edit" title="Edit">Edit</button>
              <button class="rule-delete" title="Delete">Delete</button>
            </div>
          </div>
        `).join('')

    return rulesHtml
  }

  const render = () => {
    overlay.innerHTML = `
      <div class="trust-dialog trust-dialog-wide">
        <h3>Trusted Sources</h3>
        <p class="trust-description">
          Scripts from trusted sources load without prompting.
          Use domain and path regex patterns to control access.
        </p>
        <div class="trust-rules-list">
          ${renderRules()}
        </div>
        <div class="trust-add-form">
          <input type="text" class="add-domain" placeholder="Domain (e.g., example.com)">
          <input type="text" class="add-path" placeholder="Path regex (e.g., .* or /models/.*\\.js$)">
          <button class="add-rule">Add Rule</button>
        </div>
        <div class="trust-buttons">
          <button class="trust-close">Close</button>
        </div>
      </div>
    `

    // Bind events
    overlay.querySelector('.trust-close').onclick = () => overlay.remove()

    overlay.querySelector('.add-rule').onclick = () => {
      const domainInput = overlay.querySelector('.add-domain')
      const pathInput = overlay.querySelector('.add-path')
      const domain = domainInput.value.trim()
      const path = pathInput.value.trim() || '.*'

      if (domain) {
        addRule(domain, path)
        render()
      }
    }

    // Edit and delete buttons
    overlay.querySelectorAll('.rule-edit').forEach(btn => {
      btn.onclick = () => {
        const ruleEl = btn.closest('.trust-rule')
        const id = ruleEl.dataset.id
        const rules = loadRules()
        const rule = rules.find(r => r.id === id)
        if (!rule) return

        ruleEl.innerHTML = `
          <input type="text" class="edit-domain" value="${escapeHtml(rule.domain)}">
          <input type="text" class="edit-path" value="${escapeHtml(rule.pathPattern)}">
          <button class="edit-save">Save</button>
          <button class="edit-cancel">Cancel</button>
        `

        ruleEl.querySelector('.edit-save').onclick = () => {
          const newDomain = ruleEl.querySelector('.edit-domain').value.trim()
          const newPath = ruleEl.querySelector('.edit-path').value.trim()
          if (newDomain) {
            updateRule(id, newDomain, newPath || '.*')
          }
          render()
        }

        ruleEl.querySelector('.edit-cancel').onclick = () => render()
      }
    })

    overlay.querySelectorAll('.rule-delete').forEach(btn => {
      btn.onclick = () => {
        const id = btn.closest('.trust-rule').dataset.id
        deleteRule(id)
        render()
      }
    })
  }

  render()

  // Close on overlay click
  overlay.onclick = e => {
    if (e.target === overlay) overlay.remove()
  }

  // Close on Escape
  const onKeydown = e => {
    if (e.key === 'Escape') {
      overlay.remove()
      document.removeEventListener('keydown', onKeydown)
    }
  }
  document.addEventListener('keydown', onKeydown)

  document.body.appendChild(overlay)
}

/**
 * Escape HTML to prevent XSS
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
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
