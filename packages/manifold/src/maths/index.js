/**
 * Math utilities - re-exports from @jscad/modeling/src/maths.
 *
 * These are pure math operations that don't involve geometry conversion.
 */

// Re-export all JSCAD math modules from main entry point
import * as jscad from '@jscad/modeling-core'
export const { vec2, vec3, vec4, mat4, plane, line2, line3, utils } = jscad.maths

// Common constants
export const TAU = Math.PI * 2
export const PHI = (1 + Math.sqrt(5)) / 2

// Degree/radian conversion
export const degToRad = (degrees) => degrees * (Math.PI / 180)
export const radToDeg = (radians) => radians * (180 / Math.PI)
