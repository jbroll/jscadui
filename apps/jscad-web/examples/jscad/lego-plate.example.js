"use strict"
const { block, getParameterDefinitions } = require('../../libs/LEGO/lego.js')

const main = () => block({ width: 2, length: 4, height: 1 / 3 })

module.exports = { main, getParameterDefinitions }
