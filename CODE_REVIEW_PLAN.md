# JSCADUI Code Review Plan

A systematic approach to conducting broad and deep code review of the jscadui monorepo using automated agents and manual analysis.

## Codebase Overview

| Category | Count | Lines of Code |
|----------|-------|---------------|
| Core Packages | 27 | ~40,000 |
| Applications | 8 | ~20,000 |
| File Formats | 2 | ~3,000 |
| **Total** | **37 modules** | **~63,000 LOC** |

---

## Review Strategy

### Phase 1: Automated Broad Sweep

Use parallel agent execution to quickly identify issues across the entire codebase.

#### 1.1 Security Scan
**Agent:** `git-pr-workflows:code-reviewer`
**Focus:** OWASP Top 10, injection vulnerabilities, authentication/authorization issues

```
Packages to scan (high priority):
- packages/worker (code execution)
- packages/require (module loading)
- packages/fs-provider (file system access)
- packages/fs-serviceworker (service worker security)
- apps/jscad-web (production app)
```

**Checklist:**
- [ ] XSS vulnerabilities (innerHTML, document.write)
- [ ] Injection attacks (eval, Function constructor, SQL-like)
- [ ] Path traversal (../, file system access)
- [ ] SSRF (fetch to user-controlled URLs)
- [ ] Prototype pollution
- [ ] Insecure dependencies (npm audit, CVE scan)

#### 1.2 Code Quality Scan
**Agent:** `feature-dev:code-reviewer`
**Focus:** Bugs, logic errors, error handling

```
Run against all packages in parallel batches:
Batch 1: format-* packages (5 modules)
Batch 2: render-* packages (4 modules)
Batch 3: params-*, worker, require (6 modules)
Batch 4: UI packages (orbit, html-gizmo, scene, themes)
Batch 5: fs-*, postmessage, transform-babel
Batch 6: apps/* (8 modules)
Batch 7: file-format/* (2 modules)
```

**Checklist:**
- [ ] Unhandled errors / missing try-catch
- [ ] Race conditions / async issues
- [ ] Memory leaks (event listeners, timers, object URLs)
- [ ] Type errors / incorrect assumptions
- [ ] Dead code / unused exports
- [ ] Edge cases not handled

#### 1.3 Architecture Analysis
**Agent:** `feature-dev:code-explorer`
**Focus:** Design patterns, coupling, dependency flow

**Questions to answer:**
- [ ] What are the critical data flow paths?
- [ ] Where are the integration boundaries?
- [ ] What patterns are used consistently vs inconsistently?
- [ ] Are there circular dependencies?
- [ ] What's the public API surface of each package?

---

### Phase 2: Deep Dive Reviews

Manual + agent-assisted deep analysis of critical components.

#### 2.1 Worker System (Critical Path)
**Packages:** `worker`, `require`, `transform-babel`, `postmessage`

This is the code execution pipeline - highest risk area.

| Component | Risk | Review Focus |
|-----------|------|--------------|
| worker.js | Critical | Script execution, sandboxing, global state |
| require | Critical | Module resolution, URL validation, caching |
| transform-babel | High | Code transformation, error handling |
| postmessage | Medium | RPC protocol, timeout handling, message validation |

**Deep dive questions:**
- How is user code sandboxed (if at all)?
- What happens when module resolution fails?
- Can malicious scripts escape the worker context?
- Are there race conditions in the init sequence?

#### 2.2 Rendering Pipeline (Performance Critical)
**Packages:** `format-jscad`, `format-threejs`, `format-babylonjs`, `render-*`

| Component | Focus |
|-----------|-------|
| format-jscad | Geometry conversion correctness, memory efficiency |
| format-threejs | Three.js API usage, instancing |
| render-threejs | WebGL resource management, disposal |

**Deep dive questions:**
- Is geometry data transferred efficiently (zero-copy)?
- Are WebGL resources properly disposed?
- How does instanced rendering work?
- What happens with degenerate geometry?

#### 2.3 Production App (jscad-web)
**Path:** `apps/jscad-web`

Largest module (~20k LOC), user-facing, highest exposure.

| Area | Files | Focus |
|------|-------|-------|
| Bootstrap | main.js, index.html | Init sequence, error handling |
| Editor | editor/*.js | CodeMirror integration, state management |
| Worker comm | src/worker*.js | Message handling, timeouts |
| File handling | src/file*.js | Drag-drop, ZIP, remote fetch |
| Export | src/export*.js | Format conversion, download |
| UI | src/ui/*.js | DOM manipulation, events |

---

### Phase 3: Dependency & Infrastructure

#### 3.1 Dependency Audit
**Tool:** `npm audit`, WebSearch for CVEs

```bash
npm audit --workspace=packages/...
npm audit --workspace=apps/...
npm outdated
```

**Check for:**
- [ ] Known CVEs in dependencies
- [ ] Outdated major versions
- [ ] Unnecessary dependencies
- [ ] Bundle size impact

#### 3.2 Build & Test Infrastructure
**Review:**
- [ ] Test coverage gaps
- [ ] Build configuration consistency
- [ ] TypeScript strictness settings
- [ ] ESLint/Prettier configuration

---

### Phase 4: Cross-Cutting Concerns

#### 4.1 Error Handling Audit
**Agent:** `Explore` with Grep

```
Search patterns:
- catch blocks that swallow errors
- Promise chains without .catch()
- async functions without try/catch
- throw statements and their handlers
```

#### 4.2 Memory Management Audit
**Agent:** `Explore` with Grep

```
Search patterns:
- addEventListener without removeEventListener
- setInterval/setTimeout without clear
- URL.createObjectURL without revokeObjectURL
- new Worker without terminate
- requestAnimationFrame without cancel
```

#### 4.3 Browser Compatibility
**Manual + WebSearch**

```
Check for:
- ES2022+ features (Object.hasOwn, Array.at, etc.)
- WebGL2 vs WebGL1 assumptions
- Service Worker API compatibility
- Module/nomodule handling
```

---

## Execution Plan

### Recommended Order

| Order | Phase | Effort | Parallel? |
|-------|-------|--------|-----------|
| 1 | 1.1 Security Scan | 2-3 hours | Yes (5 agents) |
| 2 | 1.2 Code Quality | 3-4 hours | Yes (7 batches) |
| 3 | 3.1 Dependency Audit | 1 hour | No |
| 4 | 2.1 Worker Deep Dive | 2-3 hours | No |
| 5 | 2.3 jscad-web Deep Dive | 3-4 hours | No |
| 6 | 2.2 Rendering Deep Dive | 2-3 hours | No |
| 7 | 4.* Cross-cutting | 2-3 hours | Yes (3 agents) |
| 8 | 1.3 Architecture | 2 hours | No |

**Total estimated time:** 15-20 hours of agent work

### Agent Parallelization Strategy

For maximum efficiency, run these in parallel:

**Wave 1 (Broad):**
- 5x `code-reviewer` agents on high-risk packages
- 1x `Explore` agent mapping architecture

**Wave 2 (Batch):**
- 7x `code-reviewer` agents on package batches

**Wave 3 (Deep):**
- 1x `code-explorer` on worker system
- 1x `code-explorer` on rendering pipeline
- 1x `code-explorer` on jscad-web

**Wave 4 (Cross-cutting):**
- 3x `Explore` agents for error/memory/compat audits

---

## Output Format

Each review phase produces findings in this format:

```markdown
## [Package/Area Name]

### Critical Issues
| Severity | Type | Description | Location |
|----------|------|-------------|----------|
| Critical | Security | ... | file.js:123 |

### Recommendations
1. ...

### Code Snippets (if applicable)
```

---

## Tools Reference

### Available Agents

| Agent | Use Case |
|-------|----------|
| `git-pr-workflows:code-reviewer` | Security, bugs, code quality |
| `feature-dev:code-reviewer` | Bugs, logic errors, conventions |
| `feature-dev:code-explorer` | Architecture analysis, tracing flows |
| `tdd-workflows:code-reviewer` | Test coverage, test quality |
| `Explore` | Quick codebase searches |

### Search Tools

| Tool | Use Case |
|------|----------|
| `Grep` | Pattern search across files |
| `Glob` | Find files by pattern |
| `LSP` | Go to definition, find references |
| `WebSearch` | CVE lookups, API docs, best practices |

### Commands

```bash
# Dependency audit
npm audit --workspace=packages/worker

# Find potential XSS
grep -r "innerHTML" packages/ apps/

# Find event listeners
grep -r "addEventListener" packages/ --include="*.js" --include="*.ts"

# Check for eval usage
grep -rE "eval\(|Function\(" packages/ apps/
```

---

## Success Criteria

Review is complete when:

1. [ ] All 37 modules have been scanned by code-reviewer
2. [ ] Zero critical security issues remain unfixed
3. [ ] Worker system has deep dive documentation
4. [ ] jscad-web has deep dive documentation
5. [ ] All npm audit issues resolved or documented
6. [ ] Cross-cutting audits complete (error, memory, compat)
7. [ ] Findings consolidated into actionable issues

---

*Plan created: 2026-01-25*
