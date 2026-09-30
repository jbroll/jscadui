import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESCRIBE_PY = fileURLToPath(new URL('./describer/describe.py', import.meta.url))
const SETUP = fileURLToPath(new URL('../../../scripts/describer-setup.sh', import.meta.url))
const hasPython = spawnSync('python3', ['--version']).status === 0

// Loads describe.py as a module (kestrel is imported only inside main()), then tries the guard.
const GUARD_CHECK = `
import importlib.util, socket, sys
spec = importlib.util.spec_from_file_location("describe", sys.argv[1])
describe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(describe)
blocked = describe.install_connection_guard()
server = socket.socket()
server.bind(("127.0.0.1", 0))
server.listen(1)
local = socket.socket()
local.connect(server.getsockname())
local.close()
outside = socket.socket()
try:
    outside.connect(("203.0.113.7", 443))
    print("connected")
except ConnectionRefusedError:
    print("refused")
print(socket.socket().connect_ex(("198.51.100.1", 80)) != 0, len(blocked))
print(describe.is_loopback("::1"), describe.is_loopback("localhost"), describe.is_loopback("api.moondream.ai"))
`

describe.skipIf(!hasPython)('describe.py', () => {
  it('refuses every connection but loopback and counts the refusals', () => {
    const out = spawnSync('python3', ['-c', GUARD_CHECK, DESCRIBE_PY], { encoding: 'utf8' })
    expect(out.stderr).toBe('')
    expect(out.stdout).toBe('refused\nTrue 2\nTrue True False\n')
  })
})

describe('describer-setup.sh --check', () => {
  it('names the missing venv and fails', () => {
    const home = mkdtempSync(join(tmpdir(), 'describer-home-'))
    const out = spawnSync('bash', [SETUP, '--check'], { encoding: 'utf8', env: { ...process.env, DESCRIBER_HOME: home } })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain(`describer: no venv at ${join(home, 'venv')}`)
  })
})
