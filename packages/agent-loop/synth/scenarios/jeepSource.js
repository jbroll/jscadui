// Source from the 2026-10-19T02:15:08Z production request (chat bb17e98f), whose Jeep the user asked to inspect.
export const JEEP_SOURCE = `// Willys MB Jeep (1944) - simplified model in mm
// Reference dimensions (approx): L 3376, W 1575, H 1727 (top up), wheelbase 2032, track 1226

const jf = require('@jbroll/jscad-fluent')
const jscadText = require('@jscadui/jscad-text')

const main = (params) => {
  params._type = 'Willys MB Jeep 1944'
  params.top = { type: 'checkbox', default: true, label: 'Canvas top up' }

  const L = 3376
  const W = 1575
  const wheelbase = 2032
  const track = 1226
  const wheelR = 360
  const wheelW = 150
  const gc = 222

  const parts = []

  // --- Wheels ---
  const tire = jf.cylinder({ radius: wheelR, height: wheelW, segments: 40 })
    .rotateX(Math.PI / 2)
  const hub = jf.cylinder({ radius: wheelR * 0.35, height: wheelW + 10, segments: 24 })
    .rotateX(Math.PI / 2)
    .colorize([0.7, 0.7, 0.75])
  const wheel = tire.union(hub)

  const halfWB = wheelbase / 2
  const halfTrack = track / 2
  const wz = wheelR
  const wheelPos = [
    [halfWB, halfTrack, wz],
    [halfWB, -halfTrack, wz],
    [-halfWB, halfTrack, wz],
    [-halfWB, -halfTrack, wz],
  ]
  wheelPos.forEach((p) => parts.push(wheel.clone().translate(p)))

  // --- Frame ---
  const frameH = 80
  const frameBottom = gc
  const frame = jf.cuboid({ size: [wheelbase + 200, track - 200, frameH] })
    .translate([0, 0, frameBottom + frameH / 2])
    .colorize([0.15, 0.15, 0.15])
  parts.push(frame)

  // --- Body tub (rear passenger compartment) ---
  const tubL = 1700
  const tubW = 1250
  const tubH = 460
  const tubBottom = frameBottom + frameH
  const tub = jf.roundedCuboid({ size: [tubL, tubW, tubH], roundRadius: 20, segments: 8 })
    .translate([-250, 0, tubBottom + tubH / 2])
    .colorize([0.2, 0.35, 0.2])
  parts.push(tub)

  // --- Hood ---
  const hoodL = 1050
  const hoodW = 1180
  const hoodH = 300
  const hood = jf.roundedCuboid({ size: [hoodL, hoodW, hoodH], roundRadius: 15, segments: 8 })
    .translate([900, 0, tubBottom + hoodH / 2])
    .colorize([0.2, 0.35, 0.2])
  parts.push(hood)

  // --- Grille (front, 9-slot stamped steel) ---
  const grille = jf.cuboid({ size: [40, hoodW - 60, hoodH + 80] })
    .translate([L / 2 - 60, 0, tubBottom + (hoodH + 80) / 2])
    .colorize([0.12, 0.12, 0.12])
  parts.push(grille)
  // 9 vertical slats
  for (let i = -4; i <= 4; i++) {
    const slat = jf.cuboid({ size: [30, 8, hoodH + 60] })
      .translate([L / 2 - 60, i * 110, tubBottom + (hoodH + 60) / 2])
      .colorize([0.7, 0.7, 0.75])
    parts.push(slat)
  }

  // --- Front fenders ---
  const fenderL = 700
  const fenderW = 360
  const fenderH = 120
  ;[-1, 1].forEach((s) => {
    const f = jf.roundedCuboid({ size: [fenderL, fenderW, fenderH], roundRadius: 25, segments: 8 })
      .translate([halfWB, s * (track / 2 + 60), wz + wheelR * 0.6])
      .colorize([0.2, 0.35, 0.2])
    parts.push(f)
  })

  // --- Rear fenders (small) ---
  ;[-1, 1].forEach((s) => {
    const f = jf.roundedCuboid({ size: [600, 260, 100], roundRadius: 20, segments: 8 })
      .translate([-halfWB, s * (track / 2 + 40), wz + wheelR * 0.55])
      .colorize([0.2, 0.35, 0.2])
    parts.push(f)
  })

  // --- Windshield frame (fold-down style, shown upright) ---
  const wsW = tubW - 100
  const wsH = 520
  const ws = jf.cuboid({ size: [25, wsW, wsH] })
    .translate([600, 0, tubBottom + tubH + wsH / 2 - 60])
    .colorize([0.12, 0.12, 0.12])
  parts.push(ws)
  const glass = jf.cuboid({ size: [8, wsW - 40, wsH - 60] })
    .translate([590, 0, tubBottom + tubH + wsH / 2 - 60])
    .colorize([0.6, 0.8, 0.95, 0.5])
  parts.push(glass)
  // windshield hinge bar at base
  const hinge = jf.cuboid({ size: [30, wsW, 25] })
    .translate([610, 0, tubBottom + tubH - 10])
    .colorize([0.12, 0.12, 0.12])
  parts.push(hinge)

  // --- Seats ---
  ;[-1, 1].forEach((s) => {
    const seat = jf.cuboid({ size: [380, 260, 80] })
      .translate([-300, s * 260, tubBottom + 120])
      .colorize([0.35, 0.2, 0.1])
    parts.push(seat)
    const back = jf.cuboid({ size: [80, 260, 360] })
      .translate([-490, s * 260, tubBottom + 290])
      .colorize([0.35, 0.2, 0.1])
    parts.push(back)
  })
  const bench = jf.cuboid({ size: [500, 900, 80] })
    .translate([-900, 0, tubBottom + 120])
    .colorize([0.35, 0.2, 0.1])
  parts.push(bench)

  // --- Canvas top (optional) ---
  if (params.top) {
    const topH = 60
    const canopyZ = 1727 - topH / 2
    const canopy = jf.roundedCuboid({ size: [1500, tubW + 60, topH], roundRadius: 15, segments: 8 })
      .translate([-200, 0, canopyZ])
      .colorize([0.3, 0.3, 0.25, 0.85])
    parts.push(canopy)
    const curtainH = canopyZ - (tubBottom + tubH) - 40
    ;[-1, 1].forEach((s) => {
      const curtain = jf.cuboid({ size: [1500, 8, curtainH] })
        .translate([-200, s * (tubW / 2 + 26), tubBottom + tubH + curtainH / 2])
        .colorize([0.3, 0.3, 0.25, 0.7])
      parts.push(curtain)
    })
    const rearCurtain = jf.cuboid({ size: [8, tubW + 60, curtainH] })
      .translate([-940, 0, tubBottom + tubH + curtainH / 2])
      .colorize([0.3, 0.3, 0.25, 0.7])
    parts.push(rearCurtain)
    // top bows (canvas frame ribs) - 4 hoops
    for (let i = -1; i <= 2; i++) {
      const bow = jf.torus({ innerRadius: 6, outerRadius: tubW / 2 + 20, innerSegments: 8, outerSegments: 24 })
        .rotateX(Math.PI / 2)
        .translate([-300 + i * 400, 0, canopyZ - 20])
        .colorize([0.12, 0.12, 0.12])
      parts.push(bow)
    }
  }

  // --- Spare tire on rear ---
  const spare = jf.cylinder({ radius: wheelR * 0.9, height: 140, segments: 40 })
    .rotateY(Math.PI / 2)
    .translate([-L / 2 - 80, 0, wz + 120])
  parts.push(spare)

  // --- Bumpers ---
  const frontBumper = jf.cuboid({ size: [60, W - 100, 100] })
    .translate([L / 2 - 20, 0, gc + 60])
    .colorize([0.7, 0.7, 0.75])
  parts.push(frontBumper)
  const rearBumper = jf.cuboid({ size: [60, W - 100, 100] })
    .translate([-L / 2 + 20, 0, gc + 60])
    .colorize([0.7, 0.7, 0.75])
  parts.push(rearBumper)

  // --- Headlights (one with blackout mask) ---
  ;[-1, 1].forEach((s, idx) => {
    const hl = jf.sphere({ radius: 55, segments: 20 })
      .translate([L / 2 - 40, s * 420, tubBottom + hoodH + 20])
      .colorize([0.95, 0.95, 0.9])
    parts.push(hl)
    // blackout mask on driver-side headlight
    if (idx === 0) {
      const mask = jf.cuboid({ size: [30, 110, 55] })
        .translate([L / 2 - 60, s * 420, tubBottom + hoodH + 20])
        .colorize([0.05, 0.05, 0.05])
      parts.push(mask)
    }
  })

  // --- Steering wheel ---
  const steer = jf.torus({ innerRadius: 8, outerRadius: 140, innerSegments: 12, outerSegments: 32 })
    .rotateX(Math.PI / 2)
    .translate([520, -180, tubBottom + 420])
    .colorize([0.12, 0.12, 0.12])
  parts.push(steer)

  // --- Distinctive Willys MB details ---

  // White 5-point star on hood
  const star = jf.star({ vertices: 5, outerRadius: 180, innerRadius: 70, startAngle: Math.PI / 2 })
    .extrudeLinear({ height: 6 })
    .colorize([0.95, 0.95, 0.9])
    .translate([900, 0, tubBottom + hoodH + 3])
  parts.push(star)

  // Four body lift handles
  ;[-1, 1].forEach((sx) => {
    ;[-1, 1].forEach((sy) => {
      const hx = -250 + sx * 800
      const hy = sy * 600
      const bar = jf.cuboid({ size: [80, 20, 20] })
        .translate([hx, hy, tubBottom + tubH + 12])
        .colorize([0.15, 0.15, 0.15])
      const post1 = jf.cuboid({ size: [20, 20, 60] })
        .translate([hx - 30, hy, tubBottom + tubH - 18])
        .colorize([0.15, 0.15, 0.15])
      const post2 = jf.cuboid({ size: [20, 20, 60] })
        .translate([hx + 30, hy, tubBottom + tubH - 18])
        .colorize([0.15, 0.15, 0.15])
      parts.push(bar, post1, post2)
    })
  })

  // Driver-side tool box
  const toolBox = jf.cuboid({ size: [360, 70, 200] })
    .translate([-320, -(tubW / 2 + 35), tubBottom + 170])
    .colorize([0.2, 0.35, 0.2])
  parts.push(toolBox)

  // Jerry-can holder on rear quarter
  const jerryHolder = jf.cuboid({ size: [200, 200, 300] })
    .translate([-1100, tubW / 2 + 30, tubBottom + 180])
    .colorize([0.2, 0.35, 0.2])
  parts.push(jerryHolder)

  // Jerry can inside
  const jerry = jf.cuboid({ size: [150, 150, 260] })
    .translate([-1100, tubW / 2 + 30, tubBottom + 160])
    .colorize([0.3, 0.35, 0.2])
  parts.push(jerry)

  // Rear pintle hook
  const pintle = jf.cuboid({ size: [90, 70, 70] })
    .translate([-L / 2 - 30, 0, gc + 45])
    .colorize([0.15, 0.15, 0.15])
  parts.push(pintle)

  // Fuel filler cap (driver side rear)
  const fuelCap = jf.cylinder({ radius: 30, height: 20, segments: 16 })
    .translate([-700, -(tubW / 2 - 60), tubBottom + tubH + 5])
    .colorize([0.7, 0.7, 0.75])
  parts.push(fuelCap)

  // Machine gun mount post (center, between front seats)
  const mgPost = jf.cylinder({ radius: 25, height: 900, segments: 16 })
    .translate([0, 0, tubBottom + 900 / 2 + 80])
    .colorize([0.15, 0.15, 0.15])
  parts.push(mgPost)
  const mgMount = jf.torus({ innerRadius: 15, outerRadius: 90, innerSegments: 12, outerSegments: 24 })
    .rotateX(Math.PI / 2)
    .translate([0, 0, tubBottom + 700])
    .colorize([0.15, 0.15, 0.15])
  parts.push(mgMount)

  // Pioneer tools on driver side (shovel + axe) as flat bars
  const shovel = jf.cuboid({ size: [900, 20, 60] })
    .translate([-200, -(tubW / 2 + 50), tubBottom + tubH + 100])
    .colorize([0.35, 0.2, 0.1])
  parts.push(shovel)
  const axe = jf.cuboid({ size: [800, 16, 50] })
    .translate([-200, -(tubW / 2 + 75), tubBottom + tubH + 60])
    .colorize([0.35, 0.2, 0.1])
  parts.push(axe)

  // Fire extinguisher on passenger side
  const fireExt = jf.cylinder({ radius: 45, height: 260, segments: 16 })
    .translate([200, tubW / 2 + 40, tubBottom + 180])
    .colorize([0.85, 0.15, 0.1])
  parts.push(fireExt)

  // "WILLYS" script on hood sides (text outlines extruded)
  const willysOutline = jscadText.text2d('WILLYS', { size: 120, font: 'Liberation Sans:style=Bold', halign: 'center', valign: 'center' })
  if (willysOutline) {
    const willys = new jf.FluentGeom2(willysOutline)
      .extrudeLinear({ height: 8 })
      .colorize([0.95, 0.95, 0.9])
    ;[-1, 1].forEach((s) => {
      const w = willys.clone()
        .rotateZ(s === 1 ? Math.PI / 2 : -Math.PI / 2)
        .translate([900, s * (hoodW / 2 + 4), tubBottom + hoodH / 2])
      parts.push(w)
    })
  }

  // "4 WHEEL DRIVE" on tailgate
  const fwdOutline = jscadText.text2d('4 WHEEL DRIVE', { size: 60, font: 'Liberation Sans:style=Bold', halign: 'center', valign: 'center' })
  if (fwdOutline) {
    const fwd = new jf.FluentGeom2(fwdOutline)
      .extrudeLinear({ height: 6 })
      .colorize([0.95, 0.95, 0.9])
      .translate([-L / 2 + 10, 0, tubBottom + 120])
    parts.push(fwd)
  }

  // Scale down 10:1
  return parts.map((p) => p.scale([0.1, 0.1, 0.1]))
}

module.exports = { main }
`
