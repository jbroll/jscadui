export const ACCEPT = 'ACCEPT'

export const SYSTEM_RULES = [
  'You are a person asking an assistant to build a 3D model. You are not technical about CAD.',
  'Speak only as the person described below. You know only the facts listed and nothing else.',
  'Never name APIs, code, functions or tools. Never suggest how to fix a problem; say what looks wrong or missing, as that person would.',
  'When asked a question, answer from the facts. If the facts are silent, say you do not mind.',
  'When judging a result, react as that person would: a size off from the facts, a feature the facts name that is missing, earlier work that was replaced.',
  'If you are satisfied, reply with exactly ACCEPT and nothing else. Otherwise reply with one short message to the assistant.',
].join('\n')

const REPORT_LIMIT = 4000
const ATTEMPTS = 3
// A cut-off, slow or refused-while-busy reply usually comes back on a second
// asking; a cut-off one with more room.
const RETRIED = new Set(['LengthError', 'TimeoutError'])
const isRetried = (error) => RETRIED.has(error?.name) || error?.status === 429 || error?.status >= 500

const system = (scenario) =>
  `${SYSTEM_RULES}\n\nPerson: ${scenario.persona}\nFacts:\n${scenario.facts.map((f) => `- ${f}`).join('\n')}`

const LABEL = { user: 'You', assistant: 'Assistant', question: 'Assistant asked' }
const transcript = (history) => history.map((h) => `${LABEL[h.role] ?? h.role}: ${h.text}`).join('\n')
const usage = (r) => ({ ms: r.ms, inputTokens: r.inputTokens, outputTokens: r.outputTokens })
// Models wrap the verdict in markdown or quotes, or add a remark below it.
const isAccept = (text) => {
  const first = text.split('\n').find((line) => line.trim() !== '') ?? ''
  return first.replace(/[*_`"'“”]/g, '').trim().replace(/[.!\s]+$/, '').toUpperCase() === ACCEPT
}

// `fallbacks` ({ model, maxTokens, vision }) take over, for the rest of the
// session, from a model that still fails after its attempts: a free model can
// pass the batch's probe and then go down.
export function createSimUser({ client, model, maxTokens, vision, scenario, retryDelayMs = 5000, fallbacks = [] }) {
  const models = [{ model, maxTokens, vision }, ...fallbacks]
  let current = 0

  const askModel = async ({ model: name, maxTokens: cap }, content) => {
    let budget = cap
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await client.complete({
          model: name,
          temperature: 0,
          maxTokens: budget,
          // The verdict needs little thought, and reasoning is what ran the budget out.
          reasoningEffort: 'low',
          messages: [
            { role: 'system', content: system(scenario) },
            { role: 'user', content },
          ],
        })
      } catch (error) {
        if (attempt >= ATTEMPTS || !isRetried(error)) throw error
        if (error.name === 'LengthError' && budget !== undefined) budget *= 2
        else await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt))
      }
    }
  }

  // `contentFor` builds the message for the model asked, which may not read images.
  const ask = async (contentFor) => {
    for (;;) {
      try {
        return await askModel(models[current], contentFor(models[current]))
      } catch (error) {
        if (!isRetried(error) || current >= models.length - 1) throw error
        current += 1
      }
    }
  }

  return {
    async answer(question, history) {
      const r = await ask(() => `Conversation so far:\n${transcript(history)}\n\nThe assistant asks: ${question}\n\nYour answer:`)
      return { text: r.text.trim(), call: usage(r) }
    },

    async critique({ history, finalText, report, images }) {
      const text =
        `Conversation so far:\n${transcript(history)}\n\nThe assistant's latest reply:\n${finalText}\n\n` +
        `Build report:\n${JSON.stringify(report).slice(0, REPORT_LIMIT)}\n\n` +
        `Judge the result. Reply ${ACCEPT} if satisfied, otherwise one short message.`
      const r = await ask((asked) =>
        asked.vision && images?.length ? [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] : text,
      )
      const accepted = isAccept(r.text)
      return { accepted, text: accepted ? null : r.text.trim(), call: usage(r) }
    },
  }
}
