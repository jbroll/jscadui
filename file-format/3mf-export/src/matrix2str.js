/** transform for attribute as specified in 3mf format
 *
 * When objects need to be transformed for rotation, scaling, or translation purposes,
 * row-major affine 3D matrices (4x4) are used. The matrix SHOULD NOT be singular or nearly singular.
 * Transforms are of the form, where only the first 3 column values are specified.
 * The last column is never provided, and has the fixed values 0.0, 0.0, 0.0, 1.0.
 * When specified as an attribute value,
 * matrices have the form "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32"
 * where each value is a decimal number of arbitrary precision.
 *
 * @param {import("./defMatrix").mat4} m
 * @return string transform attribute value
*/
export const matrix2str = m=>{
    // Validate matrix input
    if (!m || typeof m !== 'object' || m.length !== 16) {
        throw new Error('Invalid matrix: must be an array-like object with 16 elements')
    }

    let str = ''
    for(let i=0; i<16; i++){
        if(i % 4 == 3) continue
        if(i>0) str += ' '
        // Handle NaN and Infinity by replacing with 0
        const val = m[i]
        if (typeof val !== 'number' || !Number.isFinite(val)) {
            str += 0
        } else {
            str += val
        }
    }
    return str
}