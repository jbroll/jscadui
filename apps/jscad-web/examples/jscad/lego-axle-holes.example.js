"use strict"
const { block, getParameterDefinitions } = require('../../libs/LEGO/lego.js')

const main = () => block({ width: 2, length: 2, height: 1 / 3, verticalAxleHoles: true })

module.exports = { main, getParameterDefinitions }
