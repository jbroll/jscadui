// Test-only stand-in for eval/describer/describe.py: the same JSON lines, no model.
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

if (process.env.FAKE_DESCRIBER_FATAL) {
  send({ fatal: process.env.FAKE_DESCRIBER_FATAL, blockedConnections: 0 })
  process.exit(2)
}
// FAKE_DESCRIBER_HANG never sends ready, simulating a model load that never finishes.
if (!process.env.FAKE_DESCRIBER_HANG) send({ ready: true, model: 'fake', kestrel: '0.9.1', loadMs: 0 })
for await (const line of createInterface({ input: process.stdin })) {
  if (process.env.FAKE_DESCRIBER_CRASH) process.exit(3)
  const { id, image, prompt } = JSON.parse(line)
  if (!existsSync(image)) send({ id, error: `no image at ${image}` })
  else send({ id, text: ` described ${prompt.split('.')[0]} `, ms: 1, inputTokens: 10, outputTokens: 5 })
}
send({ done: true, blockedConnections: Number(process.env.FAKE_DESCRIBER_BLOCKED ?? 0) })
