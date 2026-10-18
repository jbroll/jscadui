// The sign-in control both drawer headers share: the `Sign in to Sync` button
// at the left of the header row, plus the session line and `Sign out` that
// replace it once a session exists. Both drawers mount this module, so the
// entries also share their refreshes: signing out in one clears the other.

// The local backend persists to IndexedDB when available; only without it
// (private mode, the compute frame) does a reload drop work that was never
// synced. `hasLocalWork` is set per mount; the browser's unload prompt is the
// only warning that survives a full-page navigation.
let warnOnUnload = () => false
// The sign-in redirect reloads the page on purpose and already asked; the
// native prompt would double-ask, so it is suppressed for that navigation.
let suppressUnloadPrompt = false
window.addEventListener('beforeunload', (ev) => {
  if (suppressUnloadPrompt || !warnOnUnload()) return
  ev.preventDefault()
  ev.returnValue = ''
})

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * The signed-in user, or null when the session endpoint says so or cannot be
 * reached.
 * @returns {Promise<{id?:string,email?:string,name?:string}|null>}
 */
export const getSession = async () => {
  try {
    const res = await fetch('/api/auth/get-session', { credentials: 'include' })
    if (!res.ok) return null
    const body = await res.json()
    return body?.user ?? null
  } catch {
    return null
  }
}

// Every mounted entry, so a sign-out in one drawer clears the session line in
// the other.
const mounted = new Set()

/**
 * Mount the shared sign-in control into `container` and return its header row
 * so the caller can append its own controls (the AI drawer's gear).
 * @param {HTMLElement} container
 * @param {{hasLocalWork?: () => boolean, onSignOut?: () => (void|Promise<void>)}} [accountDeps]
 * @returns {{row: HTMLElement, refreshSession: () => Promise<void>}}
 */
export const mountSyncEntry = (container, { hasLocalWork = () => false, onSignOut = () => {} } = {}) => {
  warnOnUnload = hasLocalWork
  suppressUnloadPrompt = false
  const row = el('div', 'ai-header-row')
  const signIn = el('button', 'ai-button', 'Sign in to Sync')
  signIn.type = 'button'
  const sessionLine = el('span', 'ai-session', '')
  const signOut = el('button', 'ai-button', 'Sign out')
  signOut.type = 'button'
  signOut.style.display = 'none'
  row.append(signIn, sessionLine, signOut)
  container.append(row)

  const refreshSession = async () => {
    const user = await getSession()
    if (user) {
      signIn.style.display = 'none'
      sessionLine.textContent = `${user.email ?? user.name ?? 'user'}`
      signOut.style.display = ''
    } else {
      signIn.style.display = ''
      sessionLine.textContent = ''
      signOut.style.display = 'none'
    }
  }
  mounted.add(refreshSession)

  signIn.addEventListener('click', async () => {
    // The redirect reloads the page; confirm first so local-only work is not
    // dropped silently. The callback is the full current URL so the hash
    // (a #url= model) survives the round trip.
    if (hasLocalWork() && !window.confirm('Signing in reloads the page, and work kept only on this device will be lost. Continue?')) return
    const res = await fetch('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: window.location.href }),
    })
    const body = await res.json().catch(() => ({}))
    if (body?.url) {
      // The redirect reloads the page after the confirm above; the native
      // unload prompt would ask a second time, so silence it for this
      // navigation (tab close and manual reload still warn).
      suppressUnloadPrompt = true
      window.location.assign(body.url)
    } else {
      sessionLine.textContent = `Sign-in failed: ${body?.error ?? res.status}`
    }
  })

  signOut.addEventListener('click', async () => {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' }).catch(() => {})
    await onSignOut()
    // Both drawers show the session, so a sign-out here clears them together.
    await Promise.all([...mounted].map((refresh) => refresh()))
  })

  refreshSession()
  return { row, refreshSession }
}
