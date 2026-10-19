// Part references shared by measure, check and the app's view: an index into
// the array main() returns ("0"), an index range ("1-3"), or a part name an
// anchor frame carries (a dotted param path such as front.left). Pure, with no
// geometry imports, so the app imports it without @jscad/modeling.

const INDEX_SELECTOR = /^\d+(-\d+)?$/

export const isIndexSelector = (ref) => typeof ref === 'string' && INDEX_SELECTOR.test(ref)

// The dot-separated segments of a name, or null when it cannot name a part:
// empty segments, `/` and `..` read as no match rather than something surprising.
const segmentsOf = (name) => {
  if (typeof name !== 'string' || name === '' || name.includes('/')) return null
  const segments = name.split('.')
  return segments.every((segment) => segment !== '' && segment !== '..') ? segments : null
}

// Whole-segment suffix, so `left` names `front.left` but not `front.leftover`.
const endsWithSegments = (path, nameSegments) => {
  const pathSegments = path.split('.')
  if (nameSegments.length > pathSegments.length) return false
  const offset = pathSegments.length - nameSegments.length
  return nameSegments.every((segment, i) => pathSegments[offset + i] === segment)
}

/**
 * The names a part name picks out of `names`: itself on an exact match, else
 * every name it is a whole-segment suffix of. More than one is ambiguous; the
 * caller says so rather than guessing.
 * @param {string} name
 * @param {Iterable<string>} names
 * @returns {string[]}
 */
export const matchPartName = (name, names) => {
  const nameSegments = segmentsOf(name)
  if (!nameSegments) return []
  const all = [...new Set(names)].filter((n) => typeof n === 'string')
  if (all.includes(name)) return [name]
  return all.filter((n) => endsWithSegments(n, nameSegments))
}

const NAMES_LISTED = 20

/**
 * The reference forms a model with `count` parts and these part names takes,
 * for an error that tells the agent what it could have said instead.
 * @param {number} count
 * @param {Iterable<string>} names
 */
export const partRefForms = (count, names) => {
  const index = count > 1 ? `"0" to "${count - 1}"` : '"0"'
  const all = [...new Set(names)]
  const listed = all.slice(0, NAMES_LISTED).join(', ')
  const more = all.length > NAMES_LISTED ? `, and ${all.length - NAMES_LISTED} more` : ''
  const nameForm = all.length > 0 ? `a part name: ${listed}${more}` : "a part name; this model's parts carry no part names"
  return `an index ${index} into the array main() returns, a range like "1-3", or ${nameForm}`
}
