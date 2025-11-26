// Hierarchical Car Example - demonstrates params-proxy with UI presentation hints
// Showcases: sliders, color pickers, dropdowns, checkboxes, number inputs

const { cylinder, cuboid, sphere, torus } = require('@jscad/modeling').primitives
const { translate, rotateX, rotateZ, scale } = require('@jscad/modeling').transforms
const { union, subtract } = require('@jscad/modeling').booleans
const { colorize, hexToRgb } = require('@jscad/modeling').colors

// Helper to convert hex color to RGB array
const hexToColor = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return [r, g, b]
}

// Wheel part - demonstrates sliders, color picker, dropdown
const wheel = (params) => {
  params._type = 'Wheel'

  // Slider for radius with live preview
  params.radius = { type: 'slider', default: 3, min: 1, max: 8, step: 0.5, label: 'Tire Radius' }
  params.width = { type: 'slider', default: 1.5, min: 0.5, max: 4, step: 0.25, label: 'Tire Width' }

  // Color picker for tire
  params.tireColor = { type: 'color', default: '#333333', label: 'Tire Color' }

  // Hub options
  params.hubRadius = { type: 'slider', default: 1.2, min: 0.5, max: 3, step: 0.1, label: 'Hub Radius' }
  params.hubColor = { type: 'color', default: '#c0c0c0', label: 'Hub Color' }

  // Dropdown for spoke style
  params.spokeStyle = {
    type: 'choice',
    default: 'solid',
    values: ['solid', 'spoked', 'sport', 'classic'],
    captions: ['Solid Disc', '5-Spoke', 'Sport Mesh', 'Classic Wire'],
    label: 'Wheel Style'
  }

  // Number of spokes (only relevant for spoked styles)
  params.spokeCount = { type: 'int', default: 5, min: 3, max: 12, label: 'Spoke Count' }

  const tireColorValue = params.tireColor
  const parsedTireColor = hexToColor(tireColorValue)

  const tire = colorize(
    parsedTireColor,
    torus({ innerRadius: params.radius - 0.4, outerRadius: params.radius, innerSegments: 16, outerSegments: 32 })
  )

  let hub
  if (params.spokeStyle === 'solid') {
    hub = colorize(hexToColor(params.hubColor), cylinder({ radius: params.hubRadius, height: params.width * 0.8 }))
  } else {
    // Create spoked hub
    const centerHub = cylinder({ radius: params.hubRadius * 0.4, height: params.width * 0.8 })
    const rim = torus({ innerRadius: params.hubRadius - 0.1, outerRadius: params.hubRadius, innerSegments: 8, outerSegments: 24 })
    const spokes = []
    const spokeCount = params.spokeStyle === 'classic' ? params.spokeCount * 2 : params.spokeCount
    for (let i = 0; i < spokeCount; i++) {
      const angle = (i / spokeCount) * Math.PI * 2
      const spoke = translate(
        [Math.cos(angle) * params.hubRadius * 0.5, Math.sin(angle) * params.hubRadius * 0.5, 0],
        rotateZ(angle, scale([params.hubRadius * 0.8, 0.08, params.width * 0.3], cuboid({ size: [1, 1, 1] })))
      )
      spokes.push(spoke)
    }
    hub = colorize(hexToColor(params.hubColor), union(centerHub, rim, ...spokes))
  }

  // Return as array to preserve individual colors (union destroys colors)
  return rotateX(Math.PI / 2, [tire, hub])
}

// Axle part - demonstrates checkbox, number inputs
const axle = (params) => {
  params._type = 'Axle'

  params.width = { type: 'slider', default: 12, min: 6, max: 20, step: 0.5, label: 'Track Width' }
  params.rodRadius = { type: 'number', default: 0.3, min: 0.1, max: 1, step: 0.05, label: 'Rod Radius' }
  params.rodColor = { type: 'color', default: '#666666', label: 'Rod Color' }

  // Checkbox for showing the axle rod
  params.showRod = { type: 'checkbox', default: true, label: 'Show Axle Rod' }

  // Computed offsets for child wheels (hidden params)
  const halfWidth = params.width / 2
  params.left._offset = -halfWidth
  params.right._offset = halfWidth

  const parts = []

  if (params.showRod) {
    const rod = colorize(
      hexToColor(params.rodColor),
      rotateX(Math.PI / 2, cylinder({ radius: params.rodRadius, height: params.width }))
    )
    parts.push(rod)
  }

  const leftWheel = translate([0, params.left._offset, 0], wheel(params.left))
  const rightWheel = translate([0, params.right._offset, 0], wheel(params.right))

  return [...parts, leftWheel, rightWheel]
}

// Body part - demonstrates multiple color pickers, sliders, choice
const body = (params) => {
  params._type = 'Body'

  // Main dimensions with sliders
  params.length = { type: 'slider', default: 20, min: 10, max: 40, step: 1, label: 'Length' }
  params.width = { type: 'slider', default: 8, min: 4, max: 15, step: 0.5, label: 'Width' }
  params.height = { type: 'slider', default: 3.5, min: 2, max: 8, step: 0.5, label: 'Height' }

  // Color picker for body
  params.color = { type: 'color', default: '#e74c3c', label: 'Body Color' }

  // Body style dropdown
  params.style = {
    type: 'choice',
    default: 'sedan',
    values: ['sedan', 'coupe', 'suv', 'truck'],
    captions: ['Sedan', 'Coupe', 'SUV', 'Pickup Truck'],
    label: 'Body Style'
  }

  // Cabin parameters
  params.cabin._type = 'Cabin'
  params.cabin.length = { type: 'slider', default: 8, min: 4, max: 15, step: 0.5, label: 'Cabin Length' }
  params.cabin.height = { type: 'slider', default: 2.5, min: 1, max: 5, step: 0.25, label: 'Cabin Height' }
  params.cabin.color = { type: 'color', default: '#3498db', label: 'Window Tint' }
  params.cabin.tintOpacity = { type: 'slider', default: 70, min: 0, max: 100, step: 5, label: 'Tint Opacity %' }

  // Headlights
  params.headlights._type = 'Headlights'
  params.headlights.style = {
    type: 'radio',
    default: 'round',
    values: ['round', 'rectangular', 'modern'],
    captions: ['Round Classic', 'Rectangular', 'Modern LED'],
    label: 'Headlight Style'
  }
  params.headlights.color = { type: 'color', default: '#ffffcc', label: 'Light Color' }
  params.headlights.size = { type: 'slider', default: 0.8, min: 0.3, max: 1.5, step: 0.1, label: 'Size' }

  const bodyColor = hexToColor(params.color)

  // Main body shape varies by style
  let mainBody
  const baseBody = cuboid({ size: [params.length, params.width, params.height] })

  if (params.style === 'suv') {
    mainBody = colorize(bodyColor, translate([0, 0, params.height * 0.2], scale([1, 1, 1.3], baseBody)))
  } else if (params.style === 'truck') {
    const cab = cuboid({ size: [params.length * 0.4, params.width, params.height * 1.2] })
    const bed = cuboid({ size: [params.length * 0.55, params.width, params.height * 0.6] })
    mainBody = colorize(bodyColor, union(
      translate([params.length * 0.25, 0, params.height * 0.1], cab),
      translate([-params.length * 0.2, 0, -params.height * 0.2], bed)
    ))
  } else {
    mainBody = colorize(bodyColor, baseBody)
  }

  // Cabin/windshield
  const cabinColor = hexToColor(params.cabin.color)
  const tintAlpha = params.cabin.tintOpacity / 100
  const cabinOffset = params.style === 'coupe' ? -params.length / 6 : -params.length / 5
  const cabin = colorize(
    [...cabinColor, tintAlpha],
    translate(
      [cabinOffset, 0, params.height / 2 + params.cabin.height / 2 - 0.2],
      cuboid({ size: [params.cabin.length, params.width - 1, params.cabin.height] })
    )
  )

  // Headlights
  const headlightColor = hexToColor(params.headlights.color)
  const hlSize = params.headlights.size
  let headlight
  if (params.headlights.style === 'round') {
    headlight = sphere({ radius: hlSize * 0.5 })
  } else if (params.headlights.style === 'rectangular') {
    headlight = cuboid({ size: [hlSize * 0.3, hlSize, hlSize * 0.6] })
  } else {
    headlight = scale([0.3, 1.5, 0.4], sphere({ radius: hlSize * 0.5 }))
  }

  const hlY = params.width / 2 - 1
  const hlX = params.length / 2 - 0.5
  const hlZ = params.height * 0.1
  const headlights = colorize(headlightColor, union(
    translate([hlX, hlY, hlZ], headlight),
    translate([hlX, -hlY, hlZ], headlight)
  ))

  // Return as array to preserve individual colors (union destroys colors)
  return [mainBody, cabin, headlights]
}

// Spoiler part - demonstrates checkbox enable/disable pattern
const spoiler = (params) => {
  params._type = 'Spoiler'

  params.enabled = { type: 'checkbox', default: false, label: 'Add Spoiler' }
  params.width = { type: 'slider', default: 6, min: 3, max: 10, step: 0.5, label: 'Width' }
  params.height = { type: 'slider', default: 1.5, min: 0.5, max: 3, step: 0.25, label: 'Height' }
  params.angle = { type: 'slider', default: 15, min: 0, max: 45, step: 5, label: 'Angle (degrees)' }
  params.color = { type: 'color', default: '#2c3e50', label: 'Color' }
  params.style = {
    type: 'choice',
    default: 'wing',
    values: ['wing', 'lip', 'ducktail'],
    captions: ['GT Wing', 'Lip Spoiler', 'Ducktail'],
    label: 'Style'
  }

  if (!params.enabled) return []

  const spoilerColor = hexToColor(params.color)
  const angleRad = (params.angle * Math.PI) / 180

  let spoilerShape
  if (params.style === 'wing') {
    const wing = cuboid({ size: [0.3, params.width, params.height] })
    const supports = union(
      translate([0, params.width / 3, -params.height / 2], cylinder({ radius: 0.15, height: params.height })),
      translate([0, -params.width / 3, -params.height / 2], cylinder({ radius: 0.15, height: params.height }))
    )
    spoilerShape = rotateX(-angleRad, union(wing, supports))
  } else if (params.style === 'lip') {
    spoilerShape = scale([0.5, params.width / 2, params.height / 3], sphere({ radius: 1 }))
  } else {
    spoilerShape = rotateX(-angleRad * 0.5, cuboid({ size: [1, params.width, params.height * 0.6] }))
  }

  return colorize(spoilerColor, spoilerShape)
}

// Main car assembly
const main = (params) => {
  params._type = 'Car'

  // Top-level car parameters
  params.wheelbase = { type: 'slider', default: 14, min: 8, max: 25, step: 0.5, label: 'Wheelbase' }
  params.groundClearance = { type: 'slider', default: 2.5, min: 1, max: 6, step: 0.25, label: 'Ground Clearance' }

  // Preset configurations
  params.preset = {
    type: 'choice',
    default: 'custom',
    values: ['custom', 'sports', 'offroad', 'classic'],
    captions: ['Custom', 'Sports Car', 'Off-Road', 'Classic'],
    label: 'Quick Preset'
  }

  // Quality setting
  params.quality = {
    type: 'radio',
    default: 'medium',
    values: ['low', 'medium', 'high'],
    captions: ['Fast (Low)', 'Balanced', 'Quality (Slow)'],
    label: 'Render Quality'
  }

  // Link front wheels together and rear wheels together by default
  params.front.left._class = 'front-wheels'
  params.front.right._class = 'front-wheels'
  params.rear.left._class = 'rear-wheels'
  params.rear.right._class = 'rear-wheels'

  // Apply presets (this demonstrates how presets could modify defaults)
  if (params.preset === 'sports') {
    // Sports car typically has lower clearance, wider track
    if (params.groundClearance > 2) params.groundClearance = 1.5
  } else if (params.preset === 'offroad') {
    // Off-road has higher clearance
    if (params.groundClearance < 4) params.groundClearance = 4.5
  }

  const halfWheelbase = params.wheelbase / 2

  // Position axles - axle() returns an array, so we translate each part
  const frontAxleParts = axle(params.front).map(part => translate([halfWheelbase, 0, 0], part))
  const rearAxleParts = axle(params.rear).map(part => translate([-halfWheelbase, 0, 0], part))

  // Body sits above the axles
  const bodyHeight = params.groundClearance + 2
  const carBody = translate([0, 0, bodyHeight], body(params.body))

  // Spoiler at the back (only if enabled)
  const spoilerGeom = spoiler(params.spoiler)
  const result = [...frontAxleParts, ...rearAxleParts, carBody]

  // spoiler returns a single geometry when enabled, or empty array when disabled
  if (Array.isArray(spoilerGeom) && spoilerGeom.length === 0) {
    // Disabled - no spoiler
  } else {
    result.push(translate([-params.wheelbase / 2 - 2, 0, bodyHeight + 3], spoilerGeom))
  }

  return result
}

module.exports = { main }
