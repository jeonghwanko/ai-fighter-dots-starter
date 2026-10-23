import{s as e}from"./palette-B6MFynYc.js";import{r as t,t as n}from"./native-city-art-finish-BZDHQ1na.js";import{a as r,o as i,r as a,t as o}from"./NativeCityBuildingGrade-wes7tkUs.js";import{Jt as s,O as c,Q as l,a as u,b as d,ft as f,i as p,q as m,rn as h,u as g,vn as _,yn as v}from"./three.core-Dt6LFlTl.js";import{c as y,n as b,s as x}from"./NativeCityWallRelief-DgaUovU8.js";import{a as S}from"./NativeCityPaintedFacePlan-Bd27WAXL.js";var C=`
 uniform sampler2D houseAmbient0;uniform sampler2D houseAmbient1;uniform float houseAmbientStrength;
 varying vec2 houseAt;varying float houseAtlas;
 float houseVisibility(){return houseAtlas<.5?texture2D(houseAmbient0,houseAt).r:texture2D(houseAmbient1,houseAt).r;}
 vec3 houseContactLighting(vec3 color,float visibility,float paintedLuma){
  if(nprDebug>2.5)return vec3(visibility);
  if(nprDebug>.5)return color;
  // Protect already-dark painted joinery. Open plaster stays exactly as bright as before.
  float amount=(1.-visibility)*houseAmbientStrength*mix(.35,1.,smoothstep(.08,.45,paintedLuma));
  return color*mix(vec3(1.),vec3(${new g(e[i.shadowTint]).toArray().map(e=>e.toFixed(4)).join(`,`)})*.38,amount);
 }
`,w=4,T=2048,E=T/w,D=new WeakMap,O=2048;function k(e){let t=D.get(e);if(t)return t;let n=j(e);for(;;){let t=n.next();if(t.done)return D.set(e,t.value),t.value}}async function A(e,t,n){if(D.has(e))return;let r=j(e);for(;;){let i=r.next();if(i.done){D.set(e,i.value);return}if(await t.breathe(),n())return}}function*j(t){let n=new Map,r=[],i=new Set;for(let a of t){if(!a.paintedVolume||!S(a.paintedVolume))continue;r.push(a.id);let t=new Map(a.paintedVolume.faces.filter(e=>e.part===`city-kit-wall`).map(e=>[e.id,e])),o=new Map;for(let r of a.paintedVolume.faces){r.repeatTexture&&i.add(r.path);let s=n.get(r.path);s||(s={faces:[],vertices:0,indices:0},n.set(r.path,s));let c=x(a.paintedVolume,r,1),l=y(a.paintedVolume,r),u=`tintKey`in r&&typeof r.tintKey==`string`?r.tintKey:void 0,d=new g(u?e[u]:e.white),f=`parentWall`in r&&typeof r.parentWall==`string`?t.get(r.parentWall)??r:r,p=r.part===`city-kit-roof`?2:+(r.part===`city-kit-wall`||r.part===`city-kit-relief`);p===1&&!o.has(f.id)&&o.set(f.id,b(a.paintedVolume,f));let m=p===1?o.get(f.id):[1,0,-1e6,1e6],h=r.surface?.occlusionUv;if(!h||h.length!==c.uv.length)throw Error(`Missing house visibility UV: ${a.id}/${r.id}`);s.faces.push({grid:c,normal:l,tint:[d.r,d.g,d.b],kind:p,span:m,ambientUv:h,atlas:r.surface.occlusionAtlas,anchor:a.anchor}),s.vertices+=c.positions.length/3,s.indices+=c.indices.length}yield}let a=new Map;for(let[e,t]of n){let n=t.vertices,r=Math.ceil(t.faces.length/E),i=new Float32Array(n*3),o=new Float32Array(n*2),s=new Float32Array(n*2),c=new Float32Array(n),l=new Float32Array(T*r*4),d=n>65535?new Uint32Array(t.indices):new Uint16Array(t.indices),f=0,m=0;for(let[e,n]of t.faces.entries()){(e+1)%O===0&&(yield);let{grid:t}=n,r=t.positions.length/3;i.set(t.positions,f*3),o.set(t.uv,f*2),s.set(n.ambientUv,f*2);for(let e of t.indices)d[m++]=e+f;c.fill(e,f,f+r);let a=e*w*4;l[a]=n.normal[0],l[a+1]=n.normal[1],l[a+2]=n.normal[2],l[a+3]=n.kind,l[a+4]=n.tint[0],l[a+5]=n.tint[1],l[a+6]=n.tint[2],l[a+7]=n.atlas,l[a+8]=n.span[0],l[a+9]=n.span[1],l[a+10]=n.span[2],l[a+11]=n.span[3],l[a+12]=n.anchor[0],l[a+13]=n.anchor[1],f+=r}let h=new u().setAttribute(`position`,new p(i,3));h.computeBoundingSphere();let g=h.boundingSphere;a.set(e,Object.freeze({positions:i,uv:o,ambientUv:s,faceIndex:c,faces:l,faceRows:r,indices:d,bounds:g})),yield}return Object.freeze({ids:Object.freeze(r),repeatPaths:Object.freeze([...i]),batches:a})}var M=class{world;ids=new Set;meshes=[];faceTables=[];enabled=!1;constructor(y,b,x){this.world=y;let S=k(b);for(let e of S.ids)this.ids.add(e);for(let e of S.repeatPaths){let t=x.get(e);t&&(t.wrapS=t.wrapT=s,t.needsUpdate=!0)}for(let[y,b]of S.batches){let S=x.get(y);if(!S)throw Error(`Missing city kit material ${y}`);y.endsWith(`-roof.webp`)&&(S.wrapS=S.wrapT=s,S.needsUpdate=!0);let D=new u;D.setAttribute(`position`,new p(b.positions,3)),D.setAttribute(`uv`,new p(b.uv,2)),D.setAttribute(`ambientUv`,new p(b.ambientUv,2)),D.setAttribute(`faceIndex`,new p(b.faceIndex,1)),D.setIndex(new p(b.indices,1)),D.boundingSphere=b.bounds.clone();let O=new d(b.faces,T,b.faceRows,f,c);O.minFilter=O.magFilter=l,O.generateMipmaps=!1,O.needsUpdate=!0,this.faceTables.push(O);let k=i.paths.map(e=>x.get(e));if(k.length!==2||k.some(e=>!e))throw Error(`Missing house visibility atlases`);let A=new h({side:2,transparent:!1,depthWrite:!0,uniforms:{nprDebug:{value:0},faceTable:{value:O},image:{value:S},focus:{value:new _},viewDepth:{value:new _(0,-1)},mist:{value:new g(e.cityDaySkyHorizon)},houseAmbient0:{value:k[0]},houseAmbient1:{value:k[1]},houseAmbientStrength:{value:i.strength},sun:{value:new v(...t())}},vertexShader:`uniform highp sampler2D faceTable;attribute float faceIndex;varying vec2 atmosphereAnchor;attribute vec2 ambientUv;varying vec2 houseAt;varying float houseAtlas;
          varying vec4 span;varying vec2 at;varying vec3 n;varying vec3 p;varying vec3 tint;varying float kind;
          void main(){int f=int(faceIndex);ivec2 face=ivec2(f%${E}*${w},f/${E});
            vec4 normalKind=texelFetch(faceTable,face,0),coatAtlas=texelFetch(faceTable,face+ivec2(1,0),0);
            span=texelFetch(faceTable,face+ivec2(2,0),0);atmosphereAnchor=texelFetch(faceTable,face+ivec2(3,0),0).xy;
            n=normalKind.xyz;kind=normalKind.w;tint=coatAtlas.rgb;houseAtlas=coatAtlas.a;
            houseAt=ambientUv;at=uv;p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`varying vec2 atmosphereAnchor;varying vec4 span;uniform sampler2D image;uniform vec2 focus;uniform vec2 viewDepth;uniform vec3 sun;uniform vec3 mist;
          varying vec2 at;varying vec3 n;varying vec3 p;varying vec3 tint;varying float kind;
          ${o}
          ${r}
          ${C}
          ${a}
          void main(){vec4 c=texture2D(image,at);if(c.a<.15)discard;
            float luminance=dot(c.rgb,vec3(.2126,.7152,.0722));
            float coatLight=max(.05,dot(tint,vec3(.2126,.7152,.0722)));
            // Each roof already uses the matching blue/red/green painted material.
            // A small glaze varies it without replacing its original chroma.
            if(kind>1.5)c.rgb=mix(c.rgb,tint*(luminance/coatLight),${n.paint.roofGlaze});
            else if(kind>.5){float plaster=smoothstep(.45,.78,luminance);c.rgb=mix(c.rgb,tint*(luminance/coatLight),plaster*${n.paint.wallGlaze});}
            c.rgb=cityBuildingGrade(c.rgb,kind);
            c.rgb=mix(vec3(dot(c.rgb,vec3(.2126,.7152,.0722))),c.rgb,${n.building.saturation.toFixed(4)});
            float along=dot(p.xy,span.xy);
            c.rgb=cityNprLighting(c.rgb,n,max(0.,dot(normalize(n),sun)),1.,1.,kind);
            c.rgb=houseContactLighting(c.rgb,houseVisibility(),luminance);
            if(kind>.5&&kind<1.5)c.rgb=cityNprWallEdge(c.rgb,min(along-span.z,span.w-along));
            float fade=cityDistanceMix(atmosphereAnchor,focus,viewDepth);
            gl_FragColor=vec4(nprDebug<.5?cityAtmosphere(c.rgb,mist,fade):c.rgb,1.);
            #include <colorspace_fragment>
          }`}),j=new m(D,A);j.name=`city-kit-${y}`,j.visible=!1,this.world.add(j),this.meshes.push(j)}}has(e){return this.ids.has(e)}update(e,t,n=[0,-1]){this.enabled=e;for(let r of this.meshes)r.visible=e,r.material.uniforms.focus.value.set(...t),r.material.uniforms.viewDepth.value.set(...n).normalize()}get visibleIds(){return this.enabled?[...this.ids]:[]}get batchCount(){return this.meshes.length}dispose(){for(let e of this.meshes)this.world.remove(e),e.geometry.dispose(),e.material.dispose();for(let e of this.faceTables)e.dispose();this.meshes.length=0,this.faceTables.length=0,this.ids.clear()}};export{A as n,M as t};