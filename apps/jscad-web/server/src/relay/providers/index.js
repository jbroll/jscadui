// Provider hook table for the single relay endpoint family
// (`POST|GET /api/relay/:kind/*`). `routes.ts` dispatches every relay request
// here by its wire `kind`; the hook owns that kind's protocol. Plain JS with
// JSDoc and node:/relative imports only, so plain `node` loads it and tsc
// (allowJs/checkJs) type-checks and emits it into dist/.
import { defaultHook } from './default.js'
import { jscadHook } from './jscad.js'

/** The wire kind the free jscad-web provider is served under. */
export const JSCAD_WEB_KIND = 'jscad-web'

/**
 * What `routes.ts` hands every hook: the process-wide singletons a hook needs
 * that are built (or shared) once per mounted relay.
 * @typedef {object} RelayContext
 * @property {(entry: Record<string, unknown>) => void} logger
 * @property {typeof fetch} fetchFn
 * @property {(host: string) => Promise<Array<{ address: string }>>} [dnsLookup]
 * @property {(req: import('express').Request, res: import('express').Response) => boolean} corsFor
 * @property {{ check(key: string): { ok: true } | { ok: false, retryAfterSec: number } }} limiter
 * @property {() => Record<string, string>} readAllowlist
 * @property {{ write(record: Record<string, unknown>): void } | null} log
 * @property {() => import('../inference.js').InferenceConfig} readInference
 * @property {import('../meter.js').Meter | null} meter
 * @property {Map<string, number>} inFlight
 */

/**
 * @typedef {(ctx: RelayContext, req: import('express').Request, res: import('express').Response, kind: string, subPath: string) => void | Promise<void>} RelayHandler
 */

/**
 * @typedef {object} RelayHook
 * @property {RelayHandler} [serveGET] serve a GET of this kind, or leave it unserved
 * @property {RelayHandler} servePOST serve a POST of this kind
 */

/**
 * The hook that serves a wire `kind`: the jscad-web free specialization, or the
 * own-key passthrough every other kind uses.
 * @param {string} kind
 * @returns {RelayHook}
 */
export const getHook = (kind) => (kind === JSCAD_WEB_KIND ? jscadHook : defaultHook)
