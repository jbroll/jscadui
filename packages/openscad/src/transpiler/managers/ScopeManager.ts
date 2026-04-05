/**
 * Manages lexical scoping for let bindings and for-loop variables.
 */
export class ScopeManager {
  /** Scope stack for variable bindings (maps original name -> renamed name) */
  private scopeStack: Map<string, string>[] = []

  /** Let-bound functions (maps original name -> renamed suffixed name) */
  private functionBindings = new Map<string, string>()

  /** Names explicitly assigned a function literal value (for isFunctionLiteralExpr checks) */
  private functionLiteralNames = new Set<string>()

  /** Counter for unique let binding suffixes */
  private counter = 1

  /**
   * Generate a unique scope suffix ($1, $2, etc.)
   */
  generateSuffix(): string {
    const suffix = `$${this.counter}`
    this.counter++
    return suffix
  }

  /**
   * Push a new scope level
   */
  pushScope(bindings: Map<string, string>): void {
    this.scopeStack.push(bindings)
  }

  /**
   * Pop the current scope level
   */
  popScope(): void {
    this.scopeStack.pop()
  }

  /**
   * Look up a variable in the scope stack (innermost to outermost)
   */
  lookupBinding(name: string): string | undefined {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const binding = this.scopeStack[i].get(name)
      if (binding) return binding
    }
    return undefined
  }

  /**
   * Register a let-bound function
   * @param isFunctionLiteral - true if the binding is explicitly a function literal value
   */
  registerFunctionBinding(originalName: string, renamedName: string, isFunctionLiteral = false): void {
    this.functionBindings.set(originalName, renamedName)
    if (isFunctionLiteral) this.functionLiteralNames.add(originalName)
  }

  /**
   * Unregister a let-bound function
   */
  unregisterFunctionBinding(originalName: string): void {
    this.functionBindings.delete(originalName)
  }

  /**
   * Look up a function binding
   */
  lookupFunctionBinding(name: string): string | undefined {
    return this.functionBindings.get(name)
  }

  /**
   * Check if a name is known to hold a function literal value.
   * Unlike lookupFunctionBinding, this is definitive — identity bindings
   * from parameters are not included.
   */
  isKnownFunctionLiteral(name: string): boolean {
    return this.functionLiteralNames.has(name)
  }

  /**
   * Snapshot the current function bindings for save/restore.
   * Use this when entering a nested scope that may shadow outer bindings.
   */
  snapshotFunctionBindings(): Map<string, string> {
    return new Map(this.functionBindings)
  }

  /**
   * Restore function bindings from a snapshot.
   * Use this when leaving a nested scope to undo local registrations
   * and restore any outer bindings that were shadowed.
   */
  restoreFunctionBindings(snapshot: Map<string, string>): void {
    this.functionBindings = snapshot
    // Rebuild functionLiteralNames to match restored bindings
    // (only names in the snapshot can be function literals)
    for (const name of [...this.functionLiteralNames]) {
      if (!snapshot.has(name)) this.functionLiteralNames.delete(name)
    }
  }

  /**
   * Get current scope depth (for debugging)
   */
  get scopeDepth(): number {
    return this.scopeStack.length
  }

  /**
   * Create a deep copy for nested contexts
   */
  clone(): ScopeManager {
    const copy = new ScopeManager()
    copy.scopeStack = this.scopeStack.map(scope => new Map(scope))
    copy.functionBindings = new Map(this.functionBindings)
    copy.functionLiteralNames = new Set(this.functionLiteralNames)
    copy.counter = this.counter
    return copy
  }
}
