// A user message may carry `images: [{ mime, dataUrl, width?, height? }]`
// beside its text, the shape a `view` tool message uses.

// The newest user images ride along while their message is one of this many
// newest user messages, the new one included.
export const USER_IMAGE_TURNS = 3

export const hasImages = (message) => Array.isArray(message?.images) && message.images.length > 0

const sendable = (image) => typeof image?.dataUrl === 'string' && image.dataUrl !== ''

const describe = (image) => `${image?.mime ?? 'image'}${image?.width && image?.height ? `, ${image.width}x${image.height}` : ''}`

export const imageLabel = (image) => `[image: ${describe(image)}]`

export const imageNote = (image) => `[earlier image, no longer attached: ${describe(image)}]`

const withNotes = (message, images) => {
  const { images: _images, ...rest } = message
  if (images.length === 0) return rest
  const notes = images.map(imageNote).join('\n')
  return { ...rest, content: rest.content ? `${rest.content}\n\n${notes}` : notes }
}

// Keeps pixels only on the newest image-bearing user message, and only while
// it is recent; every other image becomes a short note in its message's text.
// Returns new messages; the input is never mutated.
export const pruneUserImages = (messages, turns = USER_IMAGE_TURNS) => {
  const users = messages.flatMap((m, i) => (m.role === 'user' ? [i] : []))
  const newest = users.findLast((i) => hasImages(messages[i]))
  const recent = newest !== undefined && users.length - users.indexOf(newest) <= turns
  return messages.map((m, i) => {
    if (m.role !== 'user' || !hasImages(m)) return m
    if (i !== newest || !recent) return withNotes(m, m.images)
    const unsent = m.images.filter((image) => !sendable(image))
    if (unsent.length === 0) return m
    const kept = m.images.filter(sendable)
    const noted = withNotes(m, unsent)
    return kept.length > 0 ? { ...noted, images: kept } : noted
  })
}

export const userImageChars = (messages) =>
  messages
    .filter((m) => m.role === 'user' && hasImages(m))
    .flatMap((m) => m.images)
    .reduce((n, image) => n + (typeof image?.dataUrl === 'string' ? image.dataUrl.length : 0), 0)
