# OpenSCAD Corpus Organization Plan

## Overview

Organize 552+ .scad test files from `test/corpus/` into browsable examples at `apps/jscad-web/examples/openscad/` while maintaining provenance tracking for updates.

## Current Corpus Structure

```
test/corpus/
├── bosl/          146 files - BOSL v1 library
├── bosl2/         263 files - BOSL2 library
├── snippet/       122 files - Community snippets
├── lib/             1 file  - Shared libraries
└── text/            1 file  - Text rendering tests
```

## Target Examples Structure

```
apps/jscad-web/examples/openscad/
├── 01-basics/              # Already exists (manual curated examples)
├── bosl/
│   ├── 01-transforms/      # Files 001-030
│   ├── 02-shapes/          # Files 031-060
│   ├── 03-advanced/        # Files 061-090
│   ├── 04-utilities/       # Files 091-120
│   └── 05-misc/            # Files 121-146
├── bosl2/
│   ├── 01-core/            # Files 001-030
│   ├── 02-shapes-3d/       # Files 031-060
│   ├── 03-shapes-2d/       # Files 061-090
│   ├── 04-attachments/     # Files 091-120
│   ├── 05-rounding/        # Files 121-150
│   ├── 06-paths/           # Files 151-180
│   ├── 07-beziers/         # Files 181-210
│   ├── 08-threading/       # Files 211-240
│   └── 09-misc/            # Files 241-263
└── snippets/
    ├── 01-basic/           # Files 001-030
    ├── 02-intermediate/    # Files 031-060
    ├── 03-advanced/        # Files 061-090
    └── 04-misc/            # Files 091-122
```

## Metadata Tracking System

### 1. Corpus Manifest (`test/corpus/manifest.json`)

Track source repository and update information:

```json
{
  "version": "1.0.0",
  "lastUpdated": "2026-02-19",
  "sources": {
    "bosl": {
      "repository": "https://github.com/revarbat/BOSL",
      "commit": "abc123...",
      "branch": "master",
      "importDate": "2026-01-15",
      "fileCount": 146,
      "notes": "BOSL v1 library - stable release"
    },
    "bosl2": {
      "repository": "https://github.com/BelfrySCAD/BOSL2",
      "commit": "def456...",
      "branch": "master",
      "importDate": "2026-02-08",
      "fileCount": 263,
      "notes": "BOSL2 library - partial compatibility"
    },
    "snippet": {
      "repository": "multiple",
      "sources": [
        {"name": "Asset_SCAD", "url": "https://github.com/..."},
        {"name": "Animation_SCAD", "url": "https://github.com/..."}
      ],
      "importDate": "2026-01-20",
      "fileCount": 122,
      "notes": "Community snippets from various sources"
    }
  }
}
```

### 2. Batch Metadata (per batch directory)

Each batch directory contains a `.corpus-meta.json`:

```json
{
  "batchNumber": 1,
  "category": "bosl",
  "subcategory": "transforms",
  "fileRange": "001-030",
  "totalFiles": 30,
  "sourceDir": "test/corpus/bosl",
  "files": [
    {
      "name": "001-move.scad",
      "originalPath": "test/corpus/bosl/001-move.scad",
      "size": 1234,
      "lastModified": "2026-01-15"
    }
  ]
}
```

## Implementation Scripts

### Script 1: `bin/organize-corpus.js`

Organizes corpus files into batches:

```javascript
// Usage: node bin/organize-corpus.js [options]
// Options:
//   --dry-run        Show what would be copied without copying
//   --category=bosl  Only process specific category
//   --batch-size=30  Files per batch (default: 30)
```

**Algorithm:**
1. Read `test/corpus/manifest.json` for provenance
2. For each corpus category:
   - List all .scad files (sorted)
   - Group into batches of 25-30 files
   - Create batch directories with numbered prefixes
   - Copy files with metadata
   - Generate `.corpus-meta.json` for each batch

### Script 2: `bin/update-corpus.js`

Updates corpus from source repositories:

```javascript
// Usage: node bin/update-corpus.js [category]
// Fetches latest from source repos and updates test/corpus
```

### Script 3: `bin/verify-corpus.js`

Verifies integrity and finds missing files:

```javascript
// Usage: node bin/verify-corpus.js
// Compares test/corpus with examples/openscad batches
```

## Batch Organization Strategy

### Intelligent Grouping (Better than pure alphabetical)

Rather than just alphabetical batches, organize by **functionality**:

**BOSL categories:**
1. `01-transforms` - move, rot, scale, mirror, skew operations
2. `02-shapes` - Basic primitives and shape creation
3. `03-advanced` - Complex geometry operations
4. `04-utilities` - Helper functions and utilities
5. `05-misc` - Everything else

**BOSL2 categories:**
1. `01-core` - Core transforms and distributors (100-series tests)
2. `02-shapes-3d` - 3D shapes (200-series tests)
3. `03-shapes-2d` - 2D shapes (250-series tests)
4. `04-attachments` - Attachment system (300-series)
5. `05-rounding` - Rounding and masks (400-series)
6. `06-paths` - Path operations (500-series)
7. `07-beziers` - Bezier curves (550-series)
8. `08-threading` - Threaded parts (600-series)
9. `09-misc` - Miscellaneous

**Snippets categories:**
1. `01-basic` - Simple demonstrations
2. `02-intermediate` - Medium complexity
3. `03-advanced` - Complex examples
4. `04-misc` - Uncategorized

## File Naming Convention

Within each batch directory:
```
01-move.scad                    # Descriptive name retained
02-rot.scad
03-scale.scad
...
```

Prefix with numbers for ordering in the demo browser.

## Demo Browser Integration

The existing demo browser will automatically:
1. Discover new batch directories
2. Show hierarchical navigation: `bosl > 01-transforms > files`
3. Support [ALL] button to load all files in a batch
4. Display metadata from `.corpus-meta.json`

## Migration Path

### Phase 1: Setup (Now)
- Create manifest.json template
- Write organize-corpus.js script
- Test with one category (snippets - smallest)

### Phase 2: Organization (Next)
- Run organize-corpus.js for all categories
- Verify file counts and metadata
- Update .gitignore if needed

### Phase 3: Documentation (Final)
- Document in README
- Add update procedures
- Create GitHub Actions workflow for corpus updates

## Benefits

1. **Provenance Tracking**: Know where each file came from
2. **Easy Updates**: Script-based updates from source repos
3. **Organized Browsing**: Functional grouping, not just alphabetical
4. **Scalability**: Easy to add new categories
5. **Verification**: Scripts to ensure integrity
6. **Demo Integration**: Works with existing demo browser

## Open Questions

1. Should we exclude certain test files (e.g., those that fail)?
2. Do we want git submodules for source repos instead?
3. Should batch size be strict (30) or flexible (25-30)?
4. Include STL reference files in metadata?
