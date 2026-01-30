import{CommonToRegl as ht}from"@jscadui/format-regl";import*as V from"gl-mat4";import*as Y from"gl-vec3";var de={view:V.identity(new Float32Array(16)),projection:V.identity(new Float32Array(16)),matrix:V.identity(new Float32Array(16)),near:1,far:5e4,up:[0,0,1],eye:new Float32Array(3),position:[180,-180,220],target:[0,0,0],fov:Math.PI/4,aspect:1,viewport:[0,0,0,0],projectionType:"perspective"},Ue=Object.assign({},de),Je=(t,r,o)=>{let e=o.width/o.height,n=V.perspective(V.identity([]),r.fov,e,r.near,r.far),i=[0,0,o.width,o.height],a=t||{};return a.projection=n,a.aspect=e,a.viewport=i,a},Ze=(t,r)=>{r||(r=t);let{position:o,target:e,up:n}=r,i=Y.subtract([],o,e),a=Y.add(Y.create(),e,i),l=V.lookAt(V.create(),a,e,n),f=t||{};return f.position=a,f.view=l,f},pe={cameraState:de,defaults:Ue,setProjection:Je,update:Ze};import*as b from"gl-vec3";import*as j from"gl-mat4";var{max:le,min:me,sqrt:ve,PI:Qe,sin:O,cos:K,atan2:U}=Math,ge={limits:{minDistance:.01,maxDistance:1e4},drag:.27,EPS:1e-6,userControl:{zoom:!0,zoomSpeed:1,rotate:!0,rotateSpeed:1,pan:!0,panSpeed:1},autoRotate:{enabled:!1,speed:1}},he={thetaDelta:0,phiDelta:0,scale:1},$e=Object.assign({},he,ge),et=({controls:t,camera:r},o)=>{let{EPS:e,drag:n}=t,{position:i,target:a}=r,l=t.up?t.up:r.up,f=t.thetaDelta,u=t.phiDelta,w=t.scale,m=b.subtract([],i,a),d,p;l[2]===1?(d=U(m[0],m[1]),p=U(ve(m[0]*m[0]+m[1]*m[1]),m[2])):(d=U(m[0],m[2]),p=U(ve(m[0]*m[0]+m[2]*m[2]),m[1])),t.autoRotate?.enabled&&t.userControl?.rotate&&(f+=2*Math.PI/60/60*t.autoRotate.speed),d+=f,p+=u,p=le(e,me(Qe-e,p));let h=le(t.limits.minDistance,me(t.limits.maxDistance,b.length(m)*w));l[2]===1?(m[0]=h*O(p)*O(d),m[2]=h*K(p),m[1]=h*O(p)*K(d)):(m[0]=h*O(p)*O(d),m[1]=h*K(p),m[2]=h*O(p)*K(d));let D=b.add(b.create(),a,m),y=j.lookAt(j.create(),D,a,l),I=1-le(me(n,1),.01),C=b.distance(i,D)>.001;return{controls:{thetaDelta:f*I,phiDelta:u*I,scale:1,changed:C},camera:{position:D,view:y}}},tt=({controls:t,camera:r,speed:o=1},e)=>{let{thetaDelta:n,phiDelta:i}=t;return t.userControl?.rotate&&(n+=e[0]*o,i+=e[1]*o),{controls:{thetaDelta:n,phiDelta:i},camera:r}},ot=({controls:t,camera:r,speed:o=1},e=0)=>{let{scale:n}=t;if(t.userControl?.zoom&&r&&e!==void 0&&e!==0&&!isNaN(e)){let i=Math.sign(e)===0?1:Math.sign(e);e=e/e*i*o;let a=e+t.scale,l=b.distance(r.position,r.target)*a;l>t.limits.minDistance&&l<t.limits.maxDistance&&(n+=e)}return{controls:{scale:n},camera:r}},rt=({controls:t,camera:r,speed:o=1},e)=>{let{view:n}=r,a=b.distance(r.position,r.target)*.002*o,l=[n[0],n[4],n[8]],f=[n[1],n[5],n[9]],u=b.create();return b.scaleAndAdd(u,u,l,-e[0]*a),b.scaleAndAdd(u,u,f,e[1]*a),{controls:t,camera:{position:b.add(b.create(),r.position,u),target:b.add(b.create(),r.target,u)}}},it=({controls:t,camera:r,bounds:o},e=1.5)=>{if(!o||o.dia===0)return{controls:t,camera:r};let{fov:n,target:i,position:a}=r,{center:l,dia:f}=o,u=f*e/Math.tan(n/2),w=b.distance(i,a),m=u/w;return{camera:{target:l},controls:{scale:m}}},nt=({controls:t,camera:r},o={})=>{let e={position:[180,-180,220],target:[0,0,0]},n={thetaDelta:0,phiDelta:0,scale:1},i=o.camera||e,a=o.controls||n,l=r.up||[0,0,1],f=i.position||e.position,u=i.target||e.target,w=j.lookAt(j.create(),f,u,l),m=r.projection;return r.fov&&r.aspect&&(m=j.perspective([],r.fov,r.aspect,r.near||1,r.far||5e4)),{camera:{position:f,target:u,view:w,projection:m},controls:{thetaDelta:a.thetaDelta??0,phiDelta:a.phiDelta??0,scale:a.scale??1}}},at=(t,r,o=1)=>({...t,autoRotate:{enabled:r,speed:o}}),xe={controlsProps:ge,controlsState:he,defaults:$e,update:et,rotate:tt,zoom:ot,pan:rt,zoomToFit:it,reset:nt,setAutoRotate:at};var v={background:[1,1,1,1],meshColor:[0,.6,1,1],lightColor:[1,1,1,1],lightDirection:[.45,0,.9],lightPosition:[100,200,100],ambientLightAmount:.45,diffuseLightAmount:.65,specularLightAmount:.16,materialShininess:8};import*as N from"gl-mat4";import*as be from"gl-vec3";var we=N.identity([]),st=(t,r,o)=>(t[0]=o[0]*r[0]+o[4]*r[1]+o[8]*r[2],t[1]=o[1]*r[0]+o[5]*r[1]+o[9]*r[2],t[2]=o[2]*r[0]+o[6]*r[1]+o[10]*r[2],be.normalize(t,t)),ct=(t,r={})=>{let{fbo:o}=r,e={cull:{enable:!0},context:{lightDirection:v.lightDirection,inverseView:(n,i)=>{let a=i.camera?.view;return a&&N.invert([],a)||we}},uniforms:{view:(n,i)=>i.camera.view,eye:(n,i)=>i.camera.position,projection:(n,i)=>i.camera.projection,camNear:(n,i)=>i.camera.near,camFar:(n,i)=>i.camera.far,invertedView:n=>n.inverseView,lightPosition:(n,i)=>i?.rendering?.lightPosition??v.lightPosition,lightDirection:(n,i)=>{let a=i?.rendering?.lightDirection??v.lightDirection;return st([],a,n.inverseView)},lightView:n=>N.lookAt([],n.lightDirection,[0,0,0],[0,0,1]),lightProjection:N.ortho([],-25,-25,-20,20,-25,25),lightColor:(n,i)=>i?.rendering?.lightColor??v.lightColor,ambientLightAmount:(n,i)=>i?.rendering?.ambientLightAmount??v.ambientLightAmount,diffuseLightAmount:(n,i)=>i?.rendering?.diffuseLightAmount??v.diffuseLightAmount,specularLightAmount:(n,i)=>i?.rendering?.specularLightAmount??v.specularLightAmount,uMaterialShininess:(n,i)=>i?.rendering?.materialShininess??v.materialShininess,materialAmbient:[.5,.8,.3],materialDiffuse:[.5,.8,.3],materialSpecular:[.5,.8,.3]},framebuffer:o};return t(Object.assign({},e,r.extras))},Ce=ct;import*as P from"gl-mat4";var ye=`
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
`,De=`
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
`,Pe=`
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
`,Ae=`
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
`,Se=`
precision mediump float;

uniform mat4 model, view, projection;

attribute vec3 position;

varying vec4 _worldSpacePosition;

void main() {
  vec4 worldSpacePosition = model * vec4(position, 1);
  _worldSpacePosition = worldSpacePosition;
  gl_Position = projection * view * worldSpacePosition;
}
`,_e=`
#extension GL_OES_standard_derivatives : enable
precision mediump float;

uniform float ambientLightAmount;
uniform float diffuseLightAmount;
uniform vec4 ucolor;
uniform vec3 eye;

varying vec4 _worldSpacePosition;

void main () {
  // Compute flat normal from screen-space derivatives of world position
  vec3 dx = dFdx(_worldSpacePosition.xyz);
  vec3 dy = dFdy(_worldSpacePosition.xyz);
  vec3 normal = normalize(cross(dx, dy));

  // Compute light direction from camera position (camera-attached light)
  vec3 lightDir = normalize(eye - _worldSpacePosition.xyz);

  vec3 ambient = ambientLightAmount * ucolor.rgb;
  float cosTheta = abs(dot(normal, lightDir));
  vec3 diffuse = diffuseLightAmount * ucolor.rgb * cosTheta;

  gl_FragColor = vec4(ambient + diffuse, ucolor.a);
}
`;var lt=(t,r={extras:{}})=>{let o={useVertexColors:!0,dynamicCulling:!0,geometry:void 0,color:v.meshColor,visuals:{}},{geometry:e,dynamicCulling:n,useVertexColors:i,color:a,visuals:l}=Object.assign({},o,r),f=!!(e.indices&&e.indices.length>0),u=!!(e.normals&&e.normals.length>0),w="transparent"in l?l.transparent:!1,m=!!(i&&e.colors&&e.colors.length>0),d=e.transforms||P.create(),p=P.determinant(d)<0,h=n&&p?"front":"back",D,y;u?m?(D=Pe,y=Ae):(D=ye,y=De):(D=Se,y=_e);let I=P.invert(P.create(),d),C={primitive:"triangles",vert:D,frag:y,uniforms:{model:(T,c)=>d,ucolor:(T,c)=>c&&c.color?c.color:a,vColorToggler:(T,c)=>c&&c.useVertexColors&&c.useVertexColors===!0?1:0,unormal:(T,c)=>{let _=P.invert(P.create(),c.camera.view);return P.multiply(_,I,_),P.transpose(_,_),_}},attributes:{position:t.buffer({usage:"static",type:"float",data:e.positions})},cull:{enable:!0,face:h},depth:{enable:!0,mask:!w}};if(w&&(C.blend={enable:!0,func:{src:"src alpha",dst:"one minus src alpha"}}),e.cells)C.elements=e.cells;else if(f){let T=e.indices instanceof Uint32Array?"uint32":"uint16";C.elements=t.elements({usage:"static",type:T,data:e.indices})}else e.triangles?C.elements=e.triangles:C.count=e.positions.length/3;return u&&(C.attributes.normal=t.buffer({usage:"static",type:"float",data:e.normals})),m&&(C.attributes.color=t.buffer({usage:"static",type:"float",data:e.colors})),C=Object.assign({},C,r.extras),t(C)},Le=lt;import*as Me from"gl-mat4";var J=`
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
`,Z=`
precision mediump float;
uniform vec4 ucolor;

void main () {
  gl_FragColor = ucolor;
}
`,Q=`
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
`,$=`
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
`;var mt=(t,r={})=>{let o={color:v.meshColor,geometry:void 0},{geometry:e,color:n,transparent:i}=Object.assign({},o,r);"color"in e&&(n=e.color);let a=!!(e.indices&&e.indices.length>0),l=!!(e.normals&&e.normals.length>0),f=!!(e.colors&&e.colors.length>0),u=e.transforms||Me.create(),d={primitive:"lines",vert:f?Q:J,frag:f?$:Z,uniforms:{model:(p,h)=>h.model||u,ucolor:(p,h)=>h&&h.color?h.color:n,vColorToggler:(p,h)=>f?1:0},attributes:{position:t.buffer({usage:"static",type:"float",data:e.positions})},cull:{enable:!1},depth:{enable:!0,mask:!i}};if(i&&(d.blend={enable:!0,func:{src:"src alpha",dst:"one minus src alpha"}}),f&&(d.attributes.color=t.buffer({usage:"static",type:"float",data:e.colors})),a){let p=e.indices instanceof Uint32Array?"uint32":"uint16";d.elements=t.elements({usage:"static",type:p,data:e.indices})}else d.count=e.positions.length/3;return l&&(d.attributes.normal=t.buffer({usage:"static",type:"float",data:e.normals})),t(d)},ee=mt;import*as Ve from"gl-mat4";var ut=(t,r={})=>{let o={color:v.meshColor,geometry:void 0},{geometry:e,color:n,transparent:i}=Object.assign({},o,r);"color"in e&&(n=e.color);let a=!!(e.normals&&e.normals.length>0),l=!!(e.colors&&e.colors.length>0),f=e.transforms||Ve.create(),m={primitive:"line strip",vert:l?Q:J,frag:l?$:Z,uniforms:{model:(d,p)=>p.model||f,ucolor:(d,p)=>p&&p.color?p.color:n,vColorToggler:(d,p)=>l?1:0},attributes:{position:t.buffer({usage:"static",type:"float",data:e.positions})},cull:{enable:!1},depth:{enable:!0,mask:!i},count:e.positions.length/3};return i&&(m.blend={enable:!0,func:{src:"src alpha",dst:"one minus src alpha"}}),l&&(m.attributes.color=t.buffer({usage:"static",type:"float",data:e.colors})),a&&(m.attributes.normal=t.buffer({usage:"static",type:"float",data:e.normals})),t(m)},ze=ut;var Fe=`
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
`,je=`
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
`,Ne=`
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
`,Te=`
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
`;function ue(t,r){let{geometry:o,visuals:e,instanceMatrices:n,instanceCount:i}=r,a=e.useVertexColors&&o.colors,l=t.buffer({data:n,usage:"static"}),f={position:o.positions,normal:o.normals,instanceMatrix0:{buffer:l,divisor:1,stride:64,offset:0},instanceMatrix1:{buffer:l,divisor:1,stride:64,offset:16},instanceMatrix2:{buffer:l,divisor:1,stride:64,offset:32},instanceMatrix3:{buffer:l,divisor:1,stride:64,offset:48}};a&&(f.vcolor=o.colors);let u=a?Ne:Fe,w=a?Te:je,m={view:t.prop("camera.view"),projection:t.prop("camera.projection"),lightDirection:v.lightDirection,lightColor:v.lightColor,ambientAmount:v.ambientLightAmount,diffuseAmount:v.diffuseLightAmount,specularAmount:v.specularLightAmount,shininess:v.materialShininess};a||(m.color=t.prop("color"));let d={vert:u,frag:w,attributes:f,uniforms:m,instances:i,cull:{enable:!0,face:"back"},depth:{enable:!0,mask:!0}};return o.indices?d.elements=o.indices:d.count=o.positions.length/3,e.transparent&&(d.blend={enable:!0,func:{srcRGB:"src alpha",srcAlpha:"one",dstRGB:"one minus src alpha",dstAlpha:"one minus src alpha"}},d.depth.mask=!1),t(d)}var ke=()=>({drawMesh:Le,drawLines:ee,drawLineStrip:ze,drawMeshInstanced:ue,drawGrid:ee,drawAxis:ee});import{makeGrid as ft,makeAxes as dt}from"@jscadui/scene";var Ie=(t={})=>ft(t),Re=(t=100)=>dt(t,!0),pt=({showGrid:t=!0,showAxes:r=!0,gridSize:o=200,axisLength:e=100,gridColor1:n,gridColor2:i}={})=>{let a=[];if(t){let l={size:o};n&&(l.color1=n),i&&(l.color2=i),a.push(...Ie(l))}return r&&a.push(Re(e)),a},vt={light:{color1:[0,0,0,.2],color2:[0,0,.6,.1]},dark:{color1:[1,1,1,.2],color2:[.6,.6,1,.1]}};import*as x from"gl-vec3";function Ee(t){if(!t||t.length===0)return[[0,0,0],[0,0,0]];let r=Array.isArray(t)&&Array.isArray(t[0]),o=r?t[0].length:3,e=new Array(o),n=new Array(o);for(let i=0;i<o;i++)e[i]=1/0,n[i]=-1/0;if(r)for(let i of t)for(let a=0;a<o;a++){let l=i[a];l>n[a]&&(n[a]=l),l<e[a]&&(e[a]=l)}else for(let i=0;i<t.length;i+=o)for(let a=0;a<o;a++){let l=t[i+a];l>n[a]&&(n[a]=l),l<e[a]&&(e[a]=l)}return[e,n]}function Ge(t){if(!t||t.length===0)return{min:[0,0,0],max:[0,0,0],center:[0,0,0],size:[0,0,0],dia:0};let r=Array.isArray(t[0])?t.flat():t,o=null;for(let f of r){if(!f||!f.positions)continue;let u=Ee(f.positions);f.transforms&&(u=u.map(w=>{let m=x.create();return x.transformMat4(m,w,f.transforms),[...m]})),o?(x.min(o[0],o[0],u[0]),x.max(o[1],o[1],u[1])):o=u}if(!o)return{min:[0,0,0],max:[0,0,0],center:[0,0,0],size:[0,0,0],dia:0};let e=x.min(x.create(),o[1],o[0]),n=x.max(x.create(),o[1],o[0]),i=x.subtract(x.create(),n,e),a=x.scale(x.create(),i,.5);a=x.add(a,e,a);let l=x.distance(a,n);return{min:[...e],max:[...n],center:[...a],size:[...i],dia:l}}function gt(t){if(!t||t.length===0)return{min:[0,0,0],max:[0,0,0],center:[0,0,0],size:[0,0,0],dia:0};let r=t.filter(o=>o&&o.geometry).map(o=>({positions:o.geometry.positions,transforms:o.geometry.transforms}));return Ge(r)}function oo(t){let r=t&&typeof t=="object"&&"prepareRender"in t&&"drawCommands"in t,o,e,n,i;r&&(o=t.prepareRender,e=t.drawCommands,n=t.cameras,i=t.controls);let a=.002,l=1,f=.08,u=[0,0],w=[0,0],m=0,d=!0,p=[1,1,1],h,D,y,I=ht(),C=[];function T(s,g){function A(G){try{return{gl:s.getContext(G,g),type:G}}catch{return null}}return A("webgl")||A("experimental-webgl")||A("webgl-experimental")||A("webgl2")}let c={},_,Be=({canvas:s,cameraPosition:g=[180,-180,220],cameraTarget:A=[0,0,0],bg:G=[1,1,1]})=>{_=r?n.perspective:pe,h=r?i.orbit:xe,c.canvas=s,s.style.background="black",c.camera=Object.assign({},_.defaults),g&&(c.camera.position=g),A&&(c.camera.target=A),te({width:s.width,height:s.height}),c.controls=Object.assign({},h.defaults);let{gl:B,type:fe}=T(s);if(!B)throw new Error("WebGL not supported");let q={glOptions:{gl:B,optionalExtensions:["oes_element_index_uint","oes_standard_derivatives"]}};r?y=o(q):import("regl").then(W=>{let ae=W.default,S=ae(q.glOptions),F=new Map,H=ke(),se=Ce(S);y=L=>{L.rendering=Object.assign({},v,L.rendering),se(L,()=>{S.clear({color:L.rendering.background,depth:1}),L.entities&&L.entities.sort((X,M)=>{let ce=X.visuals?.transparent??!1,k=M.visuals?.transparent??!1;return ce===k?0:ce?1:-1}).forEach(X=>{let{visuals:M}=X;if((M?.show??!0)&&M.drawCmd&&H[M.drawCmd]){let k;M.cacheId!==void 0&&(k=F.get(M.cacheId)),k||(M.cacheId=F.size,k=H[M.drawCmd](S,X),F.set(M.cacheId,k)),k({...X,...M,camera:L.camera})}})}),S.poll()},z()}).catch(W=>{throw console.error("Failed to load regl:",W),W}),D={camera:c.camera,rendering:{background:G},drawCommands:r?{drawAxis:e.drawAxis,drawGrid:e.drawGrid,drawLines:e.drawLines,drawMesh:e.drawMesh}:{},entities:C},z()},R,We=typeof requestAnimationFrame>"u"?setTimeout:requestAnimationFrame;function z(s=8){R||!y||(R=We(Ye,s))}let He=()=>{if(u[0]||u[1]){let s=h.rotate({controls:c.controls,camera:c.camera,speed:a},u);c.controls={...c.controls,...s.controls},u=[0,0]}if(w[0]||w[1]){let s=h.pan({controls:c.controls,camera:c.camera,speed:l},w);c.controls={...c.controls,...s.controls},w=[0,0],c.camera.position=s.camera.position,c.camera.target=s.camera.target}if(m){let s=h.zoom({controls:c.controls,camera:c.camera,speed:f},m);c.controls={...c.controls,...s.controls},m=0}},Ye=s=>{R=null,He();let g=h.update({controls:c.controls,camera:c.camera});c.controls={...c.controls,...g.controls},c.controls.changed&&z(16),c.camera.position=g.camera.position,_.update(c.camera),D.entities=C,y&&y(D),d&&(d="")};function te({width:s,height:g}){c.canvas.width=s,c.canvas.height=g,_.setProjection(c.camera,c.camera,{width:s,height:g}),_.update(c.camera,c.camera),z()}let Oe=(s=[1,1,1])=>{D.rendering.background=s,z()},Xe=(s=[1,1,1])=>{p=s},qe={pan:({dx:s,dy:g})=>{w[0]+=s,w[1]+=g,z()},resize:te,rotate:({dx:s,dy:g})=>{u[0]-=s,u[1]-=g,z()},zoom:({dy:s})=>{m+=s,z()}};function Ke(s){let g=qe[s.action];if(!g)throw new Error("no handler for type: "+s.action);g(s)}function oe(s){Ke(s)}let re=0,ie=0,ne=!1,E,xt=s=>{if(!ne)return;let g={dx:re-s.pageX,dy:s.pageY-ie},A=s.shiftKey===!0||s.touches&&s.touches.length>2;g.action=A?"pan":"rotate",oe(g),re=s.pageX,ie=s.pageY,s.preventDefault()},wt=s=>{ne=!0,re=s.pageX,ie=s.pageY,E.setPointerCapture(s.pointerId)},bt=s=>{ne=!1,E.releasePointerCapture(s.pointerId)},Ct=s=>{oe({action:"zoom",dy:s.deltaY}),s.preventDefault()};return function(g,{camera:A={},bg:G=[1,1,1]}={}){E=document.createElement("CANVAS"),g.appendChild(E);let B=()=>{R&&(cancelAnimationFrame(R),R=null),C.length=0,y?.destroy?.(),y=null,g.removeChild(E)};try{Be({canvas:E,cameraPosition:A.position,cameraTarget:A.target,bg:G})}catch(S){throw B(),S}function fe({position:S,target:F}){S&&(c.camera.position=S),F&&(c.camera.target=F),z()}function q(){return{position:Array.from(c.camera.position),target:c.camera.target,fov:c.camera.fov*(180/Math.PI),aspect:c.camera.aspect}}let W=()=>({forceColors4:!1,forceIndex:!1,forceNormals:!0,useInstances:!0});function ae(S){C.length=0;let F=[];S.items.forEach(H=>{H.items.forEach(se=>{let L=I(se,S,p);L.transparent?F.push(L):C.push(L)})}),F.forEach(H=>C.push(H)),z()}return{sendCmd:oe,resize:te,destroy:B,state:c,getCamera:q,setCamera:fe,setBg:Oe,setMeshColor:Xe,getViewerEnv:W,setScene:ae}}}export{oo as RenderRegl,Ee as boundingBox,Ge as computeBounds,gt as computeEntityBounds,ke as createDrawCommands,pt as createSceneHelpers,vt as gridColors,Re as makeAxes,Ie as makeGrid,xe as orbitControls,pe as perspectiveCamera,v as renderDefaults};
//# sourceMappingURL=index.js.map
