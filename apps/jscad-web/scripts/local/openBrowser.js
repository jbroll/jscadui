// Best-effort browser open for the local startup script. Never throws:
// headless environments just keep the printed URL.
import { spawn } from 'node:child_process'

const commandFor = (platform) => {
  if (platform === 'darwin') return ['open']
  if (platform === 'win32') return ['cmd', '/c', 'start', '""']
  return ['xdg-open']
}

export const openBrowser = async (url, opts = {}) => {
  const cmd = commandFor(opts.platform ?? process.platform)
  try {
    const child = (opts.spawn ?? spawn)(cmd[0], [...cmd.slice(1), url], { detached: true, stdio: 'ignore' })
    child.unref()
  } catch { /* no browser available; URL is already printed */ }
}
