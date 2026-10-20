export const VIEWS = ['iso-front', 'iso-back', 'top']
export const EMPTY_REPLY = 'simulated user returned an empty reply'

const NO_GEOMETRY = { passed: 0, total: null, failed: [], noGeometry: true }

const blank = (text) => typeof text !== 'string' || text.trim() === ''

// Mirrors the eval's gradeProject: a failed check passes `solid` as null.
async function runChecks(driver, scenario) {
  if (!scenario.checks) return null
  const m = await driver.measure({}).catch(() => null)
  if (!m?.ok) return { ...NO_GEOMETRY }
  const solid = await driver.check({}).catch(() => null)
  const outcomes = scenario.checks(m, { solid: solid?.ok ? solid : null })
  return {
    passed: outcomes.filter((c) => c.pass).length,
    total: outcomes.length,
    failed: outcomes.filter((c) => !c.pass).map((c) => c.name),
  }
}

export async function runSession({ driver, scenario, simUser, maxUserTurns = 3, turnTimeoutMs }) {
  const result = { userTurns: 0, accepted: false, timedOut: false, error: null, checks: null, simUserCalls: [], views: [] }
  const history = []
  // The driver may swallow or rewrap an onQuestion rejection; this keeps the cause.
  let questionError = null

  const say = async (text) => {
    await driver.send(text)
    result.userTurns++
    history.push({ role: 'user', text })
  }

  const onQuestion = async (question) => {
    try {
      const r = await simUser.answer(question, [...history])
      result.simUserCalls.push(r.call)
      if (blank(r.text)) throw new Error(EMPTY_REPLY)
      history.push({ role: 'question', text: question }, { role: 'user', text: r.text })
      return r.text
    } catch (e) {
      questionError ??= e
      throw e
    }
  }

  // One view per call, so a dropped or failed shot cannot shift another's name.
  const shoot = async (turn) => {
    const taken = []
    for (const name of VIEWS) {
      const shot = await driver.view({ views: [{ preset: name }] }).then((r) => r?.shots?.[0], () => null)
      if (shot?.image?.dataUrl) taken.push({ turn, name, dataUrl: shot.image.dataUrl })
    }
    result.views.push(...taken)
    return taken.map((v) => v.dataUrl)
  }

  try {
    await say(scenario.prompt)
    for (;;) {
      let turnError = null
      try {
        const turn = await driver.waitTurn({ timeoutMs: turnTimeoutMs, onQuestion })
        if (turn.timedOut) result.timedOut = true
        if (questionError) throw questionError
        turnError = turn.error ?? null
      } catch (e) {
        // The builder's turn may still be running in the page.
        await Promise.resolve().then(() => driver.stop()).catch(() => {})
        throw e
      }
      if (result.timedOut) await driver.stop()
      if (turnError) throw new Error(turnError)
      if (result.timedOut) break
      const images = await shoot(result.userTurns)
      const report = await driver.buildReport()
      const finalText = await driver.lastAssistantText()
      const verdict = await simUser.critique({ history: [...history], finalText, report, images })
      result.simUserCalls.push(verdict.call)
      history.push({ role: 'assistant', text: finalText })
      if (verdict.accepted) {
        result.accepted = true
        break
      }
      if (blank(verdict.text)) throw new Error(EMPTY_REPLY)
      if (result.userTurns >= maxUserTurns) break
      await say(verdict.text)
    }
    result.checks = await runChecks(driver, scenario)
  } catch (e) {
    const cause = questionError ?? e
    result.error = cause?.message ?? String(cause)
  }
  return result
}
