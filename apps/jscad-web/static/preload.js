// Load visible preferences immediately to prevent a flash of content. Kept in
// its own file so the app's `script-src 'self'` CSP needs no 'unsafe-inline'.
if (localStorage.getItem('engine.theme') === 'dark') {
  document.body.classList.add('dark')
}
if (localStorage.getItem('welcome.dismissed')) {
  document.getElementById('welcome').remove()
}
if (localStorage.getItem('editor.closed') === 'true' || window.innerWidth < 768) {
  document.getElementById('editor').classList.add('closed')
} else if (localStorage.getItem('editor.width')) {
  const editorWidth = localStorage.getItem('editor.width')
  document.getElementById('editor').style.width = `${editorWidth}px`
}
