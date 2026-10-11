/**
 * Per-file code generation flags.
 */
export class CodeGenState {
  hasTopLevelGeometry = false  // Track if file has top-level geometry (for include optimization)

  /**
   * Create a deep copy for nested contexts
   */
  clone(): CodeGenState {
    const copy = new CodeGenState()
    copy.hasTopLevelGeometry = this.hasTopLevelGeometry
    return copy
  }

  /**
   * Merge state from another context (for nested transpilations)
   */
  mergeFrom(other: CodeGenState): void {
    this.hasTopLevelGeometry = this.hasTopLevelGeometry || other.hasTopLevelGeometry
  }
}
