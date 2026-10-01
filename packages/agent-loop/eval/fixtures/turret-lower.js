// The turret follow-up from the 2026-09-30 log (chat 8d3c5d92), which the provider refused three times:
// lower the turret, drive azimuth in one reduction from a Pelton wheel outside it, and altitude from the back.
const TURRET = `const jf = require('@jbroll/jscad-fluent')
const TAU = Math.PI * 2

// ---------- helpers ----------
function gearOutlinePoints(m, z) {
  const Rp = m * z / 2
  const Ro = Rp + m * 0.9
  const Rr = Math.max(Rp - m * 1.0, 2)
  const pitch = TAU / z
  const hr = pitch / 4 * 1.18
  const ht = pitch / 4 * 0.62
  const pts = []
  for (let i = 0; i < z; i++) {
    const a = i * pitch
    const a1 = a - hr, a2 = a - ht, a3 = a + ht, a4 = a + hr
    pts.push([Rr * Math.cos(a1), Rr * Math.sin(a1)])
    pts.push([Ro * Math.cos(a2), Ro * Math.sin(a2)])
    pts.push([Ro * Math.cos(a3), Ro * Math.sin(a3)])
    pts.push([Rr * Math.cos(a4), Rr * Math.sin(a4)])
  }
  return { pts, Rp, Ro, Rr }
}

function spurGear(m, z, thk, opts = {}) {
  const boreR = opts.boreR !== undefined ? opts.boreR : 4.1
  const { pts, Rp } = gearOutlinePoints(m, z)
  let g = jf.polygon(pts).extrudeLinear({ height: thk }).translateZ(-thk / 2)
  g = g.subtract(jf.cylinder({ radius: boreR, height: thk + 4, segments: 24 }))
  if (z >= 80) {
    const nH = 6
    const holeR = 7
    const holePCD = Rp - 16
    for (let i = 0; i < nH; i++) {
      const a = (i / nH) * TAU
      g = g.subtract(jf.cylinder({ radius: holeR, height: thk + 4, segments: 24 }).translate([holePCD * Math.cos(a), holePCD * Math.sin(a), 0]))
    }
  }
  return g
}

// 608 skate bearing: 22 OD x 8 ID x 7 wide
function bearing608() {
  return jf.cylinder({ outer: 11, inner: 4, height: 7, segments: 48 })
}

// 8mm shaft with clearance to 608 bore (ID radius 4)
function shaft8(len) {
  return jf.cylinder({ radius: 3.95, height: len, segments: 24 })
}

// Pelton wheel: short hub so it clears the bearing above (2mm gap)
function peltonWheel(R, nB, thk) {
  let w = jf.cylinder({ radius: R, height: thk, segments: 48 })
  w = w.union(jf.cylinder({ radius: 6, height: thk + 2, segments: 24 }))
  w = w.subtract(jf.cylinder({ radius: 4.1, height: thk + 12, segments: 20 }))
  let wheel = w
  for (let i = 0; i < nB; i++) {
    const a = (i / nB) * TAU
    let cup = jf.roundedCuboid({ size: [7, 9, 10], roundRadius: 1.5, segments: 8 })
    cup = cup.rotateZ(((a + 0.45) % TAU + TAU) % TAU)
    const rr = R + 2
    cup = cup.translate([rr * Math.cos(a), rr * Math.sin(a), 0])
    wheel = wheel.union(cup)
  }
  return wheel
}

function jetNozzle(len, rOut, rTip) {
  const pipe = jf.cylinder({ radius: rOut, height: len, segments: 20 })
  const tip = jf.cylinder({ radius: [rOut, rTip], height: 10, segments: 20 }).translateZ(len / 2 + 5)
  return pipe.union(tip).subtract(jf.cylinder({ radius: rTip * 0.55, height: len + 14, segments: 12 }))
}

// ---------- main ----------
const main = (params) => {
  params._type = 'Turret pose'
  params.azimuth = { type: 'slider', default: 25, min: -180, max: 180, step: 1, label: 'Azimuth deg' }
  params.altitude = { type: 'slider', default: 18, min: -10, max: 60, step: 1, label: 'Altitude deg' }

  const az = params.azimuth * Math.PI / 180
  const al = params.altitude * Math.PI / 180

  // 10:1 compound on each axis:
  //   Pelton 20T -> mid 40T = 2:1
  //   lay 20T -> output 100T = 5:1   (2 x 5 = 10 total)
  const m = 1.0
  const Zp = 20, Zm = 40, Zg = 100
  const Rp20 = m * Zp / 2      // 10
  const Rp40 = m * Zm / 2      // 20
  const Rp100 = m * Zg / 2     // 50
  const C_out = Rp100 + Rp20 + 0.25   // 60.25 output to lay-pinion
  const C_mid = Rp40 + Rp20 + 0.25    // 30.25 lay-gear to pelton-pinion

  const steel = [0.62, 0.64, 0.68]
  const darkSteel = [0.3, 0.31, 0.34]
  const brass = [0.85, 0.65, 0.2]
  const brass2 = [0.78, 0.55, 0.18]
  const blue = [0.2, 0.45, 0.85]
  const orange = [0.95, 0.45, 0.1]
  const red = [0.85, 0.2, 0.15]
  const baseGray = [0.35, 0.37, 0.4]
  const deckGray = [0.55, 0.57, 0.6]
  const bearingBlue = [0.35, 0.55, 0.9]

  const parts = []
  const add = (g, c) => parts.push(c ? g.colorize(c) : g)

  // Vertical stack (azimuth): base top 8, output mesh 20, mid mesh 36,
  // pelton disc 46, top bearings 56, bridge 58-64, deck 64-72
  const layZpin = 20, layZgear = 36, pelWheelZ = 46
  const topBearZ = 56, bridgeZ = 61, deckZ = 68

  // ===== AZIMUTH STATIC (base frame) =====
  const baseC = [15, 0, 4]
  const baseSize = [190, 150, 8]
  let base = jf.cuboid({ size: baseSize }).translate(baseC)
  const mntX = [-70, 100], mntY = [-60, 60]
  for (const mx of mntX) for (const my of mntY) {
    base = base.subtract(jf.cylinder({ radius: 3, height: 12, segments: 20 }).translate([mx, my, 4]))
  }
  base = base.subtract(jf.cylinder({ radius: 4.1, height: 12, segments: 20 }).translate([0, 0, 4]))
  const layXY = [C_out, 0]
  const pelXY = [C_out, C_mid]
  base = base.subtract(jf.cylinder({ radius: 11.1, height: 8.5, segments: 40 }).translate([layXY[0], layXY[1], 4]))
  base = base.subtract(jf.cylinder({ radius: 11.1, height: 8.5, segments: 40 }).translate([pelXY[0], pelXY[1], 4]))
  add(base, baseGray)

  // main azimuth shaft, static, pressed in base, top stays below deck
  add(shaft8(50).translate([0, 0, 25]), darkSteel)
  // central water inlet meets shaft bottom flush at base underside (no overlap)
  add(jf.cylinder({ radius: 4, height: 16, segments: 20 }).translate([0, 0, -8]), [0.7, 0.4, 0.2])

  // --- azimuth lay shaft: 20T pinion low + 40T gear high ---
  add(shaft8(52).translate([layXY[0], layXY[1], 34]), steel)
  add(bearing608().translate([layXY[0], layXY[1], 8]), bearingBlue)
  add(bearing608().translate([layXY[0], layXY[1], topBearZ]), bearingBlue)
  add(spurGear(m, Zp, 10).rotateZ(Math.PI / Zp + 0.06).translate([layXY[0], layXY[1], layZpin]), steel)
  add(spurGear(m, Zm, 8).rotateZ(0.1).translate([layXY[0], layXY[1], layZgear]), brass2)

  // --- azimuth Pelton shaft: 20T pinion + Pelton wheel coaxial ---
  add(shaft8(52).translate([pelXY[0], pelXY[1], 34]), steel)
  add(bearing608().translate([pelXY[0], pelXY[1], 8]), bearingBlue)
  add(bearing608().translate([pelXY[0], pelXY[1], topBearZ]), bearingBlue)
  add(spurGear(m, Zp, 10).rotateZ(Math.PI / Zp + 0.55).translate([pelXY[0], pelXY[1], layZgear]), steel)
  add(peltonWheel(19, 14, 7).translate([pelXY[0], pelXY[1], pelWheelZ]), orange)
  let jetA = jetNozzle(30, 4, 2.2).rotateX(Math.PI / 2).rotateZ(0.5)
  jetA = jetA.translate([pelXY[0] - 26, pelXY[1] + 12, pelWheelZ])
  add(jetA, red)
  add(jf.cuboid({ size: [6, 6, 40] }).translate([pelXY[0] - 30, pelXY[1] + 18, 28]), darkSteel)

  // top bridge holding lay + pelton tops, below deck
  let bridge = jf.cuboid({ size: [34, 58, 6] }).translate([C_out, C_mid / 2, bridgeZ])
  bridge = bridge.subtract(jf.cylinder({ radius: 11.1, height: 8, segments: 32 }).translate([layXY[0], layXY[1], bridgeZ]))
  bridge = bridge.subtract(jf.cylinder({ radius: 11.1, height: 8, segments: 32 }).translate([pelXY[0], pelXY[1], bridgeZ]))
  add(bridge, deckGray)
  add(jf.cylinder({ radius: 4, height: 50, segments: 16 }).translate([C_out - 13, -8, 33]), darkSteel)
  add(jf.cylinder({ radius: 4, height: 50, segments: 16 }).translate([C_out + 13, 38, 33]), darkSteel)

  // ===== TURRET (rotating) GROUP =====
  const turret = []
  const tadd = (g, c) => turret.push(c ? g.colorize(c) : g)

  // azimuth 100T output gear coaxial, meshes with lay 20T pinion at C_out
  tadd(spurGear(m, Zg, 8).translate([0, 0, layZpin]), brass)
  // hub tube gear->deck, bored to clear 608 ODs, 1mm engagement each end
  tadd(jf.cylinder({ outer: 15, inner: 11.1, height: 42, segments: 40 }).translate([0, 0, 44]), deckGray)
  tadd(bearing608().translate([0, 0, 32]), bearingBlue)
  tadd(bearing608().translate([0, 0, 46]), bearingBlue)
  tadd(jf.cuboid({ size: [150, 110, 8] }).translate([0, 0, deckZ]), deckGray)
  tadd(jf.cylinder({ outer: 68, inner: 64, height: 3, segments: 96 }).translate([0, 0, deckZ + 5]), darkSteel)
  // water riser starts flush on deck top
  tadd(jf.cylinder({ radius: 6, height: 60, segments: 20 }).translate([-18, -20, 102]), [0.7, 0.4, 0.2])
  tadd(jf.sphere({ radius: 8, segments: 24 }).translate([-18, -20, 132]), [0.7, 0.4, 0.2])

  // --- altitude trunnion pedestals (axis Y), raised so 40T clears deck ---
  const deckTop = deckZ + 4
  const pivotH = 90
  const pivZ = deckTop + pivotH
  for (const yy of [-32, 32]) {
    let post = jf.cuboid({ size: [26, 10, pivotH] }).translate([0, yy, deckTop + pivotH / 2])
    post = post.subtract(jf.cylinder({ radius: 11.1, height: 14, segments: 32 }).rotateX(Math.PI / 2).translate([0, yy, pivZ]))
    post = post.subtract(jf.cuboid({ size: [14, 12, 40] }).rotateZ(0.5).translate([0, yy, deckTop + 25]))
    tadd(post, deckGray)
    tadd(bearing608().rotateX(Math.PI / 2).translate([0, yy, pivZ]), bearingBlue)
  }
  tadd(jf.cylinder({ radius: 3.95, height: 84, segments: 20 }).rotateX(Math.PI / 2).translate([0, 0, pivZ]), steel)

  // --- altitude lay + pelton shafts (axes along Y) ---
  const altPinZ = pivZ - C_out
  const altLayX = 0
  const altPelX = C_mid
  const supH = altPinZ - deckTop
  const supMidZ = (altPinZ + deckTop) / 2
  for (const yy of [-28, 28]) {
    let pb = jf.cuboid({ size: [30, 10, supH] }).translate([altLayX, yy, supMidZ])
    pb = pb.subtract(jf.cylinder({ radius: 11.1, height: 14, segments: 32 }).rotateX(Math.PI / 2).translate([altLayX, yy, altPinZ]))
    tadd(pb, deckGray)
    tadd(bearing608().rotateX(Math.PI / 2).translate([altLayX, yy, altPinZ]), bearingBlue)
  }
  tadd(jf.cylinder({ radius: 3.95, height: 76, segments: 16 }).rotateX(Math.PI / 2).translate([altLayX, 0, altPinZ]), steel)
  for (const yy of [-28, 28]) {
    let pb = jf.cuboid({ size: [30, 10, supH] }).translate([altPelX, yy, supMidZ])
    pb = pb.subtract(jf.cylinder({ radius: 11.1, height: 14, segments: 32 }).rotateX(Math.PI / 2).translate([altPelX, yy, altPinZ]))
    tadd(pb, deckGray)
    tadd(bearing608().rotateX(Math.PI / 2).translate([altPelX, yy, altPinZ]), bearingBlue)
  }
  tadd(jf.cylinder({ radius: 3.95, height: 76, segments: 16 }).rotateX(Math.PI / 2).translate([altPelX, 0, altPinZ]), steel)
  // lay 20T pinion (y=0 plane) meshes with 100T altitude output; 40T gear (y=-18) meshes with pelton 20T
  tadd(spurGear(m, Zp, 10).rotateX(Math.PI / 2).rotateY(0.26).translate([altLayX, 0, altPinZ]), steel)
  tadd(spurGear(m, Zm, 8).rotateX(Math.PI / 2).translate([altLayX, -18, altPinZ]), brass2)
  tadd(spurGear(m, Zp, 10).rotateX(Math.PI / 2).rotateY(0.5).translate([altPelX, -18, altPinZ]), steel)
  tadd(peltonWheel(19, 14, 7).rotateX(Math.PI / 2).translate([altPelX, 42, altPinZ]), orange)
  // altitude jet comes in horizontally along X, tip stops clear of cups
  tadd(jetNozzle(30, 4, 2.2).rotateY(-Math.PI / 2).translate([altPelX + 50, 42, altPinZ]), red)
  tadd(jf.cuboid({ size: [6, 30, 6] }).translate([altPelX + 62, 42, altPinZ - 18]), darkSteel)

  // --- gun cradle + 100T altitude output gear in y=0 plane (meshes with lay pinion) ---
  const gun = []
  const gadd = (g, c) => gun.push(c ? g.colorize(c) : g)
  gadd(spurGear(m, Zg, 8, { boreR: 6.1 }).rotateX(Math.PI / 2).translate([0, 0, 0]), brass)
  gadd(jf.cylinder({ outer: 6, inner: 4.1, height: 40, segments: 24 }).rotateX(Math.PI / 2).translate([0, 0, 0]), deckGray)
  gadd(jf.cuboid({ size: [20, 12, 30] }).translate([0, 14, 8]), deckGray)
  // side cheeks straddle the 100T gear (gear is y -4..4, cheeks at y +/-20)
  gadd(jf.cuboid({ size: [56, 8, 26] }).translate([6, -20, 6]), blue)
  gadd(jf.cuboid({ size: [56, 8, 26] }).translate([6, 20, 6]), blue)
  // split bottom rails leave a central slot for the gear
  gadd(jf.cuboid({ size: [56, 12, 8] }).translate([6, -20, -6]), blue)
  gadd(jf.cuboid({ size: [56, 12, 8] }).translate([6, 20, -6]), blue)
  // arms reaching back to counterweight, clear of gear in Y
  gadd(jf.cuboid({ size: [90, 8, 10] }).translate([-18, -20, 0]), blue)
  gadd(jf.cuboid({ size: [90, 8, 10] }).translate([-18, 20, 0]), blue)
  gadd(jf.cuboid({ size: [10, 48, 10] }).translate([-62, 0, 0]), blue)
  // barrel group shifted forward so chamber clears the 100T (R~51)
  gadd(jf.cylinder({ radius: 11, height: 30, segments: 32 }).rotateZ(Math.PI / 2).translate([65, 0, 10]), darkSteel)
  gadd(jf.cylinder({ radius: 8, height: 110, segments: 32 }).rotateZ(Math.PI / 2).translate([130, 0, 10]), blue)
  gadd(jf.cylinder({ radius: [8, 4.5], height: 22, segments: 32 }).rotateZ(Math.PI / 2).translate([195, 0, 10]), red)
  gadd(jf.cylinder({ radius: 2.6, height: 26, segments: 16 }).rotateZ(Math.PI / 2).translate([196, 0, 10]), darkSteel)
  // counterweight behind gear
  gadd(jf.sphere({ radius: 9, segments: 24 }).translate([-62, 0, 2]), [0.7, 0.4, 0.2])
  gadd(jf.cylinder({ radius: 6, height: 26, segments: 20 }).translate([-62, 0, -12]), [0.7, 0.4, 0.2])
  const gunTilted = gun.map(g => g.rotateY(al).translate([0, 0, pivZ]))
  gunTilted.forEach(g => turret.push(g))

  const turretPosed = turret.map(g => g.rotateZ(az))
  turretPosed.forEach(g => parts.push(g))

  return parts
}

module.exports = { main }
`

// The same turret in the modeling style, part for part.
const TURRET_MODELING = `const { booleans, colors, extrusions, primitives, transforms } = require('@jscad/modeling')
const { subtract, union } = booleans
const { colorize } = colors
const { extrudeLinear } = extrusions
const { cuboid, cylinder, cylinderElliptic, polygon, roundedCuboid, sphere } = primitives
const { rotateX, rotateY, rotateZ, translate, translateZ } = transforms
const TAU = Math.PI * 2

// ---------- helpers ----------
function gearOutlinePoints(m, z) {
  const Rp = m * z / 2
  const Ro = Rp + m * 0.9
  const Rr = Math.max(Rp - m * 1.0, 2)
  const pitch = TAU / z
  const hr = pitch / 4 * 1.18
  const ht = pitch / 4 * 0.62
  const pts = []
  for (let i = 0; i < z; i++) {
    const a = i * pitch
    const a1 = a - hr, a2 = a - ht, a3 = a + ht, a4 = a + hr
    pts.push([Rr * Math.cos(a1), Rr * Math.sin(a1)])
    pts.push([Ro * Math.cos(a2), Ro * Math.sin(a2)])
    pts.push([Ro * Math.cos(a3), Ro * Math.sin(a3)])
    pts.push([Rr * Math.cos(a4), Rr * Math.sin(a4)])
  }
  return { pts, Rp, Ro, Rr }
}

function spurGear(m, z, thk, opts = {}) {
  const boreR = opts.boreR !== undefined ? opts.boreR : 4.1
  const { pts, Rp } = gearOutlinePoints(m, z)
  let g = translateZ(-thk / 2, extrudeLinear({ height: thk }, polygon({ points: pts })))
  g = subtract(g, cylinder({ radius: boreR, height: thk + 4, segments: 24 }))
  if (z >= 80) {
    const nH = 6
    const holeR = 7
    const holePCD = Rp - 16
    for (let i = 0; i < nH; i++) {
      const a = (i / nH) * TAU
      g = subtract(g, translate([holePCD * Math.cos(a), holePCD * Math.sin(a), 0], cylinder({ radius: holeR, height: thk + 4, segments: 24 })))
    }
  }
  return g
}

const tube = (outer, inner, height, segments) =>
  subtract(cylinder({ radius: outer, height, segments }), cylinder({ radius: inner, height, segments }))

// 608 skate bearing: 22 OD x 8 ID x 7 wide
function bearing608() {
  return tube(11, 4, 7, 48)
}

// 8mm shaft with clearance to 608 bore (ID radius 4)
function shaft8(len) {
  return cylinder({ radius: 3.95, height: len, segments: 24 })
}

// Pelton wheel: short hub so it clears the bearing above (2mm gap)
function peltonWheel(R, nB, thk) {
  let w = cylinder({ radius: R, height: thk, segments: 48 })
  w = union(w, cylinder({ radius: 6, height: thk + 2, segments: 24 }))
  w = subtract(w, cylinder({ radius: 4.1, height: thk + 12, segments: 20 }))
  let wheel = w
  for (let i = 0; i < nB; i++) {
    const a = (i / nB) * TAU
    let cup = roundedCuboid({ size: [7, 9, 10], roundRadius: 1.5, segments: 8 })
    cup = rotateZ(((a + 0.45) % TAU + TAU) % TAU, cup)
    const rr = R + 2
    cup = translate([rr * Math.cos(a), rr * Math.sin(a), 0], cup)
    wheel = union(wheel, cup)
  }
  return wheel
}

function jetNozzle(len, rOut, rTip) {
  const pipe = cylinder({ radius: rOut, height: len, segments: 20 })
  const tip = translateZ(len / 2 + 5, cylinderElliptic({ startRadius: [rOut, rOut], endRadius: [rTip, rTip], height: 10, segments: 20 }))
  return subtract(union(pipe, tip), cylinder({ radius: rTip * 0.55, height: len + 14, segments: 12 }))
}

// ---------- main ----------
const main = (params) => {
  params._type = 'Turret pose'
  params.azimuth = { type: 'slider', default: 25, min: -180, max: 180, step: 1, label: 'Azimuth deg' }
  params.altitude = { type: 'slider', default: 18, min: -10, max: 60, step: 1, label: 'Altitude deg' }

  const az = params.azimuth * Math.PI / 180
  const al = params.altitude * Math.PI / 180

  // 10:1 compound on each axis:
  //   Pelton 20T -> mid 40T = 2:1
  //   lay 20T -> output 100T = 5:1   (2 x 5 = 10 total)
  const m = 1.0
  const Zp = 20, Zm = 40, Zg = 100
  const Rp20 = m * Zp / 2      // 10
  const Rp40 = m * Zm / 2      // 20
  const Rp100 = m * Zg / 2     // 50
  const C_out = Rp100 + Rp20 + 0.25   // 60.25 output to lay-pinion
  const C_mid = Rp40 + Rp20 + 0.25    // 30.25 lay-gear to pelton-pinion

  const steel = [0.62, 0.64, 0.68]
  const darkSteel = [0.3, 0.31, 0.34]
  const brass = [0.85, 0.65, 0.2]
  const brass2 = [0.78, 0.55, 0.18]
  const blue = [0.2, 0.45, 0.85]
  const orange = [0.95, 0.45, 0.1]
  const red = [0.85, 0.2, 0.15]
  const baseGray = [0.35, 0.37, 0.4]
  const deckGray = [0.55, 0.57, 0.6]
  const bearingBlue = [0.35, 0.55, 0.9]

  const parts = []
  const add = (g, c) => parts.push(c ? colorize(c, g) : g)

  // Vertical stack (azimuth): base top 8, output mesh 20, mid mesh 36,
  // pelton disc 46, top bearings 56, bridge 58-64, deck 64-72
  const layZpin = 20, layZgear = 36, pelWheelZ = 46
  const topBearZ = 56, bridgeZ = 61, deckZ = 68

  // ===== AZIMUTH STATIC (base frame) =====
  const baseC = [15, 0, 4]
  const baseSize = [190, 150, 8]
  let base = translate(baseC, cuboid({ size: baseSize }))
  const mntX = [-70, 100], mntY = [-60, 60]
  for (const mx of mntX) for (const my of mntY) {
    base = subtract(base, translate([mx, my, 4], cylinder({ radius: 3, height: 12, segments: 20 })))
  }
  base = subtract(base, translate([0, 0, 4], cylinder({ radius: 4.1, height: 12, segments: 20 })))
  const layXY = [C_out, 0]
  const pelXY = [C_out, C_mid]
  base = subtract(base, translate([layXY[0], layXY[1], 4], cylinder({ radius: 11.1, height: 8.5, segments: 40 })))
  base = subtract(base, translate([pelXY[0], pelXY[1], 4], cylinder({ radius: 11.1, height: 8.5, segments: 40 })))
  add(base, baseGray)

  // main azimuth shaft, static, pressed in base, top stays below deck
  add(translate([0, 0, 25], shaft8(50)), darkSteel)
  // central water inlet meets shaft bottom flush at base underside (no overlap)
  add(translate([0, 0, -8], cylinder({ radius: 4, height: 16, segments: 20 })), [0.7, 0.4, 0.2])

  // --- azimuth lay shaft: 20T pinion low + 40T gear high ---
  add(translate([layXY[0], layXY[1], 34], shaft8(52)), steel)
  add(translate([layXY[0], layXY[1], 8], bearing608()), bearingBlue)
  add(translate([layXY[0], layXY[1], topBearZ], bearing608()), bearingBlue)
  add(translate([layXY[0], layXY[1], layZpin], rotateZ(Math.PI / Zp + 0.06, spurGear(m, Zp, 10))), steel)
  add(translate([layXY[0], layXY[1], layZgear], rotateZ(0.1, spurGear(m, Zm, 8))), brass2)

  // --- azimuth Pelton shaft: 20T pinion + Pelton wheel coaxial ---
  add(translate([pelXY[0], pelXY[1], 34], shaft8(52)), steel)
  add(translate([pelXY[0], pelXY[1], 8], bearing608()), bearingBlue)
  add(translate([pelXY[0], pelXY[1], topBearZ], bearing608()), bearingBlue)
  add(translate([pelXY[0], pelXY[1], layZgear], rotateZ(Math.PI / Zp + 0.55, spurGear(m, Zp, 10))), steel)
  add(translate([pelXY[0], pelXY[1], pelWheelZ], peltonWheel(19, 14, 7)), orange)
  let jetA = rotateZ(0.5, rotateX(Math.PI / 2, jetNozzle(30, 4, 2.2)))
  jetA = translate([pelXY[0] - 26, pelXY[1] + 12, pelWheelZ], jetA)
  add(jetA, red)
  add(translate([pelXY[0] - 30, pelXY[1] + 18, 28], cuboid({ size: [6, 6, 40] })), darkSteel)

  // top bridge holding lay + pelton tops, below deck
  let bridge = translate([C_out, C_mid / 2, bridgeZ], cuboid({ size: [34, 58, 6] }))
  bridge = subtract(bridge, translate([layXY[0], layXY[1], bridgeZ], cylinder({ radius: 11.1, height: 8, segments: 32 })))
  bridge = subtract(bridge, translate([pelXY[0], pelXY[1], bridgeZ], cylinder({ radius: 11.1, height: 8, segments: 32 })))
  add(bridge, deckGray)
  add(translate([C_out - 13, -8, 33], cylinder({ radius: 4, height: 50, segments: 16 })), darkSteel)
  add(translate([C_out + 13, 38, 33], cylinder({ radius: 4, height: 50, segments: 16 })), darkSteel)

  // ===== TURRET (rotating) GROUP =====
  const turret = []
  const tadd = (g, c) => turret.push(c ? colorize(c, g) : g)

  // azimuth 100T output gear coaxial, meshes with lay 20T pinion at C_out
  tadd(translate([0, 0, layZpin], spurGear(m, Zg, 8)), brass)
  // hub tube gear->deck, bored to clear 608 ODs, 1mm engagement each end
  tadd(translate([0, 0, 44], tube(15, 11.1, 42, 40)), deckGray)
  tadd(translate([0, 0, 32], bearing608()), bearingBlue)
  tadd(translate([0, 0, 46], bearing608()), bearingBlue)
  tadd(translate([0, 0, deckZ], cuboid({ size: [150, 110, 8] })), deckGray)
  tadd(translate([0, 0, deckZ + 5], tube(68, 64, 3, 96)), darkSteel)
  // water riser starts flush on deck top
  tadd(translate([-18, -20, 102], cylinder({ radius: 6, height: 60, segments: 20 })), [0.7, 0.4, 0.2])
  tadd(translate([-18, -20, 132], sphere({ radius: 8, segments: 24 })), [0.7, 0.4, 0.2])

  // --- altitude trunnion pedestals (axis Y), raised so 40T clears deck ---
  const deckTop = deckZ + 4
  const pivotH = 90
  const pivZ = deckTop + pivotH
  for (const yy of [-32, 32]) {
    let post = translate([0, yy, deckTop + pivotH / 2], cuboid({ size: [26, 10, pivotH] }))
    post = subtract(post, translate([0, yy, pivZ], rotateX(Math.PI / 2, cylinder({ radius: 11.1, height: 14, segments: 32 }))))
    post = subtract(post, translate([0, yy, deckTop + 25], rotateZ(0.5, cuboid({ size: [14, 12, 40] }))))
    tadd(post, deckGray)
    tadd(translate([0, yy, pivZ], rotateX(Math.PI / 2, bearing608())), bearingBlue)
  }
  tadd(translate([0, 0, pivZ], rotateX(Math.PI / 2, cylinder({ radius: 3.95, height: 84, segments: 20 }))), steel)

  // --- altitude lay + pelton shafts (axes along Y) ---
  const altPinZ = pivZ - C_out
  const altLayX = 0
  const altPelX = C_mid
  const supH = altPinZ - deckTop
  const supMidZ = (altPinZ + deckTop) / 2
  for (const yy of [-28, 28]) {
    let pb = translate([altLayX, yy, supMidZ], cuboid({ size: [30, 10, supH] }))
    pb = subtract(pb, translate([altLayX, yy, altPinZ], rotateX(Math.PI / 2, cylinder({ radius: 11.1, height: 14, segments: 32 }))))
    tadd(pb, deckGray)
    tadd(translate([altLayX, yy, altPinZ], rotateX(Math.PI / 2, bearing608())), bearingBlue)
  }
  tadd(translate([altLayX, 0, altPinZ], rotateX(Math.PI / 2, cylinder({ radius: 3.95, height: 76, segments: 16 }))), steel)
  for (const yy of [-28, 28]) {
    let pb = translate([altPelX, yy, supMidZ], cuboid({ size: [30, 10, supH] }))
    pb = subtract(pb, translate([altPelX, yy, altPinZ], rotateX(Math.PI / 2, cylinder({ radius: 11.1, height: 14, segments: 32 }))))
    tadd(pb, deckGray)
    tadd(translate([altPelX, yy, altPinZ], rotateX(Math.PI / 2, bearing608())), bearingBlue)
  }
  tadd(translate([altPelX, 0, altPinZ], rotateX(Math.PI / 2, cylinder({ radius: 3.95, height: 76, segments: 16 }))), steel)
  // lay 20T pinion (y=0 plane) meshes with 100T altitude output; 40T gear (y=-18) meshes with pelton 20T
  tadd(translate([altLayX, 0, altPinZ], rotateY(0.26, rotateX(Math.PI / 2, spurGear(m, Zp, 10)))), steel)
  tadd(translate([altLayX, -18, altPinZ], rotateX(Math.PI / 2, spurGear(m, Zm, 8))), brass2)
  tadd(translate([altPelX, -18, altPinZ], rotateY(0.5, rotateX(Math.PI / 2, spurGear(m, Zp, 10)))), steel)
  tadd(translate([altPelX, 42, altPinZ], rotateX(Math.PI / 2, peltonWheel(19, 14, 7))), orange)
  // altitude jet comes in horizontally along X, tip stops clear of cups
  tadd(translate([altPelX + 50, 42, altPinZ], rotateY(-Math.PI / 2, jetNozzle(30, 4, 2.2))), red)
  tadd(translate([altPelX + 62, 42, altPinZ - 18], cuboid({ size: [6, 30, 6] })), darkSteel)

  // --- gun cradle + 100T altitude output gear in y=0 plane (meshes with lay pinion) ---
  const gun = []
  const gadd = (g, c) => gun.push(c ? colorize(c, g) : g)
  gadd(rotateX(Math.PI / 2, spurGear(m, Zg, 8, { boreR: 6.1 })), brass)
  gadd(rotateX(Math.PI / 2, tube(6, 4.1, 40, 24)), deckGray)
  gadd(translate([0, 14, 8], cuboid({ size: [20, 12, 30] })), deckGray)
  // side cheeks straddle the 100T gear (gear is y -4..4, cheeks at y +/-20)
  gadd(translate([6, -20, 6], cuboid({ size: [56, 8, 26] })), blue)
  gadd(translate([6, 20, 6], cuboid({ size: [56, 8, 26] })), blue)
  // split bottom rails leave a central slot for the gear
  gadd(translate([6, -20, -6], cuboid({ size: [56, 12, 8] })), blue)
  gadd(translate([6, 20, -6], cuboid({ size: [56, 12, 8] })), blue)
  // arms reaching back to counterweight, clear of gear in Y
  gadd(translate([-18, -20, 0], cuboid({ size: [90, 8, 10] })), blue)
  gadd(translate([-18, 20, 0], cuboid({ size: [90, 8, 10] })), blue)
  gadd(translate([-62, 0, 0], cuboid({ size: [10, 48, 10] })), blue)
  // barrel group shifted forward so chamber clears the 100T (R~51)
  gadd(translate([65, 0, 10], rotateZ(Math.PI / 2, cylinder({ radius: 11, height: 30, segments: 32 }))), darkSteel)
  gadd(translate([130, 0, 10], rotateZ(Math.PI / 2, cylinder({ radius: 8, height: 110, segments: 32 }))), blue)
  gadd(translate([195, 0, 10], rotateZ(Math.PI / 2, cylinderElliptic({ startRadius: [8, 8], endRadius: [4.5, 4.5], height: 22, segments: 32 }))), red)
  gadd(translate([196, 0, 10], rotateZ(Math.PI / 2, cylinder({ radius: 2.6, height: 26, segments: 16 }))), darkSteel)
  // counterweight behind gear
  gadd(translate([-62, 0, 2], sphere({ radius: 9, segments: 24 })), [0.7, 0.4, 0.2])
  gadd(translate([-62, 0, -12], cylinder({ radius: 6, height: 26, segments: 20 })), [0.7, 0.4, 0.2])
  const gunTilted = gun.map(g => translate([0, 0, pivZ], rotateY(al, g)))
  gunTilted.forEach(g => turret.push(g))

  const turretPosed = turret.map(g => rotateZ(az, g))
  turretPosed.forEach(g => parts.push(g))

  return parts
}

module.exports = { main }
`

// The starting turret as graded, at its default pose.
export const ORIGINAL = { height: 228.8976 }

const ALONG = Array.from({ length: 19 }, (_, k) => 0.05 + k * 0.05)

// A gear lying flat shows its teeth in a horizontal cut. 18 teeth or more:
// a cylinder of 16 or more segments shows none, and the 14-cup Pelton wheel is left out.
const flatGear = (body) => (body.sections ?? []).some((s) => s.loops.some((l) => l.lobes >= 18 && Math.abs(l.area) >= 50))

export const fixture = {
  name: 'turret-lower',
  group: 'regression',
  prompt:
    'We want to lower the overall turret height.  The Azimuth drive should be a single reduction with the pelton wheel outside the turret.  The Altitude drive should be engaging the altitude gear at the back and not from the bottom.',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  transcript: [
    {
      role: 'user',
      content:
        'We are designing a small water gun turret.  The azimuth and altitude positions are each controlled by separate 10:1 gear ratios driven from a Pelton Wheel through a reducing gear.  The mechenisms should use 608 skate bearings',
    },
    {
      role: 'assistant',
      content: `Designing your 10:1 turret with 608 bearings and Pelton drives — building the parametric model.Your twin 10:1 Pelton drives need correct meshing and bearing seats — I'm laying out the full assembly now.First pass builds clean — now cleaning up the leftover code causing that warning.That warning is pointing at the wrong line — checking the actual code.That warning is a false alarm from the cup angles — fixing it and re-gearing both axes to a true 10:1 total.You're right — that stacked up to 40:1. Re-cutting the gears for a true 10:1 compound on each axis.10:1 Pelton turret concept noted — checking the current model against those drive requirements.Your 10:1 check caught real meshing faults — rebuilding the drive so both axes hit the ratio cleanly.Small Pelton-driven turret is modeled and building clean — watertight, manifold, no self-intersections.

**How the 10:1 is done — both axes identical:**
- Module 1.0 gears
- Pelton shaft 20T -> lay shaft 40T = 2:1
- Lay shaft 20T -> output 100T = 5:1
- Total 2 x 5 = **10:1**
- Pitch radii: 10 / 20 / 50mm
- Centers: 60.25mm output-to-lay, 30.25mm lay-to-Pelton + 0.25mm backlash

**Azimuth:**
- Static base 190x150x8 with 6mm mount holes
- Static 8mm main shaft pressed in base
- 100T output under deck on hub tube riding the main shaft on 2x 608s
- Lay shaft vertical at X=60.25 with 20T low / 40T high
- Pelton shaft vertical at X=60.25, Y=30.25 with 20T + 38mm Pelton wheel + tangential jet nozzle
- Bridge bar holds the tops of both shafts, below the rotating deck

**Altitude — rides on the deck, tilts with azimuth:**
- 2x trunnion pedestals, pivot ~70mm above deck, 608s on Y-axis, 8mm trunnion shaft
- 100T output coaxial with pivot in Y=0 plane — stays meshed as gun tilts
- Lay Y-shaft below pivot with 20T at Y=0 + 40T at Y=-18
- Pelton Y-shaft beside it with 20T at Y=-18 + Pelton wheel forward + jet
- Gun cradle + barrel in +X: chamber, 110mm tube, taper nozzle, rear hose elbow to deck riser

**608 skate bearings — 22 OD x 8 ID x 7:**
- Azimuth: 2x main hub, 2x lay, 2x Pelton
- Altitude: 2x trunnion, 2x lay, 2x Pelton
- Pockets modeled 22.2 dia in base, bridge, and pedestals

**Water:**
- 12mm copper feed below base through rotary union visual up riser to gun elbow — separate from drive jets
- 2x red drive jets: one for azimuth Pelton, one for altitude Pelton

Pose it with sliders: Azimuth -180 to 180, Altitude -10 to 60. Default 25 / 18 deg.

About 231 x 163 x 209mm overall. Want me to split it next into printable plates — base, deck, gears, Peltons, cradle/barrel?`,
    },
    { role: 'user', content: 'there are significant inter part interferences' },
    {
      role: 'assistant',
      content: `Your interference check is spot on — I'm reworking the clearances and gear fits now.You called out the fouling — I've mapped the clashes and I'm cutting clearances now.You flagged the clashes — I've mapped the worst offenders and I'm cutting in clearances.You flagged the fouling — I've mapped the worst offenders and I'm cutting in clearances.

[stopped by the user]`,
    },
  ],
  apiFiles: { fluent: { 'index.js': TURRET }, modeling: { 'index.js': TURRET_MODELING } },
  probe: { bodies: { sections: [{ axis: 'z', at: ALONG, outline: true }] } },
  checks: (m, { params = [], solid, probe } = {}) => {
    const gears = (probe?.bodies ?? []).filter(flatGear).length
    return [
      { name: 'at least 5% lower', pass: (m?.dimensions?.[2] ?? Infinity) <= 0.95 * ORIGINAL.height },
      { name: 'azimuth driven by one gear pair', pass: gears >= 1 && gears <= 3 },
      { name: 'keeps the pose sliders', pass: params.filter((p) => typeof p.initial === 'number').length >= 2 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
