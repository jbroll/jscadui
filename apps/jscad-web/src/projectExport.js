import { strToU8, zipSync } from 'fflate'

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
