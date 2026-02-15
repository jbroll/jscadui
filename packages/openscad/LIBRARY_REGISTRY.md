OpenSCAD Web-Library Distribution Architecture
1. Repository Structure (Source)
Each OpenSCAD library is maintained as a standard GitHub repository. A package.json is added to provide metadata for the npm registry.
text

/
├── .github/workflows/publish.yml   # Automation: Publishes to npm on tag
├── src/                            # SCAD source files
│   ├── std.scad                    # Entry point (includes others)
│   ├── geometry.scad
│   └── constants.scad
├── package.json                    # Library metadata & versioning
└── README.md                       # Documentation

2. The Packaging Manifest (package.json)
The package.json treats .scad files as assets. By defining the files array, we ensure only the necessary source code is distributed.
json

{
  "name": "@openscad-libs/bolts",
  "version": "1.0.0",
  "description": "Parametric bolt library for OpenSCAD",
  "main": "src/std.scad",
  "files": [ "src" ],
  "repository": {
    "type": "git",
    "url": "https://github.com"
  }
}

3. Automation Pipeline (GitHub Actions)
When a developer pushes a new version tag (e.g., v1.0.0), GitHub Actions automates the npm release.
yaml

name: Publish to npm
on:
  push:
    tags:
      - 'v*'
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 'latest'
          registry-url: 'https://registry.npmjs.org'
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

4. Delivery via CDN (The Runtime)
Once published to npm, the library is instantly available globally via jsDelivr. This avoids the "GitHub Raw" rate limits and provides edge caching.

    Shorthand URL: https://cdn.jsdelivr.net
    Version Aliasing: .../bolts@latest/src/std.scad (Always gets the newest version).

5. Browser Implementation (Virtual File System)
In the browser (using openscad-wasm), a lightweight loader interceptor maps shorthands to CDN URLs and populates the internal memory.
javascript

async function loadLibrary(packageName, version = "latest") {
  // 1. Resolve URL
  const url = `https://cdn.jsdelivr.net{packageName}@${version}/src/std.scad`;
  
  // 2. Fetch code
  const response = await fetch(url);
  const code = await response.text();
  
  // 3. Mount to WASM Virtual File System
  // This allows 'use <bolts/std.scad>' to work in the editor
  instance.FS.writeFile(`/libraries/${packageName}/std.scad`, code);
}
