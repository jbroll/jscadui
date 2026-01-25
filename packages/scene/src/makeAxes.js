export const makeAxes = (len = 100, forceColors4) =>{
  // Validate length
  if (!Number.isFinite(len) || len <= 0) {
    len = 100
  }

  const lines = Float32Array.of(
    0,0,0, len,0,0,
    0,0,0, 0,len,0,
    0,0,0, 0,0,len,
  )
  let colors
  if(forceColors4){
    colors = Float32Array.of(
      1,0,0,1, 1,0,0,1,
      0,1,0,1, 0,1,0,1,
      0,0,1,1, 0,0,1,1,
    )
  }else{
    colors = Float32Array.of(
      1,0,0, 1,0,0,
      0,1,0, 0,1,0,
      0,0,1, 0,0,1,
    )
  }
  return {vertices:lines, colors, type:'lines'}
}
