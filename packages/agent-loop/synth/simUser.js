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

const system = (scenario) =>
  `${SYSTEM_RULES}\n\nPerson: ${scenario.persona}\nFacts:\n${scenario.facts.map((f) => `- ${f}`).join('\n')}`

const LABEL = { user: 'You', assistant: 'Assistant', question: 'Assistant asked' }
const transcript = (history) => history.map((h) => `${LABEL[h.role] ?? h.role}: ${h.text}`).join('\n')
const usage = (r) => ({ ms: r.ms, inputTokens: r.inputTokens, outputTokens: r.outputTokens })
const isAccept = (text) => text.trim().replace(/[.!\s]+$/, '').toUpperCase() === ACCEPT

export function createSimUser({ client, model, maxTokens, vision, scenario }) {
  const ask = (content) =>
    client.complete({
      model,
      temperature: 0,
      maxTokens,
      messages: [
        { role: 'system', content: system(scenario) },
        { role: 'user', content },
      ],
    })

  return {
    async answer(question, history) {
      const r = await ask(`Conversation so far:\n${transcript(history)}\n\nThe assistant asks: ${question}\n\nYour answer:`)
      return { text: r.text.trim(), call: usage(r) }
    },

    async critique({ history, finalText, report, images }) {
      const text =
        `Conversation so far:\n${transcript(history)}\n\nThe assistant's latest reply:\n${finalText}\n\n` +
        `Build report:\n${JSON.stringify(report).slice(0, REPORT_LIMIT)}\n\n` +
        `Judge the result. Reply ${ACCEPT} if satisfied, otherwise one short message.`
      const content = vision && images?.length
        ? [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]
        : text
      const r = await ask(content)
      const accepted = isAccept(r.text)
      return { accepted, text: accepted ? null : r.text.trim(), call: usage(r) }
    },
  }
}
