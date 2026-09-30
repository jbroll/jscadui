// Known answers for the describer and judge (npm run grader-validate; `expected` is
// explained in docs/user-manual.md, Grader validation).

export const CABOOSE_MESSAGE = 'we need a model of a toy caboose'

// The toy caboose a chat built (chat 554c84a4): 111 x 41 x 67 mm, 62 parts.
const CABOOSE = `// Toy caboose model in millimetres.
const jf = require('@jbroll/jscad-fluent')

const main = (params) => {
  params._type = 'Toy Caboose'
  params.length = { type: 'slider', default: 80, min: 60, max: 120, step: 5, label: 'Body length' }
  params.width = { type: 'slider', default: 30, min: 24, max: 40, step: 1, label: 'Body width' }
  params.wheelRadius = { type: 'slider', default: 9, min: 6, max: 12, step: 0.5, label: 'Wheel radius' }

  const num = (v, fb) => (typeof v === 'number' ? v : fb)
  const L = num(params.length, 80)
  const W = num(params.width, 30)
  const WR = num(params.wheelRadius, 9)

  const bodyH = 28
  const chassisH = 5
  const chassisBottom = WR * 2 - 5 // tuck chassis just above wheel centers
  const chassisTop = chassisBottom + chassisH
  const bodyBottom = chassisTop
  const bodyTop = bodyBottom + bodyH
  const bodyCenterZ = bodyBottom + bodyH / 2

  const wheelThick = 6
  const wheelY = W / 2 + 1.5
  const wheelX = L * 0.325
  const wheelZ = WR

  // Colors
  const red = [0.78, 0.14, 0.13]
  const darkRed = [0.6, 0.1, 0.1]
  const roofGrey = [0.28, 0.28, 0.32]
  const chassisBlack = [0.16, 0.16, 0.17]
  const wheelBlack = [0.1, 0.1, 0.11]
  const hubRed = [0.78, 0.14, 0.13]
  const windowBlue = [0.55, 0.82, 0.92]
  const windowFrame = [0.95, 0.92, 0.82]
  const woodBrown = [0.45, 0.3, 0.18]

  // Chassis / frame
  const chassis = jf.cuboid({ size: [L + 4, W + 2, chassisH], center: [0, 0, chassisBottom + chassisH / 2] })
    .colorize(chassisBlack)

  // End beams (buffer beams)
  const beamT = 4
  const beamL = jf.cuboid({ size: [beamT, W + 2, 8], center: [0, 0, 0] })
  const beamFront = beamL.translate([L / 2 + 1, 0, chassisBottom + 3]).colorize(darkRed)
  const beamBack = beamL.translate([-L / 2 - 1, 0, chassisBottom + 3]).colorize(darkRed)

  // Main cabin body
  const body = jf.cuboid({ size: [L, W, bodyH], center: [0, 0, bodyCenterZ] })
    .colorize(red)

  // Side skirts below body (short apron)
  const skirt = jf.cuboid({ size: [L - 10, W - 4, 4], center: [0, 0, bodyBottom - 1] })
    .colorize(darkRed)

  // Roof - slightly overhanging slab with rounded edge feel (two stacked slabs)
  const roofLower = jf.cuboid({ size: [L + 8, W + 6, 3], center: [0, 0, bodyTop + 1.5] })
    .colorize(roofGrey)
  const roofUpper = jf.cuboid({ size: [L + 4, W + 2, 2.5], center: [0, 0, bodyTop + 3 + 1.25] })
    .colorize(roofGrey)

  // Cupola (lookout cabin on top, centered)
  const cupLen = 30
  const cupWid = W * 0.72
  const cupH = 13
  const cupBottom = bodyTop + 3 // sits into roof
  const cupola = jf.cuboid({ size: [cupLen, cupWid, cupH], center: [0, 0, cupBottom + cupH / 2] })
    .colorize(red)
  const cupRoof = jf.cuboid({ size: [cupLen + 6, cupWid + 6, 3], center: [0, 0, cupBottom + cupH + 1.5] })
    .colorize(roofGrey)
  const cupRoofTop = jf.cuboid({ size: [cupLen, cupWid, 2], center: [0, 0, cupBottom + cupH + 3 + 1] })
    .colorize(roofGrey)

  // Stove pipe chimney near one end of roof
  const chimR = 2.8
  const chimH = 10
  const chimX = -L / 2 + 14
  const chimney = jf.cylinder({ radius: chimR, height: chimH, segments: 24 })
    .translate([chimX, 0, bodyTop + 5 + chimH / 2 - 1])
    .colorize(chassisBlack)
  const chimneyCap = jf.cylinder({ radius: chimR + 1.4, height: 2, segments: 24 })
    .translate([chimX, 0, bodyTop + 5 + chimH])
    .colorize(chassisBlack)

  // Wheels + axles + hubs
  const wheelProto = jf.cylinder({ radius: WR, height: wheelThick, segments: 32 }).rotateX(Math.PI / 2)
  const hubProto = jf.cylinder({ radius: 2.6, height: wheelThick + 2, segments: 16 }).rotateX(Math.PI / 2)
  const axleProto = jf.cylinder({ radius: 2.2, height: W + 4, segments: 16 }).rotateX(Math.PI / 2)

  const wheelPos = [
    [wheelX, wheelY], [wheelX, -wheelY],
    [-wheelX, wheelY], [-wheelX, -wheelY]
  ]
  const wheels = wheelPos.map(([x, y]) => wheelProto.translate([x, y, wheelZ]).colorize(wheelBlack))
  const hubs = wheelPos.map(([x, y]) => hubProto.translate([x, y, wheelZ]).colorize(hubRed))
  const axles = [wheelX, -wheelX].map((x) => axleProto.translate([x, 0, wheelZ]).colorize(chassisBlack))

  // Side windows: cream frames + blue glass, applied on both flanks
  const winW = 11
  const winH = 10
  const winZ = bodyCenterZ + 4
  const winXpos = [-L / 2 + 13, -L / 2 + 28, L / 2 - 28, L / 2 - 13]
  const sideWindows = []
  winXpos.forEach((x) => {
    [1, -1].forEach((s) => {
      const y = s * (W / 2)
      const frame = jf.cuboid({ size: [winW + 2, 1.2, winH + 2], center: [0, 0, 0] })
        .translate([x, y + s * 0.3, winZ])
        .colorize(windowFrame)
      const glass = jf.cuboid({ size: [winW, 1.4, winH], center: [0, 0, 0] })
        .translate([x, y + s * 0.4, winZ])
        .colorize(windowBlue)
      sideWindows.push(frame, glass)
    })
  })

  // Sliding side doors in middle of each flank (brown with frame)
  const doorW = 14
  const doorH = 20
  const doorZ = bodyCenterZ - 2
  const doors = [1, -1].map((s) => {
    const y = s * (W / 2)
    const frame = jf.cuboid({ size: [doorW + 2, 1.2, doorH + 2] })
      .translate([0, y + s * 0.3, doorZ])
      .colorize(windowFrame)
    const panel = jf.cuboid({ size: [doorW, 1.4, doorH] })
      .translate([0, y + s * 0.4, doorZ])
      .colorize(woodBrown)
    return [frame, panel]
  }).flat()

  // End doors / windows on front & back faces
  const endGlass = [1, -1].map((s) => {
    const x = s * (L / 2)
    const frame = jf.cuboid({ size: [1.2, 10, 12] })
      .translate([x + s * 0.3, 0, winZ])
      .colorize(windowFrame)
    const glass = jf.cuboid({ size: [1.4, 8, 10] })
      .translate([x + s * 0.4, 0, winZ])
      .colorize(windowBlue)
    return [frame, glass]
  }).flat()

  // Cupola side windows (lookout windows)
  const cupWinZ = cupBottom + cupH / 2 + 1
  const cupWindows = []
  ;[-8, 8].forEach((x) => {
    [1, -1].forEach((s) => {
      const glass = jf.cuboid({ size: [8, 1.4, 6] })
        .translate([x, s * (cupWid / 2 + 0.3), cupWinZ])
        .colorize(windowBlue)
      cupWindows.push(glass)
    })
  })
  ;[1, -1].forEach((s) => {
    const glass = jf.cuboid({ size: [1.4, 12, 6] })
      .translate([s * (cupLen / 2 + 0.3), 0, cupWinZ])
      .colorize(windowBlue)
    cupWindows.push(glass)
  })

  // Couplers front & back (toy knuckle hint: shank + head)
  const coupler = (s) => {
    const shank = jf.cuboid({ size: [10, 6, 4], center: [0, 0, 0] })
      .translate([s * (L / 2 + 7), 0, chassisBottom + 2])
      .colorize(chassisBlack)
    const head = jf.cuboid({ size: [5, 10, 7], center: [0, 0, 0] })
      .translate([s * (L / 2 + 13), 0, chassisBottom + 2])
      .colorize(chassisBlack)
    return [shank, head]
  }

  // Rear ladder (two rails + 3 rungs) on back face
  const ladderX = -L / 2 - 0.8
  const railProto = jf.cuboid({ size: [1.2, 1.2, bodyH - 2] })
  const railL = railProto.translate([ladderX, 6, bodyCenterZ]).colorize(windowFrame)
  const railR = railProto.translate([ladderX, -6, bodyCenterZ]).colorize(windowFrame)
  const rungs = [-8, -2, 4, 10].map((dz) =>
    jf.cuboid({ size: [1.2, 13.2, 1.2] }).translate([ladderX, 0, bodyCenterZ + dz]).colorize(chassisBlack)
  )

  return [
    chassis, beamFront, beamBack, body, skirt,
    roofLower, roofUpper, cupola, cupRoof, cupRoofTop,
    chimney, chimneyCap,
    ...axles, ...wheels, ...hubs,
    ...sideWindows, ...doors, ...endGlass, ...cupWindows,
    ...coupler(1), ...coupler(-1),
    railL, railR, ...rungs
  ]
}

module.exports = { main }
`

// Negative control: a simple toy delivery truck, about the caboose's size.
const DELIVERY_TRUCK = `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const blue = [0.15, 0.35, 0.75]
  const white = [0.92, 0.92, 0.9]
  const black = [0.1, 0.1, 0.11]
  const grey = [0.6, 0.6, 0.62]
  const glass = [0.55, 0.82, 0.92]
  const WR = 9
  const W = 36

  const chassis = jf.cuboid({ size: [106, W - 4, 5], center: [0, 0, WR + 2] }).colorize(black)
  const cargo = jf.cuboid({ size: [66, W, 36], center: [-18, 0, WR + 4.5 + 18] }).colorize(white)
  const cab = jf.cuboid({ size: [30, W, 26], center: [35, 0, WR + 4.5 + 13] }).colorize(blue)
  const hood = jf.cuboid({ size: [10, W - 2, 14], center: [55, 0, WR + 4.5 + 7] }).colorize(blue)
  const windshield = jf.cuboid({ size: [1.4, W - 8, 10], center: [50.4, 0, WR + 4.5 + 19] }).colorize(glass)
  const sideWindows = [1, -1].map((s) => jf.cuboid({ size: [14, 1.4, 9], center: [38, s * (W / 2 + 0.3), WR + 4.5 + 19] }).colorize(glass))
  const bumper = jf.cuboid({ size: [3, W + 2, 5], center: [61, 0, WR + 3] }).colorize(grey)
  const lights = [1, -1].map((s) => jf.cuboid({ size: [1.4, 5, 3], center: [60.4, s * 12, WR + 9] }).colorize([0.95, 0.85, 0.3]))
  const wheelProto = jf.cylinder({ radius: WR, height: 7, segments: 32 }).rotateX(Math.PI / 2)
  const hubProto = jf.cylinder({ radius: 3.5, height: 8, segments: 16 }).rotateX(Math.PI / 2)
  const wheelPos = [38, -30].flatMap((x) => [1, -1].map((s) => [x, s * (W / 2 + 1)]))
  const wheels = wheelPos.map(([x, y]) => wheelProto.translate([x, y, WR]).colorize(black))
  const hubs = wheelPos.map(([x, y]) => hubProto.translate([x, y, WR]).colorize(grey))

  return [chassis, cargo, cab, hood, windshield, ...sideWindows, bumper, ...lights, ...wheels, ...hubs]
}

module.exports = { main }
`

// Near miss: the caboose's red body on its chassis and wheels only.
const PLAIN_BOX = `const jf = require('@jbroll/jscad-fluent')

const main = () => {
  const L = 80
  const W = 30
  const WR = 9

  const bodyH = 28
  const chassisH = 5
  const chassisBottom = WR * 2 - 5
  const chassisTop = chassisBottom + chassisH
  const bodyBottom = chassisTop
  const bodyCenterZ = bodyBottom + bodyH / 2

  const wheelThick = 6
  const wheelY = W / 2 + 1.5
  const wheelX = L * 0.325
  const wheelZ = WR

  const red = [0.78, 0.14, 0.13]
  const chassisBlack = [0.16, 0.16, 0.17]
  const wheelBlack = [0.1, 0.1, 0.11]
  const hubRed = [0.78, 0.14, 0.13]

  const chassis = jf.cuboid({ size: [L + 4, W + 2, chassisH], center: [0, 0, chassisBottom + chassisH / 2] })
    .colorize(chassisBlack)
  const body = jf.cuboid({ size: [L, W, bodyH], center: [0, 0, bodyCenterZ] })
    .colorize(red)

  const wheelProto = jf.cylinder({ radius: WR, height: wheelThick, segments: 32 }).rotateX(Math.PI / 2)
  const hubProto = jf.cylinder({ radius: 2.6, height: wheelThick + 2, segments: 16 }).rotateX(Math.PI / 2)
  const axleProto = jf.cylinder({ radius: 2.2, height: W + 4, segments: 16 }).rotateX(Math.PI / 2)
  const wheelPos = [
    [wheelX, wheelY], [wheelX, -wheelY],
    [-wheelX, wheelY], [-wheelX, -wheelY]
  ]
  const wheels = wheelPos.map(([x, y]) => wheelProto.translate([x, y, wheelZ]).colorize(wheelBlack))
  const hubs = wheelPos.map(([x, y]) => hubProto.translate([x, y, wheelZ]).colorize(hubRed))
  const axles = [wheelX, -wheelX].map((x) => axleProto.translate([x, 0, wheelZ]).colorize(chassisBlack))

  return [chassis, body, ...axles, ...wheels, ...hubs]
}

module.exports = { main }
`

export const patched = (source, edits) =>
  edits.reduce((text, [from, to]) => {
    if (!text.includes(from)) throw new Error(`grader-validation: no ${JSON.stringify(from.slice(0, 40))} to patch`)
    return text.replace(from, () => to)
  }, source)

// Near miss: the caboose with its roofs removed and the body and cupola hollowed, open on top.
const NO_ROOF = patched(CABOOSE, [
  [
    `  const body = jf.cuboid({ size: [L, W, bodyH], center: [0, 0, bodyCenterZ] })
    .colorize(red)`,
    `  const wall = 2
  const body = jf.cuboid({ size: [L, W, bodyH], center: [0, 0, bodyCenterZ] })
    .subtract(jf.cuboid({ size: [L - 2 * wall, W - 2 * wall, bodyH], center: [0, 0, bodyCenterZ + wall] }))
    .colorize(red)`,
  ],
  [
    `  // Roof - slightly overhanging slab with rounded edge feel (two stacked slabs)
  const roofLower = jf.cuboid({ size: [L + 8, W + 6, 3], center: [0, 0, bodyTop + 1.5] })
    .colorize(roofGrey)
  const roofUpper = jf.cuboid({ size: [L + 4, W + 2, 2.5], center: [0, 0, bodyTop + 3 + 1.25] })
    .colorize(roofGrey)

`,
    '',
  ],
  [
    `  const cupola = jf.cuboid({ size: [cupLen, cupWid, cupH], center: [0, 0, cupBottom + cupH / 2] })`,
    `  // open-topped cupola walls standing on the body floor
  const floorZ = bodyBottom + wall
  const cupTop = cupBottom + cupH
  const cupTall = cupTop - floorZ
  const cupola = jf.cuboid({ size: [cupLen, cupWid, cupTall], center: [0, 0, floorZ + cupTall / 2] })
    .subtract(jf.cuboid({ size: [cupLen - 3, cupWid - 3, cupTall], center: [0, 0, floorZ + cupTall / 2 + 1.5] }))`,
  ],
  [
    `  const cupRoof = jf.cuboid({ size: [cupLen + 6, cupWid + 6, 3], center: [0, 0, cupBottom + cupH + 1.5] })
    .colorize(roofGrey)
  const cupRoofTop = jf.cuboid({ size: [cupLen, cupWid, 2], center: [0, 0, cupBottom + cupH + 3 + 1] })
    .colorize(roofGrey)
`,
    '',
  ],
  [
    `  const chimney = jf.cylinder({ radius: chimR, height: chimH, segments: 24 })
    .translate([chimX, 0, bodyTop + 5 + chimH / 2 - 1])`,
    `  const chimTop = bodyTop + 4 + chimH
  const chimney = jf.cylinder({ radius: chimR, height: chimTop - floorZ, segments: 24 })
    .translate([chimX, 0, (chimTop + floorZ) / 2])`,
  ],
  ['    roofLower, roofUpper, cupola, cupRoof, cupRoofTop,', '    cupola,'],
])

// Near miss: roof, cupola, chimney and wheels moved 15 to 30 mm from where they belong.
const EXPLODED = patched(CABOOSE, [
  [
    `  return [
    chassis, beamFront, beamBack, body, skirt,
    roofLower, roofUpper, cupola, cupRoof, cupRoofTop,
    chimney, chimneyCap,
    ...axles, ...wheels, ...hubs,
    ...sideWindows, ...doors, ...endGlass, ...cupWindows,`,
    `  // Near miss: parts displaced 15-30 mm from where they belong
  const move = (v, ...gs) => gs.map((g) => g.translate(v))
  const out = (y) => Math.sign(y) * 15
  return [
    chassis, beamFront, beamBack, body, skirt,
    ...move([0, 0, 15], roofLower, roofUpper),
    ...move([0, 0, 30], cupola, cupRoof, cupRoofTop, ...cupWindows),
    ...move([-12, 0, 22], chimney, chimneyCap),
    ...move([0, 0, -20], ...axles),
    ...wheels.map((w, i) => w.translate([0, out(wheelPos[i][1]), -20])),
    ...hubs.map((h, i) => h.translate([0, out(wheelPos[i][1]), -20])),
    ...sideWindows, ...doors, ...endGlass,`,
  ],
])

export const CASES = [
  { name: 'caboose', messages: [CABOOSE_MESSAGE], expected: 'pass', source: CABOOSE },
  { name: 'delivery-truck', messages: [CABOOSE_MESSAGE], expected: 'fail', source: DELIVERY_TRUCK },
  { name: 'plain-box', messages: [CABOOSE_MESSAGE], expected: 'fail', source: PLAIN_BOX },
  { name: 'exploded', messages: [CABOOSE_MESSAGE], expected: 'gate', source: EXPLODED },
  { name: 'no-roof', messages: [CABOOSE_MESSAGE], expected: 'known-miss', source: NO_ROOF },
]
