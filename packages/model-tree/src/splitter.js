// Split a built model tree into parts: one entry per root child, except that
// root children linked by anchor references (attach/alignTo params, pending
// anchor descriptors) co-locate under a single joint-scheduling key.

const isTreeNode = (value) => Boolean(value && value.isTreeNode === true)
const isFluentArray = (value) => Boolean(value && typeof value === 'object' && value.isFluentArray === true)

// Flatten the root to root children. Nested and fluent arrays spread; keys are
// the array path (`[...path, i].join('/')`), so a flat root yields '0', '1'.
const collectChildren = (value, path, out) => {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) collectChildren(value[i], [...path, i], out)
    return
  }
  if (isFluentArray(value)) {
    let i = 0
    for (const item of value) { collectChildren(item, [...path, i], out); i++ }
    return
  }
  out.push({ key: path.join('/'), node: value })
}

// Deep scan of a params value for node references. Nodes are recorded by
// identity and not traversed into here; the map walk already covers subtrees.
const scanNodes = (value, visit, seen) => {
  if (!value || typeof value !== 'object') return
  if (isTreeNode(value)) { visit(value); return }
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) scanNodes(item, visit, seen)
    return
  }
  if (isFluentArray(value)) {
    for (const item of value) scanNodes(item, visit, seen)
    return
  }
  for (const item of Object.values(value)) scanNodes(item, visit, seen)
}

// Record every reachable node object against the root child it belongs to.
// The first root child to reach a node seeds its index; a later child that
// reaches the same node is another owner, so the two indices union instead of
// the second being dropped. Root children are seeded first so a shared node
// keeps its own index.
const walkNodes = (node, index, map, seen, uf) => {
  if (!isTreeNode(node)) return
  const owner = seen.get(node)
  if (owner !== undefined) {
    if (owner !== index) uf.union(owner, index)
    return
  }
  seen.set(node, index)
  if (!map.has(node)) map.set(node, index)
  if (node.children) {
    for (const child of node.children) walkNodes(child, index, map, seen, uf)
  }
  if (node.params) {
    scanNodes(node.params, (ref) => walkNodes(ref, index, map, seen, uf), new Set())
  }
}

const unionFind = (size) => {
  const parent = Array.from({ length: size }, (_, i) => i)
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
    return x
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  return { find, union }
}

export const splitParts = (root) => {
  const children = []
  if (root !== undefined && root !== null && !Array.isArray(root) && !isFluentArray(root)) {
    collectChildren(root, [0], children)
  } else {
    collectChildren(root, [], children)
  }
  if (children.length === 0) return []

  const map = new Map()
  children.forEach((entry, index) => map.set(entry.node, index))

  const uf = unionFind(children.length)
  const seen = new Map()
  children.forEach((entry, index) => walkNodes(entry.node, index, map, seen, uf))

  for (const [node, index] of map) {
    const linked = (ref) => {
      const other = map.get(ref)
      if (other !== undefined) uf.union(index, other)
    }
    if ((node.op === 'attach' || node.op === 'alignTo') && node.params) {
      scanNodes(node.params, linked, new Set())
    }
    const pending = node.anchors && node.anchors.pending
    if (Array.isArray(pending)) {
      for (const descriptor of pending) {
        if (descriptor && descriptor.node) linked(descriptor.node)
      }
    }
  }

  const groups = new Map()
  for (let i = 0; i < children.length; i++) {
    const rootIndex = uf.find(i)
    const members = groups.get(rootIndex)
    if (members) members.push(i)
    else groups.set(rootIndex, [i])
  }

  return [...groups.values()].map((members) => ({
    key: members.map((i) => children[i].key).join('+'),
    nodes: members.map((i) => children[i].node),
  }))
}
