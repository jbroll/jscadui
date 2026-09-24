const isDisposable = (g) => g?.isManifoldGeom3 === true

// OpenSCAD has no geometry values, so an op's inputs are dead once it returns,
// and the FinalizationRegistry never runs during a synchronous main().
export const consuming = (op) => (...args) => {
  const result = op(...args)
  let kept
  for (const g of args.flat(Infinity)) {
    if (!isDisposable(g)) continue
    kept ??= new Set([result].flat(Infinity))
    if (!kept.has(g)) g.dispose()
  }
  return result
}
