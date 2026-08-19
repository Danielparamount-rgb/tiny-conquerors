/* ═══════════════════ 3D RENDERER (rewrite, stage 1) ═══════════════════
   Raw WebGL — no library, because the artifact CSP blocks external scripts and
   the game has to stay one self-contained file.

   The camera is the important idea here. Rather than inventing a 3D camera and
   trying to make it look like the old view, the vertex shader reproduces the 2D
   projection EXACTLY:

       screenX = ((wx - wz) * IW - cam.x) * zoom
       screenY = ((wx + wz) * IH - height - cam.y) * zoom

   which is what isoPt() + the ctx transform in draw() already do. So both
   renderers frame the world identically and can be compared frame for frame,
   and every existing screen-space thing (tap hit-testing, the minimap, camera
   clamping) keeps working untouched while the rewrite proceeds.

   Stage 1 renders the ground only: a real height-mapped mesh, textured with the
   existing terrain canvas — so all the shoreline/water work carries straight
   over, and hills become actual geometry instead of the painted rim lines the
   2D view fakes them with. Units and buildings are later stages. */
/* ---- minimal mat4 (column-major, GL order) ---------------------------- */
function m4mul(a,b){
  const o=new Float32Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){
    let s=0; for(let k=0;k<4;k++) s+=a[k*4+r]*b[c*4+k];
    o[c*4+r]=s;
  }
  return o;
}
function m4ortho(l,r,b,t,n,f){
  const o=new Float32Array(16);
  o[0]=2/(r-l); o[5]=2/(t-b); o[10]=-2/(f-n); o[15]=1;
  o[12]=-(r+l)/(r-l); o[13]=-(t+b)/(t-b); o[14]=-(f+n)/(f-n);
  return o;
}
function m4inv(m){
  const o=new Float32Array(16);
  const a00=m[0],a01=m[1],a02=m[2],a03=m[3],  a10=m[4],a11=m[5],a12=m[6],a13=m[7],
        a20=m[8],a21=m[9],a22=m[10],a23=m[11],a30=m[12],a31=m[13],a32=m[14],a33=m[15];
  const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10,
        b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12,
        b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30,
        b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
  let d=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
  if(!d)return null;
  d=1/d;
  o[0]=(a11*b11-a12*b10+a13*b09)*d;  o[1]=(a02*b10-a01*b11-a03*b09)*d;
  o[2]=(a31*b05-a32*b04+a33*b03)*d;  o[3]=(a22*b04-a21*b05-a23*b03)*d;
  o[4]=(a12*b08-a10*b11-a13*b07)*d;  o[5]=(a00*b11-a02*b08+a03*b07)*d;
  o[6]=(a32*b02-a30*b05-a33*b01)*d;  o[7]=(a20*b05-a22*b02+a23*b01)*d;
  o[8]=(a10*b10-a11*b08+a13*b06)*d;  o[9]=(a01*b08-a00*b10-a03*b06)*d;
  o[10]=(a30*b04-a31*b02+a33*b00)*d; o[11]=(a21*b02-a20*b04-a23*b00)*d;
  o[12]=(a11*b07-a10*b09-a12*b06)*d; o[13]=(a00*b09-a01*b07+a02*b06)*d;
  o[14]=(a31*b01-a30*b03-a32*b00)*d; o[15]=(a20*b03-a21*b01+a22*b00)*d;
  return o;
}
function m4xform(m,x,y,z){        // full transform incl. w divide
  const w=m[3]*x+m[7]*y+m[11]*z+m[15]||1;
  return {x:(m[0]*x+m[4]*y+m[8]*z+m[12])/w,
          y:(m[1]*x+m[5]*y+m[9]*z+m[13])/w,
          z:(m[2]*x+m[6]*y+m[10]*z+m[14])/w};
}
/* Ray vs axis-aligned box. Returns the ENTRY t (which may legitimately be
   negative — the ray origin plane passes through the camera target, so about
   half the visible world is behind it) or null. */
function rayBox(r,x0,y0,z0,x1,y1,z1){
  let tn=-1e30,tf=1e30,a,b,s;
  if(Math.abs(r.dx)<1e-9){if(r.ox<x0||r.ox>x1)return null;}
  else{a=(x0-r.ox)/r.dx;b=(x1-r.ox)/r.dx;if(a>b){s=a;a=b;b=s;}if(a>tn)tn=a;if(b<tf)tf=b;}
  if(Math.abs(r.dy)<1e-9){if(r.oy<y0||r.oy>y1)return null;}
  else{a=(y0-r.oy)/r.dy;b=(y1-r.oy)/r.dy;if(a>b){s=a;a=b;b=s;}if(a>tn)tn=a;if(b<tf)tf=b;}
  if(Math.abs(r.dz)<1e-9){if(r.oz<z0||r.oz>z1)return null;}
  else{a=(z0-r.oz)/r.dz;b=(z1-r.oz)/r.dz;if(a>b){s=a;a=b;b=s;}if(a>tn)tn=a;if(b<tf)tf=b;}
  return tn>tf?null:tn;
}
function m4look(ex,ey,ez,cx,cy,cz){
  let fx=cx-ex,fy=cy-ey,fz=cz-ez;
  let rl=1/Math.hypot(fx,fy,fz); fx*=rl; fy*=rl; fz*=rl;
  // right = normalize(cross(f, worldUp)), worldUp=(0,1,0)  ->  (-f.z, 0, f.x)
  // NB: this was written (f.z,0,-f.x) at first, i.e. LEFT. The ground axes
  // looked right only because homeYaw had been set 180° round to compensate,
  // which cannot compensate world Y — so hills projected downward.
  let sx=-fz,sy=0,sz=fx;
  rl=1/Math.hypot(sx,sy,sz); sx*=rl; sy*=rl; sz*=rl;
  // up = cross(right, f)
  const ux=sy*fz-sz*fy, uy=sz*fx-sx*fz, uz=sx*fy-sy*fx;
  const o=new Float32Array(16);
  o[0]=sx; o[4]=sy; o[8]=sz;   o[12]=-(sx*ex+sy*ey+sz*ez);
  o[1]=ux; o[5]=uy; o[9]=uz;   o[13]=-(ux*ex+uy*ey+uz*ez);
  o[2]=-fx;o[6]=-fy;o[10]=-fz; o[14]=  fx*ex+fy*ey+fz*ez;
  o[15]=1;
  return o;
}
const R3={
  gl:null, prog:null, tex:null, texVer:-1, mesh:null, meshKey:'', failed:false,
  /* Real 3D camera. Daniel chose a rotating/tilting camera, so the Stage-1
     trick of hard-coding the 2D isometric projection into the shader is gone —
     this is a genuine orthographic view matrix and the world can be spun.
     HOME is the classic isometric orientation: yaw 45°, pitch atan(1/√2)
     = 35.264°, which is what produces the 2:1 diamond grid the game has always
     used. Pan and zoom still come from G.cam, so the existing controls, the
     minimap jump and camera clamping keep driving the 3D view unchanged;
     rotation is the only genuinely new axis. */
  /* HOME orientation, derived from the 2D grid rather than guessed — all three
     of these were wrong on the first attempt and the errors were only visible
     by measuring a projected tile step against isoPt:
     - pitch 30° = asin(IH/IW) = asin(0.5). NOT atan(1/√2)=35.264°. That is the
       TRUE isometric angle (equal foreshortening on all three axes); this game
       draws a 2:1 DIMETRIC grid (IW 26 / IH 13), which is 30°. Using 35.264°
       stretched everything vertically by 2/√3 = 1.1547.
     - HS converts a 2D "height in pixels" into world tiles such that at the home
       pitch a 10px hill projects to exactly 10px, matching the 2D renderer.
       It is a CONSTANT, not a function of the live pitch: height is a real world
       quantity, so its on-screen size is supposed to change as you tilt. */
  yaw:Math.PI/4, pitch:Math.PI/6, PPT:26*Math.SQRT2,
  homeYaw:Math.PI/4, homePitch:Math.PI/6,
  get HS(){ return 1/(Math.cos(Math.PI/6)*this.PPT); },
  /* Pitch limits, both of which guard real failures rather than taste.
     FLOOR 0.35 rad (20°): below atan(HILL*HS)=0.3043 a descending ray can be
       shallower than the terrain slope, so (ray.y - groundH) stops being
       monotonic and the bisection in pickGround can bracket the WRONG
       crossing — clicks land on the far side of a hill. Measured monotone at
       0.35/0.30/0.22 and NOT monotone at 0.12. 0.35 also keeps 1/sin(pitch)
       at 2.9, so a 1px finger error stays ~0.1 tiles.
     CEILING 1.45 rad (83°): at exactly π/2 the view direction is parallel to
       world up, cross(f,(0,1,0)) is the ZERO vector, and m4look normalises it
       to NaN — the entire view matrix becomes NaN and the screen goes blank.
     Clamped in setPitch so no path (drag, keybind, a future saved camera)
     can reach a degenerate angle. */
  PITCH_MIN:0.35, PITCH_MAX:1.45,
  setPitch(v){ this.pitch=Math.max(this.PITCH_MIN,Math.min(this.PITCH_MAX,v)); },
  // world target (tile coords) that the 2D camera is currently centred on
  target(){
    const sx=G.cam.x+vw/G.cam.z/2, sy=G.cam.y+vh/G.cam.z/2;
    return {x:(sx/IW+sy/IH)/2, y:(sy/IH-sx/IW)/2};
  },
  mvp(){
    const t=this.target();
    const cp=Math.cos(this.pitch), sp=Math.sin(this.pitch);
    const D=MAP*2;                                   // far enough to clear the map
    const ex=t.x+cp*Math.sin(this.yaw)*D, ey=sp*D, ez=t.y+cp*Math.cos(this.yaw)*D;
    const V=m4look(ex,ey,ez,t.x,0,t.y);
    const hw=vw/G.cam.z/(2*this.PPT), hh=vh/G.cam.z/(2*this.PPT);
    const P=m4ortho(-hw,hw,-hh,hh,-MAP*4,MAP*4);
    return m4mul(P,V);
  },
  /* ONE source of truth for screen<->world on the CPU. basis/project/sd2t are
     mvp() in closed form — for an orthographic lookAt the unprojection is
     affine, so the ray direction is CONSTANT over the screen and the origin is
     linear in (sx,sy). No matrix inverse, no allocation, per input event.
     Cached on everything it reads, so a mid-frame G.cam write (drag-pan, arrow
     keys, minimap drag) can never leave a stale basis behind. */
  _bk:[NaN,NaN,NaN,NaN,NaN,NaN,NaN], _b:null,
  basis(){
    const k=this._bk;
    if(k[0]===this.yaw&&k[1]===this.pitch&&k[2]===G.cam.x&&k[3]===G.cam.y
       &&k[4]===G.cam.z&&k[5]===vw&&k[6]===vh)return this._b;
    k[0]=this.yaw;k[1]=this.pitch;k[2]=G.cam.x;k[3]=G.cam.y;k[4]=G.cam.z;k[5]=vw;k[6]=vh;
    const cy=Math.cos(this.yaw),sy=Math.sin(this.yaw);
    const cp=Math.cos(this.pitch),sp=Math.sin(this.pitch);
    const t=this.target();
    return this._b={
      fx:-cp*sy, fy:-sp, fz:-cp*cy,   // view dir (eye->target), unit
      rx: cy,    ry: 0,  rz:-sy,      // screen RIGHT = normalize(cross(f,(0,1,0)))
      ux:-sy*sp, uy: cp, uz:-cy*sp,   // screen UP    = cross(right,f)
      tx:t.x, tz:t.y, sc:this.PPT*G.cam.z, sp, cp, cy, sy};
  },
  /* world -> canvas CSS px. `h` is a height in 2D PIXELS, so every existing
     constant ports unchanged: the -8/-10 body lift, IHT, HILL, elevF(...)*10.
     `d` is a depth key that grows toward the camera — use it wherever the 2D
     code relied on "bigger screen y = nearer", which only holds at home yaw. */
  project(x,y,h){
    const B=this.basis(),wx=x-B.tx,wy=h*this.HS,wz=y-B.tz;
    return {x: vw/2 + (wx*B.rx + wy*B.ry + wz*B.rz)*B.sc,
            y: vh/2 - (wx*B.ux + wy*B.uy + wz*B.uz)*B.sc,
            d: -(wx*B.fx + wy*B.fy + wz*B.fz)};
  },
  /* screen-pixel delta -> tile delta on a horizontal plane; exact inverse of
     project()'s x/y part. At home it evaluates to the 2D basis exactly:
     sd2t(1,0) = (1/52, -1/52) and sd2t(0,1) = (1/26, 1/26). */
  sd2t(dsx,dsy){
    const B=this.basis(),A=dsx/B.sc,C=dsy/(B.sc*B.sp);
    return {x:A*B.cy + C*B.sy, y:-A*B.sy + C*B.cy};
  },
  /* ---- picking ------------------------------------------------------------
     Ground height in WORLD units at a fractional tile position. Must mirror
     buildMesh exactly or picks drift from what is drawn: same corner average,
     same HILL, bilinear across the quad. Heights are authored in 2D pixels, so
     divide by IW to get tiles. */
  cornerH(cx,cy){
    const N=MAP,ev=(x,y)=>(x<0||y<0||x>=N||y>=N||!G.elev)?0:(G.elev[y*N+x]?1:0);
    return (ev(cx-1,cy-1)+ev(cx,cy-1)+ev(cx-1,cy)+ev(cx,cy))/4*this.HILL;
  },
  groundH(fx,fz){
    const x0=Math.floor(fx),z0=Math.floor(fz),tx=fx-x0,tz=fz-z0;
    const h00=this.cornerH(x0,z0),h10=this.cornerH(x0+1,z0),
          h01=this.cornerH(x0,z0+1),h11=this.cornerH(x0+1,z0+1);
    /* Interpolate on the MATCHING TRIANGLE, not bilinearly. buildMesh emits
       (a,c,b),(b,c,d), so the split diagonal runs along tx+tz=1. Bilinear
       disagrees with the drawn surface by up to 1.25px on saddle quads
       (verified exhaustively over all 512 3x3 elevation patterns) — about
       0.11 tiles of pick slip at the pitch floor, i.e. picks drifting off
       what is actually on screen. Continuous across the diagonal: both
       branches give h10 at (1,0) and h01 at (0,1). */
    const h=(tx+tz<=1) ? h00+(h10-h00)*tx+(h01-h00)*tz
                       : h11+(h01-h11)*(1-tx)+(h10-h11)*(1-tz);
    return h*this.HS;
  },
  // screen CSS px -> world ray. Orthographic, so unproject the near and far
  // NDC points and subtract.
  /* Closed form — same result as inverting mvp(), without the inverse or the
     allocation. NB the origin lies on the plane through the camera TARGET, so
     t may legitimately be negative for roughly half the screen. Never reject
     on the sign of t: doing so silently deletes the near half of the view and
     still looks plausible. */
  ray(sx,sy){
    const B=this.basis();
    const a=(sx-vw/2)/B.sc, c=(vh/2-sy)/B.sc;
    return {ox:B.tx+a*B.rx+c*B.ux, oy:a*B.ry+c*B.uy, oz:B.tz+a*B.rz+c*B.uz,
            dx:B.fx, dy:B.fy, dz:B.fz};
  },
  /* Screen px -> tile coords, by marching the ray against the height field.
     Returns null if it never meets the ground (possible at extreme tilt when
     the ray leaves the map before descending). Coarse march then bisect: the
     terrain is one elevation step tall, so a 0.5-tile stride cannot skip a
     feature, and 24 bisections put the answer well inside a pixel. */
  /* G.elev is binary (the only writes are =1), so the whole height field lives
     in a slab [0, HILL*HS] = 0.314 tiles thick and the ray always descends.
     Search exactly [t0,t1]: t0 enters the slab top, t1 crosses y=0. That span
     is HILL*HS/sin(pitch) — under 1 world unit even at the pitch floor, so
     2-3 half-tile steps. The earlier version marched up to MAP*3 = 384 steps
     and could still dead-end; below the slab there is only the y=0 plane,
     which a descending ray meets EXACTLY ONCE, so this returns a point for
     every screen pixel. Callers decide whether that point is on the board. */
  pickGround(sx,sy){
    const r=this.ray(sx,sy); if(!r||r.dy>=-1e-6)return null;
    const t0=(this.HILL*this.HS-r.oy)/r.dy, t1=-r.oy/r.dy;
    if(!isFinite(t0)||!isFinite(t1))return null;
    const at=u=>({x:r.ox+r.dx*u, y:r.oy+r.dy*u, z:r.oz+r.dz*u});
    const below=p=>p.y<=this.groundH(p.x,p.z);
    let prev=t0,p=at(t0);
    if(below(p))return {x:p.x,y:p.z,t:t0};        // started already inside a hill
    for(let t=t0+.5,last=false;!last;t+=.5){
      if(t>=t1){t=t1;last=true;}
      p=at(t);
      if(below(p)){
        let lo=prev,hi=t;
        for(let i=0;i<24;i++){const m=(lo+hi)/2; if(below(at(m)))hi=m; else lo=m;}
        const q=at(hi); return {x:q.x,y:q.z,t:hi};
      }
      prev=t;
    }
    const q=at(t1); return {x:q.x,y:q.z,t:t1};     // flat ground
  },
  // Hill height in 2D pixels. MUST stay 10: the 2D renderer lifts everything on
  // a hill by elevTile(...)*10 (buildings L6386/L6445, rubble L8664, hit-test
  // L9096). Stage 1 shipped 9, which floated every 3D hill 1px off the 2D one.
  HILL:10,
  /* Render toggles, settable from the console for A/B measurement.
     face: bitmask 1=trees, 2=(reserved, buildings — see the audit in draw()),
           4=units.  cull: frustum-cull the tree chunks. */
  dbg:{face:5, cull:1},
  init(){
    if(this.failed)return false;
    if(this.gl)return true;
    const c=document.getElementById('view3');
    const opt={antialias:true,alpha:false,depth:true};
    /* Prefer WebGL2: it gives mipmaps on NON-power-of-two textures, which the
       terrain canvas is (e.g. 2912²), plus 32-bit indices and instancing in
       core. WebGL1 remains a full fallback. */
    let gl=c.getContext('webgl2',opt); this.gl2=!!gl;
    if(!gl){gl=c.getContext('webgl',opt);}
    if(!gl){this.failed=true;toast('This device has no WebGL — staying on the 2D view');return false;}
    this.canvas=c; this.gl=gl;
    /* TRAP: under WebGL2 getExtension('ANGLE_instanced_arrays') returns NULL,
       because instancing is core there. Every instanced path in this file
       (trees, buildings, units) checks this.iext and would silently disable
       itself. Shim it so the ~20 ANGLE call sites keep working unchanged. */
    if(this.gl2){
      this.iext={
        vertexAttribDivisorANGLE:(i,d)=>gl.vertexAttribDivisor(i,d),
        drawElementsInstancedANGLE:(m,n,t,o,c2)=>gl.drawElementsInstanced(m,n,t,o,c2),
      };
    }else this.iext=gl.getExtension('ANGLE_instanced_arrays');
    // anisotropy matters far more than usual here: tilting the camera views the
    // ground at a grazing angle, which is exactly what isotropic filtering ruins
    this.aniso=gl.getExtension('EXT_texture_filter_anisotropic')
             ||gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    this.anisoMax=this.aniso?gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT):1;
    const vs=`
      attribute vec3 aPos;      // tile x, height in PIXELS, tile y
      attribute vec2 aUV;
      attribute float aShade;
      uniform mat4 uMVP; uniform float uHScale;
      varying vec2 vUV; varying float vShade;
      void main(){
        // height arrives in 2D pixels; the world is in tiles, so rescale it
        vec3 p=vec3(aPos.x, aPos.y*uHScale, aPos.z);
        gl_Position=uMVP*vec4(p,1.0);
        vUV=aUV; vShade=aShade;
      }`;
    const fs=`
      precision mediump float;
      uniform sampler2D uTex;
      varying vec2 vUV; varying float vShade;
      void main(){
        vec4 t=texture2D(uTex,vUV);
        gl_FragColor=vec4(t.rgb*vShade,1.0);
      }`;
    const mk=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(s));return null;}return s;};
    const v=mk(gl.VERTEX_SHADER,vs),f=mk(gl.FRAGMENT_SHADER,fs);
    if(!v||!f){this.failed=true;return false;}
    const p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){console.error(gl.getProgramInfoLog(p));this.failed=true;return false;}
    this.prog=p;
    this.loc={aPos:gl.getAttribLocation(p,'aPos'),aUV:gl.getAttribLocation(p,'aUV'),
      aShade:gl.getAttribLocation(p,'aShade'),
      uMVP:gl.getUniformLocation(p,'uMVP'),uHScale:gl.getUniformLocation(p,'uHScale'),
      uTex:gl.getUniformLocation(p,'uTex')};
    this.tex=gl.createTexture();
    this.vbo=gl.createBuffer(); this.ibo=gl.createBuffer();
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    return true;
  },
  // Ground mesh: one quad per tile, corner heights averaged from the elevation
  // grid so hills are continuous instead of stepping at every cell.
  buildMesh(){
    const gl=this.gl,N=MAP,H=this.HILL;
    // ONE height rule, shared with the picker. Two copies of a formula that
    // must agree exactly is a silent-drift generator — and the drift would be
    // between where things are drawn and where clicks land.
    const cornerH=(cx,cy)=>this.cornerH(cx,cy);
    const verts=new Float32Array((N+1)*(N+1)*6);
    let o=0;
    for(let y=0;y<=N;y++)for(let x=0;x<=N;x++){
      const h=cornerH(x,y);
      // cheap lambert-ish term from the local slope, warm light from the NW
      const slope=(cornerH(x+1,y)+cornerH(x,y+1)-cornerH(x-1,y)-cornerH(x,y-1))/(4*H||1);
      verts[o++]=x; verts[o++]=h; verts[o++]=y;
      verts[o++]=x/N; verts[o++]=y/N;
      verts[o++]=Math.max(.78,Math.min(1.18,1-slope*.34));
    }
    const idx=[];
    for(let y=0;y<N;y++)for(let x=0;x<N;x++){
      const a=y*(N+1)+x,b=a+1,c=a+N+1,d=c+1;
      idx.push(a,c,b, b,c,d);
    }
    const I=(N+1)*(N+1)>65535?new Uint32Array(idx):new Uint16Array(idx);
    this.idxType=I.BYTES_PER_ELEMENT===4?gl.UNSIGNED_INT:gl.UNSIGNED_SHORT;
    // same WebGL2 trap as the instancing extension: OES_element_index_uint
    // returns null under WebGL2 because 32-bit indices are core there
    if(this.idxType===gl.UNSIGNED_INT&&!this.gl2&&!gl.getExtension('OES_element_index_uint')){
      this.failed=true;toast('This device cannot render a map this large in 3D');return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);gl.bufferData(gl.ARRAY_BUFFER,verts,gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.ibo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,I,gl.STATIC_DRAW);
    this.idxCount=idx.length;
    this.meshKey=N+':'+elevVer;      // must match the check in draw()
  },
  /* ---- trees as REAL GEOMETRY ---------------------------------------------
     Billboards were the right answer while the camera was locked (a billboard
     IS the exact projection of a solid under a fixed orthographic view). The
     camera rotates now, so they are not: baked NW light would swing with the
     view and cards would shear. So: two low-poly species meshes, drawn
     INSTANCED — one instance per tree, ~16 bytes each, which is why 8,800
     trees on Black Forest cost ~140KB instead of the ~10MB a merged
     per-tree mesh would.
     Colours are lifted from getResSpr's own palettes so the species read the
     same as the 2D art. Lighting is a real lambert term from the NW, which is
     the whole point: it now responds to the camera instead of being painted on. */
  TREE_PINE:{dark:['#13290c','#1c3d14','#265219','#336b23','#478a32'],
             light:['#173312','#22491a','#2e6021','#3d7c2c','#54993c'],trunk:'#4a3018'},
  TREE_LEAF:{dark:['#122a0c','#1d4213','#28581a','#357024','#458830','#589b3e'],
             light:['#17330f','#255018','#316a20','#40852b','#529f38','#66b447'],trunk:'#54381e'},
  /* Nine species meshes share one VBO and one instanced pipeline: five REAL
     tree species (pine / oak / green maple / autumn maple / birch — a forest
     of one cloned tree never reads as a forest), then the resources that were
     simply MISSING from 3D: berry bush, gold mine, carcass, fish. Resource
     meshes are authored at WORLD size (instance scale 1); trees keep the
     pixel-height scaling for parity with the 2D sprites. */
  SPN:9,
  buildTreeMeshes(){
    const V=[],I=[];                       // pos3, nrm3, col3  -> 9 floats/vert
    const hex=c=>[parseInt(c.slice(1,3),16)/255,parseInt(c.slice(3,5),16)/255,parseInt(c.slice(5,7),16)/255];
    const push=(p,n,c)=>{V.push(p[0],p[1],p[2],n[0],n[1],n[2],c[0],c[1],c[2]);return V.length/9-1;};
    const tri=(a,b,c)=>{I.push(a,b,c);};
    const nrm=(a,b,c)=>{const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],
      vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
      let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
      const L=Math.hypot(nx,ny,nz)||1;return [nx/L,ny/L,nz/L];};
    /* Winding audit still holds: cone and prism wind INTO the solid, blob is
       flipped to match — everything here stays safe under cullFace(FRONT).
       Cone undersides stay deleted (provably unseeable at any legal pitch). */
    const cone=(y0,y1,r,seg,col,cx,cz)=>{
      const c=hex(col);cx=cx||0;cz=cz||0;
      for(let i=0;i<seg;i++){
        const a0=i/seg*6.283,a1=(i+1)/seg*6.283;
        const p0=[cx+Math.cos(a0)*r,y0,cz+Math.sin(a0)*r],p1=[cx+Math.cos(a1)*r,y0,cz+Math.sin(a1)*r],ap=[cx,y1,cz];
        const n=nrm(p0,p1,ap);
        tri(push(p0,n,c),push(p1,n,c),push(ap,n,c));
      }
    };
    const prism=(y0,y1,r,seg,col,rt,cx,cz)=>{
      const c=hex(col);rt=rt===undefined?r:rt;cx=cx||0;cz=cz||0;
      for(let i=0;i<seg;i++){
        const a0=i/seg*6.283,a1=(i+1)/seg*6.283;
        const b0=[cx+Math.cos(a0)*r,y0,cz+Math.sin(a0)*r],b1=[cx+Math.cos(a1)*r,y0,cz+Math.sin(a1)*r];
        const t0=[cx+Math.cos(a0)*rt,y1,cz+Math.sin(a0)*rt],t1=[cx+Math.cos(a1)*rt,y1,cz+Math.sin(a1)*rt];
        const n=nrm(b0,b1,t1);
        const i0=push(b0,n,c),i1=push(b1,n,c),i2=push(t1,n,c),i3=push(t0,n,c);
        tri(i0,i1,i2);tri(i0,i2,i3);
      }
    };
    const blob=(cx,cy,cz,r,col,jit)=>{
      const c=hex(col);
      const P=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
      const F=[[0,2,4],[2,1,4],[1,3,4],[3,0,4],[2,0,5],[1,2,5],[3,1,5],[0,3,5]];
      const at=v=>{
        const s=1+(jit?((Math.abs(v[0]*3+v[1]*5+v[2]*7)%3)-1)*0.12:0);
        return [cx+v[0]*r*s, cy+v[1]*r*s*0.82, cz+v[2]*r*s];
      };
      for(const f of F){
        const a=at(P[f[0]]),b=at(P[f[1]]),d=at(P[f[2]]);
        const n=nrm(a,b,d);
        const i0=push(a,n,c),i1=push(b,n,c),i2=push(d,n,c);
        tri(i0,i2,i1);                    // reversed — see winding audit above
      }
    };
    /* SMOOTH helpers — shared ring vertices carrying true surface normals, so
       the lambert term shades a continuous curve instead of facets (the same
       trick that rounded the units). Winding follows prism/cone (into the
       solid, safe under the tree pass's cullFace). No bottom caps — the
       pitch clamp keeps undersides unseeable, same proof as the old cones. */
    const ringV=(cx,cy,cz,r,seg,col,ny)=>{
      const c=hex(col),ids=[];
      for(let i=0;i<seg;i++){
        const a=i/seg*6.283,ca=Math.cos(a),sa=Math.sin(a);
        const L=Math.hypot(1,ny)||1;
        ids.push(push([cx+ca*r,cy,cz+sa*r],[ca/L,ny/L,sa/L],c));
      }
      return ids;
    };
    const band=(r0,r1)=>{const seg=r0.length;
      for(let i=0;i<seg;i++){const j=(i+1)%seg;
        tri(r0[i],r0[j],r1[j]);tri(r0[i],r1[j],r1[i]);}};
    const capTo=(ring,cx,cy,cz,col)=>{const seg=ring.length;
      const ap=push([cx,cy,cz],[0,1,0],hex(col));
      for(let i=0;i<seg;i++){const j=(i+1)%seg;tri(ring[i],ring[j],ap);}};
    const scone=(y0,y1,r,seg,col,cx,cz)=>{cx=cx||0;cz=cz||0;
      const ny=r/Math.max(.01,y1-y0);
      capTo(ringV(cx,y0,cz,r,seg,col,ny),cx,y1,cz,col);
    };
    // smooth canopy ball, slightly squashed like the old blobs (sq .82)
    const sblob=(cx,cy,cz,r,col)=>{
      const sq=.82,seg=8,lats=[-.5,.15,.85];
      const rings=lats.map(ph=>ringV(cx,cy+r*sq*Math.sin(ph),cz,
        Math.max(.012,r*Math.cos(ph)),seg,col,Math.tan(ph)/sq));
      for(let k=0;k<rings.length-1;k++)band(rings[k],rings[k+1]);
      capTo(rings[rings.length-1],cx,cy+r*sq,cz,col);
    };
    const off=[],cnt=[],hgt=[];
    const mark=()=>off.push(I.length);
    const seal=h=>{cnt.push(I.length-off[off.length-1]);hgt.push(h);};
    const P=this.TREE_PINE;
    // ---- 0 PINE: tall, tiered — the old silhouette, smooth-shaded ----
    mark();
    prism(0,.34,.10,5,P.trunk,.07);
    scone(.22,.64,.60,8,P.light[1]);
    scone(.42,.86,.47,8,P.light[2]);
    scone(.62,1.05,.33,8,P.light[3]);
    scone(.80,1.22,.19,8,P.light[4]);
    seal(1.22);
    // ---- 1 OAK: stout tapered trunk, broad ROUND spreading crown ----
    mark();
    prism(0,.46,.16,6,'#4e3319',.11);
    sblob(0,.74,0,.62,'#357a26');
    sblob(-.40,.84,-.16,.45,'#2e6a1f');
    sblob(.38,.88,.18,.47,'#4c9838');
    seal(1.3);
    // ---- 2 MAPLE, summer green: upright rounded crown ----
    mark();
    prism(0,.50,.11,5,'#5a3d20',.08);
    sblob(0,.88,0,.52,'#3f8f31');
    sblob(0,1.18,0,.33,'#59b048');
    seal(1.4);
    // ---- 3 MAPLE in autumn: same habit, fire colours ----
    mark();
    prism(0,.50,.11,5,'#5a3d20',.08);
    sblob(0,.88,0,.52,'#b0511d');
    sblob(0,1.18,0,.33,'#d98a2e');
    seal(1.4);
    // ---- 4 BIRCH: slender WHITE trunk with dark bands, airy high crown ----
    mark();
    prism(0,.80,.072,5,'#e6e2d6',.055);
    prism(.20,.255,.076,5,'#4a4640',.074);
    prism(.46,.505,.073,5,'#4a4640',.068);
    sblob(0,1.02,0,.40,'#7fb95a');
    sblob(.10,1.24,-.05,.27,'#a5d67d');
    seal(1.5);
    // ---- 5 BERRY BUSH (world-size): soft green mound studded with berries ----
    mark();
    sblob(0,.15,0,.27,'#2e6b22');
    sblob(-.15,.17,.09,.18,'#3a7d2c');
    blob(-.09,.28,-.12,.042,'#c22a20',false);
    blob(.13,.26,.09,.042,'#d43428',false);
    blob(0,.33,.02,.042,'#c22a20',false);
    blob(-.19,.16,-.02,.038,'#d43428',false);
    blob(.05,.20,-.18,.038,'#c22a20',false);
    seal(1);
    // ---- 6 GOLD MINE (world-size): rock crags stay ANGULAR — rocks are rocks
    mark();
    cone(0,.34,.27,4,'#736b5f');
    cone(0,.48,.19,5,'#7e766a',.15,-.09);
    cone(0,.28,.16,4,'#69615a',-.19,.11);
    cone(.27,.42,.09,4,'#d9a92c',.15,-.09);
    cone(.20,.31,.075,4,'#c9992a');
    blob(.23,.05,.17,.055,'#e3b23c',false);
    blob(-.21,.05,-.06,.048,'#d9a92c',false);
    blob(-.04,.045,.24,.048,'#e3b23c',false);
    seal(1);
    // ---- 7 CARCASS (world-size): low soft meat mound, pale rib hints ----
    mark();
    sblob(0,.08,0,.19,'#a24532');
    sblob(.11,.07,.07,.12,'#8f3a2a');
    blob(.02,.13,.02,.045,'#e8e2d2',false);
    blob(-.06,.12,-.04,.04,'#e8e2d2',false);
    seal(1);
    // ---- 8 FISH SCHOOL (world-size): ripple disc + fin above the water ----
    mark();
    cone(0,.028,.24,8,'#4585b2');
    cone(.02,.15,.06,4,'#2f6f9e',.05,.03);
    blob(-.09,.05,-.05,.045,'#77b6d9',false);
    seal(1);
    const gl=this.gl;
    this.tvbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.tvbo);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(V),gl.STATIC_DRAW);
    this.tibo=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.tibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(I),gl.STATIC_DRAW);
    this.treeOff=off;this.treeCnt=cnt;this.treeVerts=V.length/9;
    this.treeH=hgt;                      // mesh height per species, for scaling
  },
  initTrees(){
    const gl=this.gl;
    this.iext=this.iext||gl.getExtension('ANGLE_instanced_arrays');
    if(!this.iext){this.noTrees=true;return false;}   // pre-2013 device; ground only
    const vs=`
      attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol;
      attribute vec4 aI0;      // tileX, baseY, tileZ, scaleXZ
      attribute vec3 aI1;      // scaleY, shade, yaw
      uniform mat4 uMVP; uniform vec3 uLight;
      varying vec3 vC;
      void main(){
        // per-instance yaw. Without it every pine's 7-gon silhouette lined up
        // and a forest read as one tree copy-pasted 8,000 times.
        float cr=cos(aI1.z), sr=sin(aI1.z);
        vec3 rp=vec3(aPos.x*cr-aPos.z*sr, aPos.y, aPos.x*sr+aPos.z*cr);
        vec3 rn=vec3(aNrm.x*cr-aNrm.z*sr, aNrm.y, aNrm.x*sr+aNrm.z*cr);
        vec3 p=vec3(rp.x*aI0.w+aI0.x, rp.y*aI1.x+aI0.y, rp.z*aI0.w+aI0.z);
        gl_Position=uMVP*vec4(p,1.0);
        float lam=max(0.0,dot(normalize(rn),uLight));
        vC=aCol*aI1.y*(0.60+0.52*lam);
      }`;
    const fs=`precision mediump float; varying vec3 vC; uniform float uAlpha;
      void main(){ gl_FragColor=vec4(vC,uAlpha); }`;
    const mk=(t,s)=>{const sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);
      if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(sh));return null;}return sh;};
    const v=mk(gl.VERTEX_SHADER,vs),f=mk(gl.FRAGMENT_SHADER,fs);
    if(!v||!f){this.noTrees=true;return false;}
    const p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);
    ['aPos','aNrm','aCol','aI0','aI1'].forEach((n,i)=>gl.bindAttribLocation(p,i,n));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){console.error(gl.getProgramInfoLog(p));this.noTrees=true;return false;}
    this.treeProg=p;
    this.treeLoc={uMVP:gl.getUniformLocation(p,'uMVP'),uLight:gl.getUniformLocation(p,'uLight'),
      uAlpha:gl.getUniformLocation(p,'uAlpha')};
    this.buildTreeMeshes();
    this.buildShadowMesh();
    this.ivbo=Array.from({length:this.SPN},()=>gl.createBuffer());
    this.iCount=new Array(this.SPN).fill(0);
    this.iAll=new Array(this.SPN).fill(0);
    this.treeKey='';this.cullKey='';
    return true;
  },
  /* One instance per tree, split by species so each is one drawElementsInstanced.
     Variant keying matches getResSpr exactly (hash2(x*13,y*17)%8, pine when
     h%3===0, rr=10+(h%4)*1.7, dark when h>=5) so the 3D forest has the same
     species mix and size spread as the 2D art. */
  buildTrees(){
    const gl=this.gl,A=Array.from({length:this.SPN},()=>[]);
    for(const k in G.res){
      const r=G.res[k];
      let sp=-1,sxz=1,sy=1,shade=1;
      if(r.type==='wood'){
        /* species from the same hash the 2D sprites use, so a given tree is
           the same KIND in both renderers: pine 3/8, oak 2/8, green maple,
           autumn maple and birch 1/8 each — a mixed wood instead of clones */
        const h=hash2(r.x*13,r.y*17)%8;
        sp=(h%3===0)?0:(h===1||h===4)?1:(h===2)?2:(h===7)?3:4;
        const rr=10+(h%4)*1.7;
        const hp=(sp===0?34:30)+(h%4)*2.5;
        sxz=rr/IW; sy=hp*this.HS/this.treeH[sp];
        shade=.82+((h>>>3)%5)*.05;
      }
      else if(r.type==='gold')sp=6;
      else if(r.type==='food')sp=(r.sub==='meat')?7:5;  // carcass vs berry bush
      else if(r.type==='fish')sp=8;
      if(sp<0)continue;
      const rot=(hash2(r.x*57,r.y*91)%32)*0.19635;
      A[sp].push(r.x+.5, this.groundH(r.x+.5,r.y+.5), r.y+.5, sxz, sy, shade, rot);
    }
    /* Keep the FULL set on the CPU and size the GPU buffer to match; the visible
       subset is packed into it each time the camera moves (see cullTrees). */
    this.treeAll=A.map(a=>new Float32Array(a));
    this.treeVis=A.map(a=>new Float32Array(a.length));
    for(let s=0;s<this.SPN;s++){
      gl.bindBuffer(gl.ARRAY_BUFFER,this.ivbo[s]);
      gl.bufferData(gl.ARRAY_BUFFER,this.treeAll[s],gl.DYNAMIC_DRAW);
      this.iCount[s]=A[s].length/7;
      this.iAll[s]=A[s].length/7;
    }
    this.treeKey=MAP+':'+elevVer+':'+resGen+':'+resVer;
    this.cullKey='';                       // force a re-cull against the new set
  },
  /* Frustum cull. The camera is ORTHOGRAPHIC, so "inside the view" is just a
     rectangle test in the camera's own basis — no planes, no matrix. Pack the
     survivors into the front of the existing buffer and draw fewer instances;
     two draw calls either way, which matters because draw calls are the
     expensive thing on mobile and chunking would have meant ~50 of them.
     Only re-runs when the camera actually moved, so panning costs one pass over
     the trees and holding still costs nothing.
     MARGIN is in world units and must cover a tree's own extent: canopy radius
     reaches 15.1/IW = 0.58 tiles and height reaches ~40*HS = 1.26, and height
     leans into the screen-up axis. 2.5 is comfortably past both — cull too
     tightly and canopies pop out at the screen edge. */
  cullTrees(){
    if(!this.treeAll)return;
    const B=this.basis();
    // fogVer is in the key so newly explored ground re-culls exactly when the
    // fog canvas updates — the trees appear in the same frame the fog lifts.
    const key=this.yaw+','+this.pitch+','+G.cam.x+','+G.cam.y+','+G.cam.z+','+vw+','+vh
             +','+this.treeKey+','+this.dbg.cull+','+fogVer;
    if(key===this.cullKey)return;
    this.cullKey=key;
    const gl=this.gl;
    const M=2.5;
    const hw=vw/G.cam.z/(2*this.PPT)+M, hh=vh/G.cam.z/(2*this.PPT)+M;
    const vis=G.vis,fr=this.dbg.cull;      // dbg.cull=0 now skips ONLY the frustum test
    for(let s=0;s<this.SPN;s++){
      const src=this.treeAll[s],dst=this.treeVis[s];
      let o=0;
      for(let i=0;i<src.length;i+=7){
        /* Explored gate. 2D never draws a resource on an unexplored tile, and
           the unexplored fog is alpha 208 — NOT opaque — so without this the
           entire Black Forest layout leaked faintly through the dark. That is
           scouting information the player has not earned. */
        const tX=(src[i]-.5)|0, tZ=(src[i+2]-.5)|0;
        if(!vis[tZ*MAP+tX])continue;
        if(fr){
          const wx=src[i]-B.tx, wy=src[i+1], wz=src[i+2]-B.tz;
          const sx=wx*B.rx+wz*B.rz;
          if(sx<-hw||sx>hw)continue;
          const sy=wx*B.ux+wy*B.uy+wz*B.uz;
          if(sy<-hh||sy>hh)continue;
        }
        dst[o]=src[i];dst[o+1]=src[i+1];dst[o+2]=src[i+2];
        dst[o+3]=src[i+3];dst[o+4]=src[i+4];dst[o+5]=src[i+5];dst[o+6]=src[i+6];
        o+=7;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER,this.ivbo[s]);
      gl.bufferSubData(gl.ARRAY_BUFFER,0,dst.subarray(0,o));
      this.iCount[s]=o/7;
    }
  },
  drawTrees(mvp){
    if(this.noTrees)return;
    if(!this.treeProg&&!this.initTrees())return;
    const gl=this.gl,ex=this.iext;
    if(this.treeKey!==MAP+':'+elevVer+':'+resGen+':'+resVer)this.buildTrees();
    this.cullTrees();
    if(!this.iCount.some(n=>n))return;
    gl.useProgram(this.treeProg);
    gl.uniformMatrix4fv(this.treeLoc.uMVP,false,mvp);
    gl.uniform3f(this.treeLoc.uLight,-0.46,0.80,-0.38);   // key light from the NW
    gl.uniform1f(this.treeLoc.uAlpha,1.0);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.tvbo);
    for(let i=0;i<3;i++){gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i,3,gl.FLOAT,false,36,i*12);ex.vertexAttribDivisorANGLE(i,0);}
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.tibo);
    for(let s=0;s<this.SPN;s++){
      if(!this.iCount[s])continue;
      gl.bindBuffer(gl.ARRAY_BUFFER,this.ivbo[s]);
      gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,4,gl.FLOAT,false,28,0);
      ex.vertexAttribDivisorANGLE(3,1);
      gl.enableVertexAttribArray(4);gl.vertexAttribPointer(4,3,gl.FLOAT,false,28,16);
      ex.vertexAttribDivisorANGLE(4,1);
      ex.drawElementsInstancedANGLE(gl.TRIANGLES,this.treeCnt[s],gl.UNSIGNED_SHORT,
        this.treeOff[s]*2,this.iCount[s]);
    }
    // divisors are GLOBAL per attribute index — leaving these at 1 would make the
    // ground pass read one vertex for the whole terrain next frame.
    ex.vertexAttribDivisorANGLE(3,0);ex.vertexAttribDivisorANGLE(4,0);
    gl.disableVertexAttribArray(3);gl.disableVertexAttribArray(4);
  },
  /* ---- cast shadows --------------------------------------------------------
     A dark disc under every unit and building, drawn instanced through the
     tree shader with uAlpha — the cheapest thing that stops entities floating
     on uniformly lit ground. The disc is baked with a SE offset (light is from
     the NW, matching both uLight and the 2D art's sprite shadows), and the
     offset is in MESH space, so it scales with the instance radius the way a
     longer shadow under a bigger thing should. Trees are deliberately NOT
     here: refreshTerrain already darkens the forest floor under every wood
     tile, and 8,000 blended discs would be real mobile fill-rate for a hint
     the texture already provides. */
  buildShadowMesh(){
    const V=[],I=[],c=[0.07,0.06,0.035],seg=16;
    const push=(x,z)=>{V.push(x+0.11,0.0,z+0.11, 0,1,0, c[0],c[1],c[2]);return V.length/9-1;};
    const c0=push(0,0);
    for(let i=0;i<=seg;i++){const a=i/seg*6.283;push(Math.cos(a),Math.sin(a));}
    for(let i=0;i<seg;i++)I.push(c0,c0+1+i,c0+2+i);
    const gl=this.gl;
    this.shvbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.shvbo);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(V),gl.STATIC_DRAW);
    this.shibo=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.shibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(I),gl.STATIC_DRAW);
    this.shCount=I.length;
    this.shIvbo=gl.createBuffer();
  },
  drawShadows(mvp){
    if(this.noTrees)return;
    if(!this.treeProg&&!this.initTrees())return;
    const gl=this.gl,ex=this.iext;
    const A=[];
    for(const u of G.units){
      if(!allied(u.p,localP)&&!tileVis(u.x,u.y))continue;
      const d=UNITS[u.type]||{};
      let r=d.animal?0.20:d.ship?0.50:(d.siege||u.type==='ram')?0.34:d.cav?0.30:0.22;
      if(u.type==='elephant')r=0.48; else if(u.type==='warwagon')r=0.38;
      A.push(u.x, this.groundH(u.x,u.y)+0.012, u.y, r*1.05, 1,1,0);
    }
    for(const b of G.blds){
      if(!allied(b.p,localP)&&!b.seen)continue;
      const M=this.BMASS[b.type];
      const vs=(M&&M.r!=='flat')?this.BVS:1;    // shadow tracks the scaled massing
      const cx=b.tx+b.size/2,cz=b.ty+b.size/2;
      A.push(cx, this.groundH(cx,cz)+0.010, cz, b.size*0.60*vs, 1,1,0);
    }
    /* Ground resources cast too — a gold mine floating on clean lit grass
       gives the game away. CACHED: scanning all of G.res (8,700 keys on Black
       Forest) every frame cost real milliseconds, and the answer only changes
       when resources or exploration do. */
    const rsKey=resVer+':'+fogVer;
    if(this.rsKey!==rsKey){
      const RS=this.resShad=[];
      for(const k in G.res){
        const r=G.res[k];
        if(r.type==='wood'||r.type==='fish')continue;
        if(!G.vis[(r.y|0)*MAP+(r.x|0)])continue; // unexplored — same rule as trees
        const rad=r.type==='gold'?0.34:(r.sub==='meat')?0.24:0.28;
        RS.push(r.x+.5, this.groundH(r.x+.5,r.y+.5)+0.011, r.y+.5, rad, 1,1,0);
      }
      this.rsKey=rsKey;
    }
    if(this.resShad)for(const v of this.resShad)A.push(v);
    if(!A.length)return;
    gl.useProgram(this.treeProg);
    gl.uniformMatrix4fv(this.treeLoc.uMVP,false,mvp);
    gl.uniform3f(this.treeLoc.uLight,0.0,1.0,0.0);  // flat term — the disc IS the shadow
    gl.uniform1f(this.treeLoc.uAlpha,0.34);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);                            // darken the ground, never occlude it
    gl.bindBuffer(gl.ARRAY_BUFFER,this.shvbo);
    for(let i=0;i<3;i++){gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i,3,gl.FLOAT,false,36,i*12);ex.vertexAttribDivisorANGLE(i,0);}
    gl.bindBuffer(gl.ARRAY_BUFFER,this.shIvbo);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(A),gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,4,gl.FLOAT,false,28,0);
    ex.vertexAttribDivisorANGLE(3,1);
    gl.enableVertexAttribArray(4);gl.vertexAttribPointer(4,3,gl.FLOAT,false,28,16);
    ex.vertexAttribDivisorANGLE(4,1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.shibo);
    ex.drawElementsInstancedANGLE(gl.TRIANGLES,this.shCount,gl.UNSIGNED_SHORT,0,A.length/7);
    ex.vertexAttribDivisorANGLE(3,0);ex.vertexAttribDivisorANGLE(4,0);
    gl.disableVertexAttribArray(3);gl.disableVertexAttribArray(4);
    gl.depthMask(true);gl.disable(gl.BLEND);
  },
  /* ---- animated water surface ----------------------------------------------
     The terrain texture's water is a painting — correct colours, zero motion.
     This pass lays a translucent live surface over every water tile: two swell
     trains plus fine chop perturb a fake normal, the NW key light glints off
     it SPECULARLY (so the sparkle moves when the camera orbits — the one thing
     baked art can never do), depth tints and opacifies toward open water, and
     a breathing foam band hugs the shore. Fords are deliberately bare: units
     wade across them, and a water sheet over their feet reads as drowning.
     Time comes from performance.now, not G.t — water keeps moving in pause,
     and the sim never sees any of this. */
  buildWaterMesh(){
    const gl=this.gl,V=[],I=[];
    // per-tile shore distance (0 at land, 1 by ~2.2 tiles out), corner-averaged
    // so depth is continuous across tile seams — the 2D pass learned this the
    // hard way (one value per tile always reads as a mosaic)
    const dep={};
    const isW=(x,y)=>!!G.water[x+','+y];
    for(const k in G.water){
      const[x,y]=k.split(',').map(Number);
      let best=3;
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        if(!dx&&!dy)continue;
        if(!isW(x+dx,y+dy)&&!G.ford[(x+dx)+','+(y+dy)])
          best=Math.min(best,Math.hypot(dx,dy));
      }
      dep[k]=Math.max(0,Math.min(1,(best-1)/2.2));
    }
    const cdep=(cx,cy)=>{let s=0,n=0;
      for(const[ox,oy] of [[-1,-1],[0,-1],[-1,0],[0,0]]){
        const k=(cx+ox)+','+(cy+oy);
        if(k in dep){s+=dep[k];n++;}
      }
      return n?s/n:0;};
    const WLVL=0.022;                       // just proud of the painted ground
    for(const k in G.water){
      const[x,y]=k.split(',').map(Number);
      const b=V.length/4;
      V.push(x,WLVL,y,cdep(x,y),       x+1,WLVL,y,cdep(x+1,y),
             x+1,WLVL,y+1,cdep(x+1,y+1), x,WLVL,y+1,cdep(x,y+1));
      I.push(b,b+2,b+1, b,b+3,b+2);
    }
    if(!this.wvbo){this.wvbo=gl.createBuffer();this.wibo=gl.createBuffer();}
    gl.bindBuffer(gl.ARRAY_BUFFER,this.wvbo);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(V),gl.STATIC_DRAW);
    const VC=V.length/4;
    let IA,itype=gl.UNSIGNED_SHORT;
    if(VC>65535&&(this.gl2||gl.getExtension('OES_element_index_uint'))){
      IA=new Uint32Array(I);itype=gl.UNSIGNED_INT;
    }else IA=new Uint16Array(I);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.wibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,IA,gl.STATIC_DRAW);
    this.wCount=IA.length;this.wIdxType=itype;
    this.wKey=MAP+':'+elevVer;
  },
  initWater(){
    const gl=this.gl;
    const vs=`attribute vec3 aPos; attribute float aDep;
      uniform mat4 uMVP; varying vec3 vW; varying float vDep;
      void main(){ vW=aPos; vDep=aDep; gl_Position=uMVP*vec4(aPos,1.0); }`;
    const fs=`precision mediump float;
      uniform float uT; uniform vec3 uEye;
      varying vec3 vW; varying float vDep;
      void main(){
        float p1=vW.x*1.9+vW.z*1.15-uT*1.6;     // long swell
        float p2=vW.x*.75-vW.z*1.45+uT*1.05;    // crossing swell
        float p3=(vW.x+vW.z)*3.1+uT*2.3;        // fine chop
        float dx=cos(p1)*.95+cos(p2)*.23+cos(p3)*.35;
        float dz=cos(p1)*.58-cos(p2)*.44+cos(p3)*.35;
        vec3 n=normalize(vec3(-dx*.16,1.0,-dz*.16));
        vec3 L=normalize(vec3(-.46,.80,-.38));
        vec3 V2=normalize(uEye-vW);
        float lam=max(0.,dot(n,L));
        vec3 col=mix(vec3(.42,.71,.86),vec3(.13,.42,.62),vDep)*(.72+.38*lam);
        float spec=pow(max(0.,dot(reflect(-L,n),V2)),64.)*(.55+.45*vDep);
        col+=vec3(1.,.98,.90)*spec;
        float foam=(1.-smoothstep(.02,.24,vDep))*(.45+.35*sin(uT*.9+(vW.x+vW.z)*2.2));
        foam=max(0.,foam);
        col=mix(col,vec3(.93,.97,.98),foam*.55);
        float fres=pow(1.-max(0.,dot(n,V2)),2.0);
        float a=.40+.30*vDep+.18*fres+foam*.25;
        gl_FragColor=vec4(col,min(a,.85));
      }`;
    const mk=(t,s)=>{const sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);
      if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(sh));return null;}return sh;};
    const v=mk(gl.VERTEX_SHADER,vs),f=mk(gl.FRAGMENT_SHADER,fs);
    if(!v||!f){this.noWater=true;return false;}
    const p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);
    gl.bindAttribLocation(p,0,'aPos');gl.bindAttribLocation(p,1,'aDep');
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){console.error(gl.getProgramInfoLog(p));this.noWater=true;return false;}
    this.wProg=p;
    this.wLoc={uMVP:gl.getUniformLocation(p,'uMVP'),uT:gl.getUniformLocation(p,'uT'),
      uEye:gl.getUniformLocation(p,'uEye')};
    return true;
  },
  drawWater(mvp){
    if(this.noWater)return;
    if(!this.wProg&&!this.initWater())return;
    const gl=this.gl;
    if(this.wKey!==MAP+':'+elevVer)this.buildWaterMesh();
    if(!this.wCount)return;
    gl.useProgram(this.wProg);
    gl.uniformMatrix4fv(this.wLoc.uMVP,false,mvp);
    gl.uniform1f(this.wLoc.uT,performance.now()*.001%3600);
    const t=this.target(),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch),D=MAP*2;
    gl.uniform3f(this.wLoc.uEye,t.x+cp*Math.sin(this.yaw)*D,sp*D,t.y+cp*Math.cos(this.yaw)*D);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);                  // a film over the world, never an occluder
    gl.bindBuffer(gl.ARRAY_BUFFER,this.wvbo);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,16,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,1,gl.FLOAT,false,16,12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.wibo);
    gl.drawElements(gl.TRIANGLES,this.wCount,this.wIdxType,0);
    gl.depthMask(true);gl.disable(gl.BLEND);
  },
  /* ---- buildings as real geometry -----------------------------------------
     A massing table rather than 20 hand-modelled meshes: every building is a
     box plus a roof, driven by the data that already exists (b.size for the
     footprint, IHT for the height, the concept-art palettes for the colours).
     That gets all 20 types standing with the right proportions and the right
     roof silhouette immediately; individual types can be sculpted later.
     Buildings are FEW (tens, not thousands) and change rarely, so this is one
     merged mesh rebuilt on change — no instancing needed. It rides the tree
     shader by drawing as a single identity instance. */
  BMASS:{
    // wh = the fraction of total height that is WALL. Raised from ~.46 to ~.58
    // after measuring: at .46 the roof dominated so completely that a pixel
    // probe aimed at a house wall came back with the roof's brown, and no
    // amount of masonry detail could show because there was nowhere to put it.
    tc        :{w:'#a8a294',r:'gable',rc:'#b8613a',wh:.56},
    house     :{w:'#f0e7cd',r:'gable',rc:'#c2673f',wh:.60},
    farm      :{w:'#7d7245',r:'flat', wh:1},
    camp      :{w:'#8d7355',r:'gable',rc:'#9a7b57',wh:.62},
    barracks  :{w:'#f0e7cd',r:'gable',rc:'#b8613a',wh:.58},
    range     :{w:'#d8c9a8',r:'gable',rc:'#9a7b57',wh:.58},
    stable    :{w:'#d8c9a8',r:'gable',rc:'#b8613a',wh:.58},
    siege     :{w:'#c9b48c',r:'gable',rc:'#8d7355',wh:.60},
    // 'crown' = flat top ringed with a crenellated parapet — the fortress read.
    // The 2D castle is crenellated walls + four spired turrets; cone was wrong.
    castle    :{w:'#a8a294',r:'crown',rc:'#5a7ea8',wh:.82,turret:true},
    tower     :{w:'#a8a294',r:'cone', rc:'#b8613a',wh:.74},
    wall      :{w:'#8d7355',r:'flat', wh:1},
    gate      :{w:'#8d7355',r:'flat', wh:1},
    swall     :{w:'#a8a294',r:'flat', wh:1},
    sgate     :{w:'#a8a294',r:'flat', wh:1},
    market    :{w:'#f0e7cd',r:'gable',rc:'#9a7b57',wh:.58},
    monastery :{w:'#f0e7cd',r:'gable',rc:'#5a7ea8',wh:.58},
    blacksmith:{w:'#a8a294',r:'gable',rc:'#b8613a',wh:.58},
    dock      :{w:'#8d7355',r:'flat', wh:1},
    university:{w:'#f0e7cd',r:'gable',rc:'#5a7ea8',wh:.58},
    wonder    :{w:'#f0e7cd',r:'dome', rc:'#d9b44a',wh:.58},
  },
  buildBlds(){
    const V=[],I=[];
    const hex=c=>[parseInt(c.slice(1,3),16)/255,parseInt(c.slice(3,5),16)/255,parseInt(c.slice(5,7),16)/255];
    const push=(p,n,c)=>{V.push(p[0],p[1],p[2],n[0],n[1],n[2],c[0],c[1],c[2]);return V.length/9-1;};
    /* NB the normal is NEGATED. With this file's face winding, (b-a)x(d-a)
       points INTO the solid. That inverted the lambert term on every wall and
       roof, and — far worse — made panel()'s +offset push masonry, shingles and
       timber framing INSIDE the wall where the backing quad hid them. Only the
       windows showed, because they offset the other way. */
    const quad=(a,b,c,d,col)=>{
      const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=d[0]-a[0],vy=d[1]-a[1],vz=d[2]-a[2];
      let nx=-(uy*vz-uz*vy),ny=-(uz*vx-ux*vz),nz=-(ux*vy-uy*vx);
      const L=Math.hypot(nx,ny,nz)||1;const n=[nx/L,ny/L,nz/L];
      const i0=push(a,n,col),i1=push(b,n,col),i2=push(c,n,col),i3=push(d,n,col);
      I.push(i0,i1,i2, i0,i2,i3);
    };
    const tri3=(a,b,c,col)=>{
      const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
      let nx=-(uy*vz-uz*vy),ny=-(uz*vx-ux*vz),nz=-(ux*vy-uy*vx);
      const L=Math.hypot(nx,ny,nz)||1;const n=[nx/L,ny/L,nz/L];
      I.push(push(a,n,col),push(b,n,col),push(c,n,col));
    };
    /* ---- surface detail -----------------------------------------------------
       Everything below works by RELIEF, not texture: lay a dark base quad, then
       float the stones / shingles / planks a hair proud of it. The gaps between
       them reveal the base, which is the mortar line and the shingle shadow.
       That is what makes it read as masonry rather than a tinted flat wall, and
       it needs no UVs, no atlas and no shader change. Windows and doors go the
       other way — recessed INTO the wall — so they catch a real shadow edge. */
    const add=(p,d,s)=>[p[0]+d[0]*s,p[1]+d[1]*s,p[2]+d[2]*s];
    // a face is an origin plus a right and an up vector; pt(u,v) walks it
    const fpt=(A,R,U,u,v)=>[A[0]+R[0]*u+U[0]*v, A[1]+R[1]*u+U[1]*v, A[2]+R[2]*u+U[2]*v];
    // outward face normal — negated for the same reason as quad() above
    const fnorm=(R,U)=>{let nx=-(R[1]*U[2]-R[2]*U[1]),ny=-(R[2]*U[0]-R[0]*U[2]),nz=-(R[0]*U[1]-R[1]*U[0]);
      const L=Math.hypot(nx,ny,nz)||1;return [nx/L,ny/L,nz/L];};
    const panel=(A,R,U,u0,v0,u1,v1,off,col)=>{
      const N=fnorm(R,U);
      quad(add(fpt(A,R,U,u0,v0),N,off),add(fpt(A,R,U,u1,v0),N,off),
           add(fpt(A,R,U,u1,v1),N,off),add(fpt(A,R,U,u0,v1),N,off),col);
    };
    const shade=(c,f)=>[Math.max(0,Math.min(1,c[0]*f)),Math.max(0,Math.min(1,c[1]*f)),
                        Math.max(0,Math.min(1,c[2]*f))];
    /* Relief depth. 0.008 was ~0.6 SCREEN px at normal zoom — geometrically
       present, visually nothing. A wall face is ~29px wide on screen at z=1, so
       joints need ~2px to read, which is why the insets below are in the 0.03
       range and not the 0.008 they started at. */
    const REL=0.022;
    /* One wall face. style: 'stone' = staggered masonry courses, 'plaster' =
       smooth render with dark timber framing, 'plank' = vertical boarding. */
    const wall=(A,R,U,col,style,seed,openings)=>{
      panel(A,R,U,0,0,1,1,0,shade(col,0.55));            // mortar / backing
      const H=Math.hypot(U[0],U[1],U[2]),W=Math.hypot(R[0],R[1],R[2]);
      // weathering: every wall darkens where it meets the ground — rain splash
      // and damp climb real walls, and its absence is what reads as "model"
      if(style!=='solid')panel(A,R,U,0,0,1,0.09,REL*0.55,shade(col,0.62));
      if(style==='solid'){
        // one clean face — banners and other blocks that must read as pure
        // colour. The default stone branch put moss on the bottom course of
        // every team banner (undefined seed -> hash2(NaN) -> 0 -> mossy).
        panel(A,R,U,0,0,1,1,REL,col);
      }else if(style==='plank'){
        const n=Math.max(3,Math.round(W/0.13));
        for(let i=0;i<n;i++){
          const t=(hash2(seed+i*17,3)%5)/5;
          panel(A,R,U,i/n+0.030,0.02,(i+1)/n-0.030,0.98,REL,shade(col,0.86+t*0.30));
        }
      }else if(style==='plaster'){
        panel(A,R,U,0.02,0.01,0.98,0.99,REL,col);
        const beam=shade(col,0.42);                       // timber framing
        panel(A,R,U,0,0,1,0.055,REL*1.6,beam);            // sill beam
        panel(A,R,U,0,0.945,1,1,REL*1.6,beam);            // head beam
        const posts=Math.max(2,Math.round(W/0.42));
        for(let i=0;i<=posts;i++){
          const u=i/posts;
          panel(A,R,U,Math.max(0,u-0.022),0,Math.min(1,u+0.022),1,REL*1.6,beam);
        }
        // one diagonal brace per bay, alternating direction — reads as half-timber
        for(let i=0;i<posts;i++){
          const u0=i/posts+0.03,u1=(i+1)/posts-0.03;
          const dir=(hash2(seed+i*29,7)%2)?1:-1;
          for(let s=0;s<5;s++){
            const t=s/5,tn=(s+1)/5;
            const ua=u0+(u1-u0)*(dir>0?t:1-t),ub=u0+(u1-u0)*(dir>0?tn:1-tn);
            panel(A,R,U,Math.min(ua,ub),0.10+t*0.72,Math.max(ua,ub),0.10+tn*0.72,REL*1.5,beam);
          }
        }
      }else{
        const courses=Math.max(2,Math.round(H/0.115));
        for(let r=0;r<courses;r++){
          const v0=r/courses,v1=(r+1)/courses;
          const stones=Math.max(2,Math.round(W/0.20));
          const stag=(r%2)?0.5/stones:0;
          for(let s=-1;s<=stones;s++){
            const u0=s/stones+stag,u1=(s+1)/stones+stag;
            const a=Math.max(0,u0),b=Math.min(1,u1);
            if(b-a<0.02)continue;
            const h=hash2(seed+r*131+s*7,r*29+s*13);
            const f=0.80+(h%7)*0.075;
            const mossy=(r===0&&h%6===0);
            panel(A,R,U,a+0.026,v0+0.050,b-0.026,v1-0.050,REL,
                  mossy?[col[0]*0.62,col[1]*0.86,col[2]*0.55]:shade(col,f));
          }
        }
      }
      // recessed openings: {u,v,w,h,door}
      if(openings)for(const o of openings){
        const dark=[0.09,0.07,0.06];
        panel(A,R,U,o.u-o.w/2,o.v,o.u+o.w/2,o.v+o.h,-REL*1.1,dark);
        if(o.door){
          // a plank door LEAF inside the recess — deeper than the wall face,
          // shallower than the dark reveal, so it reads as a real closed door
          const dw=[0.36,0.24,0.12];
          panel(A,R,U,o.u-o.w/2+.012,o.v,o.u+o.w/2-.012,o.v+o.h-.012,-REL*0.5,dw);
          panel(A,R,U,o.u-.011,o.v+.004,o.u+.011,o.v+o.h-.016,-REL*0.34,shade(dw,0.55)); // centre seam
          panel(A,R,U,o.u-o.w/2+.016,o.v+o.h*.58,o.u+o.w/2-.016,o.v+o.h*.66,-REL*0.34,shade(dw,0.5)); // iron band
          panel(A,R,U,o.u-o.w/2+.016,o.v+o.h*.16,o.u+o.w/2-.016,o.v+o.h*.24,-REL*0.34,shade(dw,0.5));
        }
        const fr=shade(col,0.72);
        panel(A,R,U,o.u-o.w/2-0.018,o.v-0.012,o.u+o.w/2+0.018,o.v,REL*1.2,fr);      // sill
        panel(A,R,U,o.u-o.w/2-0.018,o.v+o.h,o.u+o.w/2+0.018,o.v+o.h+0.014,REL*1.2,fr); // lintel
      }
    };
    const box=(x0,z0,x1,z1,y0,y1,col,style,seed,win)=>{
      const h=y1-y0,dx=x1-x0,dz=z1-z0;
      const faces=[
        [[x0,y0,z0],[dx,0,0],[0,h,0]],
        [[x1,y0,z1],[-dx,0,0],[0,h,0]],
        [[x1,y0,z0],[0,0,dz],[0,h,0]],
        [[x0,y0,z1],[0,0,-dz],[0,h,0]],
      ];
      faces.forEach((f,i)=>wall(f[0],f[1],f[2],col,style,seed+i*911,win?win[i]:null));
      quad([x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1],shade(col,0.94));
    };
    /* Gable roof with real shingle rows. Ridge runs along x; each row overlaps
       the one below and floats proud of a dark backing, so the rows self-shadow. */
    const gable=(x0,z0,x1,z1,y0,y1,col,seed)=>{
      const zm=(z0+z1)/2,dx=x1-x0;
      const rows=Math.max(5,Math.round((y1-y0)/0.048));   // finer courses
      for(const side of [0,1]){
        const zEdge=side?z1:z0;
        const A=side?[x1,y0,z1]:[x0,y0,z0], R=side?[-dx,0,0]:[dx,0,0];
        const U=[0,y1-y0,side?zm-z1:zm-z0];
        panel(A,R,U,0,0,1,1,0,shade(col,0.5));
        for(let r=0;r<rows;r++){
          // small overlap only — a big one buries the shadow line each row casts
          const v0=r/rows,v1=(r+1)/rows+0.18/rows;
          const f=0.82+((r%2)?0.22:0)+((hash2(seed+r*53,side)%5)*0.035);
          panel(A,R,U,0.020,v0,0.980,Math.min(1,v1),REL*(1+0.5*(r%2)),shade(col,f));
        }
      }
      tri3([x0,y0,z0],[x0,y1,zm],[x0,y0,z1],shade(col,0.8));
      tri3([x1,y0,z1],[x1,y1,zm],[x1,y0,z0],shade(col,0.8));
      // ridge cap
      quad([x0,y1,zm-0.035],[x1,y1,zm-0.035],[x1,y1+0.02,zm+0.035],[x0,y1+0.02,zm+0.035],
           shade(col,1.12));
    };
    /* smooth-shaded cone: one shared base ring with true cone normals, so
       the roof shades as a curve instead of 8 flat facets */
    const cone=(cx,cz,r,y0,y1,col,seg)=>{
      seg=seg||12;
      const ny=r/Math.max(.01,y1-y0),L=Math.hypot(1,ny);
      const ring2=[];
      for(let i=0;i<seg;i++){
        const a=i/seg*6.283,ca=Math.cos(a),sa=Math.sin(a);
        ring2.push(push([cx+ca*r,y0,cz+sa*r],[ca/L,ny/L,sa/L],col));
      }
      const ap=push([cx,y1,cz],[0,1,0],col);
      for(let i=0;i<seg;i++)I.push(ring2[i],ring2[(i+1)%seg],ap);
    };
    /* smooth tapered cylinder — round tower shafts and castle turrets.
       Buildings are excluded from face culling, so only the normals matter,
       and these are explicit outward ones. */
    const cylS=(cx,cz,r0,r1,y0,y1,col,seg)=>{
      seg=seg||12;
      const ny=(r0-r1)/Math.max(.01,y1-y0),L=Math.hypot(1,ny);
      const b0=[],t0=[];
      for(let i=0;i<seg;i++){
        const a=i/seg*6.283,ca=Math.cos(a),sa=Math.sin(a);
        const n=[ca/L,ny/L,sa/L];
        b0.push(push([cx+ca*r0,y0,cz+sa*r0],n,col));
        t0.push(push([cx+ca*r1,y1,cz+sa*r1],n,col));
      }
      for(let i=0;i<seg;i++){const j=(i+1)%seg;
        I.push(b0[i],b0[j],t0[j], b0[i],t0[j],t0[i]);}
      const c2=push([cx,y1,cz],[0,1,0],col);
      for(let i=0;i<seg;i++)I.push(t0[i],t0[(i+1)%seg],c2);
    };
    // thin octagonal collar hugging a cone — stacked, they read as the tile
    // courses of a real conical roof instead of a smooth party hat
    const ring=(cx,cz,r,y,h,col)=>{
      const seg=8;
      for(let i=0;i<seg;i++){
        const a0=i/seg*6.283,a1=(i+1)/seg*6.283;
        quad([cx+Math.cos(a0)*r,y,cz+Math.sin(a0)*r],
             [cx+Math.cos(a1)*r,y,cz+Math.sin(a1)*r],
             [cx+Math.cos(a1)*r*.92,y+h,cz+Math.sin(a1)*r*.92],
             [cx+Math.cos(a0)*r*.92,y+h,cz+Math.sin(a0)*r*.92],col);
      }
    };
    // conical roof with tile courses: the cone plus two shaded collars
    const coneTiled=(cx,cz,r,y0,y1,col)=>{
      cone(cx,cz,r,y0,y1,col);
      ring(cx,cz,r*.80,y0+(y1-y0)*.24,(y1-y0)*.07,shade(col,0.82));
      ring(cx,cz,r*.55,y0+(y1-y0)*.52,(y1-y0)*.06,shade(col,0.88));
    };
    const dome=(cx,cz,r,y0,y1,col)=>{
      // smooth-shaded: shared rings, radial hemisphere normals
      const seg=12,ring=4,rings=[];
      for(let j=0;j<=ring;j++){
        const t=j/ring*1.5708,rr=Math.max(.01,r*Math.cos(t));
        const y=y0+(y1-y0)*Math.sin(t),ids=[];
        for(let i=0;i<seg;i++){
          const a=i/seg*6.283,ca=Math.cos(a),sa=Math.sin(a);
          ids.push(push([cx+ca*rr,y,cz+sa*rr],
            [ca*Math.cos(t),Math.sin(t),sa*Math.cos(t)],col));
        }
        rings.push(ids);
      }
      for(let j=0;j<ring;j++)for(let i=0;i<seg;i++){
        const k=(i+1)%seg;
        I.push(rings[j][i],rings[j][k],rings[j+1][k],
               rings[j][i],rings[j+1][k],rings[j+1][i]);
      }
    };
    let n=0;
    const bmarks=[];        // [index-count, vertex-count] before each building
    for(const b of G.blds){
      if(!allied(b.p,localP)&&!b.seen)continue;
      bmarks.push([I.length,V.length/9]);
      const M=this.BMASS[b.type]||this.BMASS.house;
      const s=b.size,inset=s*0.10;
      /* VISUAL scale (R3.BVS) on everything that isn't a flat tiler (walls/
         farms/docks tile edge-to-edge and would overlap their neighbours).
         Scaled about the footprint centre — placement, pathing and the sim
         never see it. The roof-click pick volume reads the same constant. */
      const vs=M.r==='flat'?1:this.BVS;
      const hw=(s/2-inset)*vs;
      const cxm=b.tx+s/2,czm=b.ty+s/2;
      const x0=cxm-hw,x1=cxm+hw,z0=czm-hw,z1=czm+hw;
      const g=this.groundH(b.tx+s/2,b.ty+s/2);
      // under construction: short and scaffold-brown, growing with prog
      const done=b.built?1:(0.22+0.55*(b.prog||0));
      const H=(IHT[b.type]||18)*this.HS*done*vs;
      /* Age dress (mirrors the 2D ab buckets): Dark/Feudal thatch roofs,
         Castle terracotta (the palette as authored), Imperial slate + pale
         ashlar walls. Signature roofs (blue slate monastery/university/castle,
         the wonder's gold dome) stay themselves at every age. bldSig carries
         the players' ages, so the whole town re-dresses on age-up. */
      const age=(G.P[b.p]&&G.P[b.p].age)||0, ab=age>=3?2:age===2?1:0;
      let wallC=hex(b.built?M.w:'#9a8560');
      const wh=g+H*(M.r==='flat'?1:M.wh);
      // wall treatment follows the palette: pale ashlar -> masonry, cream/buff
      // -> half-timbered plaster, anything else -> boarding
      let style=b.built?(M.w==='#a8a294'?'stone':(M.w==='#f0e7cd'||M.w==='#d8c9a8'||M.w==='#c9b48c')?'plaster':'plank'):'plank';
      if(b.built&&ab===2&&style==='plaster'){style='stone';wallC=hex('#cfc8b6');}
      /* openings per face — box() builds faces in order [z0, z1, +x, −x], and
         at the HOME camera (yaw 45°) the two faces you actually see are z1 and
         +x. The door was on face 0 and therefore always hidden behind the
         building; it lives on face 1 now. Castles get arrow slits, not
         windows. */
      let win=null;
      if(b.built&&M.r!=='flat'&&H>0.28){
        const per=s>=2?3:2;
        const slit=b.type==='castle'||b.type==='tower';   // fortifications slit, homes glaze
        win=[];
        for(let f=0;f<4;f++){
          const a=[];
          for(let i=0;i<per;i++){
            const u=(i+0.5)/per;
            if(f===1&&Math.abs(u-0.5)<0.08)continue;   // leave room for the door
            a.push(slit?{u,v:0.36,w:0.05,h:0.32}:{u,v:0.42,w:0.13,h:0.24});
          }
          if(f===1)a.push({u:0.5,v:0,w:0.18,h:0.50,door:1});   // door, floor to lintel
          win.push(a);
        }
      }
      if(b.type==='tower'&&b.built){
        /* ROUND tower — a smooth tapered drum instead of a square keep.
           The lambert gradient around the curve is the roundness read;
           thin proud rings stand in for the stone courses. */
        const R=hw*1.02,midx2=(x0+x1)/2,midz2=(z0+z1)/2;
        cylS(midx2,midz2,R*1.08,R*.92,g,wh,wallC);
        cylS(midx2,midz2,R*1.10,R*1.10,g,g+.06,shade(wallC,0.9));      // base course
        for(const f of [.38,.68])
          cylS(midx2,midz2,R*(1.09-.06*f),R*(1.09-.06*f),g+(wh-g)*f,g+(wh-g)*f+.028,shade(wallC,0.82));
        // doorway sunk into the drum, facing the home camera
        box(midx2+R*.72,midz2-.10,midx2+R*1.02,midz2+.10,g,g+.34,hex('#241a10'),'solid',b.id,null);
        // arrow slits at the axis-aligned faces, barely proud of the curve —
        // anywhere else an axis-aligned box juts off the drum like a plank
        {const rr=R*(1.08-(1.08-.92)*.72)-.01,dk=hex('#241a10');
         box(midx2+rr-.004,midz2-.030,midx2+rr+.024,midz2+.030,
             g+(wh-g)*.60,g+(wh-g)*.84,dk,'solid',b.id,null);
         box(midx2-.030,midz2+rr-.004,midx2+.030,midz2+rr+.024,
             g+(wh-g)*.60,g+(wh-g)*.84,dk,'solid',b.id,null);}
      }else box(x0,z0,x1,z1,g,wh,wallC,style,b.id*7919,win);
      const tcS=teamColor(b.p),tcv=hex(tcS&&tcS.length===7?tcS:'#3b7bd4');
      const midx=(x0+x1)/2,midz=(z0+z1)/2;
      // foundation plinth: a slightly proud stone course at the ground line.
      // Real buildings SIT on something; without this they perch on the grass.
      if(b.built&&M.r!=='flat'){
        const pl=.035;
        box(x0-pl,z0-pl,x1+pl,z1+pl,g,g+Math.min(.07,H*.06),
            shade(hex('#8f887b'),0.96),'solid',b.id,null);
      }
      /* ---- per-type extras: the details that make each building itself ---- */
      if(b.built){
        if(style==='stone'&&!BLDS[b.type].thin&&b.type!=='tower'){  // no quoins on a drum
          // quoins — alternating corner stones on real stone buildings
          for(const [qx,qz] of [[x0,z0],[x1,z0],[x0,z1],[x1,z1]])
            for(let k=0;k<4;k++){
              const w2=.045*(k%2?0.78:1.05),qh=(wh-g)/4;
              box(qx-w2,qz-w2,qx+w2,qz+w2,g+qh*(k+.12),g+qh*(k+.88),
                  shade(wallC,0.92+(k%2)*0.16),'solid',b.id+k,null);
            }
        }
        if(b.type==='swall'||b.type==='sgate'){
          // stone walls carry merlons — the fortified read from any distance
          const mh=H*.30,pw=Math.min(.07,(x1-x0)*.18);
          for(const t of [0.18,0.5,0.82]){
            const mx=x0+(x1-x0)*t,mz=z0+(z1-z0)*t;
            box(mx-pw,mz-pw,mx+pw,mz+pw,wh,wh+mh,shade(wallC,1.05),'solid',b.id+t*10,null);
          }
        }else if(b.type==='wall'){
          // palisade: sharpened stake tips along the top
          for(const t of [0.22,0.5,0.78]){
            const mx=x0+(x1-x0)*t,mz=z0+(z1-z0)*t,r2=.055,tipY=wh+H*.22;
            tri3([mx-r2,wh,mz-r2],[mx+r2,wh,mz-r2],[mx,tipY,mz],wallC);
            tri3([mx+r2,wh,mz-r2],[mx+r2,wh,mz+r2],[mx,tipY,mz],wallC);
            tri3([mx+r2,wh,mz+r2],[mx-r2,wh,mz+r2],[mx,tipY,mz],wallC);
            tri3([mx-r2,wh,mz+r2],[mx-r2,wh,mz-r2],[mx,tipY,mz],wallC);
          }
        }else if(b.type==='farm'){
          // crop rows: a golden field with furrows, laid on the top face
          const crop=hex('#96864a');
          const At=[x0,wh+.004,z0],Rt=[x1-x0,0,0],Ut=[0,0,z1-z0];
          panel(At,Rt,Ut,0.03,0.03,0.97,0.97,0,crop);
          for(let i=0;i<4;i++)
            panel(At,Rt,Ut,0.10+i*0.23,0.05,0.148+i*0.23,0.95,.006,shade(crop,0.6));
        }else if(b.type==='market'){
          // striped awning over the door face — the bazaar read
          const A1=[x1,g,z1],R1=[x0-x1,0,0],U1=[0,wh-g,0];
          for(let i=0;i<5;i++)
            panel(A1,R1,U1,.28+i*.09,.58,.335+i*.09,.94,REL*1.5,(i%2)?tcv:hex('#e6dcc2'));
        }else if(b.type==='tc'){
          // yard props: a barrel and a crate by the door
          box(x0+.08,z1-.22,x0+.22,z1-.08,g,g+.16,hex('#7a5a32'),'solid',b.id,null);
          box(x0+.065,z1-.235,x0+.235,z1-.065,g+.055,g+.082,hex('#3a2d1e'),'solid',b.id,null);
          box(x1-.32,z1-.14,x1-.12,z1+.0,g,g+.13,hex('#8a6a42'),'solid',b.id,null);
        }else if(b.type==='camp'){
          // the log pile that says lumber
          box(x0+.06,z1-.34,x0+.66,z1-.21,g,g+.11,hex('#6b4a2a'),'solid',b.id,null);
          box(x0+.06,z1-.19,x0+.66,z1-.06,g,g+.11,hex('#5e4023'),'solid',b.id,null);
          box(x0+.14,z1-.27,x0+.58,z1-.13,g+.11,g+.21,hex('#7a5631'),'solid',b.id,null);
        }else if(b.type==='blacksmith'){
          // anvil on a stump, and the forge glow in a window
          box(x1-.24,z1-.22,x1-.12,z1-.10,g,g+.09,hex('#6b4a2a'),'solid',b.id,null);
          box(x1-.27,z1-.23,x1-.09,z1-.09,g+.09,g+.15,hex('#4c5157'),'solid',b.id,null);
          const A0=[x1,g,z1],R0=[x0-x1,0,0],U0=[0,wh-g,0];
          panel(A0,R0,U0,.70,.12,.86,.38,REL*1.4,[0.95,0.5,0.13]);
          panel(A0,R0,U0,.73,.17,.83,.32,REL*1.55,[1.0,0.8,0.32]);
        }else if(b.type==='dock'){
          // a working waterfront: mooring posts, a boom crane, waiting cargo
          for(const[px2,pz2] of [[x0+.05,z0+.05],[x1-.05,z0+.05],[x0+.05,z1-.05],[x1-.05,z1-.05]])
            box(px2-.035,pz2-.035,px2+.035,pz2+.035,g-.02,g+.22,hex('#5e4023'),'solid',b.id,null);
          box(midx-.045,midz-.045,midx+.045,midz+.045,g,g+.62,hex('#6b4a2a'),'solid',b.id,null);
          box(midx-.03,midz-.30,midx+.03,midz+.03,g+.52,g+.58,hex('#7a5631'),'solid',b.id,null);
          box(midx-.02,midz-.30,midx+.02,midz-.26,g+.30,g+.52,hex('#3a2d1e'),'solid',b.id,null);
          box(x1-.30,z0+.06,x1-.10,z0+.22,g,g+.14,hex('#8a6a42'),'solid',b.id,null);
        }
      }
      if(b.built&&M.r!=='flat'){
        const sig=M.rc==='#5a7ea8'||M.rc==='#d9b44a';
        const rc=hex(sig?M.rc:(ab===0?'#b5a267':ab===2?'#6f8095':M.rc));
        if(M.r==='gable'){
          gable(x0-inset*.6,z0-inset*.6,x1+inset*.6,z1+inset*.6,wh,g+H,rc,b.id*131);
          if(style==='plaster'){
            /* king-post trusses in the gable ends — the half-timber read from
               the road. Thin dark beams poking just proud of the end triangle:
               one post to the ridge, one collar beam across. */
            const beam=hex('#4a3520'),ridge=g+H;
            for(const ex2 of [x0-inset*.6,x1+inset*.6]){
              box(ex2-.014,midz-.018,ex2+.014,midz+.018,wh,ridge-.03,beam,'solid',b.id,null);
              box(ex2-.012,midz-(midz-z0)*.42,ex2+.012,midz+(z1-midz)*.42,
                  wh+(ridge-wh)*.40,wh+(ridge-wh)*.47,beam,'solid',b.id,null);
            }
          }
          if(b.type==='house'||b.type==='blacksmith'||b.type==='tc'){
            // a chimney breathing gentle smoke says "someone lives here"
            // louder than any texture. Position formula shared with buildFx.
            const chx=x1-(x1-x0)*.24,ridge=g+H;
            box(chx-.045,midz-.045,chx+.045,midz+.045,ridge-H*.30,ridge+H*.10,
                hex('#8f887b'),'solid',b.id,null);
            box(chx-.058,midz-.058,chx+.058,midz+.058,ridge+H*.10,ridge+H*.135,
                hex('#5a544a'),'solid',b.id,null);
          }
        }
        else if(M.r==='cone')coneTiled(midx,midz,(x1-x0)*.62,wh,g+H,rc);
        else if(M.r==='dome')dome(midx,midz,(x1-x0)*.44,wh,g+H,rc);
        else if(M.r==='crown'){
          /* crenellated parapet: a proud lip ringed with merlons. The corner
             merlon is drawn once by the x-edges; the z-edges skip endpoints or
             two identical boxes would z-fight at every corner. */
          const lip=.030,mh=H*.13,pw=.05;
          box(x0-lip,z0-lip,x1+lip,z1+lip,wh,wh+H*.045,shade(wallC,1.06),'solid',b.id,null);
          const mer=(ax,az,bx2,bz,skipEnds)=>{
            const L=Math.hypot(bx2-ax,bz-az),n2=Math.max(2,Math.round(L/0.30));
            for(let i=skipEnds?1:0;i<=(skipEnds?n2-1:n2);i++){
              const t=i/n2;
              const mx=ax+(bx2-ax)*t,mz=az+(bz-az)*t;
              box(mx-pw,mz-pw,mx+pw,mz+pw,wh+H*.045,wh+H*.045+mh,shade(wallC,1.03),'solid',b.id+i,null);
            }
          };
          mer(x0-lip,z0-lip,x1+lip,z0-lip,false);
          mer(x0-lip,z1+lip,x1+lip,z1+lip,false);
          mer(x0-lip,z0-lip,x0-lip,z1+lip,true);
          mer(x1+lip,z0-lip,x1+lip,z1+lip,true);
        }
        if(M.turret){                       // castle: four ROUND spired turrets
          const tr=s*.19;
          for(const [ox,oz] of [[x0,z0],[x1,z0],[x0,z1],[x1,z1]]){
            const ty0=g,ty1=g+H*.92;
            cylS(ox,oz,tr*1.12,tr*.98,ty0,ty1,hex(M.w));
            cylS(ox,oz,tr*1.16,tr*1.16,ty0+(ty1-ty0)*.55,ty0+(ty1-ty0)*.55+.03,shade(hex(M.w),0.82));
            coneTiled(ox,oz,tr*1.25,ty1,ty1+H*.34,hex(M.rc));
          }
        }
        if(b.type==='monastery'){
          // a cross on the gable end — reads before the blue roof does
          const cxx=x1+inset*.45;
          box(cxx-.016,midz-.016,cxx+.016,midz+.016,g+H*.98,g+H+H*.26,hex('#e8e2d2'),'solid',b.id,null);
          box(cxx-.055,midz-.014,cxx+.055,midz+.014,g+H+H*.15,g+H+H*.20,hex('#e8e2d2'),'solid',b.id,null);
        }
        // team-colour banner block, the loudest ownership signal on screen
        const bw=s*.07;
        box(midx-bw,midz-bw,midx+bw,midz+bw,g+H,g+H+H*.22,tcv,'solid',b.id,null);
        if(b.type==='wonder')  // gold finial above the banner
          box(midx-.03,midz-.03,midx+.03,midz+.03,g+H+H*.22,g+H+H*.34,hex('#d9b44a'),'solid',b.id,null);
        /* lying snow — white caps on the upward surfaces, driven by the same
           wxSnowLvl the 2D sprite rim uses (bldSig carries it, so the town
           whitens and thaws without waiting for a construction event) */
        if(wxSnowLvl){
          const SN=[.94,.955,.98];
          if(M.r==='gable'){
            box(x0-inset*.6,midz-.10,x1+inset*.6,midz+.10,g+H-.005,g+H+.030,SN,'solid',b.id,null);
            if(wxSnowLvl===2){                     // heavier fall reaches the eaves
              box(x0-inset*.6,z0-inset*.6-.02,x1+inset*.6,z0-inset*.6+.07,wh-.005,wh+.026,SN,'solid',b.id,null);
              box(x0-inset*.6,z1+inset*.6-.07,x1+inset*.6,z1+inset*.6+.02,wh-.005,wh+.026,SN,'solid',b.id,null);
            }
          }else if(M.r==='cone'){
            cone(midx,midz,(x1-x0)*.28,g+H-.10,g+H+.035,SN);
          }else if(M.r==='crown'){
            box(x0+.10,z0+.10,x1-.10,z1-.10,wh+.002,wh+.020,SN,'solid',b.id,null);
          }
        }
      }
      if(b.built&&wxSnowLvl&&(b.type==='wall'||b.type==='swall'||b.type==='gate'||b.type==='sgate')){
        box(x0+.02,z0+.02,x1-.02,z1-.02,g+H,g+H+.020,[.94,.955,.98],'solid',b.id,null);
      }
      n++;
    }
    const gl=this.gl;
    if(!this.bvbo){this.bvbo=gl.createBuffer();this.bibo=gl.createBuffer();
      this.bIdent=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,this.bIdent);
      // identity instance for the tree shader: pos 0, scale 1, shade 1, yaw 0.
      // 7 floats — MUST match the tree instance stride or buildings shear.
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,0,1, 1,1,0]),gl.STATIC_DRAW);}
    gl.bindBuffer(gl.ARRAY_BUFFER,this.bvbo);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(V),gl.DYNAMIC_DRAW);
    /* A big late-game town overflows 16-bit indices (65,535 verts is ~90
       detailed buildings) — and Uint16 WRAPS silently, which draws garbage
       triangles across the whole town. Promote to 32-bit indices when the
       device has them (core in WebGL2, extension almost everywhere else);
       failing that, drop whole trailing buildings rather than corrupt. */
    const VC=V.length/9;
    let IA,itype=gl.UNSIGNED_SHORT;
    if(VC>65535){
      if(this.gl2||gl.getExtension('OES_element_index_uint')){
        IA=new Uint32Array(I);itype=gl.UNSIGNED_INT;
      }else{
        let cut=0;
        for(let k=bmarks.length-1;k>=0;k--)if(bmarks[k][1]<=65535){cut=bmarks[k][0];break;}
        IA=new Uint16Array(I.slice(0,cut));
        console.warn('R3: town too detailed for this device — trailing buildings dropped');
      }
    }else IA=new Uint16Array(I);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.bibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,IA,gl.DYNAMIC_DRAW);
    this.bCount=IA.length;this.bIdxType=itype;this.bldN=n;this.bldKey=this.bldSig();
  },
  // cheap per-frame signature: buildings are tens, not thousands.
  // b.seen is in the hash because buildBlds FILTERS on it — without the term,
  // scouting an enemy building changed nothing here and the building stayed
  // invisible in 3D until some unrelated construction forced a rebuild.
  bldSig(){
    let h=G.blds.length*2654435761;
    for(const b of G.blds)h=(h^(b.id*31+(b.built?7:(b.prog*20)|0)+b.p*3+(b.seen?13:0)))>>>0;
    // players' ages are in the key: buildings re-dress the moment an owner
    // ages up (roofs/walls read the age), not at the next construction event.
    // wxSnowLvl too — the whole town whitens and thaws with the weather.
    return h+':'+MAP+':'+elevVer+':'+G.P.map(p=>(p&&p.age)||0).join('')+':'+wxSnowLvl;
  },
  drawBlds(mvp){
    if(this.noTrees)return;                      // shares the instanced path
    if(!this.treeProg&&!this.initTrees())return;
    const gl=this.gl,ex=this.iext;
    if(this.bldKey!==this.bldSig())this.buildBlds();
    if(!this.bCount)return;
    gl.useProgram(this.treeProg);
    gl.uniformMatrix4fv(this.treeLoc.uMVP,false,mvp);
    gl.uniform3f(this.treeLoc.uLight,-0.46,0.80,-0.38);
    gl.uniform1f(this.treeLoc.uAlpha,1.0);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.bvbo);
    for(let i=0;i<3;i++){gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i,3,gl.FLOAT,false,36,i*12);ex.vertexAttribDivisorANGLE(i,0);}
    gl.bindBuffer(gl.ARRAY_BUFFER,this.bIdent);
    gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,4,gl.FLOAT,false,28,0);
    ex.vertexAttribDivisorANGLE(3,1);
    gl.enableVertexAttribArray(4);gl.vertexAttribPointer(4,3,gl.FLOAT,false,28,16);
    ex.vertexAttribDivisorANGLE(4,1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.bibo);
    ex.drawElementsInstancedANGLE(gl.TRIANGLES,this.bCount,this.bIdxType||gl.UNSIGNED_SHORT,0,1);
    ex.vertexAttribDivisorANGLE(3,0);ex.vertexAttribDivisorANGLE(4,0);
    gl.disableVertexAttribArray(3);gl.disableVertexAttribArray(4);
  },
  /* ---- units ---------------------------------------------------------------
     Five archetypes (man / cavalry / siege / ship / beast), each a small mesh
     of boxed parts. Every vertex carries a PART index, and the vertex shader
     swings the parts about hip and shoulder pivots from a per-instance walk
     phase — so units actually walk and swing rather than sliding about frozen.
     One instanced draw call per archetype; instances are rebuilt each frame
     because units move every frame, which is ~44 bytes x unit count.
     Team colour rides a per-vertex flag, so the tabard and the horse caparison
     take the player colour while skin, timber and steel do not. */
  // building visual scale (non-flat massing) — Daniel-tuned twin of BLD_VS2D;
  // buildBlds, the pick volume, shadows and rings all read it
  BVS:1.25,
  /* 22 archetypes, one instanced draw call each (only those with instances
     present actually draw — a typical scene runs 6-10 calls). The flag-based
     fallback exists so a future unit type added to UNITS renders as SOMETHING
     sensible before anyone thinks about its mesh. */
  ARCHN:86,
  UARCH:{
    villager:4, militia:0, spearman:1, archer:2, skirmisher:24, scout:25, knight:6,
    ram:10, petard:41, scorpion:13, mangonel:12, treb:11, bombard:14, handcannon:3,
    monk:5, missionary:6, longbow:36, axeman:34, berserker:31, mangudai:7, teuton:30,
    woad:27, cataphract:6, mameluke:26, huskarl:33, chukonu:35, elephant:8, janissary:39,
    samurai:32, jaguar:29, eagle:28, plumed:40, warwagon:9, conquistador:38, tarkan:37,
    fishing:15, cog:16, transport:85, galley:17, fireship:78, demo:80, longboat:17,
    turtle:18, cannongalleon:83, sheep:19, deer:20, boar:21,
    tradecart:76, king:77,
  },
  /* attack-swing damping per archetype: 1 = full 51° chop (melee, treb throw,
     mangonel fling), small = recoil kick (guns, bolt throwers), 0 = the part
     scheme has nothing sensible to swing (monks, ships, most beasts). */
  ATKF:[1,1,.7,.35,1,0, .9,.7,.8,0, 1,1,1,.3,.3, 0,0,0,.25, 0,0,0,
        1,1,1,.9,.8, 1,1,1,1,1, 1,1,1,.35,.7, .9,.3,.3,.7,0,
        1,1,1, 1,1, .35,.35, 1, .9,.9, .9, 1, 0,
        .7,1,1,.7,1, 1,.9,.8,1,.35, .8,.3,1,1,1, .7,0,.3,.9,0, 0,
        0,0, 0,0,0,0,0,0,0,0],
  /* Age-variant archetype per line unit, indexed by the OWNING PLAYER's age
     (0 Dark..3 Imperial). Chosen per frame in drawUnits — render side only.
     Unique units use the same table: their Imperial slot IS the elite,
     matching statFor's elite-at-Imperial rule. */
  AGEV:{militia:[42,43,0,44], spearman:[45,45,1,46], archer:[2,2,47,48],
        skirmisher:[24,24,49,49], scout:[25,25,50,51], knight:[6,6,6,52],
        ram:[10,10,10,53], galley:[17,17,82,54],
        fireship:[78,78,78,79], demo:[80,80,80,81], cannongalleon:[83,83,83,84],
        longbow:[36,36,36,55], axeman:[34,34,34,56], berserker:[31,31,31,57],
        mangudai:[7,7,7,58], teuton:[30,30,30,59], woad:[27,27,27,60],
        cataphract:[6,6,6,61], mameluke:[26,26,26,62], huskarl:[33,33,33,63],
        chukonu:[35,35,35,64], elephant:[8,8,8,65], janissary:[39,39,39,66],
        samurai:[32,32,32,67], jaguar:[29,29,29,68], eagle:[28,28,28,69],
        plumed:[40,40,40,70], warwagon:[9,9,9,71], conquistador:[38,38,38,72],
        tarkan:[37,37,37,73], longboat:[17,17,17,74], turtle:[18,18,18,75]},
  unitArch(t){
    if(this.UARCH[t]!==undefined)return this.UARCH[t];
    const d=UNITS[t]||{};
    if(d.animal)return 21;
    if(d.ship)return 17;
    if(d.siege)return 12;
    if(d.cav)return d.ranged?7:6;
    if(d.monk)return 5;
    if(d.gun)return 3;
    if(d.ranged)return 2;
    return 0;
  },
  buildUnitMeshes(){
    const V=[],I=[],off=[],cnt=[],piv=[];
    /* The roster + age-variant library exceeds 65,535 verts, so the unit mesh
       uses 32-bit indices where available (WebGL2 core, or OES_element_index_uint
       — both benchmarked devices have it). On a device with neither, the
       age-variant archetypes ALIAS their base geometry instead of building:
       everything still renders, just without the age looks. */
    const idx32=!!(this.gl2||this.gl.getExtension('OES_element_index_uint'));
    this.uIdx32=idx32;
    const hex=c=>[parseInt(c.slice(1,3),16)/255,parseInt(c.slice(3,5),16)/255,parseInt(c.slice(5,7),16)/255];
    const vpush=(p,n,c,part,team)=>{V.push(p[0],p[1],p[2],n[0],n[1],n[2],c[0],c[1],c[2],part,team);
      return V.length/11-1;};
    const q=(a,b,c,d,col,part,team)=>{
      const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=d[0]-a[0],vy=d[1]-a[1],vz=d[2]-a[2];
      let nx=-(uy*vz-uz*vy),ny=-(uz*vx-ux*vz),nz=-(ux*vy-uy*vx);
      const L=Math.hypot(nx,ny,nz)||1;const n=[nx/L,ny/L,nz/L];
      const i0=vpush(a,n,col,part,team),i1=vpush(b,n,col,part,team),
            i2=vpush(c,n,col,part,team),i3=vpush(d,n,col,part,team);
      I.push(i0,i1,i2,i0,i2,i3);
    };
    /* Axis-aligned box from min/max, tagged with a part index. `tap` shrinks
       the TOP face toward its centre (0..1) so a torso or head becomes a soft
       frustum instead of a crate — the single cheapest cure for "everything
       is made of boxes", because it costs ZERO extra triangles. Negative tap
       WIDENS the top: that is what gives ship hulls a keel. */
    const bx=(x0,y0,z0,x1,y1,z1,col,part,team,tap)=>{
      team=team||0;tap=tap||0;
      const cx2=(x0+x1)/2,cz2=(z0+z1)/2;
      const sx=(x1-x0)/2*(1-tap),sz=(z1-z0)/2*(1-tap);
      const tx0=cx2-sx,tx1=cx2+sx,tz0=cz2-sz,tz1=cz2+sz;
      q([x0,y0,z0],[x1,y0,z0],[tx1,y1,tz0],[tx0,y1,tz0],col,part,team);
      q([x1,y0,z1],[x0,y0,z1],[tx0,y1,tz1],[tx1,y1,tz1],col,part,team);
      q([x1,y0,z0],[x1,y0,z1],[tx1,y1,tz1],[tx1,y1,tz0],col,part,team);
      q([x0,y0,z1],[x0,y0,z0],[tx0,y1,tz0],[tx0,y1,tz1],col,part,team);
      q([tx0,y1,tz0],[tx1,y1,tz0],[tx1,y1,tz1],[tx0,y1,tz1],col,part,team);
      q([x0,y0,z1],[x1,y0,z1],[x1,y0,z0],[x0,y0,z0],col,part,team);
    };
    /* Octagonal frustum on the Y axis — the cure for "made of boxes" where the
       form is actually ROUND: limbs, torsos, necks, heads. tap shrinks the TOP
       ring toward the centre (0..1), tapB the BOTTOM ring. 8 side quads + two
       cap fans = 32 tris. Winding matches bx() so the unit-pass culling and
       the negated-normal convention both hold. */
    /* Smooth-shaded surface of revolution on the Y axis. P = rings bottom→top,
       each [y, rx, rz]. Vertices carry SMOOTH radial normals tilted by the
       profile slope, so the lambert term shades a continuous curve — smooth
       normals, not more polygons, are what kill the boxy read. Winding and
       cap fans follow the same convention the box helper uses (verified
       visible under the unit-pass culling). Caps only where the end ring is
       open; a profile that closes to ~0 radius needs none. */
    const lathe=(cx,cz,P,col,part,team,seg)=>{
      team=team||0;seg=seg||10;
      const R=P.length,ring=[];
      for(let i=0;i<R;i++){
        const y=P[i][0],rx=P[i][1],rz=P[i][2]!==undefined?P[i][2]:P[i][1];
        const p0=P[Math.max(0,i-1)],p1=P[Math.min(R-1,i+1)];
        const dy=(p1[0]-p0[0])||1e-6;
        const r1z=p1[2]!==undefined?p1[2]:p1[1],r0z=p0[2]!==undefined?p0[2]:p0[1];
        const sl=((p1[1]+r1z)-(p0[1]+r0z))/2/dy;
        const idx=[];
        for(let k=0;k<seg;k++){
          const a=k/seg*2*Math.PI,px=Math.cos(a),pz=Math.sin(a);
          let nx=px/(rx||1e-4),nz=pz/(rz||1e-4);
          const L=Math.hypot(nx,nz)||1;nx/=L;nz/=L;
          const nl=Math.hypot(nx,sl,nz)||1;
          idx.push(vpush([cx+px*rx,y,cz+pz*rz],[nx/nl,-sl/nl,nz/nl],col,part,team));
        }
        ring.push(idx);
      }
      for(let i=0;i<R-1;i++)for(let k=0;k<seg;k++){
        const k2=(k+1)%seg;
        I.push(ring[i][k],ring[i][k2],ring[i+1][k2],ring[i][k],ring[i+1][k2],ring[i+1][k]);
      }
      const cap=(i,up)=>{
        const y=P[i][0],rx=P[i][1],rz=P[i][2]!==undefined?P[i][2]:P[i][1];
        if(rx<.01&&rz<.01)return;
        const n=[0,up,0],c=vpush([cx,y,cz],n,col,part,team);
        for(let k=0;k<seg;k++){const k2=(k+1)%seg;
          const v1=vpush([cx+Math.cos(k/seg*2*Math.PI)*rx,y,cz+Math.sin(k/seg*2*Math.PI)*rz],n,col,part,team),
                v2=vpush([cx+Math.cos(k2/seg*2*Math.PI)*rx,y,cz+Math.sin(k2/seg*2*Math.PI)*rz],n,col,part,team);
          if(up>0)I.push(c,v1,v2);else I.push(c,v2,v1);
        }
      };
      cap(R-1,1);cap(0,-1);
    };
    /* Same lathe extruded along X — animal bodies, muzzles, trunks.
       P = rings back(x0)→front(x1), each [x, ry, rz]. */
    const latheX=(cy,cz,P,col,part,team,seg)=>{
      team=team||0;seg=seg||10;
      const R=P.length,ring=[];
      for(let i=0;i<R;i++){
        const x=P[i][0],ry=P[i][1],rz=P[i][2]!==undefined?P[i][2]:P[i][1];
        const p0=P[Math.max(0,i-1)],p1=P[Math.min(R-1,i+1)];
        const dx=(p1[0]-p0[0])||1e-6;
        const r1z=p1[2]!==undefined?p1[2]:p1[1],r0z=p0[2]!==undefined?p0[2]:p0[1];
        const sl=((p1[1]+r1z)-(p0[1]+r0z))/2/dx;
        const idx=[];
        for(let k=0;k<seg;k++){
          const a=k/seg*2*Math.PI,py=Math.sin(a),pz=Math.cos(a);
          let ny=py/(ry||1e-4),nz=pz/(rz||1e-4);
          const L=Math.hypot(ny,nz)||1;ny/=L;nz/=L;
          const nl=Math.hypot(sl,ny,nz)||1;
          idx.push(vpush([x,cy+py*ry,cz+pz*rz],[-sl/nl,ny/nl,nz/nl],col,part,team));
        }
        ring.push(idx);
      }
      for(let i=0;i<R-1;i++)for(let k=0;k<seg;k++){
        const k2=(k+1)%seg;
        I.push(ring[i][k],ring[i][k2],ring[i+1][k2],ring[i][k],ring[i+1][k2],ring[i+1][k]);
      }
      const cap=(i,fwd)=>{
        const x=P[i][0],ry=P[i][1],rz=P[i][2]!==undefined?P[i][2]:P[i][1];
        if(ry<.01&&rz<.01)return;
        const n=[fwd,0,0],c=vpush([x,cy,cz],n,col,part,team);
        for(let k=0;k<seg;k++){const k2=(k+1)%seg;
          const v1=vpush([x,cy+Math.sin(k/seg*2*Math.PI)*ry,cz+Math.cos(k/seg*2*Math.PI)*rz],n,col,part,team),
                v2=vpush([x,cy+Math.sin(k2/seg*2*Math.PI)*ry,cz+Math.cos(k2/seg*2*Math.PI)*rz],n,col,part,team);
          if(fwd>0)I.push(c,v1,v2);else I.push(c,v2,v1);
        }
      };
      cap(R-1,1);cap(0,-1);
    };
    /* The old octagonal helpers, now thin wrappers over the smooth lathe —
       every existing call site becomes round-shaded for free. */
    const oct=(cx,y0,cz,rx,rz,y1,col,part,team,tap,tapB)=>{
      const st=1-(tap||0),sb=1-(tapB||0);
      lathe(cx,cz,[[y0,rx*sb,rz*sb],[y1,rx*st,rz*st]],col,part,team,10);
    };
    const octX=(x0,cy,cz,ry,rz,x1,col,part,team,tapF,tapB)=>{
      const sf=1-(tapF||0),sb=1-(tapB||0);
      latheX(cy,cz,[[x0,ry*sb,rz*sb],[x1,ry*sf,rz*sf]],col,part,team,10);
    };
    const SKIN=hex('#e0b78e'),CLOTH=hex('#8a7a5e'),STEEL=hex('#b9bec4'),
          WOOD=hex('#6b4a2a'),DARK=hex('#3a2d1e'),HIDE=hex('#7d6a4e'),CANV=hex('#e6dcc2'),
          IRON=hex('#6b7078'),TUSK=hex('#e8e2d2'),WOOL=hex('#e3dcc6'),TAN=hex('#b08a5c'),
          GREY=hex('#8a8578'),BOARC=hex('#523d29'),DECK=hex('#8a6a42'),
          EYE=hex('#1c1410'),HAIR=hex('#3d2a18'),LEATH=hex('#4a331c'),
          GOLDC=hex('#c9a227'),STRAW=hex('#c9b46a'),BOOT=hex('#2a1f14'),
          WOADB=hex('#4a6fa8'),FLAME=hex('#f2a13c');
    // team-tinted detail rides the mix channel: aCol BLACK + mix m = team×m
    // (a darkened fold), aCol WHITE + mix m = team lifted toward white (a
    // highlight band). BLACK/WHITE below exist only for that trick.
    const BLACK=[0,0,0],WHITE=[1,1,1];
    const mark=()=>off.push(I.length);
    const seal=i=>cnt.push(I.length-off[i]);
    /* Part scheme (fixed by the shader — reread it before adding parts):
       2/3 legs/wheels swing ±0.55·s about pivot hip; 4/5 arms/oars ±0.32·s
       about pivot shoulder; 6 = weapon arm, −0.32·s and the attack swing;
       0/1 static (1 exists so heads/necks can be excluded from future work).
       All units face +x; hdg rotates the whole instance.
       Detail quads follow the BUILDING rule — relief, not texture: small boxes
       floated just proud of the parent face, tagged with the parent's part so
       they swing together. Eyes/hands sit ~.006 proud; closer vanishes. */
    // shared human body: booted legs, team tabard with folds+belt, head with a
    // face, off-arm+hand. Weapon arm/hand here too — weapon itself is per-type.
    // hat: 0 bare hair, 1 none (a helmet will cover it), 2 straw brim.
    /* A real FIGURE now, not a crate stack: octagonal thigh+calf legs with a
       knee break, a chest that widens to the shoulders over a belted waist,
       shoulder roundels, bare forearms, a neck, and a jaw+crown head with a
       nose. The part scheme and every per-type attachment point (helmet band
       at ±.065, arm centres z ±.133, weapon shaft z .13) are UNCHANGED, so
       all the per-archetype helmets/weapons/quivers still fit. */
    /* opt: tc = torso/sleeve colour (default CLOTH), tm = team-mix for those
       surfaces (default 1), bare = skin torso, no tunic folds (woad, eagle). */
    const man=(shield,hat,beard,opt)=>{
      const o=opt||{},TC=o.tc||CLOTH,TM=o.tm!==undefined?o.tm:1;
      const leg=(zc,part)=>{
        lathe(0,zc,[[.115,.036,.038],[.20,.043,.045],[.295,.047,.049]],DARK,part); // thigh — full at the hip
        lathe(0,zc,[[.05,.026,.028],[.10,.035,.037],[.145,.036,.038]],DARK,part);  // calf — muscle at the top
        latheX(.032,zc,[[-.042,.030,.028],[.02,.032,.030],[.066,.022,.026]],BOOT,part); // boot, rounded toe
      };
      leg(-.06,2);leg(.06,3);
      oct(0,.218,0,.064,.086,.245,BLACK,0,.66);          // tunic hem, darkened team
      oct(0,.235,0,.06,.082,.302,TC,0,TM,.04);           // hips / tunic skirt
      oct(0,.296,0,.057,.078,.322,LEATH,0);              // belt
      bx(.056,.30,-.013,.068,.32,.013,GOLDC,0);          // buckle
      lathe(0,0,[[.318,.055,.074],[.355,.050,.068],[.415,.053,.072],
        [.452,.060,.081],[.478,.048,.066]],TC,0,TM);     // chest — waist in, shoulders out and rounded
      if(!o.bare){
        bx(.048,.34,-.044,.056,.44,-.02,BLACK,0,.78);    // tunic folds, front face
        bx(.048,.34,.02,.056,.44,.044,BLACK,0,.78);
        bx(-.058,.34,-.017,-.05,.44,.017,BLACK,0,.78);   // one on the back
      }
      oct(0,.472,0,.026,.03,.512,SKIN,1);                // neck
      lathe(0,0,[[.502,.030,.033],[.518,.043,.047],[.552,.051,.055],[.588,.053,.057],
        [.625,.047,.051],[.652,.030,.033],[.663,.008,.008]],SKIN,1); // skull — chin, cheeks, rounded crown
      bx(.043,.562,-.032,.054,.584,-.012,EYE,1);         // eyes — the face reads
      bx(.043,.562,.012,.054,.584,.032,EYE,1);
      bx(.047,.535,-.011,.063,.572,.011,SKIN,1);         // nose
      if(hat===0)lathe(0,-.004,[[.588,.054,.058],[.625,.051,.055],[.655,.036,.040],
        [.672,.008,.008]],HAIR,1);                       // bare head: hair, a rounded cap
      else if(hat===2){oct(0,.612,0,.086,.09,.633,STRAW,1);    // straw brim
        lathe(0,0,[[.633,.049,.052],[.668,.043,.046],[.692,.020,.022]],STRAW,1);} // crown, domed
      if(beard)bx(.04,.502,-.028,.056,.55,.028,HAIR,1);
      const arm=(zc,part)=>{
        lathe(0,zc,[[.452,.025,.027],[.468,.034,.036],[.49,.024,.026]],TC,part,TM); // shoulder ball
        lathe(0,zc,[[.36,.026,.028],[.42,.031,.033],[.468,.028,.030]],TC,part,TM);  // sleeved upper arm
        lathe(0,zc,[[.29,.020,.022],[.335,.027,.029],[.372,.024,.026]],SKIN,part);  // bare forearm
      };
      arm(-.133,4);
      lathe(0,-.133,[[.246,.014,.016],[.262,.026,.026],[.285,.026,.026],[.298,.012,.014]],SKIN,4); // hand
      if(shield){
        bx(-.005,.28,-.225,.055,.47,-.16,CLOTH,4,1);   // shield, team face
        bx(.012,.345,-.232,.038,.405,-.222,GOLDC,4);   // boss
        bx(-.005,.28,-.23,.055,.30,-.158,BLACK,4,.62); // rim, darkened team
        bx(-.005,.45,-.23,.055,.47,-.158,BLACK,4,.62);
      }
      arm(.133,6);                                       // weapon arm — swings WITH the weapon
      lathe(0,.133,[[.246,.014,.016],[.262,.026,.026],[.285,.026,.026],[.298,.012,.014]],SKIN,6); // weapon hand
    };
    // ---- 0 SWORDSMAN (militia line, UU infantry, petard) — hip .27 shoulder .47
    mark();
    man(true,1,true);
    lathe(0,0,[[.585,.061,.065],[.628,.058,.062],[.663,.040,.044],[.684,.010,.011]],STEEL,1); // helm — a domed skullcap
    bx(-.02,.655,-.02,.02,.70,.02,BLACK,1,.8);      // team plume stub
    bx(.058,.585,-.012,.066,.645,.012,STEEL,1);     // nasal bar
    bx(-.078,.462,-.115,.02,.502,-.078,STEEL,4);    // pauldrons over the arm tops
    bx(-.078,.462,.078,.02,.502,.115,STEEL,6);
    bx(-.012,.44,.115,.012,.72,.145,STEEL,6);       // blade, upright at rest
    bx(-.004,.44,.121,.004,.70,.139,WHITE,6,.0);    // fuller line — pale steel ridge
    bx(-.035,.42,.105,.035,.45,.155,WOOD,6);        // crossguard
    bx(-.02,.395,.118,.02,.42,.142,GOLDC,6);        // pommel
    seal(0);piv.push([.27,.47]);
    // ---- 1 SPEARMAN (spear/skirmisher) — kettle hat, tall pike
    mark();
    man(true,1,true);
    lathe(0,0,[[.602,.078,.082],[.626,.070,.074]],STEEL,1);  // kettle brim — a real disc
    lathe(0,0,[[.626,.048,.052],[.658,.042,.046],[.680,.016,.018]],STEEL,1); // domed crown
    bx(-.012,.30,.118,.012,.98,.142,WOOD,6);        // shaft
    bx(-.014,.60,.116,.014,.64,.144,LEATH,6);       // grip wrap
    bx(-.02,.96,.112,.02,1.06,.148,STEEL,6);        // spearhead
    seal(1);piv.push([.27,.47]);
    // ---- 2 BOWMAN (archer line) — bow held in the swing arm, quiver on the back
    mark();
    man(false,0,false);
    bx(-.105,.34,-.03,-.062,.55,.03,WOOD,0);        // quiver
    bx(-.10,.55,-.026,-.066,.60,.026,CANV,0);       // fletching poking out
    bx(-.02,.30,-.113,.02,.50,-.106,LEATH,0);       // shoulder strap across the back
    bx(.115,.30,.122,.135,.44,.142,WOOD,6);         // bow: three slats fake the curve
    bx(.125,.44,.122,.145,.55,.142,WOOD,6);
    bx(.115,.55,.122,.135,.69,.142,WOOD,6);
    bx(.127,.47,.118,.143,.52,.146,LEATH,6);        // wrapped grip
    bx(.108,.31,.128,.114,.68,.136,CANV,6);         // string
    seal(2);piv.push([.27,.47]);
    // ---- 3 GUNNER (hand cannoneer, janissary) — iron tube held level
    mark();
    man(false,1,false);
    lathe(0,0,[[.585,.060,.064],[.625,.055,.059],[.655,.034,.037],[.668,.010,.011]],IRON,1); // iron cap, domed
    bx(-.05,.42,.112,.02,.475,.148,WOOD,6);         // stock
    bx(.02,.44,.115,.30,.495,.145,IRON,6);          // barrel
    bx(.28,.432,.11,.305,.503,.15,DARK,6);          // muzzle band
    bx(.02,.478,.122,.05,.508,.138,STEEL,6);        // pan + sight nub
    seal(3);piv.push([.27,.47]);
    // ---- 4 VILLAGER — straw hat, axe/tool over the shoulder
    mark();
    man(false,2,false);
    bx(-.012,.32,.118,.012,.64,.142,WOOD,6);        // haft
    bx(-.035,.60,.11,.035,.65,.15,STEEL,6);         // axe head
    seal(4);piv.push([.27,.47]);
    // ---- 5 MONK — full robe, team sash, tonsure, no weapon
    mark();
    bx(-.09,.02,-.10,.09,.52,.10,CLOTH,0,0,.24);    // robe, flaring to the hem
    bx(.088,.06,-.045,.094,.50,-.02,BLACK,0,.14);   // robe folds — near-neutral dark
    bx(.088,.06,.02,.094,.50,.045,BLACK,0,.14);
    bx(-.093,.22,-.035,.093,.32,.035,CLOTH,0,1);    // team sash
    bx(-.095,.205,-.037,.095,.225,.037,STRAW,0);    // rope belt under it
    oct(0,.505,0,.024,.028,.53,SKIN,1);             // neck
    lathe(0,0,[[.512,.030,.033],[.528,.042,.046],[.558,.050,.054],[.592,.052,.056],
      [.622,.046,.050],[.645,.028,.031],[.655,.008,.008]],SKIN,1); // skull — chin, cheeks, crown
    bx(.042,.565,-.031,.052,.586,-.012,EYE,1);      // eyes
    bx(.042,.565,.012,.052,.586,.031,EYE,1);
    bx(.046,.538,-.01,.061,.573,.01,SKIN,1);        // nose
    oct(0,.605,0,.054,.058,.638,HAIR,1,.15);        // tonsure ring — bald crown pokes above
    bx(-.075,.585,-.058,-.032,.66,.058,CLOTH,1);    // cowl, thrown back behind the head
    oct(0,.36,-.12,.045,.048,.465,CLOTH,4,0,-.14);  // sleeves — flare at the cuff
    oct(0,.36,.12,.045,.048,.465,CLOTH,5,0,-.14);
    oct(0,.29,-.12,.026,.028,.37,SKIN,4,0,-.1);     // wrists
    oct(0,.29,.12,.026,.028,.37,SKIN,5,0,-.1);
    bx(-.034,.256,-.146,.034,.298,-.098,SKIN,4);    // hands
    bx(-.034,.256,.098,.034,.298,.146,SKIN,5);
    seal(5);piv.push([.26,.44]);
    // shared horse: diagonal leg pairs, hide barrel, team caparison, neck+head
    /* Horse rebuilt round: octagonal legs with a cannon-bone break and real
       hooves, a barrel with a rounded chest and rump, a tapering neck and a
       proper muzzle. Rider gets the same treatment as the footmen — chest,
       neck, jaw+crown head, nose. Leg part pairs, pivots and the helm/lance
       attachment heights are unchanged. */
    /* opt: bare = no caparison (scouts, steppe riders) — a light team blanket
       carries the ownership read instead. */
    const horse=(opt)=>{
      const o=opt||{};
      const leg=(xc,zc,part)=>{
        lathe(xc,zc,[[.14,.028,.028],[.24,.033,.033],[.34,.038,.038]],DARK,part,0,8); // upper leg into the barrel
        lathe(xc,zc,[[.05,.022,.022],[.10,.026,.026],[.16,.025,.025]],DARK,part,0,8); // cannon
        latheX(.028,zc,[[xc-.03,.026,.026],[xc+.012,.028,.028],[xc+.038,.020,.024]],BOOT,part); // hoof
      };
      leg(.17,-.07,2);leg(.17,.07,3);leg(-.17,-.07,3);leg(-.17,.07,2);
      latheX(.375,0,[[-.26,.078,.068],[-.17,.112,.098],[-.02,.118,.102],
        [.13,.112,.098],[.24,.082,.072]],HIDE,0,0,12);   // barrel — real belly, chest and rump
      if(!o.bare){
        latheX(.39,0,[[-.25,.074,.085],[-.15,.098,.113],[0,.102,.118],
          [.12,.098,.113],[.23,.078,.089]],CLOTH,0,1,12);  // caparison drape — team, follows the barrel
        latheX(.39,0,[[-.09,.104,.120],[.02,.105,.121],[.13,.100,.115]],WHITE,0,.85,12); // trim girth — a lifted-team band riding the drape
      }else{
        bx(-.12,.448,-.10,.14,.478,.10,CLOTH,0,1);  // light team blanket instead
      }
      bx(-.07,.465,-.088,.10,.492,.088,LEATH,0);    // saddle pad
      oct(-.285,.30,0,.021,.021,.46,DARK,0,0,.3);   // tail
      lathe(.24,0,[[.42,.062,.050],[.53,.055,.044],[.63,.048,.038]],HIDE,1); // neck, tapering up
      bx(.17,.615,-.018,.30,.66,.018,HAIR,1);       // mane ridge
      latheX(.585,0,[[.27,.050,.044],[.34,.052,.046],[.42,.042,.038]],HIDE,1); // head
      latheX(.565,0,[[.40,.034,.031],[.44,.030,.028],[.47,.024,.022]],DARK,1); // muzzle
      bx(.33,.598,-.05,.352,.616,-.044,EYE,1);      // eyes
      bx(.33,.598,.044,.352,.616,.05,EYE,1);
      bx(.36,.545,-.049,.40,.62,.049,LEATH,1);      // bridle strap
      bx(.30,.63,-.038,.335,.685,-.022,HIDE,1);     // ears
      bx(.30,.63,.022,.335,.685,.038,HIDE,1);
      bx(-.02,.34,-.135,.06,.48,-.105,CLOTH,0,1);   // rider legs against the flanks
      bx(-.02,.34,.105,.06,.48,.135,CLOTH,0,1);
      oct(.01,.468,0,.058,.072,.492,BLACK,0,.66);   // rider hem band
      lathe(.01,0,[[.475,.056,.070],[.515,.051,.063],[.575,.053,.067],
        [.63,.058,.075],[.662,.046,.060]],CLOTH,0,1); // rider torso — waist and shoulders
      bx(.058,.53,-.042,.065,.62,-.018,BLACK,0,.78);  // rider tunic folds
      bx(.058,.53,.018,.065,.62,.042,BLACK,0,.78);
      oct(.01,.66,0,.024,.028,.688,SKIN,1);         // rider neck
      lathe(.01,0,[[.682,.026,.028],[.698,.037,.040],[.727,.043,.046],[.758,.044,.047],
        [.785,.038,.041],[.805,.014,.015]],SKIN,1); // rider skull — chin, cheeks, crown
      bx(.046,.728,-.027,.056,.748,-.009,EYE,1);    // rider eyes
      bx(.046,.728,.009,.056,.748,.027,EYE,1);
      bx(.049,.705,-.009,.063,.736,.009,SKIN,1);    // rider nose
    };
    // ---- 6 CAVALRY (scout/knight line, UU cavalry) — couched lance
    mark();
    horse();
    lathe(.01,0,[[.752,.047,.051],[.79,.043,.047],[.815,.024,.026],[.826,.008,.008]],STEEL,1); // helm, domed
    bx(-.06,.57,.105,.50,.595,.13,WOOD,6);          // lance
    bx(.50,.562,.10,.585,.60,.135,STEEL,6);         // point
    seal(6);piv.push([.26,.55]);
    // ---- 7 CAVALRY ARCHER (mangudai, conquistador, mameluke) — bow at the knee
    mark();
    horse();
    lathe(.01,0,[[.752,.047,.050],[.786,.043,.046],[.812,.020,.022]],HAIR,1); // fur cap
    bx(.10,.50,.115,.13,.62,.135,WOOD,6);           // compact bow, three slats
    bx(.115,.62,.115,.14,.72,.135,WOOD,6);
    bx(.10,.72,.115,.125,.82,.135,WOOD,6);
    bx(.105,.51,.121,.111,.81,.129,CANV,6);         // string
    seal(7);piv.push([.26,.55]);
    // ---- 8 ELEPHANT — grey mass, trunk, tusks, team howdah
    // (body factored so the Imperial elite can re-dress it)
    const elephantBody=()=>{
    oct(-.20,0,-.09,.052,.048,.33,GREY,2,0,-.12);   // columnar legs
    oct(-.20,0,.09,.052,.048,.33,GREY,3,0,-.12);
    oct(.18,0,-.09,.052,.048,.33,GREY,3,0,-.12);
    oct(.18,0,.09,.052,.048,.33,GREY,2,0,-.12);
    latheX(.47,0,[[-.30,.128,.114],[-.18,.176,.156],[.02,.185,.165],
      [.17,.172,.152],[.28,.128,.114]],GREY,0,0,12); // body — a real rounded mass
    latheX(.54,0,[[.26,.096,.091],[.34,.10,.095],[.44,.082,.078]],GREY,1); // head
    bx(.40,.565,-.083,.425,.585,-.075,EYE,1);       // eyes
    bx(.40,.565,.075,.425,.585,.083,EYE,1);
    oct(.465,.13,0,.042,.036,.475,GREY,1,0,-.08,.35); // trunk — narrows to the tip
    oct(.465,.095,0,.028,.025,.16,hex('#78716a'),1,0,0,.3); // trunk tip, darker
    bx(.42,.32,-.095,.56,.355,-.058,TUSK,1);        // tusks
    bx(.42,.32,.058,.56,.355,.095,TUSK,1);
    bx(.25,.50,-.21,.33,.63,-.165,GREY,1);          // ears
    bx(.262,.515,-.205,.318,.615,-.17,hex('#9c948a'),1); // inner ear, lighter
    bx(.25,.50,.165,.33,.63,.21,GREY,1);
    bx(.262,.515,.17,.318,.615,.205,hex('#9c948a'),1);
    bx(-.14,.62,-.12,.10,.78,.12,CLOTH,0,1);        // howdah — team
    bx(-.145,.61,-.125,.105,.64,.125,WHITE,0,.85);  // howdah trim band
    oct(-.005,.78,0,.038,.038,.875,SKIN,1,.3,.1);   // mahout
    };
    mark();elephantBody();seal(8);piv.push([.30,.60]);
    // ---- 9 WAR WAGON — armoured team cabin, draught horse
    const wagonBody=()=>{
    bx(-.30,0,-.19,-.12,.24,-.13,DARK,2);
    bx(-.30,0,.13,-.12,.24,.19,DARK,3);
    bx(.02,0,-.19,.20,.24,-.13,DARK,3);
    bx(.02,0,.13,.20,.24,.19,DARK,2);
    bx(-.34,.20,-.16,.26,.34,.16,WOOD,0);           // bed
    bx(-.32,.34,-.15,.24,.58,.15,CLOTH,0,1);        // armoured cabin — team panels
    bx(-.35,.58,-.17,.27,.65,.17,WOOD,0);           // roof
    bx(.24,.40,-.06,.255,.52,.06,DARK,0);           // arrow slit
    octX(.30,.34,0,.10,.078,.48,HIDE,0,0,.2,.2);    // draught horse — rounded barrel
    oct(.46,.40,0,.048,.04,.56,HIDE,1,0,.25);       // its neck
    octX(.44,.53,0,.04,.036,.60,HIDE,1,0,.25);      // its head
    bx(.34,0,-.075,.40,.26,-.025,DARK,2);
    bx(.34,0,.025,.40,.26,.075,DARK,3);
    };
    mark();wagonBody();seal(9);piv.push([.14,.40]);
    // ---- 10 RAM — hide-skinned shed, the log itself batters (part 6)
    mark();
    bx(-.30,0,-.20,-.16,.22,-.14,DARK,2);
    bx(-.30,0,.14,-.16,.22,.20,DARK,3);
    bx(.14,0,-.20,.28,.22,-.14,DARK,3);
    bx(.14,0,.14,.28,.22,.20,DARK,2);
    bx(-.32,.22,-.20,.32,.42,-.13,HIDE,0);          // hide skirts
    bx(-.32,.22,.13,.32,.42,.20,HIDE,0);
    bx(-.34,.42,-.15,.34,.50,.15,WOOD,0);           // roof plank
    bx(-.38,.26,-.045,.44,.345,.045,DARK,6);        // the log
    bx(.44,.25,-.05,.51,.355,.05,IRON,6);           // iron head
    seal(10);piv.push([.12,.30]);
    // ---- 11 TREBUCHET — arm cocked upright, hurls forward on attack
    mark();
    bx(-.34,0,-.18,.34,.07,-.10,WOOD,0);            // skids
    bx(-.34,0,.10,.34,.07,.18,WOOD,0);
    bx(-.30,.07,-.14,.30,.15,.14,WOOD,0);           // base
    bx(-.05,.15,-.145,.05,.585,-.085,WOOD,0);       // A-frame
    bx(-.05,.15,.085,.05,.585,.145,WOOD,0);
    bx(-.04,.53,-.10,.04,.60,.10,DARK,0);           // axle
    bx(-.028,.30,-.028,.028,1.06,.028,WOOD,6);      // throwing arm
    bx(-.105,.22,-.09,.105,.40,.09,IRON,6);         // counterweight
    bx(-.055,1.03,-.045,.055,1.11,.045,CANV,6);     // sling pouch
    seal(11);piv.push([.12,.565]);
    // ---- 12 MANGONEL — bowl arm flings from a low pivot
    mark();
    bx(-.10,0,-.17,.06,.20,-.11,DARK,2);
    bx(-.10,0,.11,.06,.20,.17,DARK,3);
    bx(-.22,.10,-.15,.22,.20,.15,WOOD,0);           // chassis
    bx(-.16,.20,-.145,.16,.36,-.095,WOOD,0);        // frame sides
    bx(-.16,.20,.095,.16,.36,.145,WOOD,0);
    bx(-.03,.14,-.028,.03,.62,.028,WOOD,6);         // arm
    bx(-.08,.60,-.075,.08,.68,.075,DARK,6);         // bowl
    seal(12);piv.push([.12,.24]);
    // ---- 13 SCORPION — crossbow bed, bolt dips on release
    mark();
    bx(-.06,0,-.17,.10,.20,-.11,DARK,2);
    bx(-.06,0,.11,.10,.20,.17,DARK,3);
    bx(-.26,.12,-.10,.26,.21,.10,WOOD,0);           // bed
    bx(.14,.21,-.23,.23,.27,-.02,WOOD,0);           // bow arms, flared
    bx(.14,.21,.02,.23,.27,.23,WOOD,0);
    bx(-.12,.215,-.016,.32,.245,.016,DARK,6);       // bolt
    seal(13);piv.push([.12,.23]);
    // ---- 14 BOMBARD — barrel kicks at the trunnion on fire
    mark();
    bx(-.22,0,-.17,-.06,.20,-.11,DARK,2);
    bx(-.22,0,.11,-.06,.20,.17,DARK,3);
    bx(.04,0,-.17,.20,.20,-.11,DARK,3);
    bx(.04,0,.11,.20,.20,.17,DARK,2);
    bx(-.20,.12,-.12,.20,.24,.12,WOOD,0);           // carriage
    bx(-.14,.26,-.058,.34,.35,.058,IRON,6);         // barrel
    bx(.34,.245,-.065,.385,.365,.065,DARK,6);       // muzzle ring
    seal(14);piv.push([.12,.30]);
    // ---- 15 FISHING BOAT — open hull, fisher with a rod
    mark();
    bx(-.28,-.03,-.12,.28,.13,.12,WOOD,0,0,-.30);   // hull — keel narrow, gunwale wide
    bx(-.22,.11,-.08,.22,.14,.08,DARK,0);           // open interior
    bx(.26,.10,-.03,.32,.24,.03,WOOD,0);            // bow post
    bx(-.32,.10,-.03,-.26,.22,.03,WOOD,0);
    oct(0,.13,0,.055,.048,.32,CLOTH,0,1,-.12);      // fisher — team shirt, shouldered
    oct(0,.32,0,.038,.036,.42,SKIN,1,.3,.18);       // head
    bx(.0,.22,.03,.34,.245,.05,WOOD,6);             // rod
    seal(15);piv.push([.10,.24]);
    // ---- 16 ROUND SHIP (cog / transport / demo) — tubby trader
    mark();
    bx(-.34,-.04,-.17,.34,.17,.17,WOOD,0,0,-.26);   // fat hull with a real keel line
    bx(-.32,.035,-.174,.32,.052,.174,DARK,0);       // plank seams
    bx(-.33,.10,-.174,.33,.117,.174,DARK,0);
    bx(-.36,.17,-.19,.36,.25,.19,WOOD,0);           // bulwark
    bx(-.36,.208,-.194,.36,.222,.194,DECK,0);       // rubbing strake
    bx(-.30,.235,-.14,.30,.255,.14,DECK,0);         // deck
    bx(.10,.25,-.09,.24,.37,.05,WOOD,0);            // cargo
    bx(.10,.30,-.094,.24,.318,.054,DARK,0);         // crate strap
    bx(-.22,.25,-.02,-.10,.34,.10,DARK,0);
    bx(-.03,.25,-.03,.03,.80,.03,WOOD,1);           // mast
    bx(-.02,.44,-.17,.02,.74,.17,CANV,0,1);         // team sail, static
    bx(-.026,.53,-.175,.026,.556,.175,BLACK,0,.72); // sail battens
    bx(-.026,.64,-.175,.026,.666,.175,BLACK,0,.72);
    seal(16);piv.push([.12,.30]);
    // ---- 17 WARSHIP (galley line) — ram prow, shield row, oars that row
    const warshipBody=()=>{
    bx(-.44,-.03,-.13,.40,.15,.13,WOOD,0,0,-.30);   // long hull, flared gunwales
    bx(-.42,.045,-.134,.38,.062,.134,DARK,0);       // plank seams
    bx(-.43,.10,-.134,.39,.117,.134,DARK,0);
    bx(.40,.0,-.05,.53,.09,.05,IRON,0);             // ram
    bx(-.42,.15,-.10,-.27,.31,.10,WOOD,0);          // stern castle
    bx(-.42,.30,-.104,-.27,.315,.104,DECK,0);       // castle rail
    bx(-.26,.15,-.155,.24,.235,-.125,CLOTH,0,1);    // shield rows — team
    bx(-.26,.15,.125,.24,.235,.155,CLOTH,0,1);
    for(let i=0;i<4;i++){                            // shield bosses down each row
      bx(-.21+i*.13,.175,-.158,-.17+i*.13,.215,-.152,GOLDC,0);
      bx(-.21+i*.13,.175,.152,-.17+i*.13,.215,.158,GOLDC,0);
    }
    bx(-.03,.15,-.03,.03,.88,.03,WOOD,1);           // mast
    bx(-.02,.42,-.24,.02,.82,.24,CANV,0,1);         // big team sail
    bx(-.026,.51,-.245,.026,.538,.245,BLACK,0,.72); // sail battens
    bx(-.026,.66,-.245,.026,.688,.245,BLACK,0,.72);
    bx(-.20,.07,-.31,.16,.10,-.14,WOOD,4);          // port oar bank — rows
    bx(-.20,.07,.14,.16,.10,.31,WOOD,5);            // starboard bank
    };
    mark();warshipBody();seal(17);piv.push([.12,.24]);
    // ---- 18 TURTLE SHIP — iron carapace, spiked ridge, dragon prow
    const turtleBody=()=>{
    bx(-.36,-.02,-.15,.36,.13,.15,WOOD,0,0,-.24);
    bx(-.34,.13,-.14,.34,.25,.14,IRON,0,0,.18);     // carapace, domed by taper
    bx(-.28,.25,-.11,.28,.33,.11,IRON,0);
    bx(-.16,.33,-.022,-.10,.40,.022,DARK,0);        // spine spikes
    bx(-.02,.33,-.022,.04,.40,.022,DARK,0);
    bx(.12,.33,-.022,.18,.40,.022,DARK,0);
    bx(.36,.10,-.05,.49,.23,.05,hex('#b8923a'),1);  // dragon head
    };
    mark();turtleBody();seal(18);piv.push([.12,.26]);
    // ---- 19 SHEEP — wool box on stub legs
    mark();
    bx(-.12,0,-.08,-.07,.13,-.03,DARK,2);
    bx(-.12,0,.03,-.07,.13,.08,DARK,3);
    bx(.05,0,-.08,.10,.13,-.03,DARK,3);
    bx(.05,0,.03,.10,.13,.08,DARK,2);
    latheX(.205,0,[[-.15,.074,.072],[-.07,.098,.096],[.04,.099,.097],[.13,.078,.076]],WOOL,0); // fleece — plump and round
    bx(.11,.17,-.045,.21,.27,.045,DARK,1);          // face
    bx(.205,.225,-.028,.213,.245,-.012,WOOL,1);     // eyes — pale on the dark face
    bx(.205,.225,.012,.213,.245,.028,WOOL,1);
    seal(19);piv.push([.12,.22]);
    // ---- 20 DEER — slim, long-legged, antlered
    mark();
    oct(-.11,0,-.045,.021,.021,.25,TAN,2,0,-.15);   // slim octagonal legs
    oct(-.11,0,.045,.021,.021,.25,TAN,3,0,-.15);
    oct(.09,0,-.045,.021,.021,.25,TAN,3,0,-.15);
    oct(.09,0,.045,.021,.021,.25,TAN,2,0,-.15);
    latheX(.31,0,[[-.17,.066,.055],[-.09,.092,.076],[.04,.093,.077],[.14,.070,.058]],TAN,0); // body — rounded chest and haunch
    bx(-.20,.32,-.02,-.16,.42,.02,WOOL,0);          // tail flash
    oct(.145,.36,0,.042,.038,.56,TAN,1,0,.25);      // neck, tapering up
    octX(.15,.58,0,.04,.036,.29,TAN,1,0,.25);       // head
    bx(.235,.575,-.039,.253,.593,-.033,EYE,1);      // eyes
    bx(.235,.575,.033,.253,.593,.039,EYE,1);
    bx(.265,.555,-.02,.285,.578,.02,DARK,1);        // nose
    bx(.16,.62,-.052,.185,.78,-.032,TUSK,1);        // antlers
    bx(.16,.62,.032,.185,.78,.052,TUSK,1);
    bx(.13,.72,-.06,.21,.745,.06,TUSK,1);           // crossbar prongs
    seal(20);piv.push([.22,.36]);
    // ---- 21 BOAR — low, wide, tusked
    mark();
    bx(-.15,0,-.085,-.09,.11,-.035,DARK,2);
    bx(-.15,0,.035,-.09,.11,.085,DARK,3);
    bx(.07,0,-.085,.13,.11,-.035,DARK,3);
    bx(.07,0,.035,.13,.11,.085,DARK,2);
    latheX(.185,0,[[-.19,.072,.072],[-.10,.098,.098],[.06,.099,.099],[.17,.080,.080]],BOARC,0); // body — barrel-round
    bx(-.15,.27,-.025,.11,.315,.025,DARK,0);        // bristle ridge
    latheX(.18,0,[[.15,.080,.068],[.23,.078,.066],[.31,.062,.053]],BOARC,1); // head, narrowing to the snout
    bx(.255,.21,-.062,.272,.228,-.052,EYE,1);       // small mean eyes
    bx(.255,.21,.052,.272,.228,.062,EYE,1);
    octX(.30,.157,0,.03,.032,.362,DARK,1,0,.3);     // snout
    bx(.352,.148,-.024,.36,.168,.024,BOARC,1);      // snout disc
    bx(.29,.175,-.065,.35,.20,-.048,TUSK,1);        // tusks
    bx(.29,.175,.048,.35,.20,.065,TUSK,1);
    seal(21);piv.push([.12,.22]);
    /* ---- 22+ THE ROSTER PASS — per-unit reads from Daniel's unit-roster CSV.
       Each brief names "the read": the one silhouette/prop that identifies the
       unit at play zoom. Types that shared a generic body now get their own. */
    // ---- 22 VILLAGER-PICK / 23 VILLAGER-HAMMER — tool swaps by job (chosen
    // per frame in drawUnits from u.state/resKey; the sim knows nothing of it)
    mark();
    man(false,2,false);
    bx(-.012,.32,.118,.012,.62,.142,WOOD,6);        // haft
    bx(-.01,.585,.085,.01,.625,.195,STEEL,6);       // pick cross-head
    seal(22);piv.push([.27,.47]);
    mark();
    man(false,2,false);
    bx(-.012,.34,.118,.012,.57,.142,WOOD,6);
    bx(-.03,.535,.098,.03,.59,.162,IRON,6);         // mallet head
    seal(23);piv.push([.27,.47]);
    // ---- 24 SKIRMISHER — javelin held high, buckler, spares on the back
    mark();
    man(false,0,false);
    lathe(0,-.157,[[.335,.026,.007],[.36,.040,.011],[.385,.026,.007]],STEEL,4); // buckler lens
    bx(-.078,.30,-.016,-.062,.60,.002,WOOD,0);      // javelin bundle
    bx(-.076,.32,.006,-.06,.58,.024,WOOD,0);
    bx(-.011,.30,.119,.011,.82,.141,WOOD,6);        // javelin
    bx(-.015,.80,.115,.015,.87,.145,STEEL,6);       // point
    seal(24);piv.push([.27,.47]);
    // ---- 25 SCOUT — bare fast horse, team blanket, raised sabre, no armor
    mark();
    horse({bare:true});
    lathe(.01,0,[[.752,.046,.049],[.786,.042,.045],[.81,.018,.02]],HAIR,1);
    bx(-.005,.58,.115,.015,.80,.139,STEEL,6);       // sabre
    bx(-.02,.553,.11,.02,.583,.144,LEATH,6);        // grip
    seal(25);piv.push([.26,.55]);
    // ---- 26 MAMELUKE ON CAMEL — the hump is the read; robed rider, thrown blade
    const camelBody=()=>{
    const cleg=(xc,zc,part)=>{
      lathe(xc,zc,[[.15,.024,.024],[.26,.029,.029],[.37,.033,.033]],TAN,part,0,8);
      lathe(xc,zc,[[.05,.019,.019],[.11,.023,.023],[.16,.022,.022]],TAN,part,0,8);
      latheX(.026,zc,[[xc-.024,.022,.022],[xc+.03,.016,.02]],BOOT,part);
    };
    cleg(.16,-.06,2);cleg(.16,.06,3);cleg(-.16,-.06,3);cleg(-.16,.06,2);
    latheX(.41,0,[[-.24,.068,.060],[-.12,.094,.082],[.04,.096,.084],
      [.15,.088,.078],[.23,.064,.056]],TAN,0,0,12);  // body
    lathe(.05,0,[[.46,.058,.052],[.51,.072,.064],[.575,.046,.042],[.61,.016,.016]],TAN,0); // the hump
    bx(-.17,.42,-.086,-.03,.452,.086,CLOTH,0,1);    // team saddle cloth behind the hump
    lathe(.235,0,[[.43,.046,.040],[.56,.040,.035],[.70,.034,.030]],TAN,1);  // tall neck
    latheX(.665,0,[[.235,.034,.030],[.30,.036,.032],[.37,.026,.024]],TAN,1);// head, carried high
    latheX(.65,0,[[.355,.022,.020],[.415,.015,.015]],DARK,1);               // muzzle
    bx(.27,.675,-.037,.29,.692,-.031,EYE,1);
    bx(.27,.675,.031,.29,.692,.037,EYE,1);
    bx(.24,.70,-.03,.265,.74,-.016,TAN,1);          // ears
    bx(.24,.70,.016,.265,.74,.03,TAN,1);
    oct(-.255,.30,0,.016,.016,.42,TAN,0,0,.3);      // tail
    bx(-.16,.35,-.115,-.05,.46,-.088,CANV,0);       // rider legs in robe
    bx(-.16,.35,.088,-.05,.46,.115,CANV,0);
    lathe(-.10,0,[[.45,.052,.064],[.49,.048,.058],[.55,.050,.062],
      [.60,.054,.068],[.635,.044,.056]],CANV,0);    // flowing robe torso
    oct(-.10,.50,0,.054,.066,.535,CLOTH,0,1);       // team sash
    oct(-.10,.635,0,.022,.026,.66,SKIN,1);
    lathe(-.10,0,[[.655,.024,.026],[.67,.035,.038],[.695,.041,.044],
      [.725,.042,.045],[.75,.036,.039],[.768,.012,.013]],SKIN,1); // head
    lathe(-.10,0,[[.735,.045,.048],[.762,.041,.044],[.782,.018,.02]],CANV,1); // turban
    bx(-.058,.695,-.026,-.048,.715,-.008,EYE,1);
    bx(-.058,.695,.008,-.048,.715,.026,EYE,1);
    bx(-.11,.55,.105,-.09,.72,.13,STEEL,6);         // thrown scimitar — offset
    bx(-.095,.70,.108,-.075,.78,.127,STEEL,6);      // blades suggest the curve
    };
    mark();camelBody();seal(26);piv.push([.28,.60]);
    // ---- 27 WOAD RAIDER — bare chest, blue warpaint, wild hair, long axe
    mark();
    man(false,0,false,{tc:SKIN,tm:0,bare:true});
    bx(.048,.35,-.04,.056,.44,-.02,WOADB,0);        // warpaint chest stripes
    bx(.048,.35,.02,.056,.44,.04,WOADB,0);
    bx(.045,.545,-.03,.054,.56,.03,WOADB,1);        // face stripe
    lathe(0,-.006,[[.58,.058,.062],[.62,.056,.06],[.66,.042,.046],[.685,.012,.012]],HAIR,1); // wild hair
    bx(-.012,.30,.118,.012,.74,.142,WOOD,6);        // long axe haft
    bx(-.04,.66,.108,.04,.73,.152,STEEL,6);         // broad head
    seal(27);piv.push([.27,.47]);
    // ---- 28 EAGLE WARRIOR — beaked cap, team feather crest, obsidian club
    mark();
    man(false,1,false,{tc:SKIN,tm:0,bare:true});
    oct(0,.30,0,.058,.079,.334,CLOTH,0,1);          // team waist wrap
    lathe(0,0,[[.585,.052,.056],[.62,.048,.052],[.652,.030,.033]],GOLDC,1); // beaked cap
    bx(.048,.578,-.02,.075,.60,.02,GOLDC,1);        // the beak
    bx(-.05,.645,-.014,.03,.75,.014,WHITE,1,.85);   // rising team crest
    bx(-.07,.635,-.01,-.045,.71,.01,WHITE,1,.7);
    bx(-.012,.32,.118,.012,.60,.142,WOOD,6);        // club
    bx(-.026,.52,.108,.026,.60,.152,DARK,6);        // obsidian edge
    seal(28);piv.push([.27,.47]);
    // ---- 29 JAGUAR WARRIOR — spotted pelt suit and fanged hood
    mark();
    man(false,1,false,{tc:TAN,tm:.15});
    lathe(0,0,[[.585,.054,.058],[.625,.051,.055],[.66,.036,.04],[.678,.01,.01]],TAN,1); // pelt hood
    bx(.046,.60,-.03,.056,.617,-.018,DARK,1);       // hood spots
    bx(-.02,.645,-.045,.0,.663,-.03,DARK,1);
    bx(-.02,.645,.03,.0,.663,.045,DARK,1);
    bx(.048,.578,-.016,.062,.594,.016,TUSK,1);      // fang motif at the brow
    bx(.049,.40,-.036,.058,.418,-.02,DARK,0);       // suit spots
    bx(.047,.36,.018,.056,.378,.034,DARK,0);
    bx(-.059,.38,-.01,-.049,.398,.006,DARK,0);
    bx(-.012,.32,.118,.012,.60,.142,WOOD,6);        // club
    bx(-.026,.52,.108,.026,.60,.152,DARK,6);
    seal(29);piv.push([.27,.47]);
    // ---- 30 TEUTONIC KNIGHT — bucket helm, long pale surcoat, greatsword
    mark();
    man(true,1,false,{tc:CANV,tm:.12});
    oct(0,.16,0,.062,.084,.24,CANV,0,.12);          // surcoat falls past the knees
    lathe(0,0,[[.575,.056,.06],[.64,.056,.06],[.668,.05,.054],[.678,.012,.012]],STEEL,1); // flat-topped bucket helm
    bx(.052,.60,-.028,.06,.612,.028,DARK,1);        // eye slit
    bx(-.014,.44,.114,.014,.78,.146,STEEL,6);       // greatsword
    bx(-.006,.44,.12,.006,.76,.14,WHITE,6,0);
    bx(-.04,.415,.103,.04,.445,.157,WOOD,6);
    seal(30);piv.push([.27,.47]);
    // ---- 31 BERSERK — furs, fur collar, round shield, war axe
    mark();
    man(true,0,true,{tc:HIDE,tm:.2});
    oct(0,.468,0,.056,.075,.505,BOARC,0);           // fur collar
    bx(-.012,.32,.118,.012,.66,.142,WOOD,6);        // war axe
    bx(-.036,.585,.108,.036,.65,.152,STEEL,6);
    seal(31);piv.push([.27,.47]);
    // ---- 32 SAMURAI — lamellar lacing, crested helm, curved blade
    mark();
    man(false,1,false);
    bx(-.058,.365,-.073,.058,.378,.073,BLACK,0,.72); // lamellar bands
    bx(-.056,.405,-.071,.056,.418,.071,BLACK,0,.72);
    bx(-.06,.44,-.076,.06,.453,.076,BLACK,0,.72);
    lathe(0,0,[[.585,.058,.062],[.63,.054,.058],[.663,.036,.04],[.678,.01,.01]],IRON,1); // helm
    bx(-.068,.588,-.05,-.052,.64,.05,IRON,1);       // flared neck guard
    bx(.05,.655,-.008,.075,.695,.008,GOLDC,1);      // crest horns
    bx(.05,.655,-.03,.062,.685,-.014,GOLDC,1);
    bx(.05,.655,.014,.062,.685,.03,GOLDC,1);
    bx(-.012,.44,.116,.012,.70,.14,STEEL,6);        // blade, hinted curve
    bx(-.008,.68,.122,.01,.75,.134,STEEL,6);
    bx(-.03,.415,.106,.03,.44,.154,GOLDC,6);        // tsuba
    seal(32);piv.push([.27,.47]);
    // ---- 33 HUSKARL — the OVERSIZED round shield sells the arrow resistance
    mark();
    man(false,1,true,{tc:HIDE,tm:.25});
    lathe(0,-.16,[[.28,.05,.012],[.36,.088,.02],[.45,.05,.012]],CLOTH,4,1); // great shield, team face
    lathe(0,-.174,[[.345,.02,.006],[.365,.032,.01],[.385,.02,.006]],GOLDC,4); // boss
    lathe(0,0,[[.585,.056,.06],[.628,.052,.056],[.66,.034,.037],[.674,.01,.01]],IRON,1); // helm
    bx(-.012,.32,.118,.012,.64,.142,WOOD,6);        // long axe
    bx(-.034,.575,.108,.034,.635,.152,STEEL,6);
    seal(33);piv.push([.27,.47]);
    // ---- 34 THROWING AXEMAN — bearded axe raised to hurl, spare at the belt
    mark();
    man(false,1,false);
    lathe(0,0,[[.585,.055,.059],[.622,.052,.056],[.655,.036,.039],[.668,.01,.01]],STEEL,1); // mail coif
    bx(-.045,.30,-.09,-.02,.345,-.065,STEEL,0);     // spare axe at the hip
    bx(-.05,.335,-.095,-.015,.357,-.06,DARK,0);
    bx(-.011,.34,.119,.011,.72,.141,WOOD,6);        // raised axe
    bx(-.032,.64,.11,.032,.71,.15,STEEL,6);         // bearded head
    seal(34);piv.push([.27,.47]);
    // ---- 35 CHU KO NU — repeating crossbow; the box magazine is the read
    mark();
    man(false,0,false);
    bx(.02,.435,.108,.30,.468,.152,WOOD,6);         // stock, held level
    bx(.08,.468,.104,.22,.522,.156,WOOD,6);         // top magazine box
    bx(.085,.522,.11,.215,.532,.15,DARK,6);         // lid seam
    bx(.06,.44,.075,.09,.462,.185,WOOD,6);          // prod arms
    seal(35);piv.push([.27,.47]);
    // ---- 36 LONGBOWMAN — team hood, man-height bow
    mark();
    man(false,1,false);
    lathe(0,0,[[.582,.056,.06],[.625,.052,.056],[.66,.036,.04],[.675,.01,.01]],CLOTH,1,1); // hood
    bx(-.105,.34,-.03,-.062,.55,.03,WOOD,0);        // quiver
    bx(-.10,.55,-.026,-.066,.60,.026,CANV,0);
    bx(.115,.26,.122,.135,.42,.142,WOOD,6);         // bow as tall as the man
    bx(.125,.42,.122,.145,.56,.142,WOOD,6);
    bx(.115,.56,.122,.135,.74,.142,WOOD,6);
    bx(.108,.27,.128,.114,.73,.136,CANV,6);         // string
    seal(36);piv.push([.27,.47]);
    // ---- 37 TARKAN — steppe rider, burning torch (fire vs buildings)
    mark();
    horse({bare:true});
    lathe(.01,0,[[.752,.047,.05],[.786,.043,.046],[.81,.02,.022]],HAIR,1); // fur cap
    bx(-.005,.56,.115,.015,.76,.139,WOOD,6);        // torch haft
    lathe(.005,.127,[[.755,.02,.02],[.78,.032,.032],[.82,.024,.024],[.85,.008,.008]],FLAME,6); // flame
    seal(37);piv.push([.26,.55]);
    // ---- 38 CONQUISTADOR — arquebus fired from horseback, crested morion
    mark();
    horse();
    lathe(.01,0,[[.752,.047,.051],[.79,.043,.047],[.815,.024,.026],[.826,.008,.008]],STEEL,1); // morion
    bx(-.02,.818,-.006,.05,.84,.006,STEEL,1);       // comb crest
    bx(-.06,.60,.112,.02,.64,.148,WOOD,6);          // stock
    bx(.02,.615,.116,.30,.655,.144,IRON,6);         // long barrel
    bx(.28,.607,.111,.305,.663,.149,DARK,6);        // muzzle band
    seal(38);piv.push([.26,.55]);
    // ---- 39 JANISSARY — tall white börk headdress, longest barrel
    mark();
    man(false,1,false);
    lathe(0,0,[[.585,.054,.058],[.62,.05,.054],[.652,.036,.039]],CANV,1);   // cap base
    lathe(0,-.01,[[.652,.042,.046],[.72,.040,.044],[.78,.030,.033],[.795,.01,.01]],CANV,1); // tall crown
    bx(-.05,.42,.112,.02,.475,.148,WOOD,6);         // stock
    bx(.02,.44,.118,.36,.492,.142,IRON,6);          // longer than the hand cannon
    bx(.34,.432,.113,.365,.50,.147,DARK,6);
    seal(39);piv.push([.27,.47]);
    // ---- 40 PLUMED ARCHER — team plumage on head and arms, quick shortbow
    mark();
    man(false,1,false,{tc:CANV,tm:.2});
    lathe(0,0,[[.585,.052,.056],[.617,.048,.052],[.647,.030,.033]],TAN,1);  // cap
    bx(-.04,.645,-.012,.02,.75,.012,WHITE,1,.85);   // tall team plume
    bx(-.06,.635,-.008,-.038,.71,.008,WHITE,1,.7);
    bx(-.05,.44,-.155,-.02,.52,-.125,WHITE,4,.8);   // arm plumes
    bx(-.05,.44,.125,-.02,.52,.155,WHITE,6,.8);
    bx(.115,.30,.122,.135,.44,.142,WOOD,6);         // shortbow
    bx(.125,.44,.122,.145,.55,.142,WOOD,6);
    bx(.115,.55,.122,.135,.69,.142,WOOD,6);
    bx(.108,.31,.128,.114,.68,.136,CANV,6);
    seal(40);piv.push([.27,.47]);
    // ---- 41 PETARD — powder keg hugged to the chest, sparking fuse
    mark();
    man(false,0,false);
    latheX(.36,0,[[.05,.052,.052],[.10,.058,.058],[.16,.052,.052]],WOOD,0); // the keg
    bx(.05,.328,-.06,.16,.344,.06,IRON,0);          // barrel hoops
    bx(.05,.392,-.06,.16,.408,.06,IRON,0);
    bx(.15,.40,-.008,.17,.455,.008,DARK,0);         // fuse
    bx(.152,.45,-.013,.178,.478,.013,FLAME,0);      // spark
    seal(41);piv.push([.27,.47]);
    /* ---- 42+ AGE VARIANTS — each line unit visibly upgrades with its
       owner's age (roster CSV tiers). Selected per frame via AGEV. */
    if(idx32){
    // ---- 42 MILITIA (Dark) — ragged, bare-headed, short sword, bare minimum
    mark();
    man(true,0,false);
    bx(-.012,.44,.118,.012,.62,.142,STEEL,6);       // short sword
    bx(-.03,.415,.108,.03,.44,.152,WOOD,6);
    seal(42);piv.push([.27,.47]);
    // ---- 43 MAN-AT-ARMS (Feudal) — simple helm, mail collar, arming sword
    mark();
    man(true,1,true);
    lathe(0,0,[[.585,.058,.062],[.625,.054,.058],[.657,.036,.04],[.67,.01,.01]],IRON,1);
    oct(0,.462,0,.05,.068,.492,STEEL,0);            // mail collar
    bx(-.012,.44,.116,.012,.68,.14,STEEL,6);
    bx(-.032,.415,.106,.032,.442,.154,WOOD,6);
    seal(43);piv.push([.27,.47]);
    // ---- 44 CHAMPION (Imperial) — polished cuirass, gold trim, plume, greatsword
    mark();
    man(true,1,true);
    oct(0,.34,0,.056,.074,.46,STEEL,0,0,-.12);      // polished cuirass
    oct(0,.332,0,.058,.077,.358,GOLDC,0);           // gold waist trim
    lathe(0,0,[[.585,.061,.065],[.628,.058,.062],[.663,.040,.044],[.684,.010,.011]],STEEL,1);
    bx(-.016,.66,-.016,.016,.75,.016,WHITE,1,.85);  // tall team plume
    bx(.058,.585,-.012,.066,.645,.012,STEEL,1);     // nasal
    bx(-.078,.462,-.115,.02,.502,-.078,STEEL,4);    // pauldrons
    bx(-.078,.462,.078,.02,.502,.115,STEEL,6);
    bx(-.014,.44,.114,.014,.80,.146,STEEL,6);       // ornate greatsword
    bx(-.006,.44,.12,.006,.78,.14,WHITE,6,0);
    bx(-.04,.41,.102,.04,.445,.158,GOLDC,6);        // gold guard
    seal(44);piv.push([.27,.47]);
    // ---- 45 SPEARMAN (Feudal) — cheap levied look, no kettle hat yet
    mark();
    man(true,0,false);
    bx(-.012,.30,.118,.012,.98,.142,WOOD,6);
    bx(-.014,.60,.116,.014,.64,.144,LEATH,6);
    bx(-.02,.96,.112,.02,1.06,.148,STEEL,6);
    seal(45);piv.push([.27,.47]);
    // ---- 46 HALBERDIER (Imperial) — half-plate; the axe-blade head is the read
    mark();
    man(true,1,false);
    oct(0,.34,0,.056,.074,.46,STEEL,0,0,-.12);      // half-plate
    lathe(0,0,[[.585,.058,.062],[.625,.054,.058],[.657,.036,.04],[.67,.01,.01]],STEEL,1);
    bx(-.012,.30,.118,.012,1.0,.142,WOOD,6);        // halberd shaft
    bx(-.03,.82,.108,.03,.92,.152,STEEL,6);         // axe blade
    bx(-.016,1.0,.114,.016,1.09,.146,STEEL,6);      // top spike
    seal(46);piv.push([.27,.47]);
    // ---- 47 CROSSBOWMAN (Castle) — the horizontal weapon separates from Archer
    mark();
    man(false,0,false);
    bx(-.105,.34,-.03,-.062,.52,.03,WOOD,0);        // bolt quiver
    bx(.02,.435,.11,.30,.468,.15,WOOD,6);           // stock, held level
    bx(.06,.44,.07,.09,.465,.19,WOOD,6);            // prod
    bx(.29,.44,.122,.315,.462,.138,IRON,6);         // stirrup
    seal(47);piv.push([.27,.47]);
    // ---- 48 ARBALEST (Imperial) — brigandine, steel prod, winch
    mark();
    man(false,1,false,{tc:LEATH,tm:.25});
    lathe(0,0,[[.585,.056,.06],[.625,.052,.056],[.657,.035,.038],[.67,.01,.01]],IRON,1);
    bx(-.105,.34,-.03,-.062,.52,.03,WOOD,0);
    bx(.02,.43,.108,.32,.47,.152,WOOD,6);           // heavier stock
    bx(.06,.44,.06,.095,.472,.20,STEEL,6);          // steel prod
    bx(.10,.47,.115,.16,.51,.145,IRON,6);           // winch block
    seal(48);piv.push([.27,.47]);
    // ---- 49 ELITE SKIRMISHER (Castle+) — adds open helm and shoulder guard
    mark();
    man(false,1,false);
    lathe(0,0,[[.585,.055,.059],[.62,.051,.055],[.652,.034,.037]],IRON,1);
    lathe(0,-.157,[[.335,.026,.007],[.36,.040,.011],[.385,.026,.007]],STEEL,4);
    bx(-.078,.462,-.115,.02,.502,-.078,STEEL,4);    // shoulder guard
    bx(-.078,.30,-.016,-.062,.60,.002,WOOD,0);
    bx(-.076,.32,.006,-.06,.58,.024,WOOD,0);
    bx(-.011,.30,.119,.011,.82,.141,WOOD,6);
    bx(-.015,.80,.115,.015,.87,.145,STEEL,6);
    seal(49);piv.push([.27,.47]);
    // ---- 50 LIGHT CAVALRY (Castle) — leather cuirass, still speed-first
    mark();
    horse({bare:true});
    oct(.01,.52,0,.052,.066,.63,LEATH,0);           // leather cuirass
    lathe(.01,0,[[.752,.046,.049],[.784,.042,.045],[.806,.016,.018]],IRON,1);
    bx(-.005,.58,.115,.015,.80,.139,STEEL,6);       // sabre
    bx(-.02,.553,.11,.02,.583,.144,LEATH,6);
    seal(50);piv.push([.26,.55]);
    // ---- 51 HUSSAR (Imperial) — tall plume and team back-banner, flashiest
    mark();
    horse({bare:true});
    lathe(.01,0,[[.752,.047,.051],[.788,.043,.047],[.81,.02,.022]],STEEL,1);
    bx(-.006,.80,-.008,.01,.90,.008,WHITE,1,.85);   // tall plume
    bx(-.10,.52,-.008,-.085,.78,.008,WOOD,0);       // banner pole
    bx(-.13,.66,-.004,-.10,.78,.004,CLOTH,0,1);     // team back-banner
    bx(-.005,.58,.115,.015,.82,.139,STEEL,6);       // sabre raised
    bx(-.02,.553,.11,.02,.583,.144,LEATH,6);
    seal(51);piv.push([.26,.55]);
    // ---- 52 PALADIN (Imperial) — full plate, great helm, chamfron, pennoned lance
    mark();
    horse();
    oct(.01,.50,0,.056,.071,.63,STEEL,0);           // plate cuirass
    lathe(.01,0,[[.75,.048,.052],[.795,.044,.048],[.822,.026,.028],[.832,.008,.008]],STEEL,1); // great helm
    bx(.05,.755,-.024,.058,.79,.024,DARK,1);        // visor slit
    bx(.30,.60,-.042,.40,.66,.042,STEEL,1);         // chamfron — horse head plate
    bx(-.06,.57,.105,.50,.595,.13,WOOD,6);          // lance
    bx(.50,.562,.10,.585,.60,.135,STEEL,6);
    bx(.06,.55,.095,.14,.615,.14,CLOTH,6,1);        // team pennon
    seal(52);piv.push([.26,.55]);
    // ---- 53 SIEGE RAM (Imperial) — nearly full metal shell, great iron head
    mark();
    bx(-.30,0,-.20,-.16,.22,-.14,DARK,2);
    bx(-.30,0,.14,-.16,.22,.20,DARK,3);
    bx(.14,0,-.20,.28,.22,-.14,DARK,3);
    bx(.14,0,.14,.28,.22,.20,DARK,2);
    bx(-.32,.22,-.20,.32,.44,-.13,IRON,0);          // iron-plated flanks
    bx(-.32,.22,.13,.32,.44,.20,IRON,0);
    bx(-.35,.44,-.16,.35,.52,.16,IRON,0);           // iron roof
    bx(-.30,.46,-.17,-.24,.53,.17,DARK,0);          // plate ribs
    bx(-.06,.46,-.17,0,.53,.17,DARK,0);
    bx(.20,.46,-.17,.26,.53,.17,DARK,0);
    bx(-.38,.26,-.045,.44,.345,.045,DARK,6);        // the log
    bx(.44,.25,-.055,.52,.36,.055,IRON,6);          // great iron head
    seal(53);piv.push([.12,.30]);
    // ---- 54 GALLEON (Imperial) — raised fore and aft castles, grandest sail
    mark();
    bx(-.44,-.03,-.13,.40,.15,.13,WOOD,0,0,-.30);
    bx(-.42,.045,-.134,.38,.062,.134,DARK,0);
    bx(-.43,.10,-.134,.39,.117,.134,DARK,0);
    bx(.40,.0,-.05,.53,.09,.05,IRON,0);             // ram
    bx(-.42,.15,-.11,-.24,.36,.11,WOOD,0);          // tall stern castle
    bx(-.42,.35,-.114,-.24,.368,.114,DECK,0);
    bx(.24,.15,-.10,.40,.30,.10,WOOD,0);            // forecastle
    bx(.24,.29,-.104,.40,.308,.104,DECK,0);
    bx(-.26,.15,-.155,.22,.235,-.125,CLOTH,0,1);    // shield rows
    bx(-.26,.15,.125,.22,.235,.155,CLOTH,0,1);
    for(let i=0;i<4;i++){
      bx(-.21+i*.13,.175,-.158,-.17+i*.13,.215,-.152,GOLDC,0);
      bx(-.21+i*.13,.175,.152,-.17+i*.13,.215,.158,GOLDC,0);
    }
    bx(-.03,.15,-.03,.03,.92,.03,WOOD,1);           // taller mast
    bx(-.02,.44,-.25,.02,.86,.25,CANV,0,1);         // grander team sail
    bx(-.026,.54,-.255,.026,.568,.255,BLACK,0,.72);
    bx(-.026,.70,-.255,.026,.728,.255,BLACK,0,.72);
    bx(-.20,.07,-.31,.16,.10,-.14,WOOD,4);          // oar banks
    bx(-.20,.07,.14,.16,.10,.31,WOOD,5);
    seal(54);piv.push([.12,.24]);
    /* ---- 55+ ELITE UNIQUE UNITS — Imperial upgrades per the roster CSV's
       elite briefs. Selected through the same AGEV table (elites go Imperial
       in the sim, so age 3 IS elite). */
    // ---- 55 ELITE LONGBOWMAN — light mail, brighter hood trim
    mark();
    man(false,1,false);
    oct(0,.455,0,.052,.070,.492,STEEL,0);           // mail collar
    lathe(0,0,[[.582,.056,.06],[.625,.052,.056],[.66,.036,.04],[.675,.01,.01]],CLOTH,1,1);
    oct(0,.578,0,.058,.062,.596,WHITE,1,.85);       // bright hood trim ring
    bx(-.105,.34,-.03,-.062,.55,.03,WOOD,0);
    bx(-.10,.55,-.026,-.066,.60,.026,CANV,0);
    bx(.115,.26,.122,.135,.42,.142,WOOD,6);
    bx(.125,.42,.122,.145,.56,.142,WOOD,6);
    bx(.115,.56,.122,.135,.74,.142,WOOD,6);
    bx(.108,.27,.128,.114,.73,.136,CANV,6);
    seal(55);piv.push([.27,.47]);
    // ---- 56 ELITE THROWING AXEMAN — shoulder plate and helm crest
    mark();
    man(false,1,false);
    lathe(0,0,[[.585,.055,.059],[.622,.052,.056],[.655,.036,.039],[.668,.01,.01]],STEEL,1);
    bx(-.016,.66,-.016,.016,.73,.016,WHITE,1,.85);  // team helm crest
    bx(-.078,.462,-.115,.02,.502,-.078,STEEL,4);    // shoulder plate
    bx(-.045,.30,-.09,-.02,.345,-.065,STEEL,0);
    bx(-.05,.335,-.095,-.015,.357,-.06,DARK,0);
    bx(-.011,.34,.119,.011,.72,.141,WOOD,6);
    bx(-.038,.63,.108,.038,.71,.152,STEEL,6);       // heavier axe head
    seal(56);piv.push([.27,.47]);
    // ---- 57 ELITE BERSERK — bear-pelt shoulders, great axe
    mark();
    man(true,0,true,{tc:BOARC,tm:.15});             // darker heavier furs
    oct(0,.468,0,.058,.078,.508,BOARC,0);           // fur collar
    oct(0,.448,-.133,.042,.044,.495,BOARC,4);       // bear-pelt shoulders
    oct(0,.448,.133,.042,.044,.495,BOARC,6);
    bx(-.012,.30,.118,.012,.70,.142,WOOD,6);        // great axe
    bx(-.044,.60,.104,.044,.685,.156,STEEL,6);
    seal(57);piv.push([.27,.47]);
    // ---- 58 ELITE MANGUDAI — light lamellar over the rider
    mark();
    horse();
    lathe(.01,0,[[.752,.047,.050],[.786,.043,.046],[.812,.020,.022]],HAIR,1);
    oct(.01,.55,0,.056,.070,.60,BLACK,0,.72);       // lamellar band
    oct(.01,.61,0,.055,.068,.655,BLACK,0,.72);
    bx(.10,.50,.115,.13,.62,.135,WOOD,6);
    bx(.115,.62,.115,.14,.72,.135,WOOD,6);
    bx(.10,.72,.115,.125,.82,.135,WOOD,6);
    bx(.105,.51,.121,.111,.81,.129,CANV,6);
    seal(58);piv.push([.26,.55]);
    // ---- 59 ELITE TEUTONIC KNIGHT — extra plate mass, greatsword
    mark();
    man(true,1,false,{tc:CANV,tm:.12});
    oct(0,.16,0,.062,.084,.24,CANV,0,.12);
    oct(0,.34,0,.057,.075,.46,STEEL,0,0,-.12);      // added breastplate
    lathe(0,0,[[.575,.057,.061],[.642,.057,.061],[.67,.051,.055],[.68,.012,.012]],STEEL,1);
    bx(.052,.60,-.028,.06,.612,.028,DARK,1);
    bx(-.078,.462,-.115,.02,.502,-.078,STEEL,4);    // pauldrons
    bx(-.078,.462,.078,.02,.502,.115,STEEL,6);
    bx(-.016,.44,.112,.016,.82,.148,STEEL,6);       // bigger greatsword
    bx(-.007,.44,.12,.007,.80,.14,WHITE,6,0);
    bx(-.044,.412,.10,.044,.448,.16,WOOD,6);
    seal(59);piv.push([.27,.47]);
    // ---- 60 ELITE WOAD RAIDER — more paint, trophy ornaments, larger axe
    mark();
    man(false,0,false,{tc:SKIN,tm:0,bare:true});
    bx(.048,.35,-.04,.056,.44,-.02,WOADB,0);
    bx(.048,.35,.02,.056,.44,.04,WOADB,0);
    bx(-.058,.36,-.03,-.05,.45,.03,WOADB,0);        // back paint too
    bx(.045,.545,-.03,.054,.56,.03,WOADB,1);
    bx(.044,.518,-.022,.052,.532,.022,WOADB,1);     // second face stripe
    oct(0,.30,0,.057,.078,.324,GOLDC,0);            // trophy torc at the waist
    lathe(0,-.006,[[.58,.06,.064],[.622,.058,.062],[.664,.044,.048],[.69,.012,.012]],HAIR,1);
    bx(-.012,.30,.118,.012,.78,.142,WOOD,6);
    bx(-.048,.68,.104,.048,.765,.156,STEEL,6);      // larger axe
    seal(60);piv.push([.27,.47]);
    // ---- 61 ELITE CATAPHRACT — gilded scale over horse and rider
    mark();
    horse();
    oct(.01,.50,0,.056,.071,.63,GOLDC,0);           // gilded scale cuirass
    lathe(.01,0,[[.75,.048,.052],[.795,.044,.048],[.822,.026,.028],[.832,.008,.008]],GOLDC,1); // gilded helm
    bx(.30,.60,-.042,.40,.66,.042,GOLDC,1);         // gilded chamfron
    bx(-.06,.57,.105,.44,.595,.13,STEEL,6);         // mace-shafted lance
    bx(.44,.555,.095,.50,.61,.14,GOLDC,6);          // gold head
    seal(61);piv.push([.26,.55]);
    // ---- 62 ELITE MAMELUKE — richer robes, gold tack on the camel
    mark();
    camelBody();
    bx(-.17,.415,-.09,-.03,.435,.09,GOLDC,0);       // gold saddle trim
    oct(-.10,.535,0,.055,.067,.56,GOLDC,0);         // gold sash trim
    oct(-.10,.755,0,.043,.046,.775,GOLDC,1);        // gold turban band
    seal(62);piv.push([.28,.60]);
    // ---- 63 ELITE HUSKARL — iron-rimmed shield, darker heavier furs
    mark();
    man(false,1,true,{tc:BOARC,tm:.18});
    lathe(0,-.16,[[.275,.054,.013],[.36,.092,.021],[.455,.054,.013]],CLOTH,4,1);
    lathe(0,-.168,[[.27,.056,.010],[.36,.096,.016],[.46,.056,.010]],IRON,4);   // iron rim ring behind
    lathe(0,-.176,[[.345,.02,.006],[.365,.032,.01],[.385,.02,.006]],GOLDC,4);
    lathe(0,0,[[.585,.056,.06],[.628,.052,.056],[.66,.034,.037],[.674,.01,.01]],IRON,1);
    bx(-.012,.32,.118,.012,.64,.142,WOOD,6);
    bx(-.038,.57,.106,.038,.64,.154,STEEL,6);
    seal(63);piv.push([.27,.47]);
    // ---- 64 ELITE CHU KO NU — lamellar coat, larger repeater
    mark();
    man(false,0,false);
    bx(-.058,.365,-.073,.058,.378,.073,BLACK,0,.72); // lamellar bands
    bx(-.056,.405,-.071,.056,.418,.071,BLACK,0,.72);
    bx(.02,.43,.106,.32,.47,.154,WOOD,6);           // bigger stock
    bx(.07,.47,.10,.24,.532,.16,WOOD,6);            // bigger magazine
    bx(.075,.532,.108,.235,.542,.152,DARK,6);
    bx(.06,.44,.065,.095,.468,.195,WOOD,6);
    seal(64);piv.push([.27,.47]);
    // ---- 65 ELITE WAR ELEPHANT — metal face plate and tusk caps
    mark();
    elephantBody();
    bx(.34,.50,-.085,.45,.63,.085,STEEL,1);         // face plate
    bx(.52,.315,-.098,.575,.36,-.055,GOLDC,1);      // tusk caps
    bx(.52,.315,.055,.575,.36,.098,GOLDC,1);
    bx(-.15,.60,-.128,.11,.625,.128,GOLDC,0);       // gilded howdah base band
    seal(65);piv.push([.30,.60]);
    // ---- 66 ELITE JANISSARY — gold-trimmed uniform, ornate musket
    mark();
    man(false,1,false);
    oct(0,.33,0,.058,.079,.352,GOLDC,0);            // gold waist trim
    lathe(0,0,[[.585,.054,.058],[.62,.05,.054],[.652,.036,.039]],CANV,1);
    lathe(0,-.01,[[.652,.042,.046],[.72,.040,.044],[.78,.030,.033],[.795,.01,.01]],CANV,1);
    oct(0,.655,-.01,.043,.047,.675,GOLDC,1);        // gold headdress band
    bx(-.05,.42,.112,.02,.475,.148,WOOD,6);
    bx(.02,.44,.118,.38,.492,.142,IRON,6);          // even longer ornate barrel
    bx(.10,.492,.122,.16,.502,.138,GOLDC,6);        // gold barrel band
    bx(.36,.432,.113,.385,.50,.147,DARK,6);
    seal(66);piv.push([.27,.47]);
    // ---- 67 ELITE SAMURAI — personal back-banner in team colour
    mark();
    man(false,1,false);
    bx(-.058,.365,-.073,.058,.378,.073,BLACK,0,.72);
    bx(-.056,.405,-.071,.056,.418,.071,BLACK,0,.72);
    bx(-.06,.44,-.076,.06,.453,.076,BLACK,0,.72);
    lathe(0,0,[[.585,.058,.062],[.63,.054,.058],[.663,.036,.04],[.678,.01,.01]],IRON,1);
    bx(-.068,.588,-.05,-.052,.64,.05,IRON,1);
    bx(.05,.655,-.008,.075,.695,.008,GOLDC,1);
    bx(.05,.655,-.03,.062,.685,-.014,GOLDC,1);
    bx(.05,.655,.014,.062,.685,.03,GOLDC,1);
    bx(-.075,.30,-.008,-.06,.82,.008,WOOD,0);       // sashimono pole
    bx(-.115,.62,-.004,-.075,.80,.004,CLOTH,0,1);   // team back-banner
    bx(-.012,.44,.116,.012,.70,.14,STEEL,6);
    bx(-.008,.68,.122,.01,.75,.134,STEEL,6);
    bx(-.03,.415,.106,.03,.44,.154,GOLDC,6);
    seal(67);piv.push([.27,.47]);
    // ---- 68 ELITE JAGUAR WARRIOR — fuller pelt coverage, hide shield
    mark();
    man(false,1,false,{tc:TAN,tm:.1});
    lathe(0,0,[[.585,.054,.058],[.625,.051,.055],[.66,.036,.04],[.678,.01,.01]],TAN,1);
    bx(.046,.60,-.03,.056,.617,-.018,DARK,1);
    bx(-.02,.645,-.045,.0,.663,-.03,DARK,1);
    bx(-.02,.645,.03,.0,.663,.045,DARK,1);
    bx(.048,.578,-.016,.062,.594,.016,TUSK,1);
    oct(0,.44,-.133,.036,.038,.478,TAN,4);          // pelt arm covers
    oct(0,.44,.133,.036,.038,.478,TAN,6);
    bx(.048,.40,-.036,.058,.418,-.02,DARK,0);
    bx(.046,.36,.018,.056,.378,.034,DARK,0);
    bx(-.059,.38,-.01,-.049,.398,.006,DARK,0);
    bx(-.059,.42,-.034,-.049,.438,-.018,DARK,0);    // more spots
    lathe(0,-.157,[[.335,.028,.008],[.36,.044,.012],[.385,.028,.008]],HIDE,4); // hide shield
    bx(-.012,.32,.118,.012,.62,.142,WOOD,6);
    bx(-.03,.52,.106,.03,.62,.154,DARK,6);          // larger club
    seal(68);piv.push([.27,.47]);
    // ---- 69 ELITE EAGLE WARRIOR — larger crest, brighter plumage
    mark();
    man(false,1,false,{tc:SKIN,tm:0,bare:true});
    oct(0,.30,0,.058,.079,.334,CLOTH,0,1);
    lathe(0,0,[[.585,.052,.056],[.62,.048,.052],[.652,.030,.033]],GOLDC,1);
    bx(.048,.578,-.02,.075,.60,.02,GOLDC,1);
    bx(-.05,.645,-.016,.034,.79,.016,WHITE,1,.85);  // taller crest
    bx(-.075,.635,-.012,-.045,.75,.012,WHITE,1,.7);
    bx(-.095,.62,-.008,-.07,.70,.008,WHITE,1,.85);
    bx(-.05,.44,-.155,-.02,.52,-.125,WHITE,4,.8);   // arm plumes
    bx(-.05,.44,.125,-.02,.52,.155,WHITE,6,.8);
    bx(-.012,.32,.118,.012,.60,.142,WOOD,6);
    bx(-.026,.52,.108,.026,.60,.152,DARK,6);
    seal(69);piv.push([.27,.47]);
    // ---- 70 ELITE PLUMED ARCHER — fuller plumage, jade accents
    mark();
    man(false,1,false,{tc:CANV,tm:.2});
    lathe(0,0,[[.585,.052,.056],[.617,.048,.052],[.647,.030,.033]],TAN,1);
    bx(-.04,.645,-.012,.02,.78,.012,WHITE,1,.85);
    bx(-.06,.635,-.008,-.038,.74,.008,WHITE,1,.7);
    bx(-.078,.625,-.006,-.058,.70,.006,WHITE,1,.85);
    bx(-.05,.44,-.155,-.02,.54,-.125,WHITE,4,.8);
    bx(-.05,.44,.125,-.02,.54,.155,WHITE,6,.8);
    oct(0,.30,0,.057,.078,.322,hex('#3f8e6d'),0);   // jade waist band
    bx(.115,.30,.122,.135,.44,.142,WOOD,6);
    bx(.125,.44,.122,.145,.55,.142,WOOD,6);
    bx(.115,.55,.122,.135,.69,.142,WOOD,6);
    bx(.108,.31,.128,.114,.68,.136,CANV,6);
    seal(70);piv.push([.27,.47]);
    // ---- 71 ELITE WAR WAGON — iron panels over the wood, heavier wheels
    mark();
    wagonBody();
    bx(-.33,.36,-.158,.25,.56,-.147,IRON,0);        // iron side plates
    bx(-.33,.36,.147,.25,.56,.158,IRON,0);
    bx(-.36,.58,-.175,.28,.60,.175,IRON,0);         // iron roof edge
    bx(-.31,0,-.20,-.11,.05,-.12,IRON,2);           // heavier wheel rims
    bx(-.31,0,.12,-.11,.05,.20,IRON,3);
    seal(71);piv.push([.14,.40]);
    // ---- 72 ELITE CONQUISTADOR — polished cuirass, helmet plume
    mark();
    horse();
    oct(.01,.50,0,.056,.071,.625,STEEL,0);          // polished cuirass
    lathe(.01,0,[[.752,.047,.051],[.79,.043,.047],[.815,.024,.026],[.826,.008,.008]],STEEL,1);
    bx(-.02,.818,-.006,.05,.84,.006,STEEL,1);
    bx(-.01,.83,-.008,.006,.90,.008,WHITE,1,.85);   // team plume
    bx(-.06,.60,.112,.02,.64,.148,WOOD,6);
    bx(.02,.615,.116,.33,.655,.144,IRON,6);         // longer arquebus
    bx(.31,.607,.111,.335,.663,.149,DARK,6);
    seal(72);piv.push([.26,.55]);
    // ---- 73 ELITE TARKAN — lamellar coat, bigger flame
    mark();
    horse({bare:true});
    lathe(.01,0,[[.752,.047,.05],[.786,.043,.046],[.81,.02,.022]],HAIR,1);
    oct(.01,.55,0,.056,.070,.60,BLACK,0,.72);       // lamellar bands
    oct(.01,.61,0,.055,.068,.655,BLACK,0,.72);
    bx(-.005,.56,.115,.015,.76,.139,WOOD,6);
    lathe(.005,.127,[[.75,.024,.024],[.78,.040,.040],[.83,.030,.030],[.87,.010,.010]],FLAME,6); // bigger flame
    seal(73);piv.push([.26,.55]);
    // ---- 74 ELITE LONGBOAT — carved prow ornament, more shields
    mark();
    warshipBody();
    lathe(.44,0,[[.09,.028,.028],[.16,.036,.036],[.23,.022,.022],[.27,.008,.008]],GOLDC,0); // carved prow spiral
    for(let i=0;i<3;i++){
      bx(-.24+i*.17,.24,-.155,-.17+i*.17,.30,-.148,CLOTH,0,1); // upper shield row
      bx(-.24+i*.17,.24,.148,-.17+i*.17,.30,.155,CLOTH,0,1);
    }
    seal(74);piv.push([.12,.24]);
    // ---- 75 ELITE TURTLE SHIP — more spikes, darker heavier iron
    mark();
    turtleBody();
    bx(-.24,.33,-.022,-.18,.41,.022,DARK,0);        // extra spine spikes
    bx(.06,.33,-.022,.12,.41,.022,DARK,0);
    bx(.20,.33,-.022,.26,.40,.022,DARK,0);
    bx(-.30,.25,-.13,.30,.28,-.10,DARK,0);          // dark iron plate seams
    bx(-.30,.25,.10,.30,.28,.13,DARK,0);
    seal(75);piv.push([.12,.26]);
    // ---- 76 TRADE CART — two-wheel goods cart behind a plodding ox
    mark();
    bx(-.24,0,-.17,-.04,.22,-.13,DARK,2);           // wheels (rock as it rolls)
    bx(-.24,0,.13,-.04,.22,.17,DARK,3);
    bx(-.30,.20,-.14,.12,.28,.14,WOOD,0);           // bed
    bx(-.30,.28,-.145,.12,.34,-.125,WOOD,0);        // side rails
    bx(-.30,.28,.125,.12,.34,.145,WOOD,0);
    lathe(-.20,-.05,[[.28,.048,.048],[.38,.062,.062],[.46,.028,.028]],CANV,0); // grain sacks
    lathe(-.10,.06,[[.28,.045,.045],[.37,.058,.058],[.44,.026,.026]],STRAW,0);
    bx(-.04,.28,-.07,.08,.38,.03,WOOD,0);           // gold chest
    bx(-.045,.315,-.075,.085,.345,.035,GOLDC,0);    // gold band
    bx(-.32,.34,-.12,-.14,.56,.12,CLOTH,0,1);       // team canopy over the rear
    bx(-.33,.55,-.13,-.13,.585,.13,CLOTH,0,1);
    oct(.13,0,-.05,.02,.02,.24,TAN,3,0,-.15);       // ox legs
    oct(.13,0,.05,.02,.02,.24,TAN,2,0,-.15);
    oct(.37,0,-.05,.02,.02,.24,TAN,2,0,-.15);
    oct(.37,0,.05,.02,.02,.24,TAN,3,0,-.15);
    latheX(.30,0,[[.12,.068,.060],[.24,.092,.082],[.38,.070,.062]],HIDE,0); // ox barrel
    oct(.42,.24,0,.045,.04,.42,HIDE,1,0,.25);       // neck, head carried low
    latheX(.38,0,[[.40,.038,.035],[.50,.026,.025]],HIDE,1);
    bx(.42,.42,-.075,.47,.45,-.02,TUSK,1);          // horns
    bx(.42,.42,.02,.47,.45,.075,TUSK,1);
    bx(.10,.26,-.01,.16,.30,.01,WOOD,0);            // yoke pole
    seal(76);piv.push([.11,.30]);
    // ---- 77 KING — Regicide only: rich team robe, gold crown, scepter
    mark();
    lathe(0,0,[[.02,.078,.092],[.20,.070,.082],[.38,.061,.073],[.50,.052,.062]],CLOTH,0,1); // robe to the ground
    oct(0,.295,0,.062,.076,.325,GOLDC,0);           // gold belt band
    bx(.055,.33,-.02,.066,.50,.02,WHITE,0,.85);     // ermine front stripe
    oct(0,.475,0,.026,.03,.515,SKIN,1);             // neck
    lathe(0,0,[[.505,.030,.033],[.52,.043,.047],[.553,.051,.055],[.588,.053,.057],
      [.623,.047,.051],[.65,.030,.033],[.66,.008,.008]],SKIN,1); // head
    bx(.043,.562,-.032,.054,.584,-.012,EYE,1);
    bx(.043,.562,.012,.054,.584,.032,EYE,1);
    bx(.047,.535,-.011,.063,.572,.011,SKIN,1);      // nose
    bx(.04,.502,-.028,.056,.556,.028,WOOL,1);       // white beard
    lathe(0,0,[[.636,.050,.054],[.664,.048,.052]],GOLDC,1); // crown band
    bx(-.05,.664,-.008,-.034,.706,.008,GOLDC,1);    // crown points
    bx(.034,.664,-.008,.05,.706,.008,GOLDC,1);
    bx(-.008,.664,-.05,.008,.706,-.034,GOLDC,1);
    bx(-.008,.664,.034,.008,.706,.05,GOLDC,1);
    bx(-.008,.664,-.008,.008,.72,.008,GOLDC,1);     // tall centre point
    lathe(0,-.133,[[.36,.028,.030],[.42,.033,.035],[.475,.028,.030]],CLOTH,4,1); // sleeved arms
    lathe(0,-.133,[[.29,.020,.022],[.335,.026,.028],[.372,.023,.025]],SKIN,4);
    lathe(0,.133,[[.36,.028,.030],[.42,.033,.035],[.475,.028,.030]],CLOTH,6,1);
    lathe(0,.133,[[.29,.020,.022],[.335,.026,.028],[.372,.023,.025]],SKIN,6);
    bx(-.008,.30,.122,.008,.56,.138,GOLDC,6);       // scepter
    lathe(0,.13,[[.555,.015,.015],[.578,.022,.022],[.598,.013,.013]],GOLDC,6); // orb
    seal(77);piv.push([.27,.47]);
    /* ---- 78+ SHIP TIERS — the roster's naval reads, split at last from the
       two generic hulls. Fire/demo/cannon/transport get their own bodies and
       the galley line gains its Castle tier. */
    // ---- 78/79 FIRE SHIP / FAST FIRE SHIP — flame projector, scorched prow
    const fireBody=(k)=>{
      bx(-.30,-.03,-.13,.28,.15,.13,WOOD,0,0,-.28);  // squat aggressive hull
      bx(-.28,.05,-.134,.26,.067,.134,DARK,0);
      bx(-.26,.15,-.15,.24,.22,-.12,WOOD,0);         // low bulwarks
      bx(-.26,.15,.12,.24,.22,.15,WOOD,0);
      bx(.18,.03,-.06,.36,.15,.06,DARK,0,0,.3);      // scorched prow
      bx(-.10,.15,-.03,-.04,.60,.03,WOOD,1);         // stub mast
      bx(-.09,.30,-.11,-.05,.54,.11,CANV,0,1);       // small team sail
      bx(-.02,.20,-.055,.08,.30,.055,IRON,0);        // brazier
      lathe(.03,0,[[.30,.030,.030],[.37,.042,.042],[.44,.020,.020]],FLAME,0); // brazier fire
      latheX(.24,0,[[.24,.026,.026],[.44,.032,.032]],IRON,0);  // projector nozzle
      latheX(.24,0,[[.44,.036*k,.036*k],[.58,.058*k,.058*k],[.72+.06*(k-1),.024*k,.024*k]],FLAME,0); // the flame cone
    };
    mark();fireBody(1);seal(78);piv.push([.12,.24]);
    mark();fireBody(1.35);
    bx(-.33,.02,-.02,-.29,.10,.02,IRON,0);           // streamlined stern post
    seal(79);piv.push([.12,.24]);
    // ---- 80/81 DEMOLITION SHIP / HEAVY — the visible barrels ARE the read
    const demoBody=(heavy)=>{
      bx(-.24,-.03,-.11,.22,.11,.11,WOOD,0,0,-.26);  // low minimal hull
      bx(-.22,.035,-.114,.20,.05,.114,DARK,0);
      bx(-.25,.11,-.12,.23,.16,.12,WOOD,0);          // rail
      const bar=(x,z)=>{
        lathe(x,z,[[.14,.048,.048],[.30,.048,.048]],WOOD,0,0,8);
        bx(x-.052,.165,z-.052,x+.052,.182,z+.052,heavy?IRON:DARK,0); // hoops
        bx(x-.052,.245,z-.052,x+.052,.262,z+.052,heavy?IRON:DARK,0);
      };
      bar(-.10,-.055);bar(-.10,.055);bar(.03,0);
      if(heavy){bar(.14,-.05);bar(.14,.05);}
      lathe(-.035,0,[[.30,.048,.048],[.44,.048,.048]],WOOD,0,0,8); // top barrel
      bx(-.05,.44,-.008,-.02,.50,.008,DARK,0);       // fuse
      bx(-.055,.495,-.013,-.015,.522,.013,FLAME,0);  // spark
    };
    mark();demoBody(false);seal(80);piv.push([.10,.22]);
    mark();demoBody(true);seal(81);piv.push([.10,.22]);
    // ---- 82 WAR GALLEY (Castle tier) — a second shield row along the rail
    mark();
    warshipBody();
    for(let i=0;i<3;i++){
      bx(-.22+i*.16,.235,-.152,-.14+i*.16,.30,-.145,CLOTH,0,1);
      bx(-.22+i*.16,.235,.145,-.14+i*.16,.30,.152,CLOTH,0,1);
    }
    seal(82);piv.push([.12,.24]);
    // ---- 83/84 CANNON GALLEON / ELITE — forward cannon over the bow
    const cannonBody=(k)=>{
      warshipBody();
      bx(.08,.235,-.055,.20,.31,.055,WOOD,0);        // gun carriage
      latheX(.275,0,[[.12,.036*k,.036*k],[.42+.04*(k-1),.028*k,.028*k]],IRON,0);
      bx(.40,.245,-.04,.44,.31,.04,DARK,0);          // muzzle band
    };
    mark();cannonBody(1);seal(83);piv.push([.12,.24]);
    mark();cannonBody(1.3);
    bx(.10,.31,-.05,.18,.335,.05,GOLDC,0);           // gilded breech band
    seal(84);piv.push([.12,.24]);
    // ---- 85 TRANSPORT — wide flat barge with a bow loading ramp
    mark();
    bx(-.34,-.04,-.18,.34,.16,.18,WOOD,0,0,-.22);
    bx(-.32,.03,-.184,.32,.05,.184,DARK,0);
    bx(-.36,.16,-.20,.36,.225,.20,WOOD,0);           // bulwark ring
    bx(-.30,.16,-.155,.30,.175,.155,DECK,0);         // open cargo deck
    bx(.30,.09,-.08,.50,.15,.08,DECK,0);             // the ramp
    bx(-.06,.16,-.02,-.02,.64,.02,WOOD,1);           // modest mast, aft
    bx(-.05,.30,-.14,-.03,.56,.14,CANV,0,1);         // team sail
    seal(85);piv.push([.12,.26]);
    }else{
      // no 32-bit indices: age and elite variants alias their base geometry
      const alias=b=>{off.push(off[b]);cnt.push(cnt[b]);piv.push(piv[b]);};
      [0,0,0, 1,1, 2,2, 24, 25,25, 6, 10, 17,
       36,34,31,7,30,27,6,26,33,35,8,39,32,29,28,40,9,38,37,17,18,
       9,5, 17,17,16,16,17,17,17,16].forEach(alias);   // cart→wagon, king→monk, ships→generic hulls
    }
    const gl=this.gl;
    this.uvbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.uvbo);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(V),gl.STATIC_DRAW);
    this.uibo=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.uibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,idx32?new Uint32Array(I):new Uint16Array(I),gl.STATIC_DRAW);
    this.uOff=off;this.uCnt=cnt;this.uPiv=piv;
  },
  initUnits(){
    const gl=this.gl;
    this.iext=this.iext||gl.getExtension('ANGLE_instanced_arrays');
    if(!this.iext){this.noUnits=true;return false;}
    const vs=`
      attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol;
      attribute vec2 aPT;        // part index, team flag (mix factor)
      attribute vec4 aI0;        // x, baseY, z, yaw
      attribute vec4 aI1;        // phase, scale, attack, swing amplitude
      attribute vec3 aI2;        // team colour
      attribute float aI3;       // death topple angle — 8th and LAST attribute
                                 // slot WebGL1 guarantees; the budget is full
      uniform mat4 uMVP; uniform vec3 uLight; uniform vec2 uPiv;
      varying vec3 vC;
      vec3 rotX(vec3 p,float a){ return vec3(p.x, p.y*cos(a)-p.z*sin(a), p.y*sin(a)+p.z*cos(a)); }
      vec3 rotZ(vec3 p,float a){ return vec3(p.x*cos(a)-p.y*sin(a), p.x*sin(a)+p.y*cos(a), p.z); }
      void main(){
        vec3 p=aPos; vec3 n=aNrm;
        // aI1.w is the swing amplitude — 1 while walking, ~0.12 when idle so
        // standing units breathe rather than freeze
        float part=aPT.x, s=sin(aI1.x)*aI1.w, atk=aI1.z;
        // limbs swing about the hip; arms about the shoulder, counter-phase
        if(part==2.0||part==3.0){
          float d=(part==2.0)?s:-s;
          vec3 o=vec3(0.0,uPiv.x,0.0);
          p=rotZ(p-o,d*0.55)+o; n=rotZ(n,d*0.55);
        }else if(part==4.0||part==5.0||part==6.0){
          float d=(part==4.0)?s:-s;
          if(part==6.0)d=-s;
          vec3 o=vec3(0.0,uPiv.y,0.0);
          float a=d*0.32-atk*0.9;
          p=rotZ(p-o,a)+o; n=rotZ(n,a);
        }
        p*=aI1.y; p.y+=0.0;
        // death topple: the whole body keels over sideways about its facing
        // axis, pivoting at the feet (origin = ground). Zero for the living.
        if(aI3!=0.0){ p=rotX(p,aI3); n=rotX(n,aI3); }
        float c=cos(aI0.w),si=sin(aI0.w);
        vec3 w=vec3(p.x*c-p.z*si, p.y, p.x*si+p.z*c);
        vec3 wn=vec3(n.x*c-n.z*si, n.y, n.x*si+n.z*c);
        gl_Position=uMVP*vec4(w.x+aI0.x, w.y+aI0.y, w.z+aI0.z, 1.0);
        /* aPT.y is a MIX toward team colour, not a boolean. 0 = vertex colour,
           1 = pure team — the old flag values behave identically — and the
           fractions in between are what let cloth have detail: a fold quad
           with aCol black and mix .72 renders at 72% team brightness, one
           with aCol white and mix .85 is a team highlight. Without this every
           team surface was one flat panel, because the shader threw the vertex
           colour away wholesale. */
        vec3 base=mix(aCol,aI2,clamp(aPT.y,0.0,1.0));
        float lam=max(0.0,dot(normalize(wn),uLight));
        vC=base*(0.60+0.52*lam);
      }`;
    const fs=`precision mediump float; varying vec3 vC;
      void main(){ gl_FragColor=vec4(vC,1.0); }`;
    const mk=(t,s)=>{const sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);
      if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(sh));return null;}return sh;};
    const v=mk(gl.VERTEX_SHADER,vs),f=mk(gl.FRAGMENT_SHADER,fs);
    if(!v||!f){this.noUnits=true;return false;}
    const p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);
    ['aPos','aNrm','aCol','aPT','aI0','aI1','aI2','aI3'].forEach((n,i)=>gl.bindAttribLocation(p,i,n));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){console.error(gl.getProgramInfoLog(p));this.noUnits=true;return false;}
    this.uProg=p;
    this.uLoc={uMVP:gl.getUniformLocation(p,'uMVP'),uLight:gl.getUniformLocation(p,'uLight'),
      uPiv:gl.getUniformLocation(p,'uPiv')};
    this.buildUnitMeshes();
    this.uIvbo=Array.from({length:this.ARCHN},()=>gl.createBuffer());
    this.uArr=Array.from({length:this.ARCHN},()=>[]);
    return true;
  },
  /* ---- sculpted unit models (exported from the Blender forge) ---------------
     Same 11-float vertex layout the boxed archetypes already use (pos, nrm,
     col, part, teamMix) so they feed the SAME shader and the SAME instancing
     path -- only the geometry changes, and every feature built on top of it
     (team colour, age variants, shadows, topple, garrison) keeps working.
     Loaded async. Until it lands, or if it never does (the artifact's CSP
     blocks the fetch), every archetype simply keeps its boxed mesh. */
  M3:null, m3Raw:null, m3Tried:false,
  loadModels(){
    if(this.m3Tried)return;this.m3Tried=true;
    const bases=['models','app/models'];
    const go=i=>{
      if(i>=bases.length){dlChip(null);return;}
      fetch(bases[i]+'.json').then(r=>r.ok?r.json():Promise.reject(0))
        .then(meta=>fetch(bases[i]+'.bin').then(r=>{
          // stream the 6.6MB body so the download chip can show real progress
          const total=+r.headers.get('content-length')||0;
          if(!r.body||!total)return r.arrayBuffer();
          const rd=r.body.getReader(),chunks=[];let got=0;
          const pump=()=>rd.read().then(({done,value})=>{
            if(done){const out=new Uint8Array(got);let o=0;
              for(const ch of chunks){out.set(ch,o);o+=ch.length;}
              return out.buffer;}
            chunks.push(value);got+=value.length;
            dlChip('Downloading 3D models… '+Math.round(100*got/total)+'%');
            return pump();});
          return pump();
        }).then(buf=>{this.m3Raw={meta,buf};dlChip(null);}))
        .catch(()=>go(i+1));
    };
    go(0);
  },
  m3Build(){
    const gl=this.gl,R=this.m3Raw;this.m3Raw=null;
    if(!R)return;
    const verts=new Float32Array(R.buf,0,R.meta.vBytes/4);
    const idx=new Uint32Array(R.buf,R.meta.vBytes);
    this.m3vbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.m3vbo);
    gl.bufferData(gl.ARRAY_BUFFER,verts,gl.STATIC_DRAW);
    this.m3ibo=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.m3ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,idx,gl.STATIC_DRAW);
    /* Map archetype index -> model through UARCH AND every AGEV variant: miss
       the variants and a unit reverts to a boxed mesh the moment its owner
       ages up, which looks like a bug rather than a tier. */
    const arch={};
    for(const k in R.meta.units){
      const m=R.meta.units[k];
      const a=this.UARCH[k];if(a!==undefined)arch[a]=m;
      const av=this.AGEV[k];if(av)for(const x of av)arch[x]=m;
      if(k==='villager'){arch[22]=m;arch[23]=m;}   // pick / hammer variants
    }
    this.M3={arch};
  },
  drawUnits(mvp){
    if(this.noUnits)return;
    if(!this.uProg&&!this.initUnits())return;
    const gl=this.gl,ex=this.iext;
    const A=this.uArr;for(let i=0;i<this.ARCHN;i++)A[i].length=0;
    const t=G.t||0;
    for(const u of G.units){
      if(!allied(u.p,localP)&&!tileVis(u.x,u.y))continue;
      let a=this.unitArch(u.type);
      /* Villager tools swap by job (roster CSV: "tool is the read") — pure
         render-side choice off u.state/resKey, the sim never sees it. */
      if(u.type==='villager'){
        if(u.state==='toBuild'||u.state==='building')a=23;         // hammer
        else{const r=u.resKey?G.res[u.resKey]:null;
          if((r&&r.type==='gold')||u.carryType==='gold')a=22;}     // pick
      }
      /* Line units upgrade their LOOK with the owner's age (roster tiers) */
      else{const av=this.AGEV[u.type];
        if(av)a=av[(G.P[u.p]&&G.P[u.p].age)||0];}
      const tc=teamColor(u.p)||'#3b7bd4';
      const r=parseInt(tc.slice(1,3),16)/255,g2=parseInt(tc.slice(3,5),16)/255,b2=parseInt(tc.slice(5,7),16)/255;
      // walk phase advances with speed; idle units breathe slowly instead
      const moving=(u.spd||0)>0.05;
      const ph=moving?(t*7.5+u.id*1.7):(t*0.9+u.id*1.7);
      const amp=moving?1:0.12;
      /* u.state, NOT u.st — the sim has no field called st, so this term was
         permanently zero and no unit ever swung a weapon in 3D. ATKF scales
         the 51° chop down to a recoil kick for guns and off for ships/monks. */
      const atk=(u.state==='attack')?Math.max(0,Math.sin(t*7.0+u.id))*this.ATKF[a]:0;
      /* groundH, not elevF: elevF is the SIM's smooth-walking height, groundH
         is the DRAWN mesh. They disagree on slope edges by design, and a unit
         must stand on the ground the renderer actually drew. */
      A[a].push(u.x, this.groundH(u.x,u.y), u.y, (u.hdg||0),
                ph, 1.05, atk, amp, r, g2, b2, 0);   // +5% unit scale; 0 topple
    }
    /* Garrison rendering — a ram's crew pushes at its flanks and garrisoned
       soldiers man the castle deck and tower top, drawn as instances of their
       own archetypes. Pure render: the sim's garrison arrays are untouched,
       and the passengers ride the carrier's heading and walk phase. */
    for(const u of G.units){
      if(!u.gar||!u.gar.length||u.type!=='ram')continue;
      if(!allied(u.p,localP)&&!tileVis(u.x,u.y))continue;
      const moving=(u.spd||0)>0.05;
      const ph=moving?(t*7.5+u.id*1.7):(t*0.9+u.id*1.7);
      const cs=Math.cos(u.hdg||0),sn=Math.sin(u.hdg||0);
      const g=this.groundH(u.x,u.y);
      const OFF=[[-.50,-.14],[-.50,.14],[-.02,-.27],[-.02,.27]];
      for(let i=0;i<Math.min(4,u.gar.length);i++){
        const p2=u.gar[i];
        const av=this.AGEV[p2.type];
        const a2=av?av[(G.P[p2.p]&&G.P[p2.p].age)||0]:this.unitArch(p2.type);
        const [ox,oz]=OFF[i];
        const tc=teamColor(p2.p)||'#3b7bd4';
        const r=parseInt(tc.slice(1,3),16)/255,g2=parseInt(tc.slice(3,5),16)/255,b2=parseInt(tc.slice(5,7),16)/255;
        A[a2].push(u.x+ox*cs-oz*sn, g, u.y+ox*sn+oz*cs, (u.hdg||0),
                   ph+i*.9, 0.95, 0, moving?1:0.12, r,g2,b2, 0);
      }
    }
    for(const b of G.blds){
      if(!b.gar||!b.gar.length||!b.built)continue;
      if(b.type!=='castle'&&b.type!=='tower')continue;
      if(!allied(b.p,localP)&&!b.seen)continue;
      const s=b.size,inset=s*.10,hw=(s/2-inset)*this.BVS;
      const cxm=b.tx+s/2,czm=b.ty+s/2;
      const g=this.groundH(cxm,czm);
      const H=(IHT[b.type]||18)*this.HS*this.BVS;
      const top=g+H*(b.type==='castle'?.82:.74);   // the deck the parapet rings
      // mid-edge posts — the castle's corner turrets swallow anything at a corner
      const k=hw-.14;
      const OFF=[[0,-k],[k,0],[0,k],[-k,0]];
      for(let i=0;i<Math.min(4,b.gar.length);i++){
        const p2=b.gar[i];
        const av=this.AGEV[p2.type];
        const a2=av?av[(G.P[p2.p]&&G.P[p2.p].age)||0]:this.unitArch(p2.type);
        const [ox,oz]=OFF[i];
        const tc=teamColor(p2.p)||'#3b7bd4';
        const r=parseInt(tc.slice(1,3),16)/255,g2=parseInt(tc.slice(3,5),16)/255,b2=parseInt(tc.slice(5,7),16)/255;
        A[a2].push(cxm+ox, top, czm+oz, (i%2?-.8:.8)+i,
                   t*0.9+i*1.7, 0.9, 0, 0.12, r,g2,b2, 0);
      }
    }
    /* Fresh corpses play the death topple through this same pipeline: the
       unit's real mesh keels 90° sideways in SIX HARD POSES (the 2D corpse
       does exactly this — period sprite sheets ran ~12fps, don't smooth it),
       then buildFx's low lump takes over at 0.6s. Older saves lack hdg/fall;
       defaults keep them from throwing. */
    const tql=0.6;
    for(const c of (G.corpses||[])){
      const age=c.max-c.t;
      if(age>=tql)continue;
      if(!tileVis(c.x,c.y))continue;
      let a=this.unitArch(c.type);
      const cav=this.AGEV[c.type];
      if(cav)a=cav[(G.P[c.p]&&G.P[c.p].age)||0];   // corpses topple in age dress
      const sm=age/tql,e2=sm*sm*(3-2*sm);          // smoothstep…
      const ease=Math.floor(e2*6)/6;               // …then stepped, deliberately
      const tc=teamColor(c.p)||'#3b7bd4';
      const r=parseInt(tc.slice(1,3),16)/255,g2=parseInt(tc.slice(3,5),16)/255,b2=parseInt(tc.slice(5,7),16)/255;
      A[a].push(c.x, this.groundH(c.x,c.y)-0.02*ease, c.y, (c.hdg||0),
                0, 1.05, 0, 0, r, g2, b2, (c.fall||1)*1.5*ease);
    }
    gl.useProgram(this.uProg);
    gl.uniformMatrix4fv(this.uLoc.uMVP,false,mvp);
    gl.uniform3f(this.uLoc.uLight,-0.46,0.80,-0.38);
    /* Sculpted models need 32-bit indices; on a device without them the boxed
       meshes carry on exactly as before. */
    if(this.m3Raw&&this.uIdx32)this.m3Build();
    const st=44;
    const bindGeom=(vbo,ibo)=>{
      gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
      for(const [i,sz,o] of [[0,3,0],[1,3,12],[2,3,24],[3,2,36]]){
        gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,sz,gl.FLOAT,false,st,o);
        ex.vertexAttribDivisorANGLE(i,0);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ibo);
    };
    let curGeom=null;
    for(let a=0;a<this.ARCHN;a++){
      const arr=A[a];if(!arr.length)continue;
      const M=(this.M3&&this.M3.arch[a])||null;
      const want=M?'m':'u';
      if(want!==curGeom){curGeom=want;bindGeom(M?this.m3vbo:this.uvbo,M?this.m3ibo:this.uibo);}
      gl.bindBuffer(gl.ARRAY_BUFFER,this.uIvbo[a]);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(arr),gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(4);gl.vertexAttribPointer(4,4,gl.FLOAT,false,48,0);
      ex.vertexAttribDivisorANGLE(4,1);
      gl.enableVertexAttribArray(5);gl.vertexAttribPointer(5,4,gl.FLOAT,false,48,16);
      ex.vertexAttribDivisorANGLE(5,1);
      gl.enableVertexAttribArray(6);gl.vertexAttribPointer(6,3,gl.FLOAT,false,48,32);
      ex.vertexAttribDivisorANGLE(6,1);
      gl.enableVertexAttribArray(7);gl.vertexAttribPointer(7,1,gl.FLOAT,false,48,44);
      ex.vertexAttribDivisorANGLE(7,1);
      const M2=(this.M3&&this.M3.arch[a])||null;
      gl.uniform2f(this.uLoc.uPiv,M2?M2.piv[0]:this.uPiv[a][0],
                                  M2?M2.piv[1]:this.uPiv[a][1]);
      ex.drawElementsInstancedANGLE(gl.TRIANGLES,M2?M2.iCount:this.uCnt[a],
        (M2||this.uIdx32)?gl.UNSIGNED_INT:gl.UNSIGNED_SHORT,
        M2?M2.iOff*4:this.uOff[a]*(this.uIdx32?4:2),arr.length/12);
    }
    for(let i=4;i<=7;i++){ex.vertexAttribDivisorANGLE(i,0);gl.disableVertexAttribArray(i);}
    gl.disableVertexAttribArray(3);
  },
  /* ---- selection rings, projectiles, corpses --------------------------------
     One dynamic merged mesh rebuilt each frame, drawn through the building
     shader as a single identity instance — no new program, no new instance
     buffer. Counts are small (selection is dozens, projectiles dozens, corpses
     capped at 140), so a rebuild is cheaper than tracking dirtiness.
     Selection rings are REAL GROUND GEOMETRY rather than screen-space ellipses:
     under a rotating camera a ground circle projects to an ellipse whose
     orientation changes with yaw, which a screen-space ellipse cannot express. */
  buildFx(){
    const V=[],I=[];
    const push=(p,n,c)=>{V.push(p[0],p[1],p[2],n[0],n[1],n[2],c[0],c[1],c[2]);return V.length/9-1;};
    const UP=[0,1,0];
    const quadUp=(a,b,c,d,col)=>{
      const i0=push(a,UP,col),i1=push(b,UP,col),i2=push(c,UP,col),i3=push(d,UP,col);
      I.push(i0,i1,i2,i0,i2,i3);
    };
    const bx=(cx,cy,cz,hx,hy,hz,col)=>{
      const X=[cx-hx,cx+hx],Y=[cy-hy,cy+hy],Z=[cz-hz,cz+hz];
      const P=(i,j,k)=>[X[i],Y[j],Z[k]];
      const f=(a,b,c,d,n)=>{const i0=push(a,n,col),i1=push(b,n,col),i2=push(c,n,col),i3=push(d,n,col);
        I.push(i0,i1,i2,i0,i2,i3);};
      f(P(0,0,0),P(1,0,0),P(1,1,0),P(0,1,0),[0,0,-1]);
      f(P(1,0,1),P(0,0,1),P(0,1,1),P(1,1,1),[0,0,1]);
      f(P(1,0,0),P(1,0,1),P(1,1,1),P(1,1,0),[1,0,0]);
      f(P(0,0,1),P(0,0,0),P(0,1,0),P(0,1,1),[-1,0,0]);
      f(P(0,1,0),P(1,1,0),P(1,1,1),P(0,1,1),[0,1,0]);
      f(P(0,0,1),P(1,0,1),P(1,0,0),P(0,0,0),[0,-1,0]);
    };
    // flat annulus lying on the terrain, following its height
    const ring=(cx,cz,r,w,col)=>{
      const seg=22;
      for(let i=0;i<seg;i++){
        const a0=i/seg*6.283,a1=(i+1)/seg*6.283;
        const c0=Math.cos(a0),s0=Math.sin(a0),c1=Math.cos(a1),s1=Math.sin(a1);
        const p=(ct,st,rr)=>{const x=cx+ct*rr,z=cz+st*rr;
          return [x,this.groundH(x,z)+0.012,z];};
        quadUp(p(c0,s0,r-w),p(c1,s1,r-w),p(c1,s1,r+w),p(c0,s0,r+w),col);
      }
    };
    const GOLD=[0.89,0.70,0.24],WHITE=[0.92,0.92,0.90];
    // ring radius follows the scaled massing, or big buildings swallow it
    const bR=b=>{const M=this.BMASS[b.type];
      return b.size*0.62*((M&&M.r!=='flat')?this.BVS:1);};
    // selection
    for(const id of (G.sel||[])){
      const u=G.units.find(x=>x.id===id);
      if(u){ring(u.x,u.y,0.36,0.045,GOLD);continue;}
      const b=G.blds.find(x=>x.id===id);
      if(b)ring(b.tx+b.size/2,b.ty+b.size/2,bR(b),0.055,GOLD);
    }
    if(G.inspect&&G.inspect.id!==undefined){
      const u=G.units.find(x=>x.id===G.inspect.id);
      if(u)ring(u.x,u.y,0.36,0.04,WHITE);
      else{const b=G.blds.find(x=>x.id===G.inspect.id);
        if(b)ring(b.tx+b.size/2,b.ty+b.size/2,bR(b),0.05,WHITE);}
    }
    if(G.inspect&&G.inspect.res){
      const r=G.res[G.inspect.res];
      if(r)ring(r.x+0.5,r.y+0.5,0.4,0.04,WHITE);
    }
    // projectiles — position along the flight plus a real parabolic arc
    const PC={ball:[0.16,0.15,0.14],stone:[0.42,0.40,0.36],bolt:[0.35,0.26,0.14]};
    for(const q of (G.proj||[])){
      const t=Math.max(0,Math.min(1,q.t/q.dur));
      const x=q.x0+(q.x1-q.x0)*t, z=q.y0+(q.y1-q.y0)*t;
      const arc=(q.kind==='stone'?0.9:q.kind==='ball'?0.18:0.34);
      const y=this.groundH(x,z)+0.14+arc*4*t*(1-t);
      const col=PC[q.kind]||[0.38,0.29,0.16];
      const s=q.kind==='stone'?0.055:q.kind==='ball'?0.04:0.028;
      bx(x,y,z,s,s,s,col);
    }
    // corpses — a low flattened form, footprint sized to what fell there: a
    // dead horse is not the same lump as a dead villager, a wreck is longer
    // still. Indexed by archetype (0-5 men, 6-7 cav, 8 elephant, 9 wagon,
    // 10-14 siege, 15-18 ships, 19-21 beasts).
    const CD=[[.13,.09],[.13,.09],[.13,.09],[.13,.09],[.13,.09],[.13,.09],
              [.26,.12],[.26,.12],[.40,.20],[.30,.16],
              [.28,.17],[.28,.17],[.24,.15],[.24,.13],[.24,.14],
              [.30,.13],[.36,.18],[.44,.14],[.38,.16],
              [.14,.10],[.19,.10],[.19,.12]];
    for(const c of (G.corpses||[])){
      const f=Math.max(0,Math.min(1,c.t/c.max));
      if(f<=0.02)continue;
      if(c.max-c.t<0.6)continue;              // still toppling — drawUnits owns it
      const g=this.groundH(c.x,c.y);
      const k=0.30+0.45*f;                    // darkens as it decays
      const dim=CD[this.unitArch(c.type)]||CD[0];
      bx(c.x,g+0.035,c.y,dim[0],0.035,dim[1],[k*0.34,k*0.30,k*0.26]);
    }
    // loose relics — a little gold monolith on a plinth (they were invisible
    // in 3D; on Hallowed Ground the whole map revolves around finding them)
    for(const rl of (G.relics||[])){
      if(rl.held||rl.mon)continue;
      if(!tileKnown(rl.x,rl.y))continue;
      const g=this.groundH(rl.x,rl.y);
      bx(rl.x,g+0.020,rl.y,0.11,0.020,0.11,[0.42,0.36,0.24]);          // plinth
      bx(rl.x,g+0.150,rl.y,0.045,0.115,0.045,[0.85,0.66,0.20]);        // monolith
      bx(rl.x,g+0.282,rl.y,0.058,0.018,0.058,[0.97,0.85,0.44]);        // gilt cap
    }
    /* Fire and smoke on damaged buildings — camera-facing quads built fresh
       each frame (this mesh already rebuilds per frame, so animation is free).
       Flames go in the main OPAQUE range; smoke quads are appended AFTER
       fxSplit and drawn as a second blended pass. Same stateless rule as the
       2D version: everything derives from the clock, the id and hp. */
    const B2=this.basis(),t2=performance.now()*.001;
    const bb=(cx,cy,cz,s,col)=>{
      const rx=B2.rx*s,rz=B2.rz*s;
      const ux=B2.ux*s,uy=B2.uy*s,uz=B2.uz*s;
      const i0=push([cx-rx-ux,cy-uy,cz-rz-uz],UP,col);
      const i1=push([cx+rx-ux,cy-uy,cz+rz-uz],UP,col);
      const i2=push([cx+rx+ux,cy+uy,cz+rz+uz],UP,col);
      const i3=push([cx-rx+ux,cy+uy,cz-rz+uz],UP,col);
      I.push(i0,i1,i2,i0,i2,i3);
    };
    const burning=[];
    for(const b of G.blds){
      if(!b.built||!b.maxhp||b.hp>=b.maxhp*.75)continue;
      if(!allied(b.p,localP)&&!b.seen)continue;
      const M=this.BMASS[b.type];
      if(!M||M.r==='flat')continue;           // walls and farms don't burn
      const r=b.hp/b.maxhp,tier=r<.25?2:r<.5?1:0;
      const vs=this.BVS,H=(IHT[b.type]||18)*this.HS*vs;
      const g=this.groundH(b.tx+b.size/2,b.ty+b.size/2);
      for(let i=0;i<=tier;i++){
        const h=hash2(b.id*31+i*7,b.id*13+i*29);
        const ax=b.tx+b.size*(.28+((h%100)/100)*.44);
        const az=b.ty+b.size*(.28+(((h>>>9)%100)/100)*.44);
        /* anchors sit ON THE ROOFLINE, not inside the massing — a billboard
           inside the volume loses the depth test to its own walls and the
           fire is simply invisible (found the hard way: the first pass put
           them at mid-wall and 3D showed smoke with no flames) */
        const ay=g+H*(1.0+((h>>>7)%30)/100*.28);
        burning.push({ax,ay,az,h,tier,i});
        if(tier>0){
          const fl=.62+.26*Math.sin(t2*11+b.id*3+i*2.4)+.16*Math.sin(t2*7.3+i*5.1);
          const s=(.07+.04*tier+b.size*.012)*fl+.05;
          bb(ax,ay+s*.55,az,s*1.15,[0.66,0.20,0.05]);       // red base
          bb(ax,ay+s*.75,az,s*.78,[0.89,0.43,0.12]);        // orange body
          bb(ax,ay+s*.95,az,s*.46,[0.98,0.82,0.35]);        // yellow core
          if(tier===2)bb(ax,ay+s*1.05,az,s*.26,[1,.98,.88]);
        }
      }
    }
    /* hearth smoke: healthy houses, town halls and smithies breathe a thin
       pale wisp from their chimney — the cheapest "people live here" in the
       whole renderer. Position formula mirrors the chimney in buildBlds. */
    const hearth=[];
    for(const b of G.blds){
      if(!b.built||b.maxhp&&b.hp<b.maxhp*.75)continue;   // damaged ones already smoke
      if(b.type!=='house'&&b.type!=='tc'&&b.type!=='blacksmith')continue;
      if(!allied(b.p,localP)&&!b.seen)continue;
      const s=b.size,inset=s*.10,vs=this.BVS,hw=(s/2-inset)*vs;
      const cxm=b.tx+s/2,czm=b.ty+s/2;
      const H=(IHT[b.type]||18)*this.HS*vs;
      const g=this.groundH(cxm,czm);
      hearth.push({ax:cxm+hw-2*hw*.24,ay:g+H+H*.135,az:czm,h:hash2(b.id*17,b.id*5)});
    }
    this.fxSplit=I.length;                    // smoke starts here — drawn blended
    for(const f2 of burning){
      const puffs=f2.tier===0?2:3;
      for(let s2=0;s2<puffs;s2++){
        const p=((t2*.40)+(f2.h>>>3)/97+s2/puffs)%1;
        const rise=p*(0.9+f2.tier*.25);
        const sway=Math.sin(p*5.2+f2.h)*.10*p;
        let s=.055+.13*p;
        if(p>.85)s*=(1-p)/.15;                // dissolve instead of popping
        const g2=.30+.34*p;
        bb(f2.ax+sway,f2.ay+.12+rise,f2.az+sway*.6,s,[g2,g2*.97,g2*.94]);
      }
    }
    for(const f2 of hearth){
      for(let s2=0;s2<2;s2++){
        const p=((t2*.22)+(f2.h>>>3)/97+s2/2)%1;   // slower, lazier than fire smoke
        const sway=Math.sin(p*4.4+f2.h)*.07*p;
        let s=.030+.055*p;
        if(p>.82)s*=(1-p)/.18;
        const g2=.56+.20*p;                        // pale woodsmoke, not soot
        bb(f2.ax+sway,f2.ay+.05+p*.55,f2.az+sway*.5,s,[g2,g2,g2*.98]);
      }
    }
    /* battle aftermath decals — blood soaking in under corpses, scorched
       ground under burning buildings. Two ground quads 45° apart make an
       eight-point star that reads as a rounded pool at blend alpha (the
       double-covered centre darkens, which is what a pool should do).
       Stateless off the corpse timers and hp like everything else here. */
    const pool=(cx,cz,r,g,col)=>{
      quadUp([cx-r,g,cz-r*.8],[cx+r,g,cz-r*.8],[cx+r,g,cz+r*.8],[cx-r,g,cz+r*.8],col);
      const d=r*.9;
      quadUp([cx,g,cz-d],[cx+d,g,cz],[cx,g,cz+d],[cx-d,g,cz],col);
    };
    for(const c of (G.corpses||[])){
      if(UNITS[c.type]&&UNITS[c.type].ship)continue;
      if(c.type==='ram')continue;
      if(!tileVis(c.x,c.y))continue;
      const age=c.max-c.t;if(age<.25)continue;
      const soak=Math.min(1,age/10),fade=Math.min(1,c.t/25);
      const big=!!(UNITS[c.type]&&UNITS[c.type].cav)||c.type==='elephant';
      const r=(0.20+0.18*soak)*(big?1.5:1);
      const g=this.groundH(c.x,c.y)+.012;
      pool(c.x,c.y,r,g,[.30*fade+.05,.045*fade+.02,.035*fade+.02]);
    }
    for(const b of G.blds){
      if(!b.built||!b.maxhp)continue;
      const r2=b.hp/b.maxhp;if(r2>=.5)continue;
      if(!allied(b.p,localP)&&!b.seen)continue;
      const s=b.size,cxm=b.tx+s/2,czm=b.ty+s/2;
      const g=this.groundH(cxm,czm)+.010;
      const sc=s*.62*Math.min(1,(1-r2)*1.6);
      pool(cxm,czm,sc,g,[.055,.045,.04]);
    }
    const gl=this.gl;
    if(!this.fxvbo){this.fxvbo=gl.createBuffer();this.fxibo=gl.createBuffer();}
    gl.bindBuffer(gl.ARRAY_BUFFER,this.fxvbo);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(V),gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.fxibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(I),gl.DYNAMIC_DRAW);
    this.fxCount=I.length;
  },
  drawFx3(mvp){
    if(this.noTrees)return;
    if(!this.treeProg&&!this.initTrees())return;
    this.buildFx();
    if(!this.fxCount)return;
    const gl=this.gl,ex=this.iext;
    gl.useProgram(this.treeProg);
    gl.uniformMatrix4fv(this.treeLoc.uMVP,false,mvp);
    gl.uniform3f(this.treeLoc.uLight,-0.46,0.80,-0.38);
    gl.uniform1f(this.treeLoc.uAlpha,1.0);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.fxvbo);
    for(let i=0;i<3;i++){gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i,3,gl.FLOAT,false,36,i*12);ex.vertexAttribDivisorANGLE(i,0);}
    gl.bindBuffer(gl.ARRAY_BUFFER,this.bIdent);
    gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,4,gl.FLOAT,false,28,0);
    ex.vertexAttribDivisorANGLE(3,1);
    gl.enableVertexAttribArray(4);gl.vertexAttribPointer(4,3,gl.FLOAT,false,28,16);
    ex.vertexAttribDivisorANGLE(4,1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.fxibo);
    // opaque range: rings, projectiles, corpses, flames
    ex.drawElementsInstancedANGLE(gl.TRIANGLES,this.fxSplit||this.fxCount,gl.UNSIGNED_SHORT,0,1);
    // smoke range: blended, no depth write — soot, not solid grey boxes
    if(this.fxSplit!=null&&this.fxCount>this.fxSplit){
      gl.uniform1f(this.treeLoc.uAlpha,0.42);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      ex.drawElementsInstancedANGLE(gl.TRIANGLES,this.fxCount-this.fxSplit,
        gl.UNSIGNED_SHORT,this.fxSplit*2,1);
      gl.depthMask(true);gl.disable(gl.BLEND);
      gl.uniform1f(this.treeLoc.uAlpha,1.0);
    }
    ex.vertexAttribDivisorANGLE(3,0);ex.vertexAttribDivisorANGLE(4,0);
    gl.disableVertexAttribArray(3);gl.disableVertexAttribArray(4);
  },
  /* Fog overlay. Without this the 3D view reveals the whole map — on Black
     Forest that hands over the entire tree layout, which is a gameplay
     difference, not a cosmetic gap. Source is fogS (512², power-of-two).
     The 2D path's drifting mist layer is NOT ported yet. */
  initFog(){
    const gl=this.gl;
    // Fog is a map-sized quad lying ON the ground plane, projected by the same
    // camera matrix — so it rotates and tilts with the world instead of being
    // pasted flat over the screen.
    const vs=`attribute vec2 aCorner;
      uniform mat4 uMVP; uniform float uMap;
      varying vec2 vUV;
      void main(){
        gl_Position=uMVP*vec4(aCorner.x*uMap, 0.0, aCorner.y*uMap, 1.0);
        vUV=aCorner;
      }`;
    const fs=`precision mediump float;
      uniform sampler2D uFog; uniform float uMul; varying vec2 vUV;
      void main(){ gl_FragColor=texture2D(uFog,vUV)*vec4(1.,1.,1.,uMul); }`;
    const mk=(t,s)=>{const sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);
      if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(sh));return null;}return sh;};
    const v=mk(gl.VERTEX_SHADER,vs),f=mk(gl.FRAGMENT_SHADER,fs);
    if(!v||!f)return false;
    const p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);
    gl.bindAttribLocation(p,0,'aCorner');       // deterministic index, see drawFog
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){console.error(gl.getProgramInfoLog(p));return false;}
    this.fogProg=p;
    this.fogLoc={uMVP:gl.getUniformLocation(p,'uMVP'),
      uMap:gl.getUniformLocation(p,'uMap'),uFog:gl.getUniformLocation(p,'uFog'),
      uMul:gl.getUniformLocation(p,'uMul')};
    this.quad=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0, 1,0, 0,1, 1,0, 1,1, 0,1]),gl.STATIC_DRAW);
    this.fogTex=gl.createTexture();
    this.mistTex=gl.createTexture();
    this.fogVerAt=-1;this.mistVerAt=-1;
    return true;
  },
  drawFog(mvp){
    const gl=this.gl;
    if(!this.fogProg&&!this.initFog())return;
    if(fogDirty)renderFogCanvas();     // in 3D nothing else drives this; draw() does in 2D
    if(this.fogVerAt!==fogVer){
      gl.bindTexture(gl.TEXTURE_2D,this.fogTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,fogS);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      this.fogVerAt=fogVer;
    }
    gl.useProgram(this.fogProg);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.uniformMatrix4fv(this.fogLoc.uMVP,false,mvp);
    gl.uniform1f(this.fogLoc.uMap,MAP);
    gl.uniform1f(this.fogLoc.uMul,1.0);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.fogTex);
    gl.uniform1i(this.fogLoc.uFog,0);
    gl.drawArrays(gl.TRIANGLES,0,6);
    /* The drifting mist, at last ported to 3D — same wisp canvas the 2D path
       drifts over unexplored ground, drawn as a second pass of the same quad
       at the 2D's 0.35 alpha. updateWisps() is shared; whichever renderer is
       live keeps the clouds moving. */
    updateWisps(6);
    if(this.mistVerAt!==wispVer){
      gl.bindTexture(gl.TEXTURE_2D,this.mistTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,wispC);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      this.mistVerAt=wispVer;
    }else gl.bindTexture(gl.TEXTURE_2D,this.mistTex);
    gl.uniform1f(this.fogLoc.uMul,0.35);
    gl.drawArrays(gl.TRIANGLES,0,6);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
  },
  upload(){
    const gl=this.gl;
    gl.bindTexture(gl.TEXTURE_2D,this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,terrain);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    /* Mipmaps. The terrain canvas is non-power-of-two, which WebGL1 forbids
       mipmapping — hence the old LINEAR-only path, which shimmered badly at the
       zoom floor (a ~2.2x minification of a 2912px texture, full screen, every
       frame). WebGL2 allows NPOT mipmaps, so take them when we have them. */
    if(this.gl2){
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      this.terrainMips=true;
    }else{
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      this.terrainMips=false;
    }
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    /* Anisotropy. This is the one that matters for a TILTING camera: the ground
       plane is viewed at a grazing angle, where isotropic filtering picks a mip
       from the worst axis and smears the terrain to mush. Capped at 8 — beyond
       that costs bandwidth on mobile for no visible gain at this texel density. */
    if(this.aniso)
      gl.texParameterf(gl.TEXTURE_2D,this.aniso.TEXTURE_MAX_ANISOTROPY_EXT,
                       Math.min(8,this.anisoMax));
    this.texVer=terrainVer;
  },
  draw(){
    if(!G||!vw||!vh)return;
    if(!this.init())return;
    const gl=this.gl,c=this.canvas;
    if(c.width!==vw*dpr||c.height!==vh*dpr){c.width=vw*dpr;c.height=vh*dpr;}
    gl.viewport(0,0,c.width,c.height);
    gl.clearColor(.071,.086,.043,1);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    if(this.meshKey!==MAP+':'+elevVer)this.buildMesh();
    if(this.failed)return;
    if(this.texVer!==terrainVer)this.upload();
    /* NB: the depthRange split added in the stage-2 foundation is GONE, and
       deliberately so. It emulated 2D's painter order (flat terrain blit before
       all entities) because depth was a fake tile-based key. The camera is now
       a real projection, so depth is real: terrain occluding an entity behind a
       hill is CORRECT in 3D, not a bug to be engineered around. */
    const mvp=this.mvp();
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.ibo);
    const st=24;
    gl.enableVertexAttribArray(this.loc.aPos);
    gl.vertexAttribPointer(this.loc.aPos,3,gl.FLOAT,false,st,0);
    gl.enableVertexAttribArray(this.loc.aUV);
    gl.vertexAttribPointer(this.loc.aUV,2,gl.FLOAT,false,st,12);
    gl.enableVertexAttribArray(this.loc.aShade);
    gl.vertexAttribPointer(this.loc.aShade,1,gl.FLOAT,false,st,20);
    gl.uniformMatrix4fv(this.loc.uMVP,false,mvp);
    gl.uniform1f(this.loc.uHScale,this.HS);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.tex);
    gl.uniform1i(this.loc.uTex,0);
    gl.drawElements(gl.TRIANGLES,this.idxCount,this.idxType,0);
    /* Backface culling is GLOBAL state, exactly like vertexAttribDivisor, and
       this file has NO single winding convention. Audited every builder:
         ground grid       -> winding normal +Y, i.e. FRONT — would VANISH if culled
         tree cone/prism   -> point INTO the solid  -> cull FRONT
         tree blob         -> flipped above to match -> cull FRONT
         buildings, units  -> quad/tri3/fnorm negate -> cull FRONT
         fx mesh           -> quadUp is outward, bx is inward: MIXED, never cullable
       So the span is scoped HERE per pass, not enabled once in init(). Trees and
       units are closed convex solids, so a back face always has a front face of
       the same body nearer the camera — removing back faces cannot change a
       pixel. Buildings are NOT in the mask: their relief panels are single-sided
       quads floated proud of a backing, so culling them would punch holes. */
    this.drawShadows(mvp);       // after the ground, before anything that stands on it
    const FC=this.dbg.face;
    if(FC&1){gl.enable(gl.CULL_FACE);gl.cullFace(gl.FRONT);}
    this.drawTrees(mvp);
    if(FC&1)gl.disable(gl.CULL_FACE);
    this.drawBlds(mvp);
    if(FC&4){gl.enable(gl.CULL_FACE);gl.cullFace(gl.FRONT);}
    this.drawUnits(mvp);
    if(FC&4)gl.disable(gl.CULL_FACE);
    // transparent passes after all opaque ones: water depth-tests against the
    // world (hidden behind hills, parts around hulls) but writes no depth
    this.drawWater(mvp);
    this.drawFx3(mvp);
    this.drawFog(mvp);
  },
};
let use3D=false;
function toggle3D(){
  if(!use3D&&!R3.init())return;          // no WebGL: stay on 2D and say so
  use3D=!use3D;
  document.body.classList.toggle('r3d',use3D);
  const b=document.getElementById('d3Btn');
  if(b)b.classList.toggle('sel',use3D);
  toast(use3D?'3D — drag to pan, right-drag or two fingers to rotate/tilt, ⟲ to reset'
             :'2D renderer');
}
document.getElementById('d3Btn').addEventListener('click',toggle3D);
const _sprBtn=document.getElementById('sprBtn');
if(_sprBtn)_sprBtn.addEventListener('click',toggleSprites);
sprInit();
bsprInit();   // building sheets (graphics campaign G1)
R3.loadModels();   // sculpted 3D unit meshes for the WebGL renderer
/* The standalone rotate handler that used to live here is GONE. It bound a
   SECOND independent pointerdown to #view3 and would now fight the shared
   onDown/onMove that give 3D its tap, command, box-select and pan. Its
   gestures live in onMove (right/middle drag) and twoFingerOrbit; its R key
   moved into the main keydown handler so it cannot shadow the contextual
   train/build keys ('r' is Ram at a siege workshop and Turtle Ship at a dock). */
document.getElementById('camBtn').onclick=()=>{
  R3.yaw=R3.homeYaw;R3.setPitch(R3.homePitch);toast('Camera reset');
};
function frame(now){
  requestAnimationFrame(frame);
  if(!G)return;
  // belt-and-braces beside the ResizeObserver: if the panel re-flowed the view,
  // recalibrate before drawing so taps always land where the cursor points
  chkT-=1;
  if(chkT<=0){chkT=20;chkView();}
  const dt=Math.min(.1,(now-last)/1000);last=now;
  if(!G.paused&&!G.over){
    acc+=dt;
    let guard=0;
    if(netMode){
      // A networked turn runs only when every peer's orders for it have landed.
      // Falling behind is not a reason to skip ahead — that is exactly the
      // divergence lockstep exists to prevent — so we wait, and say who for.
      while(acc>=.05&&guard++<6){
        if(!netRunTurn())break;
        acc-=.05;
      }
      if(acc>=.05){
        const w=netWaitingOn(netTurn);
        netStall+=dt;
        acc=Math.min(acc,.05);            // don't bank a debt we'd sprint to repay
        if(netStall>2.5&&w&&netStallSeat!==w.seat){
          netStallSeat=w.seat;toast('Waiting for '+w.name+'…');
        }
        // Behind a proxy a vanished player takes ~15-20s to be confirmed dead,
        // so say what is about to happen rather than leaving people staring.
        if(netStall>8&&w&&!netStallSaid){
          netStallSaid=true;
          feed(w.name+' has gone quiet — if they don\'t return the computer will take their banner',true);
        }
        // A dropped seat is handled by the relay's takeover notice, so netWaitingOn
        // already ignores it. Reaching here still waiting on a gone seat means the
        // notice never came — the relay itself is in trouble, not the player.
        if(w&&netGone.has(w.seat)&&netStall>15)
          netHalt('Lost the relay',
            w.name+' left, but no handover instruction arrived.',
            'Without it the computer cannot take their banner on a turn every machine agrees about, so the battle stops here.');
        else if(netStall>45)
          netHalt('Lost contact','Nothing has arrived from '+(w?w.name:'the other players')+' for 45 seconds.',
            'Your connection, or theirs, has gone quiet.');
      }else{netStall=0;netStallSeat=-1;netStallSaid=false;}
    }else{
      // replay playback runs the same fixed steps, just more of them per frame
      const spd=REC.play?REC.speed:1;
      if(spd>1)acc+=dt*(spd-1);
      const gmax=Math.min(48,6*spd);
      while(acc>=.05&&guard++<gmax){step(.05);acc-=.05;}
      if(REC.play)acc=Math.min(acc,.2);   // never bank an unpayable debt at 16x
    }
    if((now|0)%500<20)updateTop();
  }
  updateTop();
  updateOverlays();
  syncSelRect();
  // drawMini lives at the tail of the 2D draw(), which never runs in 3D — the
  // minimap froze the moment you toggled. It only touches mctx, so call it
  // directly; it is how you navigate, frozen is not an option.
  // battery saver: render every other frame (the sim above still ran at full
  // rate, so lockstep and game speed are untouched — only the paint thins out)
  fpsAlt=!fpsAlt;
  if(OPT.fps30&&fpsAlt)return;
  if(use3D){R3.draw();drawMini();}else draw();
  drawWeather();          // on the glass, over whichever renderer just drew
}
