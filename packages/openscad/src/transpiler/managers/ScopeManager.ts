/** Saved function bindings, restored when a nested scope ends */
export interface FunctionBindingsSnapshot {
  bindings: Map<string, string>
  declared: Set<string>
}

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

  /**
   * Names bound by a function declaration nested in a module or function, as
   * opposed to a parameter (also registered, so a function-valued argument can
   * be called). Only a declaration shadows a builtin function of the same name:
   * OpenSCAD keeps functions and variables in separate namespaces.
   */
  private declaredFunctionNames = new Set<string>()

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
  registerFunctionBinding(originalName: string, renamedName: string, isFunctionLiteral = false, isDeclaration = false): void {
    this.functionBindings.set(originalName, renamedName)
    if (isFunctionLiteral) this.functionLiteralNames.add(originalName)
    if (isDeclaration) this.declaredFunctionNames.add(originalName)
    else this.declaredFunctionNames.delete(originalName)
  }

  /**
   * Unregister a let-bound function
   */
  unregisterFunctionBinding(originalName: string): void {
    this.functionBindings.delete(originalName)
    this.declaredFunctionNames.delete(originalName)
  }

  /** Whether `name` is bound by a nested function declaration (not a parameter) */
  isDeclaredFunction(name: string): boolean {
    return this.declaredFunctionNames.has(name)
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
  snapshotFunctionBindings(): FunctionBindingsSnapshot {
    return { bindings: new Map(this.functionBindings), declared: new Set(this.declaredFunctionNames) }
  }

  /**
   * Restore function bindings from a snapshot.
   * Use this when leaving a nested scope to undo local registrations
   * and restore any outer bindings that were shadowed.
   */
  restoreFunctionBindings(snapshot: FunctionBindingsSnapshot): void {
    this.functionBindings = snapshot.bindings
    this.declaredFunctionNames = snapshot.declared
    // Rebuild functionLiteralNames to match restored bindings
    // (only names in the snapshot can be function literals)
    for (const name of [...this.functionLiteralNames]) {
      if (!snapshot.bindings.has(name)) this.functionLiteralNames.delete(name)
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
    copy.declaredFunctionNames = new Set(this.declaredFunctionNames)
    copy.counter = this.counter
    return copy
  }
}
