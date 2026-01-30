import{CommonToRegl as ft}from"@jscadui/format-regl";import*as V from"gl-mat4";import*as Y from"gl-vec3";var le={view:V.identity(new Float32Array(16)),projection:V.identity(new Float32Array(16)),matrix:V.identity(new Float32Array(16)),near:1,far:5e4,up:[0,0,1],eye:new Float32Array(3),position:[180,-180,220],target:[0,0,0],fov:Math.PI/4,aspect:1,viewport:[0,0,0,0],projectionType:"perspective"},Xe=Object.assign({},le),qe=(e,r,o)=>{let t=o.width/o.height,n=V.perspective(V.identity([]),r.fov,t,r.near,r.far),i=[0,0,o.width,o.height],a=e||{};return a.projection=n,a.aspect=t,a.viewport=i,a},Ke=(e,r)=>{r||(r=e);let{position:o,target:t,up:n}=r,i=Y.subtract([],o,t),a=Y.add(Y.create(),t,i),l=V.lookAt(V.create(),a,t,n),f=e||{};return f.position=a,f.view=l,f},me={cameraState:le,defaults:Xe,setProjection:qe,update:Ke};import*as w from"gl-vec3";import*as N from"gl-mat4";var{max:ne,min:ae,sqrt:ue,PI:Oe,sin:X,cos:O,atan2:U}=Math,fe={limits:{minDistance:.01,maxDistance:1e4},drag:.27,EPS:1e-6,userControl:{zoom:!0,zoomSpeed:1,rotate:!0,rotateSpeed:1,pan:!0,panSpeed:1},autoRotate:{enabled:!1,speed:1}},de={thetaDelta:0,phiDelta:0,scale:1},Ue=Object.assign({},de,fe),Je=({controls:e,camera:r},o)=>{let{EPS:t,drag:n}=e,{position:i,target:a}=r,l=e.up?e.up:r.up,f=e.thetaDelta,u=e.phiDelta,b=e.scale,m=w.subtract([],i,a),d,x;l[2]===1?(d=U(m[0],m[1]),x=U(ue(m[0]*m[0]+m[1]*m[1]),m[2])):(d=U(m[0],m[2]),x=U(ue(m[0]*m[0]+m[2]*m[2]),m[1])),e.autoRotate?.enabled&&e.userControl?.rotate&&(f+=2*Math.PI/60/60*e.autoRotate.speed),d+=f,x+=u,x=ne(t,ae(Oe-t,x));let v=ne(e.limits.minDistance,ae(e.limits.maxDistance,w.length(m)*b));l[2]===1?(m[0]=v*X(x)*X(d),m[2]=v*O(x),m[1]=v*X(x)*O(d)):(m[0]=v*X(x)*X(d),m[1]=v*O(x),m[2]=v*X(x)*O(d));let z=w.add(w.create(),a,m),P=N.lookAt(N.create(),z,a,l),I=1-ne(ae(n,1),.01),C=w.distance(i,z)>.001;return{controls:{thetaDelta:f*I,phiDelta:u*I,scale:1,changed:C},camera:{position:z,view:P}}},Ze=({controls:e,camera:r,speed:o=1},t)=>{let{thetaDelta:n,phiDelta:i}=e;return e.userControl?.rotate&&(n+=t[0]*o,i+=t[1]*o),{controls:{thetaDelta:n,phiDelta:i},camera:r}},Qe=({controls:e,camera:r,speed:o=1},t=0)=>{let{scale:n}=e;if(e.userControl?.zoom&&r&&t!==void 0&&t!==0&&!isNaN(t)){let i=Math.sign(t)===0?1:Math.sign(t);t=t/t*i*o;let a=t+e.scale,l=w.distance(r.position,r.target)*a;l>e.limits.minDistance&&l<e.limits.maxDistance&&(n+=t)}return{controls:{scale:n},camera:r}},$e=({controls:e,camera:r,speed:o=1},t)=>{let{view:n}=r,a=w.distance(r.position,r.target)*.002*o,l=[n[0],n[4],n[8]],f=[n[1],n[5],n[9]],u=w.create();return w.scaleAndAdd(u,u,l,-t[0]*a),w.scaleAndAdd(u,u,f,t[1]*a),{controls:e,camera:{position:w.add(w.create(),r.position,u),target:w.add(w.create(),r.target,u)}}},et=({controls:e,camera:r,bounds:o},t=1.5)=>{if(!o||o.dia===0)return{controls:e,camera:r};let{fov:n,target:i,position:a}=r,{center:l,dia:f}=o,u=f*t/Math.tan(n/2),b=w.distance(i,a),m=u/b;return{camera:{target:l},controls:{scale:m}}},tt=({controls:e,camera:r},o={})=>{let t={position:[180,-180,220],target:[0,0,0]},n={thetaDelta:0,phiDelta:0,scale:1},i=o.camera||t,a=o.controls||n,l=r.up||[0,0,1],f=i.position||t.position,u=i.target||t.target,b=N.lookAt(N.create(),f,u,l),m=r.projection;return r.fov&&r.aspect&&(m=N.perspective([],r.fov,r.aspect,r.near||1,r.far||5e4)),{camera:{position:f,target:u,view:b,projection:m},controls:{thetaDelta:a.thetaDelta??0,phiDelta:a.phiDelta??0,scale:a.scale??1}}},ot=(e,r,o=1)=>({...e,autoRotate:{enabled:r,speed:o}}),pe={controlsProps:fe,controlsState:de,defaults:Ue,update:Je,rotate:Ze,zoom:Qe,pan:$e,zoomToFit:et,reset:tt,setAutoRotate:ot};var g={background:[1,1,1,1],meshColor:[0,.6,1,1],lightColor:[1,1,1,1],lightDirection:[.45,0,.9],lightPosition:[100,200,100],ambientLightAmount:.45,diffuseLightAmount:.65,specularLightAmount:.16,materialShininess:8};import*as _ from"gl-mat4";import*as ge from"gl-vec3";var ve=_.identity([]),rt=(e,r,o)=>(e[0]=o[0]*r[0]+o[4]*r[1]+o[8]*r[2],e[1]=o[1]*r[0]+o[5]*r[1]+o[9]*r[2],e[2]=o[2]*r[0]+o[6]*r[1]+o[10]*r[2],ge.normalize(e,e)),it=(e,r={})=>{let{fbo:o}=r,t={cull:{enable:!0},context:{lightDirection:g.lightDirection,inverseView:(n,i)=>{let a=i.camera?.view;return a&&_.invert([],a)||ve}},uniforms:{view:(n,i)=>i.camera.view,eye:(n,i)=>i.camera.position,projection:(n,i)=>i.camera.projection,camNear:(n,i)=>i.camera.near,camFar:(n,i)=>i.camera.far,invertedView:n=>n.inverseView,lightPosition:(n,i)=>i?.rendering?.lightPosition??g.lightPosition,lightDirection:(n,i)=>{let a=i?.rendering?.lightDirection??g.lightDirection;return rt([],a,n.inverseView)},lightView:n=>_.lookAt([],n.lightDirection,[0,0,0],[0,0,1]),lightProjection:_.ortho([],-25,-25,-20,20,-25,25),lightColor:(n,i)=>i?.rendering?.lightColor??g.lightColor,ambientLightAmount:(n,i)=>i?.rendering?.ambientLightAmount??g.ambientLightAmount,diffuseLightAmount:(n,i)=>i?.rendering?.diffuseLightAmount??g.diffuseLightAmount,specularLightAmount:(n,i)=>i?.rendering?.specularLightAmount??g.specularLightAmount,uMaterialShininess:(n,i)=>i?.rendering?.materialShininess??g.materialShininess,materialAmbient:[.5,.8,.3],materialDiffuse:[.5,.8,.3],materialSpecular:[.5,.8,.3]},framebuffer:o};return e(Object.assign({},t,r.extras))},he=it;import*as y from"gl-mat4";var xe=`
precision mediump float;

uniform float camNear, camFar;
uniform mat4 model, view, projection;

attribute vec3 position, normal;

varying vec3 surfaceNormal, surfacePosition;
varying vec4 _worldSpacePosition;

void main() {
  surfacePosition = position;
  surfaceNormal = normal;
  vec4 worldSpacePosition = model * vec4(position, 1);
  _worldSpacePosition = worldSpacePosition;

  gl_Position = projection * view * model * vec4(position, 1);
}
`,we=`
precision mediump float;

varying vec3 surfaceNormal;
uniform float ambientLightAmount;
uniform float diffuseLightAmount;
uniform vec4 ucolor;
uniform vec3 eye;  // Camera position

varying vec4 _worldSpacePosition;

void main () {
  // Compute light direction from camera position toward surface (camera-attached light)
  vec3 lightDir = normalize(eye - _worldSpacePosition.xyz);

  vec3 ambient = ambientLightAmount * ucolor.rgb;
  float cosTheta = dot(normalize(surfaceNormal), lightDir);
  vec3 diffuse = diffuseLightAmount * ucolor.rgb * clamp(cosTheta, 0.0, 1.0);

  gl_FragColor = vec4((ambient + diffuse), ucolor.a);
}
`,be=`
precision mediump float;

uniform float camNear, camFar;
uniform mat4 model, view, projection, unormal;

attribute vec3 position, normal;
attribute vec4 color;

varying vec3 surfaceNormal, surfacePosition;
varying vec4 _worldSpacePosition;
varying vec4 vColor;

void main() {
  surfacePosition = (unormal * vec4(position, 1.0)).xyz;
  surfaceNormal = normalize((unormal * vec4(normal, 1.0)).xyz);
  vec4 worldSpacePosition = model * vec4(position, 1);
  _worldSpacePosition = worldSpacePosition;

  vColor = color;

  gl_Position = projection * view * model * vec4(position, 1);
}
`,Ce=`
precision mediump float;

varying vec3 surfaceNormal, surfacePosition;

uniform float ambientLightAmount;
uniform float diffuseLightAmount;
uniform float specularLightAmount;

uniform vec3 eye;  // Camera position
uniform vec4 lightColor;
uniform float uMaterialShininess;

varying vec4 vColor;
uniform vec4 ucolor;
uniform float vColorToggler;

varying vec4 _worldSpacePosition;

void main () {
  vec4 endColor = vColor * vColorToggler + ucolor * (1.0 - vColorToggler);

  // Compute light direction from camera position (camera-attached light)
  vec3 lightDir = normalize(eye - _worldSpacePosition.xyz);
  vec3 normal = normalize(surfaceNormal);

  vec3 ambient = ambientLightAmount * endColor.rgb;

  float diffuseWeight = dot(normal, lightDir);
  vec3 diffuse = diffuseLightAmount * endColor.rgb * clamp(diffuseWeight, 0.0, 1.0);

  // Specular (Phong)
  vec4 specularColor = lightColor;
  vec3 eyeDirection = normalize(eye - _worldSpacePosition.xyz);
  vec3 reflectionDirection = reflect(-lightDir, normal);
  float specularLightWeight = pow(max(dot(reflectionDirection, eyeDirection), 0.0), uMaterialShininess);
  vec3 specular = specularColor.rgb * specularLightWeight * specularLightAmount;

  gl_FragColor = vec4((ambient + diffuse + specular), endColor.a);
}
`;var nt=(e,r={extras:{}})=>{let o={useVertexColors:!0,dynamicCulling:!0,geometry:void 0,color:g.meshColor,visuals:{}},{geometry:t,dynamicCulling:n,useVertexColors:i,color:a,visuals:l}=Object.assign({},o,r),f=!!(t.indices&&t.indices.length>0),u=!!(t.normals&&t.normals.length>0),b="transparent"in l?l.transparent:!1,m=!!(i&&t.colors&&t.colors.length>0),d=t.transforms||y.create(),x=y.determinant(d)<0,v=n&&x?"front":"back",z=m?be:xe,P=m?Ce:we,I=y.invert(y.create(),d),C={primitive:"triangles",vert:z,frag:P,uniforms:{model:(T,c)=>d,ucolor:(T,c)=>c&&c.color?c.color:a,vColorToggler:(T,c)=>c&&c.useVertexColors&&c.useVertexColors===!0?1:0,unormal:(T,c)=>{let M=y.invert(y.create(),c.camera.view);return y.multiply(M,I,M),y.transpose(M,M),M}},attributes:{position:e.buffer({usage:"static",type:"float",data:t.positions})},cull:{enable:!0,face:v},depth:{enable:!0,mask:!b}};if(b&&(C.blend={enable:!0,func:{src:"src alpha",dst:"one minus src alpha"}}),t.cells)C.elements=t.cells;else if(f){let T=t.indices instanceof Uint32Array?"uint32":"uint16";C.elements=e.elements({usage:"static",type:T,data:t.indices})}else t.triangles?C.elements=t.triangles:C.count=t.positions.length/3;return u&&(C.attributes.normal=e.buffer({usage:"static",type:"float",data:t.normals})),m&&(C.attributes.color=e.buffer({usage:"static",type:"float",data:t.colors})),C=Object.assign({},C,r.extras),e(C)},ye=nt;import*as Se from"gl-mat4";var De=`
precision mediump float;

uniform float camNear, camFar;
uniform mat4 model, view, projection;

attribute vec3 position, normal;

varying vec3 surfaceNormal, surfacePosition;
varying vec4 _worldSpacePosition;

void main() {
  surfacePosition = position;
  surfaceNormal = normal;
  vec4 worldSpacePosition = model * vec4(position, 1);
  _worldSpacePosition = worldSpacePosition;

  gl_Position = projection * view * model * vec4(position, 1);
}
`,Ae=`
precision mediump float;
uniform vec4 ucolor;

void main () {
  gl_FragColor = ucolor;
}
`,Pe=`
precision mediump float;

uniform float camNear, camFar;
uniform mat4 model, view, projection;

attribute vec3 position, normal;
attribute vec4 color;

varying vec3 surfaceNormal, surfacePosition;
varying vec4 _worldSpacePosition;
varying vec4 vColor;

void main() {
  surfacePosition = position;
  surfaceNormal = normal;
  vec4 worldSpacePosition = model * vec4(position, 1);
  _worldSpacePosition = worldSpacePosition;

  vColor = color;

  gl_Position = projection * view * model * vec4(position, 1);
}
`,Me=`
precision mediump float;
varying vec3 surfaceNormal, surfacePosition;

uniform float ambientLightAmount;
uniform float diffuseLightAmount;
uniform float specularLightAmount;

uniform vec3 lightDirection;
uniform vec4 lightColor;
uniform float uMaterialShininess;

varying vec4 vColor;
uniform vec4 ucolor;
uniform float vColorToggler;

varying vec4 _worldSpacePosition;

void main () {
  vec4 endColor = vColor * vColorToggler + ucolor * (1.0 - vColorToggler);

  vec3 ambient = ambientLightAmount * endColor.rgb;

  float diffuseWeight = dot(surfaceNormal, lightDirection);
  vec3 diffuse = diffuseLightAmount * endColor.rgb * clamp(diffuseWeight, 0.0, 1.0);

  // Specular
  vec4 specularColor = lightColor;
  vec3 eyeDirection = normalize(surfacePosition.xyz);
  vec3 reflectionDirection = reflect(-lightDirection, -surfaceNormal);
  float specularLightWeight = pow(max(dot(reflectionDirection, eyeDirection), 0.0), uMaterialShininess);
  vec3 specular = specularColor.rgb * specularLightWeight * specularLightAmount;

  gl_FragColor = vec4((ambient + diffuse + specular), endColor.a);
}
`;var at=(e,r={})=>{let o={color:g.meshColor,geometry:void 0},{geometry:t,color:n,transparent:i}=Object.assign({},o,r);"color"in t&&(n=t.color);let a=!!(t.indices&&t.indices.length>0),l=!!(t.normals&&t.normals.length>0),f=!!(t.colors&&t.colors.length>0),u=t.transforms||Se.create(),d={primitive:"lines",vert:f?Pe:De,frag:f?Me:Ae,uniforms:{model:(x,v)=>v.model||u,ucolor:(x,v)=>v&&v.color?v.color:n,vColorToggler:(x,v)=>f?1:0},attributes:{position:e.buffer({usage:"static",type:"float",data:t.positions})},cull:{enable:!1},depth:{enable:!0,mask:!i}};if(i&&(d.blend={enable:!0,func:{src:"src alpha",dst:"one minus src alpha"}}),f&&(d.attributes.color=e.buffer({usage:"static",type:"float",data:t.colors})),a){let x=t.indices instanceof Uint32Array?"uint32":"uint16";d.elements=e.elements({usage:"static",type:x,data:t.indices})}else d.count=t.positions.length/3;return l&&(d.attributes.normal=e.buffer({usage:"static",type:"float",data:t.normals})),e(d)},J=at;var Le=`
precision highp float;

// Per-vertex attributes
attribute vec3 position, normal;

// Per-instance attributes (matrix columns)
attribute vec4 instanceMatrix0;
attribute vec4 instanceMatrix1;
attribute vec4 instanceMatrix2;
attribute vec4 instanceMatrix3;

// Global uniforms
uniform mat4 view, projection;
uniform vec3 lightDirection;

// Varyings for fragment shader
varying vec3 vNormal;
varying vec3 vLightDir;
varying vec3 vViewDir;

void main() {
  // Reconstruct instance model matrix from columns
  mat4 instanceModel = mat4(
    instanceMatrix0,
    instanceMatrix1,
    instanceMatrix2,
    instanceMatrix3
  );

  // Transform position by instance matrix then view/projection
  vec4 worldPos = instanceModel * vec4(position, 1.0);
  gl_Position = projection * view * worldPos;

  // Transform normal by instance matrix (ignoring translation)
  mat3 normalMatrix = mat3(instanceModel);
  vNormal = normalize(normalMatrix * normal);

  // Light direction (camera-attached light)
  vLightDir = normalize(lightDirection);

  // View direction for specular
  vec3 cameraPos = -view[3].xyz * mat3(view);
  vViewDir = normalize(cameraPos - worldPos.xyz);
}
`,Ve=`
precision highp float;

uniform vec4 color;
uniform vec3 lightColor;
uniform float ambientAmount, diffuseAmount, specularAmount, shininess;

varying vec3 vNormal;
varying vec3 vLightDir;
varying vec3 vViewDir;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(vLightDir);
  vec3 viewDir = normalize(vViewDir);

  // Ambient
  vec3 ambient = ambientAmount * color.rgb;

  // Diffuse (Lambertian)
  float diff = max(dot(normal, lightDir), 0.0);
  vec3 diffuse = diffuseAmount * diff * color.rgb;

  // Specular (Blinn-Phong)
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, halfDir), 0.0), shininess);
  vec3 specular = specularAmount * spec * lightColor;

  vec3 result = ambient + diffuse + specular;
  gl_FragColor = vec4(result, color.a);
}
`,ze=`
precision highp float;

// Per-vertex attributes
attribute vec3 position, normal;
attribute vec4 vcolor;

// Per-instance attributes (matrix columns)
attribute vec4 instanceMatrix0;
attribute vec4 instanceMatrix1;
attribute vec4 instanceMatrix2;
attribute vec4 instanceMatrix3;

// Global uniforms
uniform mat4 view, projection;
uniform vec3 lightDirection;

// Varyings
varying vec3 vNormal;
varying vec3 vLightDir;
varying vec3 vViewDir;
varying vec4 vColor;

void main() {
  // Reconstruct instance model matrix from columns
  mat4 instanceModel = mat4(
    instanceMatrix0,
    instanceMatrix1,
    instanceMatrix2,
    instanceMatrix3
  );

  // Transform position
  vec4 worldPos = instanceModel * vec4(position, 1.0);
  gl_Position = projection * view * worldPos;

  // Transform normal
  mat3 normalMatrix = mat3(instanceModel);
  vNormal = normalize(normalMatrix * normal);

  // Light and view directions
  vLightDir = normalize(lightDirection);
  vec3 cameraPos = -view[3].xyz * mat3(view);
  vViewDir = normalize(cameraPos - worldPos.xyz);

  // Pass through vertex color
  vColor = vcolor;
}
`,je=`
precision highp float;

uniform vec3 lightColor;
uniform float ambientAmount, diffuseAmount, specularAmount, shininess;

varying vec3 vNormal;
varying vec3 vLightDir;
varying vec3 vViewDir;
varying vec4 vColor;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(vLightDir);
  vec3 viewDir = normalize(vViewDir);

  // Ambient
  vec3 ambient = ambientAmount * vColor.rgb;

  // Diffuse
  float diff = max(dot(normal, lightDir), 0.0);
  vec3 diffuse = diffuseAmount * diff * vColor.rgb;

  // Specular
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, halfDir), 0.0), shininess);
  vec3 specular = specularAmount * spec * lightColor;

  vec3 result = ambient + diffuse + specular;
  gl_FragColor = vec4(result, vColor.a);
}
`;function se(e,r){let{geometry:o,visuals:t,instanceMatrices:n,instanceCount:i}=r,a=t.useVertexColors&&o.colors,l=e.buffer({data:n,usage:"static"}),f={position:o.positions,normal:o.normals,instanceMatrix0:{buffer:l,divisor:1,stride:64,offset:0},instanceMatrix1:{buffer:l,divisor:1,stride:64,offset:16},instanceMatrix2:{buffer:l,divisor:1,stride:64,offset:32},instanceMatrix3:{buffer:l,divisor:1,stride:64,offset:48}};a&&(f.vcolor=o.colors);let u=a?ze:Le,b=a?je:Ve,m={view:e.prop("camera.view"),projection:e.prop("camera.projection"),lightDirection:g.lightDirection,lightColor:g.lightColor,ambientAmount:g.ambientLightAmount,diffuseAmount:g.diffuseLightAmount,specularAmount:g.specularLightAmount,shininess:g.materialShininess};a||(m.color=e.prop("color"));let d={vert:u,frag:b,attributes:f,uniforms:m,instances:i,cull:{enable:!0,face:"back"},depth:{enable:!0,mask:!0}};return o.indices?d.elements=o.indices:d.count=o.positions.length/3,t.transparent&&(d.blend={enable:!0,func:{srcRGB:"src alpha",srcAlpha:"one",dstRGB:"one minus src alpha",dstAlpha:"one minus src alpha"}},d.depth.mask=!1),e(d)}var Fe=()=>({drawMesh:ye,drawLines:J,drawMeshInstanced:se,drawGrid:J,drawAxis:J});import{makeGrid as st,makeAxes as ct}from"@jscadui/scene";var Ne=(e={})=>st(e),_e=(e=100)=>ct(e,!0),lt=({showGrid:e=!0,showAxes:r=!0,gridSize:o=200,axisLength:t=100,gridColor1:n,gridColor2:i}={})=>{let a=[];if(e){let l={size:o};n&&(l.color1=n),i&&(l.color2=i),a.push(...Ne(l))}return r&&a.push(_e(t)),a},mt={light:{color1:[0,0,0,.2],color2:[0,0,.6,.1]},dark:{color1:[1,1,1,.2],color2:[.6,.6,1,.1]}};import*as h from"gl-vec3";function Te(e){if(!e||e.length===0)return[[0,0,0],[0,0,0]];let r=Array.isArray(e)&&Array.isArray(e[0]),o=r?e[0].length:3,t=new Array(o),n=new Array(o);for(let i=0;i<o;i++)t[i]=1/0,n[i]=-1/0;if(r)for(let i of e)for(let a=0;a<o;a++){let l=i[a];l>n[a]&&(n[a]=l),l<t[a]&&(t[a]=l)}else for(let i=0;i<e.length;i+=o)for(let a=0;a<o;a++){let l=e[i+a];l>n[a]&&(n[a]=l),l<t[a]&&(t[a]=l)}return[t,n]}function ke(e){if(!e||e.length===0)return{min:[0,0,0],max:[0,0,0],center:[0,0,0],size:[0,0,0],dia:0};let r=Array.isArray(e[0])?e.flat():e,o=null;for(let f of r){if(!f||!f.positions)continue;let u=Te(f.positions);f.transforms&&(u=u.map(b=>{let m=h.create();return h.transformMat4(m,b,f.transforms),[...m]})),o?(h.min(o[0],o[0],u[0]),h.max(o[1],o[1],u[1])):o=u}if(!o)return{min:[0,0,0],max:[0,0,0],center:[0,0,0],size:[0,0,0],dia:0};let t=h.min(h.create(),o[1],o[0]),n=h.max(h.create(),o[1],o[0]),i=h.subtract(h.create(),n,t),a=h.scale(h.create(),i,.5);a=h.add(a,t,a);let l=h.distance(a,n);return{min:[...t],max:[...n],center:[...a],size:[...i],dia:l}}function ut(e){if(!e||e.length===0)return{min:[0,0,0],max:[0,0,0],center:[0,0,0],size:[0,0,0],dia:0};let r=e.filter(o=>o&&o.geometry).map(o=>({positions:o.geometry.positions,transforms:o.geometry.transforms}));return ke(r)}function Kt(e){let r=e&&typeof e=="object"&&"prepareRender"in e&&"drawCommands"in e,o,t,n,i;r&&(o=e.prepareRender,t=e.drawCommands,n=e.cameras,i=e.controls);let a=.002,l=1,f=.08,u=[0,0],b=[0,0],m=0,d=!0,x=[1,1,1],v,z,P,I=ft(),C=[];function T(s,p){function D(G){try{return{gl:s.getContext(G,p),type:G}}catch{return null}}return D("webgl")||D("experimental-webgl")||D("webgl-experimental")||D("webgl2")}let c={},M,Ie=({canvas:s,cameraPosition:p=[180,-180,220],cameraTarget:D=[0,0,0],bg:G=[1,1,1]})=>{M=r?n.perspective:me,v=r?i.orbit:pe,c.canvas=s,s.style.background="black",c.camera=Object.assign({},M.defaults),p&&(c.camera.position=p),D&&(c.camera.target=D),Z({width:s.width,height:s.height}),c.controls=Object.assign({},v.defaults);let{gl:B,type:ce}=T(s);if(!B)throw new Error("WebGL not supported");let K={glOptions:{gl:B,optionalExtensions:["oes_element_index_uint"]}};r?P=o(K):import("regl").then(W=>{let oe=W.default,A=oe(K.glOptions),F=new Map,H=Fe(),re=he(A);P=S=>{S.rendering=Object.assign({},g,S.rendering),re(S,()=>{A.clear({color:S.rendering.background,depth:1}),S.entities&&S.entities.sort((q,L)=>{let ie=q.visuals?.transparent??!1,k=L.visuals?.transparent??!1;return ie===k?0:ie?1:-1}).forEach(q=>{let{visuals:L}=q;if((L?.show??!0)&&L.drawCmd&&H[L.drawCmd]){let k;L.cacheId!==void 0&&(k=F.get(L.cacheId)),k||(L.cacheId=F.size,k=H[L.drawCmd](A,q),F.set(L.cacheId,k)),k({...q,...L,camera:S.camera})}})}),A.poll()},j()}).catch(W=>{throw console.error("Failed to load regl:",W),W}),z={camera:c.camera,rendering:{background:G},drawCommands:r?{drawAxis:t.drawAxis,drawGrid:t.drawGrid,drawLines:t.drawLines,drawMesh:t.drawMesh}:{},entities:C},j()},R,Re=typeof requestAnimationFrame>"u"?setTimeout:requestAnimationFrame;function j(s=8){R||!P||(R=Re(Ge,s))}let Ee=()=>{if(u[0]||u[1]){let s=v.rotate({controls:c.controls,camera:c.camera,speed:a},u);c.controls={...c.controls,...s.controls},u=[0,0]}if(b[0]||b[1]){let s=v.pan({controls:c.controls,camera:c.camera,speed:l},b);c.controls={...c.controls,...s.controls},b=[0,0],c.camera.position=s.camera.position,c.camera.target=s.camera.target}if(m){let s=v.zoom({controls:c.controls,camera:c.camera,speed:f},m);c.controls={...c.controls,...s.controls},m=0}},Ge=s=>{R=null,Ee();let p=v.update({controls:c.controls,camera:c.camera});c.controls={...c.controls,...p.controls},c.controls.changed&&j(16),c.camera.position=p.camera.position,M.update(c.camera),z.entities=C,P&&P(z),d&&(d="")};function Z({width:s,height:p}){c.canvas.width=s,c.canvas.height=p,M.setProjection(c.camera,c.camera,{width:s,height:p}),M.update(c.camera,c.camera),j()}let Be=(s=[1,1,1])=>{z.rendering.background=s,j()},We=(s=[1,1,1])=>{x=s},He={pan:({dx:s,dy:p})=>{b[0]+=s,b[1]+=p,j()},resize:Z,rotate:({dx:s,dy:p})=>{u[0]-=s,u[1]-=p,j()},zoom:({dy:s})=>{m+=s,j()}};function Ye(s){let p=He[s.action];if(!p)throw new Error("no handler for type: "+s.action);p(s)}function Q(s){Ye(s)}let $=0,ee=0,te=!1,E,dt=s=>{if(!te)return;let p={dx:$-s.pageX,dy:s.pageY-ee},D=s.shiftKey===!0||s.touches&&s.touches.length>2;p.action=D?"pan":"rotate",Q(p),$=s.pageX,ee=s.pageY,s.preventDefault()},pt=s=>{te=!0,$=s.pageX,ee=s.pageY,E.setPointerCapture(s.pointerId)},vt=s=>{te=!1,E.releasePointerCapture(s.pointerId)},gt=s=>{Q({action:"zoom",dy:s.deltaY}),s.preventDefault()};return function(p,{camera:D={},bg:G=[1,1,1]}={}){E=document.createElement("CANVAS"),p.appendChild(E);let B=()=>{R&&(cancelAnimationFrame(R),R=null),C.length=0,P?.destroy?.(),P=null,p.removeChild(E)};try{Ie({canvas:E,cameraPosition:D.position,cameraTarget:D.target,bg:G})}catch(A){throw B(),A}function ce({position:A,target:F}){A&&(c.camera.position=A),F&&(c.camera.target=F),j()}function K(){return{position:Array.from(c.camera.position),target:c.camera.target,fov:c.camera.fov*(180/Math.PI),aspect:c.camera.aspect}}let W=()=>({forceColors4:!1,forceIndex:!1,forceNormals:!0,useInstances:!0});function oe(A){C.length=0;let F=[];A.items.forEach(H=>{H.items.forEach(re=>{let S=I(re,A,x);S.transparent?F.push(S):C.push(S)})}),F.forEach(H=>C.push(H)),j()}return{sendCmd:Q,resize:Z,destroy:B,state:c,getCamera:K,setCamera:ce,setBg:Be,setMeshColor:We,getViewerEnv:W,setScene:oe}}}export{Kt as RenderRegl,Te as boundingBox,ke as computeBounds,ut as computeEntityBounds,Fe as createDrawCommands,lt as createSceneHelpers,mt as gridColors,_e as makeAxes,Ne as makeGrid,pe as orbitControls,me as perspectiveCamera,g as renderDefaults};
//# sourceMappingURL=index.js.map
