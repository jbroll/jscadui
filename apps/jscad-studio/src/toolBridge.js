// Routes an agent tool request to the part of the app that can serve it: the
// compute frame, the live viewer, or the storage seam. Every path answers with
// a JSON result; a failure is a result, never a throw, so the chat panel always
// has something to POST back to the server.
import { calcCamPos, getCommonRotCombined } from '@jscadui/orbit'

const DEFAULT_ENTRY = 'main.js'

const errorResult = (error) => ({
  ok: false,
  error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
})

// The frame's payloads do not all match the tool schemas the model sees:
// measure takes its options object under `options`, and eval's source is the
// single entry file the frame loads.
const frameRequest = async (name, input, frame) => {
  const payload = input ?? {}
  if (name === 'eval') {
    const entry = payload.entry ?? DEFAULT_ENTRY
    return frame.load({ files: { [entry]: payload.source }, entry })
  }
  if (name === 'measure') return frame.measure({ options: payload })
  const command = { params: 'params', check: 'check', export: 'export' }[name]
  if (!command) return errorResult({ name: 'UnknownToolError', message: `unknown tool ${name}` })
  return frame[command](payload)
}

// A preset is a rotation about the current target; the distance stays put so
// the shot is framed like the one the user is looking at.
const presetCamera = (preset, viewer) => {
  const current = viewer.getCamera()
  const target = current.target ?? [0, 0, 0]
  const position = current.position ?? [0, 0, 0]
  const len = Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2])
  const [rx, rz] = getCommonRotCombined(preset)
  return { position: calcCamPos({ target, len, rx, rz }), target }
}

const handleView = async (input, viewer) => {
  const { camera, preset } = input ?? {}
  const next = camera ?? (preset ? presetCamera(preset, viewer) : undefined)
  if (next) viewer.setCamera(next)
  const image = await viewer.capture()
  return { ok: true, image, camera: viewer.getCamera() }
}

const handleWriteModel = async (input, save) => {
  const { source, entry = DEFAULT_ENTRY, message } = input ?? {}
  await save(source, entry)
  return { ok: true, entry, message }
}

/**
 * @param {string} name
 * @param {object} [input]
 * @param {{frame:object,viewer:object,save:Function}} deps
 */
export const handleToolRequest = async (name, input, { frame, viewer, save }) => {
  try {
    if (name === 'view') return await handleView(input, viewer)
    if (name === 'writeModel') return await handleWriteModel(input, save)
    return await frameRequest(name, input, frame)
  } catch (error) {
    return errorResult(error)
  }
}