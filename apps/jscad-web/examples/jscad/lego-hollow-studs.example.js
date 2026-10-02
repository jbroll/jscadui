"use strict"
const { block, getParameterDefinitions } = require('../../libs/LEGO/lego.js')

const main = () => block({ width: 2, length: 2, studType: 'hollow' })

module.exports = { main, getParameterDefinitions }
