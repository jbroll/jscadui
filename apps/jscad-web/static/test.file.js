import * as jscad from '@jscad/modeling'

export const main =({// @jscad-params
  mesh,// {type:"file"}
  check: _check=false,
  bla: _bla='test',
  bla1: _bla1='test', // {type:'choice', values:["a","b"]}
})=>{  
  return mesh ? mesh : jscad.primitives.sphere()

}
