"use strict"
const { block, getParameterDefinitions } = require('../../libs/LEGO/lego.js')

const main = () => block({ width: 1, length: 8, horizontalHoles: true })

module.exports = { main, getParameterDefinitions }
