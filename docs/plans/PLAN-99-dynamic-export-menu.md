# Plan: Derive Export Menu from Configured Serializers (#99)

## Overview
Dynamically build the export format menu from the actual serializers configured in the worker, instead of maintaining a static list.

## Current Problem
The export menu in `exporter.js` is a static array that can get out of sync with the serializers configured in the worker bundle. This led to issues like:
- DXF was listed but had no serializer
- X3D had a typo ('x3b' vs 'x3d')

## Proposed Solution

### Phase 1: Worker API Extension

Add format metadata to serializer configuration in the worker:

```javascript
// In worker or worker config
const serializerConfig = {
  stla: { label: 'STL (ascii)', extension: 'stl', mimeType: 'text/plain' },
  stlb: { label: 'STL (binary)', extension: 'stl', mimeType: 'application/octet-stream' },
  amf: { label: 'AMF', extension: 'amf', mimeType: 'text/plain' },
  // ... etc
}
```

### Phase 2: Expose Available Formats

Modify `jscadInit` response to include available formats:

```javascript
// Worker response
{
  success: true,
  availableFormats: [
    { id: 'stla', label: 'STL (ascii)', extension: 'stl' },
    { id: 'stlb', label: 'STL (binary)', extension: 'stl' },
    // ... only formats with configured serializers
  ]
}
```

### Phase 3: Dynamic Menu Building

Update `exporter.js` to build menu from worker response:

```javascript
export const init = async (newWorkerApi) => {
  workerApi = newWorkerApi

  // Get available formats from worker
  const { availableFormats } = await workerApi.jscadGetFormats()

  // Build menu dynamically
  const exportFormats = availableFormats.map(format => ({
    name: format.id,
    label: format.label,
    execute: () => exportAsFile(format.id, format.extension)
  }))

  // Add non-serializer options
  exportFormats.push({
    name: 'scriptUrl',
    label: 'Copy to clipboard script url',
    execute: () => exportToScriptUrl()
  })

  // Populate dropdown
  for (const format of exportFormats) {
    const option = document.createElement('option')
    option.value = format.name
    option.text = format.label
    exportFormatSelect.appendChild(option)
  }
}
```

## Implementation Steps

### Phase 1: Worker Changes (3-4 hours)
**Files:** `packages/worker/worker.js`

1. [ ] Create serializer metadata registry
2. [ ] Add `jscadGetFormats` message handler
3. [ ] Return only formats with valid serializers

### Phase 2: Type Definitions (1 hour)
**Files:** `packages/worker/types.d.ts`

1. [ ] Add FormatMetadata type
2. [ ] Update JscadWorker interface
3. [ ] Document new message type

### Phase 3: Exporter Changes (2 hours)
**Files:** `apps/jscad-web/src/exporter.js`

1. [ ] Call worker to get formats on init
2. [ ] Build menu dynamically
3. [ ] Remove static format array

### Phase 4: Testing (2 hours)
1. [ ] Verify all formats appear in menu
2. [ ] Verify export works for each format
3. [ ] Test error handling for missing serializers

## Benefits
- Single source of truth for available formats
- No manual sync between worker config and UI
- Prevents "format not found" errors
- Easier to add new formats

## Considerations
- Requires async init (already the case)
- Slightly more complex initialization
- Worker must be initialized before building menu

## Dependencies
- Builds on #100 (centralized format identifiers)
- Can share format metadata with ExportFormatMeta

## Estimated Total Effort
8-10 hours
