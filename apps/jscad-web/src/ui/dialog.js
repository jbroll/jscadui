/**
 * A small modal confirm over the app; resolves true on confirm, false on
 * cancel or a backdrop click.
 * @param {{title:string, message:string, confirmLabel?:string, cancelLabel?:string}} options
 * @returns {Promise<boolean>}
 */
export const confirm = ({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel' }) =>
  new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'confirm-overlay'
    const box = document.createElement('div')
    box.className = 'confirm-box'
    const heading = document.createElement('h2')
    heading.className = 'confirm-title'
    heading.textContent = title
    const body = document.createElement('p')
    body.className = 'confirm-message'
    body.textContent = message
    const actions = document.createElement('div')
    actions.className = 'confirm-actions'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'confirm-cancel'
    cancel.textContent = cancelLabel
    const ok = document.createElement('button')
    ok.type = 'button'
    ok.className = 'confirm-ok'
    ok.textContent = confirmLabel
    actions.append(cancel, ok)
    box.append(heading, body, actions)
    overlay.append(box)
    const done = (value) => { overlay.remove(); resolve(value) }
    cancel.addEventListener('click', () => done(false))
    ok.addEventListener('click', () => done(true))
    overlay.addEventListener('click', (event) => { if (event.target === overlay) done(false) })
    document.body.append(overlay)
    ok.focus?.()
  })
