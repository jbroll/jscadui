"use strict"
const { block, getParameterDefinitions } = require('../../libs/LEGO/lego.js')

const main = () => block({ width: 8, length: 8, type: 'baseplate' })

module.exports = { main, getParameterDefinitions }
