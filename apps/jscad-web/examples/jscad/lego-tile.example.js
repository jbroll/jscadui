"use strict"
const { block, getParameterDefinitions } = require('../../libs/LEGO/lego.js')

const main = () => block({ width: 2, length: 3, height: 1 / 3, type: 'tile' })

module.exports = { main, getParameterDefinitions }
