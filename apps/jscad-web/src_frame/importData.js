// Keep in step with BINARY_EXT in src/projectFiles.js, which decides what
// crosses to the frame as an ArrayBuffer.
const FONT_EXT = new Set(['ttf', 'otf'])
const BINARY_EXT = new Set(['stl', ...FONT_EXT])

// A fetched binary file arrives as an x-user-defined string (see fileMap.js),
// a project file as an ArrayBuffer.
const toBytes = (content) =>
  typeof content === 'string' ? Uint8Array.from(content, (c) => c.charCodeAt(0) & 0xff) : new Uint8Array(content)

/**
 * What require() does with a non-JS file. A font file (`use <font.ttf>`) comes
 * back as bytes for j$.useFont; anything else goes to @jscad/io.
 * @param {() => Record<string, Function>} ioDeserializers
 */
export const createImportData = (ioDeserializers) => ({
  isBinaryExt: (ext) => BINARY_EXT.has(ext.toLowerCase()),
  deserialize: ({ url, filename, ext }, fileContent) => {
    if (FONT_EXT.has(ext.toLowerCase())) return toBytes(fileContent)
    const deserializer = ioDeserializers()[ext]
    if (!deserializer) throw new Error('unsupported format in ' + url)
    return deserializer({ output: 'geometry', filename }, fileContent)
  },
})
