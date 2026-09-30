// Grading for `complex` fixtures, which declare `gates` in place of `checks`: the gates,
// then geometry from a verdict on a blind description of the renders (eval/describe.js, eval/judge.js).
import { isRecord, NO_GRADE } from './executor-protocol.js'
import { geometryError, gradedModel, gradeTranscript, requiresWrite } from './grade.js'
import { meshSha256 } from './mesh.js'

export const isComplex = (fixture) => typeof fixture?.gates === 'function'

// Each body's bounding box grows this much on every side before the overlap test.
export const GROW_MM = 0.5

export const complexProbe = (fixture) => ({ ...fixture.probe, bodies: fixture.probe?.bodies ?? {} })

export const userMessagesOf = (fixture) => [fixture.prompt, ...(fixture.followUps ?? []).map((f) => f.message)]

const overlap = ([aLo, aHi], [bLo, bHi], grow) => [0, 1, 2].every((k) => aLo[k] - grow < bHi[k] + grow && bLo[k] - grow < aHi[k] + grow)

// A test for parts that float clear, not for contact: a part inside another's box joins it.
export const connectedGroups = (bodies, grow = GROW_MM) => {
  const parent = bodies.map((_, i) => i)
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (let a = 0; a < bodies.length; a += 1) {
    for (let b = a + 1; b < bodies.length; b += 1) {
      if (overlap(bodies[a].boundingBox, bodies[b].boundingBox, grow)) parent[find(a)] = find(b)
    }
  }
  return new Set(bodies.map((_, i) => find(i))).size
}

export const harnessGates = ({ measure, solid, probe }, pieces = 1) => {
  const builds = isRecord(measure)
  const groups = builds && Array.isArray(probe?.bodies) ? connectedGroups(probe.bodies) : 0
  return [
    { name: 'builds', pass: builds },
    { name: 'watertight', pass: builds && solid?.watertight === true },
    { name: 'connected', pass: groups >= 1 && groups <= pieces, groups },
  ]
}

const gatesOf = (fixture, graded) => [
  ...harnessGates(graded, fixture.pieces ?? 1),
  ...fixture.gates(graded.measure, { solid: graded.solid, probe: graded.probe ?? null, params: graded.params ?? [] }),
]

// A grade the gates cannot read (model code can shape the one it is measured in) grades nothing.
export const complexGates = (fixture, graded) => {
  try {
    return gatesOf(fixture, graded)
  } catch {
    return gatesOf(fixture, { ...NO_GRADE(), probe: null })
  }
}

export const complexGeometry = (gates, verdict) => (verdict?.success !== true ? 0 : gates.every((g) => g.pass) ? 2 : 1)

export const settledReport = (report, gates, verdict) => {
  const unwritten = report.wrote === false
  const geometry = unwritten ? 0 : complexGeometry(gates, verdict)
  const passed = gates.filter((g) => g.pass).length + (verdict?.success === true ? 1 : 0)
  const dimensions = { ...report.dimensions, geometry }
  return {
    ...report,
    dimensions,
    total: dimensions.discipline + dimensions.recovery + geometry + dimensions.conservation,
    checkRate: unwritten ? 0 : passed / (gates.length + 1),
  }
}

export const complexReport = (fixture, transcript, gates, { maxTurns, providerError = false } = {}) => {
  const { dimensions, firstAttemptFailures } = gradeTranscript(fixture, transcript, { maxTurns })
  const unwritten = requiresWrite(fixture) && !gradedModel(fixture, transcript)
  const report = { dimensions: { ...dimensions, geometry: 0 }, total: 0, firstAttemptFailures, checkRate: 0, ...(unwritten && !providerError ? { wrote: false } : {}) }
  return settledReport(report, gates, null)
}

// Pending while the run has renders and neither a verdict nor a graderError.
export const settleRun = (run) => {
  const { verdictPending: _was, ...rest } = run
  const pending = Boolean(rest.render) && !rest.renderError && rest.verdict == null && !rest.graderError
  return {
    ...rest,
    ...(pending ? { verdictPending: true } : {}),
    ...(rest.report ? { report: settledReport(rest.report, rest.gates ?? [], pending ? null : rest.verdict) } : {}),
  }
}

export const renderFacts = (graded) => ({
  dimensions: graded.measure.dimensions.map((d) => Math.round(d)),
  bodies: graded.probe?.bodies?.length ?? 0,
})

export const renderRecord = (graded, views) => ({ meshSha256: meshSha256(graded.mesh.parts), facts: renderFacts(graded), views })

// Gates, then three renders of a model that built, drawn by `render(parts, { fixture, run })`.
export async function scoreComplex(fixture, run, transcript, graded, { maxTurns, providerError = false, render } = {}) {
  const gates = complexGates(fixture, graded)
  const fields = { userMessages: userMessagesOf(fixture), gates, description: null, verdict: null }
  if (gates[0].pass) {
    const mesh = graded.mesh
    if (!mesh) fields.renderError = 'no mesh came back with the grade'
    else if (mesh.error) fields.renderError = mesh.error
    else if (!render) fields.renderError = 'no renderer'
    else {
      try {
        fields.render = renderRecord(graded, await render(mesh.parts, { fixture: fixture.name, run }))
      } catch (error) {
        fields.renderError = `render failed: ${error.message}`
      }
    }
  }
  const { report, ...settled } = settleRun({ report: complexReport(fixture, transcript, gates, { maxTurns, providerError }), ...fields })
  return { report, fields: settled, geometryError: geometryError(fixture.target, graded.measure) }
}
