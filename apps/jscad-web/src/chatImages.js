// Images the user attaches to a chat message, downscaled and re-encoded in the
// browser before they are sent.

export const MAX_CHAT_IMAGES = 4
// Anthropic's advised long side; larger images are resized by the provider anyway.
export const MAX_IMAGE_SIDE = 1568
// Four of these fit the relay's 1 MB body (server/src/relay/body.ts) beside the
// text and a view render; agent-loop's MAX_VIEW_IMAGE_CHARS shares that room.
export const MAX_IMAGE_CHARS = 120_000

const JPEG_QUALITIES = [0.85, 0.7, 0.55]
const SHRINK = 0.75
const MIN_SIDE = 256

export const fitWithin = (width, height, maxSide = MAX_IMAGE_SIDE) => {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const mimeOf = (dataUrl) => dataUrl.slice(5, dataUrl.indexOf(';'))

/**
 * Encodes at the fitted size, as PNG when the source is PNG and that fits, else
 * as JPEG at falling quality, shrinking the size until the data URL fits.
 * `encode({width, height}, mime, quality)` answers a data URL.
 */
export const encodeWithin = ({ width, height, sourceMime }, encode, { maxSide = MAX_IMAGE_SIDE, maxChars = MAX_IMAGE_CHARS, minSide = MIN_SIDE } = {}) => {
  let size = fitWithin(width, height, maxSide)
  const done = (dataUrl) => ({ mime: mimeOf(dataUrl), dataUrl, ...size })
  if (sourceMime === 'image/png') {
    const png = encode(size, 'image/png')
    if (png.length <= maxChars) return done(png)
  }
  for (;;) {
    for (const quality of JPEG_QUALITIES) {
      const jpeg = encode(size, 'image/jpeg', quality)
      if (jpeg.length <= maxChars) return done(jpeg)
    }
    if (Math.max(size.width, size.height) <= minSide) throw new Error(`the image is too large to send, even at ${size.width}x${size.height}`)
    size = { width: Math.max(1, Math.round(size.width * SHRINK)), height: Math.max(1, Math.round(size.height * SHRINK)) }
  }
}

const decodeFile = (file) => createImageBitmap(file)

const canvasEncoder = (bitmap) => {
  const canvas = document.createElement('canvas')
  return ({ width, height }, mime, quality) => {
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    context.imageSmoothingQuality = 'high'
    // JPEG has no alpha: a transparent PNG would turn black.
    if (mime === 'image/jpeg') {
      context.fillStyle = '#fff'
      context.fillRect(0, 0, width, height)
    }
    context.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL(mime, quality)
  }
}

/** @returns {Promise<{mime:string,dataUrl:string,width:number,height:number}>} */
export const prepareImage = async (file, { decode = decodeFile, encoder = canvasEncoder } = {}) => {
  if (!file?.type?.startsWith('image/')) throw new Error(`${file?.name ?? 'the file'} is not an image`)
  let bitmap
  try {
    bitmap = await decode(file)
  } catch {
    throw new Error(`could not read ${file.name}`)
  }
  try {
    return encodeWithin({ width: bitmap.width, height: bitmap.height, sourceMime: file.type }, encoder(bitmap))
  } finally {
    bitmap.close?.()
  }
}

export const imageFiles = (list) => [...(list ?? [])].filter((file) => file?.type?.startsWith('image/'))
