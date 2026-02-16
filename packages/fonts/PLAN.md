1. OpenSCAD text capabilities — distilled

What OpenSCAD gives you out of the box

High-level text() primitive

One call produces 2D filled glyph outlines.

Parameters: font, size, spacing, halign, valign, direction, language, script.

Native TTF/OTF support

Uses system or local font files.

Full Bézier outlines → tessellated polygons.

Broad Unicode coverage (subject to font).

Solid-ready geometry

Output is already a closed 2D region.

Directly usable with linear_extrude(), offset(), minkowski(), booleans.

Deterministic and declarative

Same input → same mesh.

No external dependencies or runtime font parsing logic.

Limitations (important for comparison)

No stroke fonts (engraving/plotter style) without hacks.

No font introspection or runtime glyph logic.

Tessellation quality is global, not per-glyph adaptive.

2. Design goal for JSCAD

Recreate OpenSCAD-level text ergonomics in JSCAD, while:

Preserving JSCAD’s procedural strengths

Supporting both outline fonts and stroke (Hershey) fonts

Making text a first-class, composable geometry primitive

Target user experience:

text2d("Hello", {
  font: "Inter-Regular.ttf",
  size: 20,
  halign: "center",
  valign: "baseline"
}).extrude(5)

3. Architectural plan for JSCAD text
Layer 1 — Font ingestion
A. Outline fonts (TTF / OTF)

Use opentype.js to load fonts (Node + browser compatible).

For each glyph:

Convert Bézier contours → polyline approximation

Preserve winding order (outer vs hole)

Key outputs:

Array<Polygon2D> per glyph

Glyph metrics: advance width, bearings, ascender/descender

B. Stroke fonts (Hershey-style)

Use existing JSCAD Hershey font data.

Normalize API so both font types return:

glyph.outlines[] (for filled)

glyph.strokes[] (for single-line)

This allows one text layout engine for both.

Layer 2 — Text layout engine

Implements OpenSCAD-equivalent semantics.

Responsibilities

Unicode codepoint iteration

Kerning (for outline fonts)

Line breaking

Alignment and anchoring

Direction (LTR initially; RTL later)

Internal representation:

GlyphPlacement {
  geometry: Polygon2D[] | Path2D[]
  x, y
}


Alignment rules:

halign: left | center | right

valign: top | center | baseline | bottom

Baseline handling is critical for parity with OpenSCAD.

Layer 3 — Geometry synthesis
Outline mode (default)

Union glyph polygons per line

Output:

geom2 (filled, watertight)

Safe for booleans and extrusion

Stroke mode

Two options:

Pure stroke output

Return path2 objects

Ideal for CNC / plotters / laser

Stroke expansion

Offset strokes by strokeWidth/2

Join caps (round / square)

Convert to geom2

This cleanly exceeds OpenSCAD’s capabilities.

Layer 4 — Public API
text2d(str, {
  font,
  size,
  spacing,
  lineHeight,
  halign,
  valign,
  mode: "outline" | "stroke",
  strokeWidth
})


Returns an object with fluent helpers:

text2d("A").extrude(5)
text2d("B").offset(0.3)


Internally, these just wrap existing JSCAD modeling ops.

4. Implementation phases (practical roadmap)
Phase 1 — MVP (OpenSCAD parity)

TTF loading via opentype.js

ASCII + Latin-1 support

Filled outlines → geom2

Linear extrusion

Phase 2 — Quality & correctness

Kerning pairs

Hole preservation

Adaptive curve subdivision

Robust union strategy (avoid polygon self-intersections)

Phase 3 — Differentiators

Native Hershey + outline unification

Stroke → solid expansion

Font caching and memoization

Deterministic tessellation controls

Phase 4 — Advanced typography (optional)

RTL scripts

Ligatures

Text-on-path

Per-glyph transforms