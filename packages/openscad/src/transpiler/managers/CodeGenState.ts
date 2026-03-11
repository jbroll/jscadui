/**
 * Tracks which JSCAD primitives, transforms, and helpers are used.
 * Used to generate minimal import statements.
 */
export class CodeGenState {
  readonly usedPrimitives = new Set<string>()
  readonly usedTransforms = new Set<string>()
  readonly usedBooleans = new Set<string>()
  readonly usedExtrusions = new Set<string>()
  readonly usedHelpers = new Set<string>()

  usedColors = false
  usedHulls = false
  usedMaths = false
  usedMinMax = false
  hasTopLevelGeometry = false  // Track if file has top-level geometry (for include optimization)

  /**
   * Create a deep copy for nested contexts
   */
  clone(): CodeGenState {
    const copy = new CodeGenState()
    for (const p of this.usedPrimitives) copy.usedPrimitives.add(p)
    for (const t of this.usedTransforms) copy.usedTransforms.add(t)
    for (const b of this.usedBooleans) copy.usedBooleans.add(b)
    for (const e of this.usedExtrusions) copy.usedExtrusions.add(e)
    for (const h of this.usedHelpers) copy.usedHelpers.add(h)
    copy.usedColors = this.usedColors
    copy.usedHulls = this.usedHulls
    copy.usedMaths = this.usedMaths
    copy.usedMinMax = this.usedMinMax
    copy.hasTopLevelGeometry = this.hasTopLevelGeometry
    return copy
  }

  /**
   * Merge usage from another context (for nested transpilations)
   */
  mergeFrom(other: CodeGenState): void {
    for (const p of other.usedPrimitives) this.usedPrimitives.add(p)
    for (const t of other.usedTransforms) this.usedTransforms.add(t)
    for (const b of other.usedBooleans) this.usedBooleans.add(b)
    for (const e of other.usedExtrusions) this.usedExtrusions.add(e)
    for (const h of other.usedHelpers) this.usedHelpers.add(h)
    this.usedColors = this.usedColors || other.usedColors
    this.usedHulls = this.usedHulls || other.usedHulls
    this.usedMaths = this.usedMaths || other.usedMaths
    this.usedMinMax = this.usedMinMax || other.usedMinMax
    this.hasTopLevelGeometry = this.hasTopLevelGeometry || other.hasTopLevelGeometry
  }
}
