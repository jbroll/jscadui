/** The `items` array of a generated ALL.js, or null if the source is not one. */
export function gridItems(source) {
  const match = source.match(/^const items = (\[[\s\S]*?\])$/m)
  return match ? JSON.parse(match[1]) : null
}

/**
 * Split grid files into the ones with models of their own and the aggregates,
 * whose every item is another ALL.js. An aggregate reruns grids the pool
 * already covers, all in one worker, so it must not share the box with them.
 * @param {{rel: string}[]} files
 * @param {(rel: string) => string} readSource
 */
export function splitAggregateGrids(files, readSource) {
  const grids = [], aggregates = []
  for (const file of files) {
    const items = gridItems(readSource(file.rel))
    const aggregate = items?.length > 0 && items.every(item => item.endsWith('/ALL.js'))
    ;(aggregate ? aggregates : grids).push(file)
  }
  return { grids, aggregates }
}
