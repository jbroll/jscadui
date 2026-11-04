import { strToU8, zipSync } from 'fflate'
import { exportsMaker } from './projectBuild.js'

export const EXPORT_VIEW = '.export-view.js'
export const CAPTURES = '__jscadExportCaptures'

export const makerFiles = files =>
  Object.keys(files).filter(path => typeof files[path] === 'string' && exportsMaker(files[path]))

// The entry loads last so its load-time destructuring binds the wrappers.
// Run state is module-scoped: a rerun of main on the same load calls the wrappers the cached entry bound first.
export const exportScript = (entry, paths) => `const makerFiles = ${JSON.stringify(paths.filter(path => path !== entry))}
let captures
let pending
let depth
const main = async (params) => {
  captures = globalThis[${JSON.stringify(CAPTURES)}] = []
  pending = []
  depth = 0
  const originals = []
  try {
    for (const file of makerFiles) {
      const mod = require('./' + file)
      for (const maker of Object.keys(mod)) {
        const original = mod[maker]
        // Babel's \`export { x } from\` is a getter-only property; its source file gets wrapped instead.
        if (!/^make[A-Z]/.test(maker) || typeof original !== 'function' || !Object.getOwnPropertyDescriptor(mod, maker)?.writable) continue
        originals.push([mod, maker, original])
        mod[maker] = function (...args) {
          const outer = depth === 0
          depth++
          let ret
          try {
            ret = original.apply(this, args)
          } finally {
            depth--
          }
          if (outer) {
            const record = { maker, file }
            const captured = captures
            captures.push(record)
            // A rejection reaches main through its own await; drop the record instead of leaving it unhandled.
            pending.push(Promise.resolve(ret).then(value => { record.value = value }, () => captured.splice(captured.indexOf(record), 1)))
          }
          return ret
        }
      }
    }
    const value = await require(${JSON.stringify(`./${entry}`)}).main(params)
    await Promise.all(pending)
    return value
  } finally {
    for (const [mod, maker, original] of originals) mod[maker] = original
  }
}
module.exports = { main }
`

// A run saves its buffer without marking it clean, so dirty means differs from the saved text.
export const unsavedEdits = (buffers, files) =>
  buffers.some(([path, text]) => {
    const bare = path.replace(/^\//, '')
    return bare in files && files[bare] !== text
  })

export const partName = maker => {
  const name = maker.replace(/^make/, '')
  return name[0].toLowerCase() + name.slice(1)
}

const sameBytes = (x, y) => x.length === y.length && x.every((v, i) => v === y[i])

const fileBase = file => file.split('/').pop().replace(/\.js$/, '')

export const stlEntries = parts => {
  const makers = new Map()
  for (const { maker, file, data } of parts) {
    const key = `${file}\0${maker}`
    if (!makers.has(key)) makers.set(key, { maker, file, outputs: [] })
    const { outputs } = makers.get(key)
    const seen = outputs.find(o => sameBytes(o.data, data))
    if (seen) seen.count++
    else outputs.push({ data, count: 1 })
  }

  const nameCount = {}
  for (const { maker } of makers.values()) nameCount[partName(maker)] = (nameCount[partName(maker)] ?? 0) + 1

  const entries = {}
  for (const { maker, file, outputs } of makers.values()) {
    const part = partName(maker)
    const base = nameCount[part] > 1 ? `${fileBase(file)}-${part}` : part
    outputs.forEach(({ data, count }, i) => {
      const number = outputs.length > 1 ? `-${i + 1}` : ''
      const times = count > 1 ? `-x${count}` : ''
      entries[`stl/${base}${number}${times}.stl`] = data
    })
  }
  return entries
}

export const zipProject = ({ name, files, params, assembly, parts }) => {
  const entries = {}
  for (const [path, content] of Object.entries(files)) {
    entries[path] = typeof content === 'string' ? strToU8(content) : content
  }
  entries['params.json'] = strToU8(JSON.stringify(params, null, 2))
  const assemblyPath = `stl/${name}.stl` in parts ? `stl/${name}-assembly.stl` : `stl/${name}.stl`
  entries[assemblyPath] = assembly
  Object.assign(entries, parts)
  return zipSync(entries)
}
