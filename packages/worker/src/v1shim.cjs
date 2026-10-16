/**
 * V1 compatibility shim: V1-named modeling functions over chainable geometry.
 *
 * Base vendored from `jscad-community/jscad-migrate` (`v1shim.js` @ 76664d2),
 * MIT-licensed (see notice below), with attribution. Substrate rebased from
 * `@jscad/modeling` to `@jbroll/jscad-fluent`: every constructor returns a
 * fluent geometry, so V1 method-chaining (`obj.translate()`, `obj.rotateX()`,
 * `p.subtract(q)`) works natively. Signature normalization (scalar sizes,
 * `r`→`radius`, `fn`→`segments`, `center:true`) is preserved from upstream.
 * To re-sync with upstream, diff against:
 * https://github.com/jscad-community/jscad-migrate/blob/master/v1shim.js
 *
 * Upstream license (MIT, © jscad-community contributors):
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, subject to including this notice in all copies.
 */

const jf = require('@jbroll/jscad-fluent')
const { colorNameToRgb } = require('@jscad/modeling').colors
const { degToRad } = require('@jscad/modeling').utils

// V1 method names missing from the fluent surface, installed once on the
// fluent prototypes (same technique as wrapFluentMethods in optionChecks).
let aliasesInstalled = false
function installV1Aliases() {
  if (aliasesInstalled) return
  aliasesInstalled = true
  for (const proto of [jf.FluentGeom3?.prototype, jf.FluentGeom2?.prototype]) {
    if (!proto) continue
    if (!proto.mirroredX) {
      proto.mirroredX = function () { return this.mirrorX() }
      proto.mirroredY = function () { return this.mirrorY() }
      proto.mirroredZ = function () { return this.mirrorZ() }
    }
    // V1 getBounds() returns [{x,y,z},{x,y,z}]; measureBoundingBox gives arrays.
    if (!proto.getBounds) {
      proto.getBounds = function () {
        const [[mix, miy, miz], [max, may, maz]] = this.measureBoundingBox()
        return [{ x: mix, y: miy, z: miz }, { x: max, y: may, z: maz }]
      }
    }
    if (!proto.setColor) {
      proto.setColor = function (c) { return color(c, this) }
    }
  }
  const p2 = jf.FluentGeom2?.prototype
  // V1 cag.extrude({offset:[x,y,z]}); only z-offsets are supported.
  if (p2 && !p2.extrude) {
    p2.extrude = function ({ offset }) {
      const [x = 0, y = 0, z = 0] = offset
      if (x !== 0 || y !== 0) throw new Error('v1shim.extrude: only z-offset supported')
      return this.extrudeLinear({ height: z })
    }
  }
}

const flat = (args) => args.flat()

module.exports = {
  color: (color, obj) => {
    installV1Aliases()
    if (typeof color === 'string') {
      return obj.colorize(colorNameToRgb(color))
    } else {
      return obj.colorize(color)
    }
  },
  cube: (opt) => {
    installV1Aliases()
    if (typeof opt === 'number') {
      opt = { size: opt }
    }
    if (Number.isFinite(opt.size)) {
      opt.size = [opt.size, opt.size, opt.size]
    }
    if (opt.center === undefined) {
      opt.center = [opt.size[0] / 2, opt.size[1] / 2, opt.size[2] / 2]
    } else if (opt.center === true) {
      delete opt.center
    }
    // rounded cube; V2 default rounding segments apply
    if (opt.radius) {
      if (opt.fn) opt.segments = opt.fn
      return jf.roundedCuboid({ ...opt, roundRadius: opt.radius })
    }
    return jf.cuboid(opt)
  },
  cylinder: (opt) => {
    installV1Aliases()
    const rot = [0, 0, 0]
    const center = [0, 0, 0]
    if (opt.start && opt.end) {
      center[0] = (opt.start[0] + opt.end[0]) / 2
      center[1] = (opt.start[1] + opt.end[1]) / 2
      center[2] = (opt.start[2] + opt.end[2]) / 2
      const dx = opt.end[0] - opt.start[0]
      const dy = opt.end[1] - opt.start[1]
      const dz = opt.end[2] - opt.start[2]
      opt.height = Math.hypot(dx, dy, dz)
      rot[0] = Math.asin(-dy / opt.height)
      rot[1] = Math.atan2(dx / opt.height, dz / opt.height)
    }
    if (opt.fn) {
      opt.segments = opt.fn
    }
    if (opt.r) {
      opt.radius = opt.r
    }
    if (opt.r1 === 0) {
      opt.r1 = 0.01
    }
    if (opt.r2 === 0) {
      opt.r2 = 0.01
    }
    const cyl = (opt.r1 && opt.r2)
      ? jf.cylinderElliptic({ ...opt, startRadius: [opt.r1, opt.r1], endRadius: [opt.r2, opt.r2] })
      : jf.cylinder(opt)
    return cyl.translate(center).rotate(rot)
  },
  difference: (...args) => {
    installV1Aliases()
    const [first, ...rest] = flat(args)
    return first.subtract(...rest)
  },
  intersection: (...args) => {
    installV1Aliases()
    return jf.intersect(...flat(args))
  },
  linear_extrude: (opts, obj) => {
    installV1Aliases()
    return obj.extrudeLinear(opts)
  },
  polygon: (opt) => {
    installV1Aliases()
    if (Array.isArray(opt)) {
      return jf.polygon(opt)
    } else {
      return jf.polygon(opt.points ?? opt)
    }
  },
  rotate: (r, obj) => {
    installV1Aliases()
    return obj.rotate(r.map(degToRad))
  },
  sphere: (opt) => {
    installV1Aliases()
    // V1 and V2 spheres both default to centered at the origin; only
    // center:true needs mapping (V2 default is already centered).
    if (opt.center === true) {
      delete opt.center
    }
    if (opt.r) {
      opt.radius = opt.r
    }
    if (opt.fn) {
      opt.segments = opt.fn
    }
    return jf.sphere(opt)
  },
  translate: (offset, obj) => {
    installV1Aliases()
    return obj.translate(offset)
  },
  union: (...args) => {
    installV1Aliases()
    return jf.union(...flat(args))
  }
}
