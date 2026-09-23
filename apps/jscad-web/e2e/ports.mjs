// Every e2e server sits at a fixed offset from JSCAD_WEB_PORT, which build.js
// also reads, so concurrent CI jobs on one host each take their own block of four.
export const BASE_PORT = Number(process.env.JSCAD_WEB_PORT) || 5120

export const APP_PORT = BASE_PORT
export const RUN_PORT = BASE_PORT + 1
export const MARK_PORT = BASE_PORT + 2
export const ATTACKER_PORT = BASE_PORT + 3

export const APP_ORIGIN = `http://localhost:${APP_PORT}`
export const RUN_ORIGIN = `http://localhost:${RUN_PORT}`
export const MARK_ORIGIN = `http://localhost:${MARK_PORT}`
export const ATTACKER_ORIGIN = `http://localhost:${ATTACKER_PORT}`
