# Current Fix

**Issue:** format-twgl is empty and render-twgl uses format-regl
**Phase:** 2 | **Severity:** Critical
**Package:** format-twgl, render-twgl
**Location:** format-twgl/index.js, render-twgl/index.js

## Analysis

### format-twgl is empty
```javascript
export function CommonToTwgl () {

}
```
No implementation at all.

### render-twgl uses format-regl
```javascript
import { CommonToRegl } from '@jscadui/format-regl'
```
The render-twgl package imports from format-regl instead of format-twgl. The function is even named `RenderRegl`.

## Decision Required

This needs owner decision:
1. **Implement format-twgl** - Create a proper twgl-specific format adapter
2. **Remove both packages** - If TWGL support is not planned, remove format-twgl and render-twgl
3. **Rename to regl** - If render-twgl is intentionally using regl, rename it appropriately

## Status

Skipping for now - requires architectural decision from owner.

---

# Next Issue

**Issue:** format-threejs missing instanceMatrix.needsUpdate
**Phase:** 2 | **Severity:** High
**Package:** format-threejs
**Location:** index.js:68-75
