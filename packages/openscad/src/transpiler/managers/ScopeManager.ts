/**
 * Manages lexical scoping for let bindings and for-loop variables.
 */
export class ScopeManager {
  /** Scope stack for variable bindings (maps original name -> renamed name) */
  private scopeStack: Map<string, string>[] = []

  /** Let-bound functions (maps original name -> renamed suffixed name) */
  private functionBindings = new Map<string, string>()

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
   */
  registerFunctionBinding(originalName: string, renamedName: string): void {
    this.functionBindings.set(originalName, renamedName)
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
    copy.counter = this.counter
    return copy
  }
}
