/* ================= rendering ================= */
const view=document.getElementById('view');
const view3=document.getElementById('view3');
let ctx=view.getContext('2d'); // let: portraitFor temporarily points it at a portrait canvas
const mini=document.getElementById('minimap'),mctx=mini.getContext('2d');
const TREZ=2; // supersample factor for sprites
let TREZT=2;  // supersample for the terrain canvas (drops to 1 on big maps to cap memory)
let terrain=document.createElement('canvas');
terrain.width=MAP*TILE*TREZT;terrain.height=MAP*TILE*TREZT;
const tctx=terrain.getContext('2d');
function setMapSize(n){
  if(MAP===n)return;
  MAP=n;
  TREZT=n>64?1:2;elevVer++;
  terrain.width=MAP*TILE*TREZT;terrain.height=MAP*TILE*TREZT;
  fogC.width=MAP;fogC.height=MAP;
  maskC.width=MAP;maskC.height=MAP;
  miniResC.width=MAP;miniResC.height=MAP;
  grainPat=null;
}
let vw=0,vh=0,dpr=1,vig=null;
const fogC=document.createElement('canvas');fogC.width=MAP;fogC.height=MAP;
const fogCtx=fogC.getContext('2d');
// minimap resource dots, cached (Black Forest has thousands of trees)
const miniResC=document.createElement('canvas');miniResC.width=MAP;miniResC.height=MAP;
let miniResDirty=true;
function renderMiniRes(){
  const mg=miniResC.getContext('2d');
  mg.clearRect(0,0,MAP,MAP);
  const rnd=mulberry(1313); // macro tone blotches so the green isn't flat
  for(let i=0;i<26;i++){
    mg.fillStyle=i%2?'rgba(20,60,10,.2)':'rgba(130,170,60,.14)';
    mg.beginPath();mg.ellipse(rnd()*MAP,rnd()*MAP,3+rnd()*7,2+rnd()*4,rnd()*3,0,7);mg.fill();}
  mg.globalAlpha=.55;mg.fillStyle='#b99a55';
  for(const d of dirtPatches){mg.beginPath();mg.ellipse(d.x,d.y,d.rx*.8,d.ry*.8,0,0,7);mg.fill();}
  mg.globalAlpha=1;
  for(const k in G.res){const r=G.res[k];
    const wd=r.type==='wood';
    mg.fillStyle=wd?'#173a0e':r.type==='food'?'#b03226':r.type==='fish'?'#bfe3ef':'#ffd34e';
    mg.fillRect(r.x,r.y,wd?1.4:1.1,wd?1.4:1.1);}
  miniResDirty=false;
}
/* soft fog: hard 64px cells -> two-step bilinear upscale for organic edges,
   plus an unexplored-only mask that carries slow-drifting mist */
const fogM=document.createElement('canvas');fogM.width=128;fogM.height=128;
const fogMCtx=fogM.getContext('2d');
const fogS=document.createElement('canvas');fogS.width=512;fogS.height=512;
const fogSCtx=fogS.getContext('2d');
const maskC=document.createElement('canvas');maskC.width=MAP;maskC.height=MAP;
const maskCtx=maskC.getContext('2d');
const maskM=document.createElement('canvas');maskM.width=128;maskM.height=128;
const maskMCtx=maskM.getContext('2d');
const maskS=document.createElement('canvas');maskS.width=512;maskS.height=512;
const maskSCtx=maskS.getContext('2d');
const wispC=document.createElement('canvas');wispC.width=512;wispC.height=512;
const wispCtx=wispC.getContext('2d');
let wispT=0,fogWasDirty=true; // mist refresh throttle (see the draw() mist block)
const noiseC=(()=>{ // seamless soft cloud blobs for the mist layer
  const c=document.createElement('canvas');c.width=256;c.height=256;
  const g=c.getContext('2d');
  const rnd=mulberry(4242);
  for(let i=0;i<42;i++){
    const x=rnd()*256,y=rnd()*256,r=18+rnd()*38;
    for(const ox of [-256,0,256])for(const oy of [-256,0,256]){
      const gr=g.createRadialGradient(x+ox,y+oy,0,x+ox,y+oy,r);
      gr.addColorStop(0,'rgba(150,158,175,.12)');
      gr.addColorStop(1,'rgba(150,158,175,0)');
      g.fillStyle=gr;
      g.beginPath();g.arc(x+ox,y+oy,r,0,7);g.fill();
    }
  }
  return c;})();
function renderFogCanvas(){
  const img=fogCtx.createImageData(MAP,MAP);
  const mimg=maskCtx.createImageData(MAP,MAP);
  for(let i=0;i<MAP*MAP;i++){
    const v=G.vis[i],o=i*4;
    if(v===2)img.data[o+3]=0;
    else if(v===1){img.data[o]=10;img.data[o+1]=12;img.data[o+2]=18;img.data[o+3]=84;} // hue only — alpha stays 84 (visibility gotcha)
    else{img.data[o]=3;img.data[o+1]=4;img.data[o+2]=7;img.data[o+3]=208; // AoE2 near-black HUE — alpha stays 208 (phone visibility gotcha)
      mimg.data[o+3]=255;}
  }
  fogCtx.putImageData(img,0,0);
  maskCtx.putImageData(mimg,0,0);
  fogMCtx.clearRect(0,0,128,128);fogMCtx.drawImage(fogC,0,0,128,128);
  fogSCtx.clearRect(0,0,512,512);fogSCtx.drawImage(fogM,0,0,512,512);
  maskMCtx.clearRect(0,0,128,128);maskMCtx.drawImage(maskC,0,0,128,128);
  maskSCtx.clearRect(0,0,512,512);maskSCtx.drawImage(maskM,0,0,512,512);
  fogDirty=false;fogWasDirty=true; // mist must re-clip to the new mask at once
  fogVer++;                        // tells R3 to re-upload fogS as a texture
}
const TEAMS=[ // high-chroma AoE2 player colors — the loudest signal on screen
  {main:'#2a56d4',dark:'#16308f',trim:'#7da2f2'},  // blue (you)
  {main:'#d42a1e',dark:'#8c1710',trim:'#f2887d'},  // red
  {main:'#2f9e28',dark:'#1b6316',trim:'#8ade82'},  // green
  {main:'#e8c31f',dark:'#9c7f12',trim:'#f5e17a'},  // yellow
  {main:'#1fb5c8',dark:'#127181',trim:'#84e0eb'},  // cyan
  {main:'#9b3fd4',dark:'#63268c',trim:'#cf9af2'},  // purple
  {main:'#8c8c8c',dark:'#565656',trim:'#c9c9c9'},  // gray
  {main:'#e8801f',dark:'#9c5212',trim:'#f5b87a'}]; // orange
TEAMS[GAIA]={main:'#9a8f7c',dark:'#5d5548',trim:'#cfc4ac'}; // nature — hide, horn, bristle
/* Colourblind-safe palette (Okabe–Ito derived). Applied at BOOT, before any
   sprite cache exists, so every cache keying on team index paints the right
   colour. The Settings toggle flips OPT.cbPal and reloads the page. */
if(OPT.cbPal){
  const CB=[['#3465c4','#1d3a78','#8fb0ec'],  // blue (you)
            ['#d55e00','#8a3d00','#f0a56b'],  // vermillion
            ['#009e73','#00644a','#66cbae'],  // teal-green
            ['#f0e442','#9c9420','#f8f094'],  // yellow
            ['#56b4e9','#33719c','#a3d7f4'],  // sky
            ['#cc79a7','#85506d','#e2b3cc'],  // rose
            ['#8c8c8c','#565656','#c9c9c9'],  // gray
            ['#e69f00','#9c6c00','#f3c866']]; // amber
  CB.forEach((c,i)=>{TEAMS[i].main=c[0];TEAMS[i].dark=c[1];TEAMS[i].trim=c[2];});
}
// no black outlines — forms read through value contrast; edges are a soft warm
// shadow tone (late-90s pre-rendered look: warm key upper-left, cool ambient fill)
const OUT='rgba(50,33,17,.72)',SKIN='#e0b78e'; // a notch darker/crisper, still warm — the reference sprites pop harder
/* ---------- isometric projection ---------- */
const IW=26,IH=13; // half-diamond extents per tile
function isoPt(x,y){return{x:(x-y)*IW,y:(x+y)*IH};}
function invIso(sx,sy){return{x:(sx/IW+sy/IH)/2,y:(sy/IH-sx/IW)/2};}
function elevTile(x,y){
  if(!G||!G.elev)return 0;
  x|=0;y|=0;
  if(x<0||y<0||x>=MAP||y>=MAP)return 0;
  return G.elev[y*MAP+x];
}
function elevF(x,y){ // bilinear between tile centers for smooth hill walking
  if(!G||!G.elev)return 0;
  const gx=x-.5,gy=y-.5;
  const x0=Math.floor(gx),y0=Math.floor(gy);
  const fx=gx-x0,fy=gy-y0;
  const e=(xx,yy)=>elevTile(xx,yy);
  return (e(x0,y0)*(1-fx)+e(x0+1,y0)*fx)*(1-fy)+(e(x0,y0+1)*(1-fx)+e(x0+1,y0+1)*fx)*fy;
}
function isoE(x,y){const p=isoPt(x,y);p.y-=elevF(x,y)*10;return p;}
function ip(x,y){return{x:(x-y)*IW,y:(x+y)*IH};}
function lift(p,h){return{x:p.x,y:p.y-h};}
function poly(g,pts,fill,stroke,lw){
  g.beginPath();g.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++)g.lineTo(pts[i].x,pts[i].y);
  g.closePath();
  if(fill){g.fillStyle=fill;g.fill();}
  if(stroke){g.strokeStyle=stroke;g.lineWidth=lw||1;g.stroke();}
}
function shadeCol(hex,f){
  const n=parseInt(hex.slice(1),16);
  const cl=v=>Math.max(0,Math.min(255,Math.round(v+f*255)));
  return 'rgb('+cl((n>>16)&255)+','+cl((n>>8)&255)+','+cl(n&255)+')';
}
function faceGrad(g,col,yTop,yBot,fLight,fDark){
  if(typeof col!=='string'||col[0]!=='#')return col;
  const gr=g.createLinearGradient(0,yTop,0,yBot);
  gr.addColorStop(0,shadeCol(col,fLight));
  gr.addColorStop(1,shadeCol(col,fDark));
  return gr;
}
function isoBlock(g,x0,y0,w,d,hb,h,cols){
  const A=lift(ip(x0,y0),hb),B=lift(ip(x0+w,y0),hb),
        C=lift(ip(x0+w,y0+d),hb),D=lift(ip(x0,y0+d),hb);
  const A2=lift(A,h),B2=lift(B,h),C2=lift(C,h),D2=lift(D,h);
  poly(g,[D,C,C2,D2],faceGrad(g,cols.l,C2.y,C.y,.05,-.1),cols.o);
  poly(g,[C,B,B2,C2],faceGrad(g,cols.r,C2.y,C.y,.02,-.14),cols.o);
  // warm key light on the west face, cool ambient fill on the shaded east face
  poly(g,[D,C,C2,D2],'rgba(255,224,166,.09)');
  poly(g,[C,B,B2,C2],'rgba(46,54,74,.12)');
  poly(g,[A2,B2,C2,D2],cols.t,cols.o);
  // ambient occlusion band along the ground line + crisp corner shadow
  g.strokeStyle='rgba(20,14,6,.13)';g.lineWidth=4.5;
  g.beginPath();g.moveTo(D.x,D.y-1.8);g.lineTo(C.x,C.y-1.8);g.lineTo(B.x,B.y-1.8);g.stroke();
  g.strokeStyle='rgba(20,14,6,.3)';g.lineWidth=2;
  g.beginPath();g.moveTo(D.x,D.y);g.lineTo(C.x,C.y);g.lineTo(B.x,B.y);g.stroke();
  // sunlit top edge
  g.strokeStyle='rgba(255,248,225,.25)';g.lineWidth=1;
  g.beginPath();g.moveTo(D2.x,D2.y);g.lineTo(C2.x,C2.y);g.lineTo(B2.x,B2.y);g.stroke();
  return{A,B,C,D,A2,B2,C2,D2};
}
function roofGable(g,x0,y0,w,d,hb,rh,cols){
  const A=lift(ip(x0,y0),hb),B=lift(ip(x0+w,y0),hb),
        C=lift(ip(x0+w,y0+d),hb),D=lift(ip(x0,y0+d),hb);
  const Rs=lift(ip(x0,y0+d/2),hb+rh),Re=lift(ip(x0+w,y0+d/2),hb+rh);
  poly(g,[A,D,Rs],cols.end,cols.o);
  poly(g,[A,B,Re,Rs],cols.shade,cols.o);
  poly(g,[D,C,Re,Rs],faceGrad(g,cols.slope,Rs.y,C.y,.07,-.09),cols.o);
  poly(g,[C,B,Re],faceGrad(g,cols.shade,Re.y,C.y,.02,-.1),cols.o);
  // warm key on the sunlit slope, cool ambient on the shaded gable end
  poly(g,[D,C,Re,Rs],'rgba(255,224,166,.08)');
  poly(g,[C,B,Re],'rgba(46,54,74,.12)');
  return{Rs,Re};
}
const TERRA={slope:'#b8613a',shade:'#8f4829',end:'#a65733',o:'rgba(52,20,8,.55)'}; // concept-art pass: brighter orange-red clay tile
const SLATE={slope:'#5a7ea8',shade:'#43617f',end:'#4e6f93',o:'rgba(16,24,36,.5)'}; // blue slate, the concept art's signature roof
/* Pyramidal/conical roof cap — four faces meeting at an apex over the centre.
   The concept art puts one of these on every tower and turret; a flat crenellated
   top was the biggest silhouette difference. `eave` overhangs the footprint.
   Draws the two HIDDEN faces first so an overhanging eave still silhouettes right. */
function coneRoof(g,x0,y0,w,d,hb,rh,cols,eave){
  const e=eave||0;
  const A=lift(ip(x0-e,y0-e),hb),B=lift(ip(x0+w+e,y0-e),hb),
        C=lift(ip(x0+w+e,y0+d+e),hb),D=lift(ip(x0-e,y0+d+e),hb);
  const apex=lift(ip(x0+w/2,y0+d/2),hb+rh);
  poly(g,[A,D,apex],cols.end,cols.o);
  poly(g,[A,B,apex],cols.shade,cols.o);
  poly(g,[D,C,apex],faceGrad(g,cols.slope,apex.y,C.y,.07,-.09),cols.o);
  poly(g,[C,B,apex],faceGrad(g,cols.shade,apex.y,C.y,.02,-.1),cols.o);
  // warm key on the sunlit slope, cool ambient fill on the shaded one
  poly(g,[D,C,apex],'rgba(255,224,166,.10)');
  poly(g,[C,B,apex],'rgba(46,54,74,.13)');
  // lit hip ridge from apex down the sunlit corner + eave shadow
  g.strokeStyle='rgba(255,240,205,.4)';g.lineWidth=1.3;
  g.beginPath();g.moveTo(apex.x,apex.y);g.lineTo(D.x,D.y);g.stroke();
  g.strokeStyle='rgba(0,0,0,.26)';g.lineWidth=1.2;
  g.beginPath();g.moveTo(D.x,D.y+.6);g.lineTo(C.x,C.y+.6);g.lineTo(B.x,B.y+.6);g.stroke();
  return apex;
}
function archWin(g,P,Q,t0,t1,h0,h1,fill,stroke){
  // small round-arched opening on an iso face (spec: arched windows/doors)
  const bl=facePt(P,Q,t0,h0),br=facePt(P,Q,t1,h0),tr=facePt(P,Q,t1,h1),tl=facePt(P,Q,t0,h1);
  const rise=(h1-h0)*.45;
  g.fillStyle=fill;g.beginPath();
  g.moveTo(bl.x,bl.y);g.lineTo(tl.x,tl.y);
  g.quadraticCurveTo((tl.x+tr.x)/2,(tl.y+tr.y)/2-rise,tr.x,tr.y);
  g.lineTo(br.x,br.y);g.closePath();g.fill();
  if(stroke){g.strokeStyle=stroke;g.lineWidth=.8;g.stroke();}
}
function facePt(P,Q,t,h){return{x:P.x+(Q.x-P.x)*t,y:P.y+(Q.y-P.y)*t-h};}
function groundShadow(g,cx,cy,rx){
  g.fillStyle='rgba(24,27,36,.26)';
  g.beginPath();g.ellipse(cx,cy,rx,rx*.5,0,0,7);g.fill();
}
function teamColor(p){return TEAMS[p].main;}
function teamDark(p){return TEAMS[p].dark;}
function hash2(x,y){let h=(x*374761393+y*668265263)>>>0;
  h=(h^(h>>>13))>>>0;h=Math.imul(h,1274126177)>>>0;return (h^(h>>>16))>>>0;}
function mulberry(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;
  let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;
  return((t^t>>>14)>>>0)/4294967296;};}
function resize(){
  const wrap=document.getElementById('viewwrap');
  dpr=Math.min(2,window.devicePixelRatio||1);
  vw=wrap.clientWidth;vh=wrap.clientHeight;
  view.width=vw*dpr;view.height=vh*dpr;
  vig=document.createElement('canvas');vig.width=vw;vig.height=vh;
  const vc=vig.getContext('2d');
  const gr=vc.createRadialGradient(vw/2,vh/2,Math.min(vw,vh)*.42,vw/2,vh/2,Math.hypot(vw,vh)*.62);
  gr.addColorStop(0,'rgba(16,22,8,0)');gr.addColorStop(1,'rgba(16,22,8,.22)');
  vc.fillStyle=gr;vc.fillRect(0,0,vw,vh);
  clampCam&&G&&clampCam();
}
window.addEventListener('resize',resize);
// The bottom panel grows and shrinks with the selection, resizing #viewwrap
// WITHOUT a window resize. If vw/vh go stale the canvas is drawn squashed and
// every tap lands offset from the cursor — so watch the wrap itself.
let chkT=0;
function chkView(){
  const wrap=document.getElementById('viewwrap');
  if(wrap.clientWidth!==vw||wrap.clientHeight!==vh){
    resize();
    // reallocating the canvas blanks it — repaint NOW so no empty frame shows
    if(G&&typeof draw==='function')try{draw();}catch(e){}
  }
}
if(window.ResizeObserver)
  new ResizeObserver(chkView).observe(document.getElementById('viewwrap'));
/* ---------- terrain ---------- */
function stampWorn(b){
  // dithered trampled-earth ring around a finished building, painted onto the terrain canvas
  tctx.setTransform(TREZT,0,0,TREZT,0,0);
  const cx=(b.tx+b.size/2)*TILE,cy=(b.ty+b.size/2)*TILE;
  const r=(b.size*.85+1.15)*TILE;
  const rw=mulberry(b.tx*73+b.ty*131+7);
  // solid worn core so it reads at a distance, then dithered edge
  tctx.globalAlpha=.7;
  tctx.fillStyle='#a48b58';
  tctx.beginPath();tctx.ellipse(cx,cy,r*.66,r*.53,0,0,7);tctx.fill();
  const WORN=['#b39a66','#a48b58','#c0a878','#8f7a4e'];
  for(let i=0;i<170;i++){
    const t=Math.sqrt(rw()),ang=rw()*6.283;
    const px=cx+Math.cos(ang)*r*t,py=cy+Math.sin(ang)*r*t*.82;
    if(px<0||py<0||px>=MAP*TILE||py>=MAP*TILE)continue;
    const kk=((px/TILE)|0)+','+((py/TILE)|0);
    if(G.water[kk]||G.ford[kk])continue;
    tctx.globalAlpha=.55+.35*(1-t);
    tctx.fillStyle=WORN[i%4];
    tctx.fillRect(px,py,2.2+rw()*2,2+rw()*1.8);
  }
  tctx.globalAlpha=1;
}
function stampCleared(x,y){
  // felled forest tile -> leaf-litter clearing + stump (refreshTerrain only runs
  // on new/load game, so the solid understory must be repainted incrementally)
  tctx.setTransform(TREZT,0,0,TREZT,0,0);
  const px=x*TILE,py=y*TILE,h=hash2(x*7,y*13);
  tctx.fillStyle='#4a5830';
  tctx.fillRect(px-1,py-1,TILE+2,TILE+2);
  const LIT=['#5b6a38','#42522c','#697544','#374826'];
  tctx.globalAlpha=.55;
  for(let i=0;i<22;i++){
    tctx.fillStyle=LIT[(h+i)%4];
    tctx.fillRect(px+(hash2(x*3+i,y*5)%23),py+(hash2(x,y*9+i)%23),2.4,2);
  }
  tctx.globalAlpha=1;
  const sx=px+8+(h%10),sy=py+8+((h>>>3)%10);
  tctx.fillStyle='rgba(18,26,10,.35)';
  tctx.beginPath();tctx.ellipse(sx+1.5,sy+1.5,4.5,2,0,0,7);tctx.fill();
  tctx.fillStyle='#5a3d20';tctx.fillRect(-2.6+sx,sy-2,5.2,3.6);
  tctx.fillStyle='#c9a266';
  tctx.beginPath();tctx.ellipse(sx,sy-2,2.6,1.5,0,0,7);tctx.fill();
  tctx.strokeStyle='#8a6a3a';tctx.lineWidth=.7;
  tctx.beginPath();tctx.ellipse(sx,sy-2,1.4,.8,0,0,7);tctx.stroke();
}
// (render-side version counters are declared above genMap — see there)
function refreshTerrain(){
  if(!G)return;
  terrainVer++;
  tctx.setTransform(TREZT,0,0,TREZT,0,0);
  // AoE2-style ground: tightly-spaced warm olive tones so no tile checkerboard
  // shows — the texture comes from the fine grain pass below, not tile contrast
  // muted dry-grass olives (desaturated, low contrast so units read on top)
  // yellow-olive grass calibrated against the reference frames (f600/f1500):
  // brighter and yellower than the old dry olive, still tightly spaced
  // concept-art pass: off the dry yellow-olive and into a saturated meadow green.
  // Still tightly spaced (no tile checkerboard) and GRH stays within ~6% of GR.
  /* GRAPHICS CAMPAIGN G2: the ground is now a real TEXTURE, not a flat fill.
     One seamless 208px grass tile is synthesized once per load — low-frequency
     mottled fields, mid-frequency clumps, and short directional blade strokes —
     and pattern-filled under everything. Runtime-generated on purpose: it works
     in the artifact (no fetch), ships zero bytes, and the 3D renderer inherits
     it automatically because it samples this same canvas. Contrast is kept
     moderate so units still read on top (the game's standing terrain rule). */
  if(!groundPat)groundPat=tctx.createPattern(mkGroundTex(),'repeat');
  tctx.fillStyle=groundPat;
  tctx.fillRect(0,0,MAP*TILE,MAP*TILE);
  // hills keep their slightly sunnier read (high ground is +25% damage — it must show)
  for(let y=0;y<MAP;y++)for(let x=0;x<MAP;x++){
    if(!(G.elev&&G.elev[y*MAP+x]))continue;
    const k=x+','+y;
    if(G.water[k]||G.ford[k])continue;
    tctx.fillStyle='rgba(236,240,180,.10)';
    tctx.fillRect(x*TILE,y*TILE,TILE,TILE);
  }
  // dense fine grain tiled across the whole ground — this, not tile contrast,
  // is what makes AoE2 terrain read as real earth
  if(!grainPat){
    const nc=document.createElement('canvas');nc.width=96;nc.height=96;
    const ng=nc.getContext('2d');
    const gr2=mulberry(777);
    for(let i=0;i<1100;i++){
      ng.fillStyle=gr2()<.52
        ?'rgba(34,54,22,'+(.04+gr2()*.1).toFixed(3)+')'
        :'rgba(206,222,160,'+(.03+gr2()*.08).toFixed(3)+')';
      ng.fillRect(gr2()*96,gr2()*96,1+gr2()*1.6,1+gr2()*1.6);
    }
    grainPat=tctx.createPattern(nc,'repeat');
  }
  tctx.fillStyle=grainPat;
  tctx.fillRect(0,0,MAP*TILE,MAP*TILE);
  const rnd=mulberry(90210);
  // dark/pale grass macro fields: walked lobed patches w/ their own speckle,
  // so the grass patchworks at AoE2's macro scale instead of faint round tints
  for(let i=0,nP=Math.round(26*MAP*MAP/4096);i<nP;i++){
    let mx=rnd()*MAP*TILE,my=rnd()*MAP*TILE;
    const dark=i%3!==2;let a=rnd()*6.283;
    for(let s=0,st=6+(rnd()*7|0);s<st;s++){
      const mr=TILE*(2.0+rnd()*2.8); // the reference grass patches are FIELDS, not spots
      // faint solid core + heavy dither so the union reads as one ragged field,
      // not a chain of stamped ellipses
      tctx.fillStyle=dark?'rgba(32,62,20,.11)':'rgba(180,200,112,.08)';
      tctx.beginPath();tctx.ellipse(mx,my,mr,mr*.55,0,0,7);tctx.fill();
      tctx.fillStyle=dark?'rgba(20,44,14,.26)':'rgba(200,216,132,.2)';
      for(let d=0;d<34;d++){
        const t2=Math.sqrt(rnd()),an=rnd()*6.283;
        tctx.fillRect(mx+Math.cos(an)*mr*t2,my+Math.sin(an)*mr*.55*t2,2.4,2);
      }
      a+=(rnd()-.5)*1.4;
      mx+=Math.cos(a)*mr*.8;my+=Math.sin(a)*mr*.5;
    }
  }
  // dirt/sand macro-blobs: random-walked stamp unions, multi-tile lobed fields
  // with solid tan cores and heavy dithered grass fringes (skips water/fords)
  const wet=(px,py)=>{const tx2=(px/TILE)|0,ty2=(py/TILE)|0,kk=tx2+','+ty2;
    return G.water[kk]||G.ford[kk];};
  const DIRT=['#c0a266','#b4975c','#d0b276','#a1874f']; // warmer orange-tan, per reference
  const dirtSpots=[];
  dirtPatches.length=0; // minimap mirrors the same blobs (tile units)
  for(let i=0,nB=Math.round(9*MAP*MAP/4096);i<nB;i++){
    let bx=(4+rnd()*(MAP-8))*TILE,by=(4+rnd()*(MAP-8))*TILE;
    if(wet(bx,by))continue;
    const stamps=[];let a=rnd()*6.283;
    for(let s=0,st=7+(rnd()*8|0);s<st;s++){
      const r=TILE*(1.3+rnd()*1.6);
      if(!wet(bx,by))stamps.push([bx,by,r,r*(.55+rnd()*.25)]);
      a+=(rnd()-.5)*1.5;
      bx=Math.max(TILE,Math.min(MAP*TILE-TILE,bx+Math.cos(a)*r*.9));
      by=Math.max(TILE,Math.min(MAP*TILE-TILE,by+Math.sin(a)*r*.55));
    }
    if(!stamps.length)continue;
    dirtSpots.push(stamps[stamps.length>>1]);
    for(const[sx,sy,rx,ry] of stamps)dirtPatches.push({x:sx/TILE,y:sy/TILE,rx:rx/TILE,ry:ry/TILE});
    tctx.globalAlpha=.9;tctx.fillStyle='#ab9260';
    for(const[sx,sy,rx,ry] of stamps){
      tctx.beginPath();tctx.ellipse(sx,sy,rx*.72,ry*.72,0,0,7);tctx.fill();}
    for(const[sx,sy,rx,ry] of stamps)for(let d=0;d<70;d++){
      const t2=Math.sqrt(rnd()),an=rnd()*6.283;
      const px=sx+Math.cos(an)*rx*t2,py=sy+Math.sin(an)*ry*t2;
      if(px<0||py<0||px>=MAP*TILE||py>=MAP*TILE||wet(px,py))continue;
      tctx.globalAlpha=t2<.7?.5:.42+.4*(1-t2);
      tctx.fillStyle=d%9===8?'rgba(96,74,42,.4)':DIRT[(d+i)%4];
      tctx.fillRect(px,py,2.4+rnd()*2.2,2.2+rnd()*1.8);
    }
    tctx.globalAlpha=1;
  }
  // forest understory: dense clusters read as one solid green-black canopy mass
  const wd=new Uint8Array(MAP*MAP);
  for(const k2 in G.res){const r2=G.res[k2];if(r2.type==='wood')wd[r2.y*MAP+r2.x]=1;}
  const wAt=(x,y)=>x>=0&&y>=0&&x<MAP&&y<MAP&&wd[y*MAP+x]?1:0;
  /* Edge shade is ROUND radial pools now, not iso canopy scallops. This was
     the last iso-baked art in the texture: the scallops painted canopy
     SILHOUETTES onto the ground, which lay flat and wrong the moment the 3D
     camera tilted or turned. A direction-free ground stain is geometrically
     valid at any yaw/pitch — it just foreshortens with the ground. One tiny
     pre-rendered pool sprite, stamped per edge, keeps genMap cost flat. */
  const poolC=document.createElement('canvas');poolC.width=poolC.height=20;
  {const pg=poolC.getContext('2d');
   const gr=pg.createRadialGradient(10,10,1,10,10,9.5);
   gr.addColorStop(0,'rgba(14,25,9,.55)');gr.addColorStop(1,'rgba(14,25,9,0)');
   pg.fillStyle=gr;pg.fillRect(0,0,20,20);}
  for(let y=0;y<MAP;y++)for(let x=0;x<MAP;x++){
    if(!wd[y*MAP+x])continue;
    const n=wAt(x,y-1)+wAt(x,y+1)+wAt(x-1,y)+wAt(x+1,y);
    const px=x*TILE,py=y*TILE,h=hash2(x*29,y*41);
    tctx.fillStyle=n===4?'#0e1a09':n>=2?'#152410':'#1c2e14';
    tctx.fillRect(px-1,py-1,TILE+2,TILE+2); // overfill kills seams in the skewed blit
    tctx.fillStyle='rgba(60,86,40,.14)';
    for(let s=0;s<3;s++)
      tctx.fillRect(px+2+((h>>>(s*3))%22),py+2+((h>>>(s*3+7))%22),2.2,2);
    const fr=(ex,ey,horiz)=>{for(let s=0;s<3;s++){
      const j=((h>>>(s*4))%9)-4,sz=13+((h>>>(s*2+1))%8);
      const cx2=(horiz?ex-9+s*9:ex)+j*.5,cy2=(horiz?ey:ey-9+s*9)+j*.5;
      tctx.drawImage(poolC,cx2-sz/2,cy2-sz/2,sz,sz);
    }};
    if(!wAt(x,y-1))fr(px+TILE/2,py,true);
    if(!wAt(x,y+1))fr(px+TILE/2,py+TILE,true);
    if(!wAt(x-1,y))fr(px,py+TILE/2,false);
    if(!wAt(x+1,y))fr(px+TILE,py+TILE/2,false);
  }
  // trampled earth around finished buildings
  for(const b of G.blds)if(b.built&&!BLDS[b.type].thin&&b.type!=='farm')stampWorn(b);
  // hill slope shading: sunlit NW rims, shaded SE drops
  if(G.elev)for(let y=0;y<MAP;y++)for(let x=0;x<MAP;x++){
    if(!G.elev[y*MAP+x])continue;
    const e=(xx,yy)=>xx<0||yy<0||xx>=MAP||yy>=MAP?0:G.elev[yy*MAP+xx];
    // Hill rims used to be dead-straight strokes along the tile edge, which
    // drew a visible lattice over every hill — the pale "grid lines" in the
    // open-map complaint. Break each rim into jittered segments so it reads as
    // a contour of the slope instead of the boundary of a cell.
    const hh4=hash2(x*67,y*89);
    const wav=(x1,y1,x2,y2)=>{
      const N=4;
      tctx.moveTo(x1,y1);
      for(let s=1;s<=N;s++){
        const t=s/N, jx=x1+(x2-x1)*t, jy=y1+(y2-y1)*t;
        const o=s===N?0:((((hh4>>>(s*4))%11)-5)*.55);
        tctx.lineTo(jx+(y2-y1?o:0),jy+(x2-x1?o:0));
      }
    };
    tctx.lineWidth=2.4;
    tctx.strokeStyle='rgba(240,248,205,.19)';
    tctx.beginPath();
    if(!e(x,y-1))wav(x*TILE,y*TILE+1,x*TILE+TILE,y*TILE+1);
    if(!e(x-1,y))wav(x*TILE+1,y*TILE,x*TILE+1,y*TILE+TILE);
    tctx.stroke();
    tctx.strokeStyle='rgba(22,34,12,.21)';
    tctx.beginPath();
    if(!e(x,y+1))wav(x*TILE,y*TILE+TILE-1,x*TILE+TILE,y*TILE+TILE-1);
    if(!e(x+1,y))wav(x*TILE+TILE-1,y*TILE,x*TILE+TILE-1,y*TILE+TILE);
    tctx.stroke();
  }
  G.waterList=Object.keys(G.water).map(k=>{
    const[x,y]=k.split(',').map(Number);
    // e marks a shore tile — the animated foam laps only where water meets land
    const e=(!G.water[(x+1)+','+y]&&!G.ford[(x+1)+','+y])||(!G.water[(x-1)+','+y]&&!G.ford[(x-1)+','+y])
          ||(!G.water[x+','+(y+1)]&&!G.ford[x+','+(y+1)])||(!G.water[x+','+(y-1)]&&!G.ford[x+','+(y-1)])?1:0;
    return{x,y,h:hash2(x,y)%20,e};});
  // river banks: dry sand over wet sand, dithered into the grass, with reeds
  const isLand=(x,y)=>{const kk=x+','+y;return !G.water[kk]&&!G.ford[kk];};
  for(const k in G.water){
    const[wx,wy]=k.split(',').map(Number);
    for(const[dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=wx+dx,ny=wy+dy,nk=nx+','+ny;
      if(nx<0||ny<0||nx>=MAP||ny>=MAP)continue;
      if(G.water[nk]||G.ford[nk])continue;
      if(G.res[nk]&&G.res[nk].type==='wood')continue; // deep forest meets water directly
      const bx=nx*TILE,by=ny*TILE;
      const strip=(w1,c)=>{tctx.fillStyle=c;
        if(dx===1)tctx.fillRect(bx,by,w1,TILE);
        else if(dx===-1)tctx.fillRect(bx+TILE-w1,by,w1,TILE);
        else if(dy===1)tctx.fillRect(bx,by,TILE,w1);
        else tctx.fillRect(bx,by+TILE-w1,TILE,w1);};
      strip(8,'#c9b078');strip(4,'#ab9165');
      const hh=hash2(nx*13,ny*7);
      // sand speckles fading into the grass
      tctx.fillStyle='rgba(201,176,120,.6)';
      for(let s3=0;s3<5;s3++){
        const t3=(s3+.5)/5*TILE+((hh>>s3)%5)-2, j=9+((hh>>(s3*2))%7);
        let sx3,sy3;
        if(dx===1){sx3=bx+j;sy3=by+t3;}
        else if(dx===-1){sx3=bx+TILE-j-2;sy3=by+t3;}
        else if(dy===1){sx3=bx+t3;sy3=by+j;}
        else{sx3=bx+t3;sy3=by+TILE-j-2;}
        tctx.fillRect(sx3,sy3,2.2,2.2);
      }
      // reed clumps with cattails on some bank tiles
      if(hh%4===0){
        const rx3=dx===1?bx+9:dx===-1?bx+TILE-9:bx+6+(hh%12);
        const ry3=dy===1?by+9:dy===-1?by+TILE-9:by+6+(hh%12);
        tctx.strokeStyle='#3f6a2e';tctx.lineWidth=1;
        tctx.beginPath();
        tctx.moveTo(rx3-2,ry3+4);tctx.lineTo(rx3-3.4,ry3-5);
        tctx.moveTo(rx3,ry3+4);tctx.lineTo(rx3,ry3-7.5);
        tctx.moveTo(rx3+2,ry3+4);tctx.lineTo(rx3+3.4,ry3-4);
        tctx.stroke();
        tctx.fillStyle='#6b4a2a';
        tctx.fillRect(rx3-.8,ry3-9,1.6,3.2);
      }
    }
  }
  // water: depth-graded, with submerged stones, deep-water blobs and bank foam
  const SHAL=[96,172,214],DEEP=[43,116,166];
  // Continuous 0..1 shelf: 0 = touching the shore, 1 = open water. This is the
  // EUCLIDEAN distance to the nearest land tile, deliberately not an integer
  // ring count — integer rings drew concentric diamond bands and every small
  // pond came out as a bullseye. Off-map counts as land, so the board edge
  // shelves like a coast instead of a cliff.
  const wdep=(x,y)=>{
    let best=9;
    for(let dy2=-3;dy2<=3;dy2++)for(let dx2=-3;dx2<=3;dx2++){
      if(!isLand(x+dx2,y+dy2))continue;
      const d=Math.sqrt(dx2*dx2+dy2*dy2);
      if(d<best)best=d;
    }
    return Math.max(0,Math.min(1,(best-1)/2.2));
  };
  const wdepArr=new Float32Array(MAP*MAP);
  for(const k in G.water){const[x,y]=k.split(',').map(Number);wdepArr[y*MAP+x]=wdep(x,y);}
  // Depth at a tile CORNER = mean of the four tiles meeting there. Sampling at
  // corners and bilinearly interpolating across the tile is what stops open
  // water reading as a mosaic of flat diamonds — one colour per tile always
  // will, however smooth the underlying field is.
  const cdep=(cx,cy)=>{let s=0,n=0;
    for(const[ox,oy] of [[-1,-1],[0,-1],[-1,0],[0,0]]){
      const x=cx+ox,y=cy+oy;
      if(x<0||y<0||x>=MAP||y>=MAP)continue;
      s+=wdepArr[y*MAP+x];n++;}
    return n?s/n:0;};
  const WSUB=6,WSS=TILE/WSUB;
  for(const k in G.water){
    const[wx,wy]=k.split(',').map(Number);
    const px=wx*TILE,py=wy*TILE,h=hash2(wx*11,wy*7);
    const edge=isLand(wx,wy-1)||isLand(wx,wy+1)||isLand(wx-1,wy)||isLand(wx+1,wy);
    /* Bright azure with pale turquoise shallows.
       TWO things made open water read as a grid and both are fixed here:
       (1) a per-tile VERTICAL GRADIENT that restarted at every tile boundary —
           invisible at the old dark values, a hard checkerboard once brightened;
       (2) shallow-vs-deep as a per-tile BOOLEAN, which ringed every shore with a
           row of lighter diamonds.
       So: depth is a distance-to-shore ramp (0..3) lerped smoothly, plus a
       low-frequency wobble in world space. Don't reintroduce either a per-tile
       gradient or a boolean shallow test. */
    const t4=wdepArr[wy*MAP+wx];
    const d00=cdep(wx,wy),d10=cdep(wx+1,wy),d01=cdep(wx,wy+1),d11=cdep(wx+1,wy+1);
    for(let sy=0;sy<WSUB;sy++)for(let sx=0;sx<WSUB;sx++){
      const u=(sx+.5)/WSUB,v=(sy+.5)/WSUB;
      const d=d00*(1-u)*(1-v)+d10*u*(1-v)+d01*(1-u)*v+d11*u*v;
      const gx=wx+u,gy=wy+v;
      const wob=(Math.sin(gx*.37)+Math.sin(gy*.29)+Math.sin((gx+gy)*.19))/3*9;
      tctx.fillStyle='rgb('+((SHAL[0]+(DEEP[0]-SHAL[0])*d+wob)|0)+','
                           +((SHAL[1]+(DEEP[1]-SHAL[1])*d+wob)|0)+','
                           +((SHAL[2]+(DEEP[2]-SHAL[2])*d+wob)|0)+')';
      // half-pixel overfill so the sub-cells leave no seams of their own
      tctx.fillRect(px+sx*WSS-.5,py+sy*WSS-.5,WSS+1,WSS+1);
    }
    // depth mottling at a scale LARGER than one tile, so the eye can never
    // pick out an individual cell in open water
    // alpha RAMPS with depth — a hard threshold here drew a tile-aligned dark
    // block across the middle of every pond, which is the artefact this whole
    // pass exists to remove
    if(t4>0){
      tctx.fillStyle='rgba(18,58,94,'+(.085*t4).toFixed(3)+')';
      tctx.beginPath();tctx.ellipse(px+13+((h>>>3)%18)-9,py+13+((h>>>7)%18)-9,
        17+((h>>>11)%10),12+((h>>>13)%8),0,0,7);tctx.fill();
      if(h%5===0){
        tctx.fillStyle='rgba(150,205,230,'+(.07*t4).toFixed(3)+')';
        tctx.beginPath();tctx.ellipse(px+13+((h>>>5)%16)-8,py+13+((h>>>9)%16)-8,
          15+((h>>>15)%9),11+((h>>>17)%7),0,0,7);tctx.fill();
      }
    }
    // baked wave glints, two rows
    const oy2=4+(h%14);
    tctx.strokeStyle='rgba(190,220,235,.32)';tctx.lineWidth=1.1;
    tctx.beginPath();tctx.moveTo(px+3+(h%6),py+oy2);
    tctx.quadraticCurveTo(px+12,py+oy2-2,px+21,py+oy2);tctx.stroke();
    tctx.strokeStyle='rgba(190,220,235,.15)';
    tctx.beginPath();tctx.moveTo(px+5+(h%5),py+((oy2+9)%24));
    tctx.quadraticCurveTo(px+13,py+((oy2+7)%24),px+20,py+((oy2+9)%24));tctx.stroke();
    // pale stones visible through the shallows
    if(edge&&h%3===0){
      tctx.fillStyle='rgba(165,175,168,.4)';
      tctx.beginPath();tctx.ellipse(px+8+(h%10),py+16+(h%5),2.4,1.6,.3,0,7);tctx.fill();
      tctx.beginPath();tctx.ellipse(px+16-(h%7),py+7+(h%6),1.8,1.2,0,0,7);tctx.fill();
    }
    // foam where the water laps the bank
    tctx.strokeStyle='rgba(228,242,246,.45)';tctx.lineWidth=1.5;
    const foam=(x1,y1,x2,y2)=>{tctx.beginPath();tctx.moveTo(x1,y1);tctx.lineTo(x2,y2);tctx.stroke();};
    if(isLand(wx,wy-1))foam(px+1,py+1.4,px+TILE-1,py+1.4);
    if(isLand(wx,wy+1))foam(px+1,py+TILE-1.4,px+TILE-1,py+TILE-1.4);
    if(isLand(wx-1,wy))foam(px+1.4,py+1,px+1.4,py+TILE-1);
    if(isLand(wx+1,wy))foam(px+TILE-1.4,py+1,px+TILE-1.4,py+TILE-1);
  }
  /* ── organic shoreline ────────────────────────────────────────────────
     Water is filled per TILE and the sand was a constant-width strip along the
     tile edge, so every coast read as a 26px diamond staircase — the single
     biggest reason the world looked like a grid rather than an open map.
     Walk each water/land boundary and stamp jittered lobes BOTH ways across it
     so the waterline wanders over the tile edge. Purely cosmetic: G.water is
     still the only authority on what floats and what walks, so pathing,
     dock placement and naval routing are untouched. Runs AFTER the water pass
     (it has to paint into water tiles as well as land ones). */
  for(const k in G.water){
    const[wx,wy]=k.split(',').map(Number);
    for(const[dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=wx+dx,ny=wy+dy,nk=nx+','+ny;
      if(nx<0||ny<0||nx>=MAP||ny>=MAP)continue;
      if(G.water[nk]||G.ford[nk])continue;
      const h=hash2(nx*53+wx*7,ny*97+wy*3);
      // shared edge endpoints; (dx,dy) is already the unit normal into the land
      let ax,ay,bx2,by2;
      if(dx===1){ax=nx*TILE;ay=ny*TILE;bx2=nx*TILE;by2=ny*TILE+TILE;}
      else if(dx===-1){ax=nx*TILE+TILE;ay=ny*TILE;bx2=nx*TILE+TILE;by2=ny*TILE+TILE;}
      else if(dy===1){ax=nx*TILE;ay=ny*TILE;bx2=nx*TILE+TILE;by2=ny*TILE;}
      else{ax=nx*TILE;ay=ny*TILE+TILE;bx2=nx*TILE+TILE;by2=ny*TILE+TILE;}
      // Lobes are flattened ALONG the shore (rx across the beach is small, ry
      // along it is large) — round ones read as a row of cotton-wool bubbles.
      const lob=(cx,cy,across,along,c)=>{tctx.fillStyle=c;
        tctx.beginPath();
        tctx.ellipse(cx,cy,dy?along:across,dy?across:along,0,0,7);tctx.fill();};
      for(let s=0;s<9;s++){
        const t=(s+.5)/9;
        const ex=ax+(bx2-ax)*t,ey=ay+(by2-ay)*t;
        const j=(((h>>>(s*3))%11)-5)*.6;           // slide along the edge
        const sx4=dy?j:0, sy4=dx?j:0;
        // water pushes irregularly into the land tile
        if(((h>>>(s*2))&3)!==0){
          const d1=1+((h>>>(s*3+2))%4);
          lob(ex+dx*d1+sx4,ey+dy*d1+sy4,3.1+((h>>>s)%3),5.6+((h>>>(s+4))%4),'#5aa8d2');
        }
        // ragged sand further up the beach
        const d2=4+((h>>>(s*3+5))%7);
        lob(ex+dx*d2+sx4*1.1,ey+dy*d2+sy4*1.1,3.4+((h>>>(s+2))%3),6.2+((h>>>(s+6))%5),
            s%3===0?'#ab9165':'#c9b078');
        // a spit of sand eating back out into the water
        if(((h>>>(s*2+1))&3)===0)
          lob(ex-dx*2.6+sx4*.7,ey-dy*2.6+sy4*.7,2.2,3.6,'#c9b078');
      }
      // dither the top of the beach into the grass so it has no hard outer rim
      for(let s=0;s<16;s++){
        const t=((h>>>(s*2))%64)/64;
        const ex=ax+(bx2-ax)*t,ey=ay+(by2-ay)*t;
        const d3=8+((h>>>(s+3))%9);
        tctx.fillStyle=s%2?'rgba(201,176,120,.5)':'rgba(171,145,101,.4)';
        tctx.fillRect(ex+dx*d3-1,ey+dy*d3-1,2.4+((h>>>s)%3),2.2);
      }
    }
  }
  // fords: wet sand shallows with rippling water and stepping stones
  for(const k in G.ford){
    const[fx,fy]=k.split(',').map(Number);
    const px=fx*TILE,py=fy*TILE,h=hash2(fx*5,fy*13);
    const grad=tctx.createLinearGradient(px,py,px,py+TILE);
    grad.addColorStop(0,'#c2a874');grad.addColorStop(.5,'#ac9468');grad.addColorStop(1,'#c2a874');
    tctx.fillStyle=grad;tctx.fillRect(px,py,TILE,TILE);
    tctx.fillStyle='rgba(90,150,180,.3)';
    tctx.fillRect(px,py+3+(h%4),TILE,5);
    tctx.fillRect(px,py+14+(h%5),TILE,4);
    tctx.strokeStyle='rgba(228,242,246,.35)';tctx.lineWidth=1;
    tctx.beginPath();tctx.moveTo(px,py+6+(h%4));
    tctx.quadraticCurveTo(px+13,py+4+(h%4),px+TILE,py+6+(h%4));tctx.stroke();
    // stepping stones with wet sheen
    const st=(sx3,sy3,r1,r2)=>{
      tctx.fillStyle='#8f877a';
      tctx.beginPath();tctx.ellipse(sx3,sy3,r1,r2,.3,0,7);tctx.fill();
      tctx.fillStyle='rgba(255,255,255,.28)';
      tctx.beginPath();tctx.ellipse(sx3-.6,sy3-.7,r1*.55,r2*.5,.3,0,7);tctx.fill();
      tctx.strokeStyle='rgba(40,35,25,.45)';tctx.lineWidth=.7;
      tctx.beginPath();tctx.ellipse(sx3,sy3,r1,r2,.3,0,7);tctx.stroke();};
    st(px+6+(h%6),py+8+(h%8),3,2.2);
    st(px+16+(h%5),py+16-(h%6),2.6,1.9);
    st(px+12,py+4+(h%10),2.2,1.6);
  }
  for(let y=0;y<MAP;y++)for(let x=0;x<MAP;x++){
    if(G.map[y][x]||G.ford[x+','+y])continue;
    const h=hash2(x*3+7,y*5+1)%100;
    const cx=x*TILE+6+(hash2(x,y*7)%14),cy=y*TILE+6+(hash2(x*7,y)%14);
    // doodad bands widened (was 15% of tiles, now ~24%) — bigger boards need
    // denser ground clutter or they read as empty lawn
    if(h<11){ // grass tufts, two-tone so they pop like AoE2's pale tufts
      tctx.strokeStyle='rgba(44,62,28,.55)';tctx.lineWidth=1.1;
      tctx.beginPath();
      tctx.moveTo(cx-2,cy+2);tctx.lineTo(cx-3,cy-3);
      tctx.moveTo(cx,cy+2);tctx.lineTo(cx,cy-4);
      tctx.moveTo(cx+2,cy+2);tctx.lineTo(cx+3,cy-3);tctx.stroke();
      tctx.strokeStyle='rgba(200,215,150,.5)';tctx.lineWidth=1;
      tctx.beginPath();tctx.moveTo(cx-1,cy+1.6);tctx.lineTo(cx-2,cy-2.6);
      tctx.moveTo(cx+1,cy+1.6);tctx.lineTo(cx+1.6,cy-3.2);tctx.stroke();
    }else if(h<15){ // flowers
      const fc=['#e8e0c8','#e5c95c','#d9a0b8'][h%3];
      tctx.fillStyle=fc;
      tctx.beginPath();tctx.arc(cx,cy,1.4,0,7);tctx.fill();
      tctx.beginPath();tctx.arc(cx+4,cy+2,1.2,0,7);tctx.fill();
    }else if(h<18){ // pebbles
      tctx.fillStyle='rgba(130,126,112,.6)';
      tctx.beginPath();tctx.ellipse(cx,cy,2.2,1.5,.4,0,7);tctx.fill();
      tctx.fillStyle='rgba(90,88,78,.5)';
      tctx.beginPath();tctx.ellipse(cx+3,cy+2,1.4,1,0,0,7);tctx.fill();
    }else if(h<21){ // low bush
      tctx.fillStyle='rgba(18,30,12,.4)';
      tctx.beginPath();tctx.ellipse(cx+1.5,cy+2.2,5.5,2.4,0,0,7);tctx.fill();
      tctx.fillStyle='#27441d';
      tctx.beginPath();tctx.arc(cx-2,cy,3.2,0,7);tctx.arc(cx+2.4,cy+.6,2.8,0,7);tctx.arc(cx+.4,cy-2,2.6,0,7);tctx.fill();
      tctx.fillStyle='#3d662c';
      tctx.beginPath();tctx.arc(cx-2.6,cy-1,1.9,0,7);tctx.arc(cx+.2,cy-2.6,1.5,0,7);tctx.fill();
      tctx.fillStyle='#578740';tctx.beginPath();tctx.arc(cx-3,cy-1.6,1,0,7);tctx.fill();
    }else if(h<23){ // rock cluster
      const rock=(rx3,ry3,r1,r2)=>{
        tctx.fillStyle='#7d786a';tctx.beginPath();tctx.ellipse(rx3,ry3,r1,r2,.35,0,7);tctx.fill();
        tctx.fillStyle='#a09a88';tctx.beginPath();tctx.ellipse(rx3-r1*.28,ry3-r2*.32,r1*.55,r2*.5,.35,0,7);tctx.fill();
        tctx.strokeStyle='rgba(30,28,20,.5)';tctx.lineWidth=.8;
        tctx.beginPath();tctx.ellipse(rx3,ry3,r1,r2,.35,0,7);tctx.stroke();};
      tctx.fillStyle='rgba(18,26,10,.3)';
      tctx.beginPath();tctx.ellipse(cx+2,cy+2.5,6.5,2.6,0,0,7);tctx.fill();
      rock(cx,cy,3.6,2.6);rock(cx+4.6,cy+1.6,2.4,1.7);rock(cx-3.4,cy+2,1.8,1.3);
    }else if(h===23&&hash2(x*11,y*23)%3===0){ // fallen log
      tctx.save();tctx.translate(cx,cy);tctx.rotate((hash2(x,y)%314)/100);
      tctx.fillStyle='rgba(18,26,10,.32)';
      tctx.beginPath();tctx.ellipse(1,2.6,10,2.6,0,0,7);tctx.fill();
      tctx.fillStyle='#5a3d20';tctx.fillRect(-9,-2.4,18,4.8);
      tctx.fillStyle='#6d4b28';tctx.fillRect(-9,-2.4,18,1.7);
      tctx.strokeStyle='rgba(30,18,8,.5)';tctx.lineWidth=.7;
      tctx.beginPath();tctx.moveTo(-7,-.4);tctx.lineTo(6,-.2);tctx.moveTo(-5,1);tctx.lineTo(4,1.2);tctx.stroke();
      tctx.fillStyle='#c9a266';tctx.beginPath();tctx.ellipse(9,0,1.6,2.4,0,0,7);tctx.fill();
      tctx.strokeStyle='#8a6a3a';tctx.beginPath();tctx.ellipse(9,0,.8,1.2,0,0,7);tctx.stroke();
      tctx.restore();
    }
  }
  // bleached bones scattered in the dirt fields — signature AoE2 doodad
  for(const[sx,sy,rx] of dirtSpots){
    const rb=mulberry((sx|0)*31+(sy|0)*7);
    tctx.lineCap='round';
    for(let b2=0,nb=1+(rb()*3|0);b2<nb;b2++){
      const bx2=sx+(rb()-.5)*rx,by2=sy+(rb()-.5)*rx*.6;
      if(bx2<2||by2<2||bx2>=MAP*TILE-2||by2>=MAP*TILE-2||wet(bx2,by2))continue;
      if(rb()<.45){ // ribcage + skull, shadow pass first so it sits IN the dirt
        for(const[col,o] of [['rgba(120,106,80,.5)',1],['#d9d0ad',0]]){
          tctx.strokeStyle=col;tctx.lineWidth=o?2.2:1.5;
          tctx.beginPath();
          for(let r3=0;r3<4;r3++){tctx.moveTo(bx2-6+r3*3.6+o*.7,by2+3+o*.7);
            tctx.quadraticCurveTo(bx2-5+r3*3.6+o*.7,by2-3.5+o*.7,bx2-3.6+r3*3.6+o*.7,by2-4.5+o*.7);}
          tctx.moveTo(bx2-8+o*.7,by2+3+o*.7);tctx.lineTo(bx2+7+o*.7,by2+2.2+o*.7);
          tctx.stroke();}
        tctx.fillStyle='#e2dabb';
        tctx.beginPath();tctx.ellipse(bx2+9.5,by2+1,2.6,2,.2,0,7);tctx.fill();
        tctx.fillStyle='#6d5f3f';tctx.fillRect(bx2+8.6,by2+.4,1,1);
      }else{ // scattered long bones
        tctx.strokeStyle='#d9d0ad';tctx.lineWidth=1.5;
        tctx.beginPath();tctx.moveTo(bx2-4,by2);tctx.lineTo(bx2+4,by2-2);
        tctx.moveTo(bx2-1,by2+3.5);tctx.lineTo(bx2+5,by2+4.2);tctx.stroke();
        tctx.fillStyle='#d9d0ad';
        tctx.beginPath();tctx.arc(bx2-4,by2,1.2,0,7);tctx.arc(bx2+4,by2-2,1.2,0,7);
        tctx.arc(bx2-1,by2+3.5,1,0,7);tctx.fill();
      }
    }
    tctx.lineCap='butt';
  }
  miniResDirty=true; // dirtPatches feed the cached minimap layer
}
/* ---------- resource sprites (billboards, y-sorted with units) ---------- */
const RES_SPR={};
function getResSpr(type,h){
  const key=type+'_'+(h%8);
  if(RES_SPR[key])return RES_SPR[key];
  const W=76,Ht=88,ax=W/2,ay=Ht-10;
  const c=document.createElement('canvas');
  c.width=W*TREZ;c.height=Ht*TREZ;
  const g=c.getContext('2d');
  g.setTransform(TREZ,0,0,TREZ,ax*TREZ,ay*TREZ);
  g.lineJoin='round';
  if(type==='fish'){
    // a school breaking the surface: ripple rings + leaping silver fish
    const rnd=mulberry(h*77+5);
    g.strokeStyle='rgba(228,242,246,.5)';g.lineWidth=1;
    g.beginPath();g.ellipse(0,-2,9,3.6,0,0,7);g.stroke();
    g.strokeStyle='rgba(228,242,246,.28)';
    g.beginPath();g.ellipse(0,-2,13,5.2,0,0,7);g.stroke();
    const fishAt=(fx,fy,fs,flip)=>{
      g.save();g.translate(fx,fy);g.scale(flip?-fs:fs,fs);
      g.fillStyle='#b8c8d0';g.strokeStyle='rgba(70,86,96,.7)';g.lineWidth=.5;
      g.beginPath();g.moveTo(-4,0);g.quadraticCurveTo(0,-3.4,4,-.6);
      g.quadraticCurveTo(0,1.6,-4,0);g.closePath();g.fill();g.stroke();
      g.beginPath();g.moveTo(-3.6,-.2);g.lineTo(-6,-2.4);g.lineTo(-5.4,.8);g.closePath();g.fill();
      g.fillStyle='rgba(255,255,255,.5)';
      g.beginPath();g.ellipse(.5,-1.4,2.4,.8,-.3,0,7);g.fill();
      g.fillStyle='#2e3a42';g.beginPath();g.arc(3,-.8,.4,0,7);g.fill();
      g.restore();};
    fishAt(-3+rnd()*2,-6,1,false);
    fishAt(4,-3.4,.8,true);
    if(h%2)fishAt(-6,-1.6,.7,true);
    g.fillStyle='rgba(228,242,246,.5)';
    for(let i=0;i<4;i++){g.beginPath();g.arc(-8+rnd()*16,-1+rnd()*2,.7,0,7);g.fill();}
    const out={c,ox:ax,oy:ay-6,w:W,h:Ht};RES_SPR[key]=out;return out;
  }
  if(type==='meat'){
    // a fallen beast: hide over a low mass, legs folded, a scatter of feathers
    // of grass torn up around it. Deliberately reads flatter than a bush so a
    // kill never looks like forage from across the map.
    const rnd=mulberry(h*3141+7);
    g.fillStyle='rgba(18,26,10,.30)';
    g.beginPath();g.ellipse(1.5,1.5,13,4.4,.1,0,7);g.fill();
    const hide=(h%3===0)?['#6b5442','#83694f','#a08360']    // boar bristle
              :(h%3===1)?['#7d6a4e','#98835f','#b6a077']    // deer
                        :['#8d8375','#a8a094','#c6c0b4'];   // fleece
    g.fillStyle=hide[0];
    g.beginPath();g.ellipse(0,-3,11,5.2,-.06,0,7);g.fill();
    g.fillStyle=hide[1];
    g.beginPath();g.ellipse(-1.5,-4.6,8.4,3.4,-.1,0,7);g.fill();
    g.fillStyle=hide[2];
    g.beginPath();g.ellipse(-3,-5.6,4.6,1.9,-.14,0,7);g.fill();
    // head lolling off the near side, legs stuck out stiff
    g.fillStyle=hide[0];
    g.beginPath();g.ellipse(9.5,-1.6,4,2.6,.35,0,7);g.fill();
    g.strokeStyle=hide[0];g.lineWidth=1.9;g.lineCap='round';
    for(let i=0;i<3;i++){
      const lx=-6+i*5.2,ly=-4.4;
      g.beginPath();g.moveTo(lx,ly);g.lineTo(lx-2.4-rnd()*2,ly-4.6-rnd()*2.4);g.stroke();
    }
    g.strokeStyle='rgba(64,44,26,.5)';g.lineWidth=.6;
    g.beginPath();g.ellipse(0,-3,11,5.2,-.06,0,7);g.stroke();
    // trampled grass around the kill
    g.strokeStyle='rgba(96,86,44,.45)';g.lineWidth=.7;
    for(let i=0;i<7;i++){
      const gx=-13+rnd()*26,gy=-.5+rnd()*2.4;
      g.beginPath();g.moveTo(gx,gy);g.lineTo(gx+(rnd()-.5)*3,gy-2-rnd()*2);g.stroke();
    }
    const out={c,ox:ax,oy:ay-2,w:W,h:Ht};RES_SPR[key]=out;return out;
  }
  if(type==='wood'){
    const rr=10+(h%4)*1.7;
    const dark=(h%8)>=5;
    const rnd=mulberry(h*2654435761+11);
    // long cast shadow to the south-east (sun from the north-west)
    g.fillStyle='rgba(18,26,10,.30)';
    g.beginPath();g.ellipse(rr*.75,1.5,rr*1.45,rr*.4,.14,0,7);g.fill();
    g.fillStyle='rgba(18,26,10,.22)';
    g.beginPath();g.ellipse(0,1.5,rr*.8,rr*.34,0,0,7);g.fill();
    if(h%3===0){ // pine — layered fronds with drooping tips
      // concept-art pass: conifers are saturated deep green, not olive-black
      const pc=dark?['#13290c','#1c3d14','#265219','#336b23','#478a32']
                   :['#173312','#22491a','#2e6021','#3d7c2c','#54993c'];
      // trunk with root flare
      g.fillStyle='#4a3018';
      g.beginPath();g.moveTo(-3.4,1);g.quadraticCurveTo(-1.4,-1.5,-1.5,-8);
      g.lineTo(1.5,-8);g.quadraticCurveTo(1.4,-1.5,3.4,1);g.closePath();g.fill();
      g.fillStyle='#32200f';g.fillRect(.4,-8,1.1,9);
      for(let l=0;l<4;l++){
        const ly=-6-l*7,lw2=rr*(1.3-l*.27),tip=11-l*1.2;
        // frond mass
        g.fillStyle=pc[1];
        g.beginPath();g.moveTo(-lw2,ly);
        g.quadraticCurveTo(-lw2*.5,ly-tip*.55,0,ly-tip);
        g.quadraticCurveTo(lw2*.5,ly-tip*.55,lw2,ly);
        g.quadraticCurveTo(lw2*.6,ly+2,lw2*.2,ly+1);
        g.quadraticCurveTo(0,ly+2.4,-lw2*.2,ly+1);
        g.quadraticCurveTo(-lw2*.6,ly+2,-lw2,ly);g.closePath();g.fill();
        g.strokeStyle='rgba(12,22,8,.45)';g.lineWidth=.8;g.stroke();
        // lit west side of each frond
        g.fillStyle=pc[3];
        g.beginPath();g.moveTo(-lw2,ly);
        g.quadraticCurveTo(-lw2*.5,ly-tip*.55,0,ly-tip);
        g.quadraticCurveTo(-lw2*.25,ly-tip*.35,-lw2*.45,ly+.4);g.closePath();g.fill();
        // needle streaks
        g.strokeStyle='rgba(12,22,8,.3)';g.lineWidth=.6;
        for(let n2=0;n2<4;n2++){const fx=-lw2+lw2*2*(n2+.5)/4;
          g.beginPath();g.moveTo(fx*.4,ly-tip*.55);g.lineTo(fx,ly+1);g.stroke();}
        // snow-bright tip highlight
        g.fillStyle=pc[4];
        g.beginPath();g.arc(-lw2*.28,ly-tip*.5,1.1,0,7);g.fill();
      }
      // crown
      g.fillStyle=pc[3];
      g.beginPath();g.moveTo(-2.6,-27);g.quadraticCurveTo(0,-33.5,2.2,-27);
      g.quadraticCurveTo(0,-28.6,-2.6,-27);g.closePath();g.fill();
      g.strokeStyle='rgba(12,22,8,.4)';g.lineWidth=.7;g.stroke();
    }else{ // broadleaf — clumped, dappled canopy over a real trunk
      // concept-art pass: richer, greener canopy mass
      const oc=dark?['#122a0c','#1d4213','#28581a','#357024','#458830','#589b3e']
                   :['#17330f','#255018','#316a20','#40852b','#529f38','#66b447'];
      // trunk with root flare and a fork
      g.fillStyle='#54381e';
      g.beginPath();g.moveTo(-4,1);g.quadraticCurveTo(-1.8,-2,-2,-9);
      g.quadraticCurveTo(-2.1,-13,-3.4,-15.5);
      g.lineTo(-1.2,-15.5);g.quadraticCurveTo(-.2,-12,1,-14.8);
      g.lineTo(2.8,-14.2);g.quadraticCurveTo(2,-11.5,2,-9);
      g.quadraticCurveTo(1.8,-2,4,1);g.closePath();g.fill();
      g.strokeStyle='rgba(30,18,8,.5)';g.lineWidth=.8;
      g.beginPath();g.moveTo(-4,1);g.quadraticCurveTo(-1.8,-2,-2,-9);g.stroke();
      g.beginPath();g.moveTo(4,1);g.quadraticCurveTo(1.8,-2,2,-9);g.stroke();
      // bark grain
      g.strokeStyle='rgba(35,20,8,.5)';g.lineWidth=.6;
      g.beginPath();g.moveTo(-.6,-1);g.lineTo(-.8,-9);g.moveTo(1,-2);g.lineTo(1.1,-8);g.stroke();
      g.fillStyle='rgba(255,235,200,.14)';g.fillRect(-1.9,-12,1,10);
      // canopy: shadow mass, then leaf clumps in rising tones
      const cy0=-19-rr*.12;
      g.fillStyle=oc[0];
      g.beginPath();g.arc(0,cy0,rr*1.02,0,7);g.fill();
      const clumps=[];
      for(let i2=0;i2<9;i2++){const a2=i2/9*6.283+rnd()*.5;
        clumps.push([Math.cos(a2)*rr*.55,cy0+Math.sin(a2)*rr*.5,rr*(.38+rnd()*.2)]);}
      clumps.push([0,cy0-rr*.3,rr*.55],[0,cy0+rr*.15,rr*.5]);
      for(const[cx2,cy2,cr] of clumps){
        g.fillStyle=oc[1];g.beginPath();g.arc(cx2+.8,cy2+.8,cr,0,7);g.fill();
        g.fillStyle=oc[2];g.beginPath();g.arc(cx2,cy2,cr*.85,0,7);g.fill();
        g.fillStyle=oc[3];g.beginPath();g.arc(cx2-cr*.22,cy2-cr*.25,cr*.6,0,7);g.fill();
      }
      // sunlit crown on the NW + leaf speckles
      g.fillStyle=oc[4];
      for(let i2=0;i2<7;i2++){
        const sx2=-rr*.55+rnd()*rr*.75,sy2=cy0-rr*.25-rnd()*rr*.45;
        g.beginPath();g.arc(sx2,sy2,1.6+rnd()*1.6,0,7);g.fill();}
      g.fillStyle=oc[5];
      for(let i2=0;i2<5;i2++){
        const sx2=-rr*.6+rnd()*rr*.6,sy2=cy0-rr*.35-rnd()*rr*.35;
        g.beginPath();g.arc(sx2,sy2,.9+rnd()*.9,0,7);g.fill();}
      // deep-shade dapples on the SE
      g.fillStyle='rgba(14,26,10,.45)';
      for(let i2=0;i2<4;i2++){
        const sx2=rr*.15+rnd()*rr*.5,sy2=cy0+rnd()*rr*.5;
        g.beginPath();g.arc(sx2,sy2,1.4+rnd()*1.5,0,7);g.fill();}
      // soft canopy outline
      g.strokeStyle='rgba(14,24,9,.4)';g.lineWidth=1;
      g.beginPath();g.arc(0,cy0,rr*1.02,0,7);g.stroke();
    }
  }else if(type==='food'){
    const rnd=mulberry(h*98763+41);
    g.fillStyle='rgba(18,26,10,.28)';
    g.beginPath();g.ellipse(4,1.2,11.5,4,.14,0,7);g.fill();
    // woody stems at the base
    g.strokeStyle='#5f4526';g.lineWidth=1.1;
    g.beginPath();g.moveTo(-2,.5);g.lineTo(-3.5,-4);
    g.moveTo(1,.5);g.lineTo(2,-4.5);
    g.moveTo(-.5,.5);g.lineTo(0,-5);g.stroke();
    // clumped foliage in rising tones
    const bp=['#2c4a24','#3a5e2c','#4a7336','#5d8a44'];
    g.fillStyle=bp[0];
    g.beginPath();g.ellipse(0,-6,11,7.5,0,0,7);g.fill();
    const cl=[[-5,-6,4.5],[4.5,-5.5,4.5],[0,-9.5,5],[-2,-4,4.5],[3,-8.5,3.8],[-6.5,-8.5,3.4]];
    for(const [cx2,cy2,cr] of cl){
      g.fillStyle=bp[1];g.beginPath();g.arc(cx2+.7,cy2+.7,cr,0,7);g.fill();
      g.fillStyle=bp[2];g.beginPath();g.arc(cx2,cy2,cr*.8,0,7);g.fill();
      g.fillStyle=bp[3];g.beginPath();g.arc(cx2-cr*.25,cy2-cr*.28,cr*.5,0,7);g.fill();
    }
    // shade dapples
    g.fillStyle='rgba(14,26,10,.4)';
    for(let i=0;i<4;i++){g.beginPath();g.arc(2+rnd()*6,-4+rnd()*3,1.4+rnd(),0,7);g.fill();}
    // berry clusters, each berry shaded with a bright eye
    for(let c2=0;c2<4;c2++){
      const bx=-6+rnd()*12, by=-10+rnd()*7;
      for(let b2=0;b2<3;b2++){
        const px2=bx+Math.cos(b2*2.1)*1.8, py2=by+Math.sin(b2*2.1)*1.6;
        g.fillStyle='#8f1f1f';g.beginPath();g.arc(px2+.4,py2+.4,1.9,0,7);g.fill();
        g.fillStyle='#c0392b';g.beginPath();g.arc(px2,py2,1.7,0,7);g.fill();
        g.fillStyle='#ef9a8d';g.beginPath();g.arc(px2-.6,py2-.6,.7,0,7);g.fill();
      }
    }
    g.strokeStyle='rgba(15,25,10,.35)';g.lineWidth=1;
    g.beginPath();g.ellipse(0,-6,11,7.5,0,0,7);g.stroke();
  }else{ // gold — angular crags with veins and glinting nuggets
    g.fillStyle='rgba(18,26,10,.28)';
    g.beginPath();g.ellipse(5,1.2,12.5,4,.14,0,7);g.fill();
    // scattered debris at the base
    g.fillStyle='#6f675c';
    g.beginPath();g.ellipse(-10.5,-.2,2.2,1.3,.3,0,7);g.fill();
    g.beginPath();g.ellipse(10.5,.4,1.8,1.1,0,0,7);g.fill();
    const crag=(cx2,base,w2,ht)=>{
      const tx2=cx2+w2*.15,ty=base-ht;
      g.fillStyle='#a29a8d'; // sunlit west face
      g.beginPath();g.moveTo(cx2-w2/2,base);g.lineTo(tx2,ty);g.lineTo(cx2-w2*.05,base);g.closePath();g.fill();
      g.fillStyle='#655d52'; // shaded east face
      g.beginPath();g.moveTo(cx2+w2/2,base);g.lineTo(tx2,ty);g.lineTo(cx2-w2*.05,base);g.closePath();g.fill();
      g.strokeStyle='rgba(25,20,12,.5)';g.lineWidth=.9;
      g.beginPath();g.moveTo(cx2-w2/2,base);g.lineTo(tx2,ty);g.lineTo(cx2+w2/2,base);g.stroke();
      g.strokeStyle='rgba(255,250,235,.3)';g.lineWidth=.8;
      g.beginPath();g.moveTo(cx2-w2/2+1,base-1);g.lineTo(tx2,ty+1);g.stroke();
    };
    crag(-6,1,10,11);
    crag(6.5,1,9,9);
    crag(0,1,13,18);
    // gold veins running through the cracks
    g.strokeStyle='#c9a227';g.lineWidth=1.2;
    g.beginPath();g.moveTo(-1.5,-14);g.lineTo(-3.5,-8);g.lineTo(-2,-3);
    g.moveTo(2.5,-11);g.lineTo(4,-6);g.stroke();
    // nugget clusters, each with facet shading and a glint
    const nug=(nx,ny,r)=>{
      g.fillStyle='#a87e1c';g.beginPath();g.arc(nx+.5,ny+.5,r,0,7);g.fill();
      g.fillStyle='#e3b23c';g.beginPath();g.arc(nx,ny,r*.9,0,7);g.fill();
      g.fillStyle='#f5da7a';g.beginPath();g.arc(nx-r*.3,ny-r*.3,r*.45,0,7);g.fill();
      g.fillStyle='#fff7d6';g.fillRect(nx-r*.15,ny-r*.55,.9,.9);
    };
    nug(-5,-4,2.2);nug(-3,-9,1.8);nug(1.5,-5.5,2.4);
    nug(4.5,-8.5,1.6);nug(6,-3,2);nug(-.5,-13.5,1.7);
    // star sparkle
    g.strokeStyle='rgba(255,250,220,.9)';g.lineWidth=.8;
    g.beginPath();g.moveTo(-8,-13);g.lineTo(-8,-10);
    g.moveTo(-9.5,-11.5);g.lineTo(-6.5,-11.5);g.stroke();
  }
  spriteGrain(c,h*53+key.length*911,.8); // trees/gold/berries get the dither too
  const sp={c,ox:ax,oy:ay,w:W,h:Ht};
  RES_SPR[key]=sp;return sp;
}
function clampCam(){
  /* The 2D bounds below are an axis-aligned box in ISO screen space, which is
     only the right shape when the camera points the way it always used to.
     Under rotation the correct constraint is on the orbit TARGET, in tiles. */
  if(use3D){
    const t=R3.target(),m=4;
    const nx=Math.max(-m,Math.min(MAP+m,t.x)),ny=Math.max(-m,Math.min(MAP+m,t.y));
    if(nx!==t.x||ny!==t.y)camTo(nx,ny);   // camTo, not centerOn — no recursion
    return;
  }
  const z=G.cam.z,m=50;
  const minX=-MAP*IW-m,maxX=MAP*IW+m-vw/z;
  const minY=-m,maxY=MAP*2*IH+m-vh/z;
  G.cam.x=maxX<minX?-(vw/z)/2:Math.max(minX,Math.min(maxX,G.cam.x));
  G.cam.y=maxY<minY?(MAP*2*IH-vh/z)/2:Math.max(minY,Math.min(maxY,G.cam.y));
}
/* ---------- building sprites ---------- */
const SPR={};
const SP_PX=10,SP_PT=46,SP_PB=8;
function mkSpr(s,fn){
  const c=document.createElement('canvas');
  c.width=(s+SP_PX*2)*TREZ;c.height=(s+SP_PT+SP_PB)*TREZ;
  const g=c.getContext('2d');
  g.setTransform(TREZ,0,0,TREZ,SP_PX*TREZ,SP_PT*TREZ);
  g.lineJoin='round';fn(g,s);
  return{c,ox:SP_PX,oy:SP_PT,w:s+SP_PX*2,h:s+SP_PT+SP_PB};
}
function groundPatch(g,s){
  g.fillStyle='rgba(122,98,58,.4)';
  g.beginPath();g.ellipse(s/2,s*.7,s*.6,s*.33,0,0,7);g.fill();
}
function stoneTex(g,x,y,w,h){
  g.strokeStyle='rgba(0,0,0,.1)';g.lineWidth=1;
  for(let yy=y+6;yy<y+h;yy+=7){g.beginPath();g.moveTo(x,yy);g.lineTo(x+w,yy);g.stroke();}
  for(let yy=y+6,row=0;yy<y+h;yy+=7,row++)
    for(let xx=x+(row%2?4:9);xx<x+w;xx+=10){
      g.beginPath();g.moveTo(xx,yy-7);g.lineTo(xx,yy);g.stroke();}
}
function pennant(g,x,y,team,len){
  g.strokeStyle='#4a3a24';g.lineWidth=1.4;
  g.beginPath();g.moveTo(x,y);g.lineTo(x,y+len);g.stroke();
  g.fillStyle=TEAMS[team].main;
  g.beginPath();g.moveTo(x,y);g.lineTo(x+9,y+2.6);g.lineTo(x,y+5.2);g.closePath();g.fill();
  g.strokeStyle=TEAMS[team].dark;g.lineWidth=.8;g.stroke();
}
function getBldSpr(type,p,built){
  const key=type+'_'+p+'_'+(built?1:0);
  if(SPR[key])return SPR[key];
  const s=BLDS[type].size*TILE;
  let sp;
  if(!built){
    sp=mkSpr(s,(g,s)=>{
      groundPatch(g,s);
      g.fillStyle='#8a6f47';
      g.fillRect(2,2,s-4,s-4);
      g.strokeStyle='rgba(0,0,0,.15)';g.strokeRect(2,2,s-4,s-4);
      g.fillStyle='#6b4a2a';
      for(const[cx,cy] of [[4,4],[s-7,4],[4,s-10],[s-7,s-10]])
        g.fillRect(cx,cy-6,3,12);
      g.strokeStyle='#6b4a2a';g.lineWidth=2;
      g.beginPath();g.moveTo(5,-1);g.lineTo(s-5,-1);g.stroke();
      g.fillStyle='#caa66b';
      g.fillRect(s*.3,s*.55,s*.4,3);g.fillRect(s*.34,s*.55-4,s*.32,3);
    });
  }else sp=mkSpr(s,(g,sz)=>drawBldArt[type](g,sz,p));
  SPR[key]=sp;return sp;
}
const drawBldArt={
  tc(g,s,p){
    groundPatch(g,s);
    // stone lower hall
    g.fillStyle='#a29a8d';g.fillRect(0,s*.30,s,s*.70);
    stoneTex(g,0,s*.30,s,s*.70);
    g.fillStyle='rgba(0,0,0,.14)';g.fillRect(0,s*.88,s,s*.12);
    g.fillStyle='rgba(255,255,255,.12)';g.fillRect(0,s*.30,3,s*.70);
    // timber upper band
    g.fillStyle='#e9dcba';g.fillRect(s*.04,s*.10,s*.92,s*.24);
    g.strokeStyle='#5f4526';g.lineWidth=2;
    g.strokeRect(s*.04,s*.10,s*.92,s*.24);
    g.beginPath();
    g.moveTo(s*.2,s*.10);g.lineTo(s*.2,s*.34);
    g.moveTo(s*.5,s*.10);g.lineTo(s*.5,s*.34);
    g.moveTo(s*.8,s*.10);g.lineTo(s*.8,s*.34);
    g.moveTo(s*.2,s*.10);g.lineTo(s*.5,s*.34);g.moveTo(s*.5,s*.10);g.lineTo(s*.8,s*.34);
    g.stroke();
    // gabled roof
    g.fillStyle='#a8523a';
    g.beginPath();g.moveTo(-4,s*.14);g.lineTo(s/2,-s*.30);g.lineTo(s+4,s*.14);g.closePath();g.fill();
    g.fillStyle='rgba(0,0,0,.18)';
    g.beginPath();g.moveTo(s/2,-s*.30);g.lineTo(s+4,s*.14);g.lineTo(s*.62,s*.14);g.closePath();g.fill();
    g.strokeStyle='rgba(0,0,0,.15)';g.lineWidth=1.2;
    for(let i=1;i<4;i++){const f=i/4;
      g.beginPath();g.moveTo(-4+f*(s/2+4),s*.14-f*s*.44);
      g.lineTo(s+4-f*(s/2+4),s*.14-f*s*.44);g.stroke();}
    g.strokeStyle='#c9764f';g.lineWidth=2;
    g.beginPath();g.moveTo(s*.16,-s*.02);g.lineTo(s/2,-s*.30);g.lineTo(s*.84,-s*.02);g.stroke();
    // door + windows
    g.fillStyle='#33241466';g.fillStyle='#332414';
    g.beginPath();g.moveTo(s*.42,s);g.lineTo(s*.42,s*.72);
    g.arc(s*.5,s*.72,s*.08,Math.PI,0);g.lineTo(s*.58,s);g.closePath();g.fill();
    g.strokeStyle='#6b5330';g.lineWidth=1.5;g.stroke();
    g.fillStyle='#332414';
    g.fillRect(s*.14,s*.44,s*.1,s*.14);g.fillRect(s*.76,s*.44,s*.1,s*.14);
    g.fillStyle='rgba(255,240,190,.25)';
    g.fillRect(s*.14,s*.44,s*.1,s*.05);g.fillRect(s*.76,s*.44,s*.1,s*.05);
    pennant(g,s*.5,-s*.30-13,p,13);
  },
  house(g,s,p){
    groundPatch(g,s);
    g.fillStyle='#e9dcba';g.fillRect(1,s*.30,s-2,s*.70);
    g.strokeStyle='#5f4526';g.lineWidth=1.6;
    g.strokeRect(1,s*.30,s-2,s*.70);
    g.beginPath();g.moveTo(1,s*.30);g.lineTo(s-1,s);g.moveTo(s-1,s*.30);g.lineTo(1,s);g.stroke();
    g.fillStyle='#c8a75f';
    g.beginPath();g.moveTo(-3,s*.36);g.lineTo(s/2,-s*.26);g.lineTo(s+3,s*.36);g.closePath();g.fill();
    g.strokeStyle='rgba(90,66,30,.4)';g.lineWidth=1;
    for(let i=0;i<5;i++){const fx=.14+i*.18;
      g.beginPath();g.moveTo(s*fx,s*.36-Math.min(s*fx,s*(1-fx))*.9);
      g.lineTo(s*fx-2,s*.36);g.stroke();}
    g.strokeStyle='#a3853f';g.lineWidth=2;
    g.beginPath();g.moveTo(-3,s*.36);g.lineTo(s/2,-s*.26);g.lineTo(s+3,s*.36);g.stroke();
    g.fillStyle='#332414';g.fillRect(s*.38,s*.62,s*.24,s*.38);
    g.fillStyle=TEAMS[p].main;g.fillRect(s*.38,s*.52,s*.24,s*.08);
  },
  barracks(g,s,p){
    groundPatch(g,s);
    g.fillStyle='#948c7e';g.fillRect(0,-s*.04,s,s*1.04);
    stoneTex(g,0,-s*.04,s,s*1.04);
    g.fillStyle='#7e7668';
    for(let x=-2;x<s+2;x+=s*.125)g.fillRect(x,-s*.14,s*.07,s*.1);
    g.fillStyle='rgba(0,0,0,.16)';g.fillRect(0,-s*.05,s,s*.05);
    g.fillStyle='rgba(255,255,255,.1)';g.fillRect(0,-s*.04,3,s*1.04);
    g.fillStyle='rgba(0,0,0,.16)';g.fillRect(0,s*.9,s,s*.1);
    g.fillStyle='#2c2013';
    g.beginPath();g.moveTo(s*.38,s);g.lineTo(s*.38,s*.62);
    g.arc(s*.5,s*.62,s*.12,Math.PI,0);g.lineTo(s*.62,s);g.closePath();g.fill();
    g.strokeStyle='#b9bec4';g.lineWidth=1;
    for(let x=s*.42;x<s*.62;x+=s*.05){g.beginPath();g.moveTo(x,s*.56);g.lineTo(x,s);g.stroke();}
    // team kite shield above gate
    g.fillStyle=TEAMS[p].main;
    g.beginPath();g.moveTo(s*.5-5,s*.3);g.lineTo(s*.5+5,s*.3);
    g.quadraticCurveTo(s*.5+5,s*.44,s*.5,s*.5);
    g.quadraticCurveTo(s*.5-5,s*.44,s*.5-5,s*.3);g.closePath();g.fill();
    g.strokeStyle=TEAMS[p].trim;g.lineWidth=1.2;g.stroke();
    g.fillStyle='#332414';
    g.fillRect(s*.12,s*.34,s*.07,s*.16);g.fillRect(s*.81,s*.34,s*.07,s*.16);
  },
  range(g,s,p){
    groundPatch(g,s);
    g.fillStyle='#9d7440';g.fillRect(0,s*.18,s,s*.82);
    g.strokeStyle='rgba(0,0,0,.14)';g.lineWidth=1;
    for(let y=s*.3;y<s;y+=6){g.beginPath();g.moveTo(0,y);g.lineTo(s,y);g.stroke();}
    g.fillStyle='#7a5a30';
    g.beginPath();g.moveTo(-3,s*.26);g.lineTo(-3,s*.16);g.lineTo(s+3,-s*.02);g.lineTo(s+3,s*.08);g.closePath();g.fill();
    g.strokeStyle='#93744a';g.lineWidth=1.6;
    g.beginPath();g.moveTo(-3,s*.16);g.lineTo(s+3,-s*.02);g.stroke();
    // archery target
    g.fillStyle='#e8e0c8';g.beginPath();g.arc(s*.74,s*.55,s*.13,0,7);g.fill();
    g.fillStyle='#b03a30';g.beginPath();g.arc(s*.74,s*.55,s*.085,0,7);g.fill();
    g.fillStyle='#e8e0c8';g.beginPath();g.arc(s*.74,s*.55,s*.045,0,7);g.fill();
    g.fillStyle='#332414';g.beginPath();g.arc(s*.74,s*.55,s*.018,0,7);g.fill();
    g.strokeStyle='#4a3a24';g.lineWidth=1.4;
    g.beginPath();g.moveTo(s*.74-4,s*.55+2);g.lineTo(s*.74+6,s*.55-3);g.stroke();
    g.fillStyle='#332414';g.fillRect(s*.16,s*.6,s*.18,s*.4);
    g.fillStyle=TEAMS[p].main;g.fillRect(0,s*.18,s,s*.05);
  },
  stable(g,s,p){
    groundPatch(g,s);
    g.fillStyle='#8f5f3a';g.fillRect(0,s*.24,s,s*.76);
    g.strokeStyle='rgba(0,0,0,.14)';g.lineWidth=1;
    for(let x=6;x<s;x+=7){g.beginPath();g.moveTo(x,s*.24);g.lineTo(x,s);g.stroke();}
    g.fillStyle='#6e4c28';
    g.beginPath();g.moveTo(-4,s*.32);g.lineTo(s*.16,-s*.12);g.lineTo(s*.84,-s*.12);g.lineTo(s+4,s*.32);g.closePath();g.fill();
    g.fillStyle='rgba(0,0,0,.15)';
    g.beginPath();g.moveTo(s*.84,-s*.12);g.lineTo(s+4,s*.32);g.lineTo(s*.6,s*.32);g.closePath();g.fill();
    g.strokeStyle='#8a6538';g.lineWidth=1.8;
    g.beginPath();g.moveTo(s*.16,-s*.12);g.lineTo(s*.84,-s*.12);g.stroke();
    g.fillStyle='#2c2013';
    g.beginPath();g.moveTo(s*.32,s);g.lineTo(s*.32,s*.58);
    g.arc(s*.5,s*.58,s*.18,Math.PI,0);g.lineTo(s*.68,s);g.closePath();g.fill();
    g.strokeStyle='#6b5330';g.lineWidth=1.4;
    g.beginPath();g.moveTo(s*.5,s*.42);g.lineTo(s*.5,s);g.stroke();
    g.fillStyle='#d9b45a';
    g.beginPath();g.ellipse(s*.85,s*.9,s*.12,s*.09,0,0,7);g.fill();
    g.strokeStyle='#b8933e';g.lineWidth=1;
    g.beginPath();g.moveTo(s*.78,s*.88);g.lineTo(s*.92,s*.84);g.moveTo(s*.79,s*.93);g.lineTo(s*.91,s*.9);g.stroke();
    g.fillStyle=TEAMS[p].main;g.fillRect(0,s*.24,s,s*.045);
  },
  tower(g,s,p){
    groundPatch(g,s);
    g.fillStyle='#9a9285';
    g.beginPath();g.moveTo(1,s);g.lineTo(3.5,-s*.95);g.lineTo(s-3.5,-s*.95);g.lineTo(s-1,s);g.closePath();g.fill();
    stoneTex(g,2,-s*.95,s-4,s*1.9);
    g.fillStyle='rgba(255,255,255,.12)';
    g.beginPath();g.moveTo(1,s);g.lineTo(3.5,-s*.95);g.lineTo(7,-s*.95);g.lineTo(5,s);g.closePath();g.fill();
    g.fillStyle='rgba(0,0,0,.16)';
    g.beginPath();g.moveTo(s-1,s);g.lineTo(s-3.5,-s*.95);g.lineTo(s-7,-s*.95);g.lineTo(s-5,s);g.closePath();g.fill();
    g.fillStyle='#847c6f';g.fillRect(0,-s*1.02,s,s*.1);
    g.fillStyle='#7e7668';
    for(let x=0;x<s;x+=s*.24)g.fillRect(x,-s*1.16,s*.13,s*.15);
    g.fillStyle='#332414';g.fillRect(s*.44,-s*.5,s*.12,s*.3);
    g.fillStyle='rgba(0,0,0,.2)';g.fillRect(1,s*.85,s-2,s*.15);
    pennant(g,s*.5,-s*1.16-11,p,11);
  },
  farm(g,s,p){
    g.fillStyle='#8a6a41';
    g.fillRect(.5,.5,s-1,s-1);
    g.strokeStyle='#6d5231';g.lineWidth=1.6;
    for(let i=1;i<5;i++){g.beginPath();g.moveTo(2,i*s/5);g.lineTo(s-2,i*s/5);g.stroke();}
    g.fillStyle='#6d8f3e';
    for(let row=0;row<5;row++)for(let i=0;i<4;i++){
      const gx=4+i*(s-8)/3+((row*7+i*3)%3),gy=row*s/5+s*.08;
      g.fillRect(gx,gy,1.6,2.6);}
    g.strokeStyle='#b09468';g.lineWidth=1.2;
    g.strokeRect(.5,.5,s-1,s-1);
  },
  camp(g,s,p){
    groundPatch(g,s);
    g.fillStyle='#8a6538';
    for(let i=0;i<4;i++){
      g.fillStyle=i%2?'#8a6538':'#7a5830';
      g.fillRect(0,s*.34+i*s*.165,s,s*.15);
      g.fillStyle='#5f4526';
      g.beginPath();g.arc(1.5,s*.41+i*s*.165,s*.07,0,7);g.fill();
      g.beginPath();g.arc(s-1.5,s*.41+i*s*.165,s*.07,0,7);g.fill();
    }
    g.fillStyle='#a3743f';
    g.beginPath();g.moveTo(-2,s*.38);g.lineTo(s*.5,s*.02);g.lineTo(s+2,s*.38);g.closePath();g.fill();
    g.strokeStyle='rgba(0,0,0,.18)';g.lineWidth=1;
    g.beginPath();g.moveTo(-2,s*.38);g.lineTo(s*.5,s*.02);g.lineTo(s+2,s*.38);g.stroke();
    g.fillStyle='#c9b07f';
    g.beginPath();g.ellipse(s*.26,s*.88,s*.14,s*.1,0,0,7);g.fill();
    g.beginPath();g.ellipse(s*.44,s*.9,s*.12,s*.09,0,0,7);g.fill();
    g.strokeStyle=OUT;g.lineWidth=.7;
    g.beginPath();g.ellipse(s*.26,s*.88,s*.14,s*.1,0,0,7);g.stroke();
    g.fillStyle=TEAMS[p].main;g.fillRect(s*.72,s*.72,s*.2,s*.24);
    g.strokeStyle='rgba(0,0,0,.25)';g.strokeRect(s*.72,s*.72,s*.2,s*.24);
  },
  siege(g,s,p){
    groundPatch(g,s);
    g.fillStyle='#7a5830';g.fillRect(0,s*.26,s,s*.74);
    g.strokeStyle='rgba(0,0,0,.16)';g.lineWidth=1.2;
    for(let x=7;x<s;x+=8){g.beginPath();g.moveTo(x,s*.26);g.lineTo(x,s);g.stroke();}
    g.fillStyle='#5f4526';
    g.beginPath();g.moveTo(-4,s*.32);g.lineTo(s*.5,-s*.14);g.lineTo(s+4,s*.32);g.closePath();g.fill();
    g.fillStyle='rgba(0,0,0,.16)';
    g.beginPath();g.moveTo(s*.5,-s*.14);g.lineTo(s+4,s*.32);g.lineTo(s*.6,s*.32);g.closePath();g.fill();
    g.strokeStyle='#8a6538';g.lineWidth=1.8;
    g.beginPath();g.moveTo(-4,s*.32);g.lineTo(s*.5,-s*.14);g.lineTo(s+4,s*.32);g.stroke();
    // open bay with wheel and beam
    g.fillStyle='#241a10';g.fillRect(s*.2,s*.44,s*.6,s*.56);
    g.strokeStyle='#8a6538';g.lineWidth=1.6;
    g.beginPath();g.arc(s*.38,s*.8,s*.13,0,7);g.stroke();
    g.beginPath();g.moveTo(s*.38,s*.68);g.lineTo(s*.38,s*.92);g.moveTo(s*.26,s*.8);g.lineTo(s*.5,s*.8);g.stroke();
    g.strokeStyle='#caa66b';g.lineWidth=2.4;
    g.beginPath();g.moveTo(s*.52,s*.9);g.lineTo(s*.76,s*.56);g.stroke();
    g.fillStyle='#9aa0a6';g.fillRect(s*.73,s*.5,s*.07,s*.09);
    g.fillStyle=TEAMS[p].main;g.fillRect(0,s*.26,s,s*.05);
  },
  wall(g,s,p){
    g.fillStyle='rgba(122,98,58,.3)';
    g.fillRect(1,s*.6,s-2,s*.36);
    for(let i=0;i<5;i++){
      const x=1+i*(s-5.5)/4,hv=(i*37)%3;
      g.fillStyle=i%2?'#8a6538':'#79572e';
      g.fillRect(x,s*.1+hv,4.6,s*.86-hv);
      g.fillStyle=i%2?'#9c7544':'#8a6538';
      g.beginPath();g.moveTo(x,s*.1+hv);g.lineTo(x+2.3,s*(-.04)+hv);g.lineTo(x+4.6,s*.1+hv);g.closePath();g.fill();
      g.strokeStyle='rgba(30,20,8,.35)';g.lineWidth=.8;
      g.strokeRect(x,s*.1+hv,4.6,s*.86-hv);
    }
    g.fillStyle='#5f4526';g.fillRect(-1,s*.4,s+2,3);
    g.strokeStyle='rgba(0,0,0,.3)';g.lineWidth=.8;g.strokeRect(-1,s*.4,s+2,3);
  },
  gate(g,s,p){
    g.fillStyle='rgba(122,98,58,.4)';
    g.fillRect(1,s*.5,s-2,s*.46);
    for(const gx of [0,s-6]){
      g.fillStyle='#79572e';g.fillRect(gx,-s*.1,6,s*1.06);
      g.fillStyle='#9c7544';
      g.beginPath();g.moveTo(gx,-s*.1);g.lineTo(gx+3,-s*.24);g.lineTo(gx+6,-s*.1);g.closePath();g.fill();
      g.strokeStyle='rgba(30,20,8,.4)';g.lineWidth=.9;g.strokeRect(gx,-s*.1,6,s*1.06);
    }
    g.fillStyle='#5f4526';g.fillRect(2,-s*.16,s-4,4.5);
    g.strokeStyle='rgba(30,20,8,.4)';g.strokeRect(2,-s*.16,s-4,4.5);
    g.fillStyle=TEAMS[p].main;
    g.beginPath();g.moveTo(s/2,-s*.1);g.lineTo(s/2+5,s*.02);g.lineTo(s/2-5,s*.02);g.closePath();g.fill();
  },
};
/* ---------- ISOMETRIC building sprites (supersede the flat set) ---------- */
const ISPR={};
// NB: mkIsoSpr sizes the sprite canvas from these — a taller roof clips unless
// its entry grows too. tower/castle raised for the conical roofs.
const IHT={tc:56,house:36,farm:10,camp:28,barracks:48,range:38,stable:44,siege:42,castle:100,tower:94,wall:24,gate:34,swall:26,sgate:36,market:44,monastery:56,blacksmith:48,dock:40,university:56,wonder:96};
const O2='rgba(58,42,26,.5)'; // soft warm edge tone — no black outlines
// concept-art pass: pale warm ashlar and genuinely white plaster, so walls read
// bright against the saturated grass instead of muddying into it
const STONE={l:'#a8a294',r:'#87837c',t:'#bdb6a6',o:O2};   // pale warm ashlar
const CREAMW={l:'#f0e7cd',r:'#d5c8ae',t:'#e8dfc0',o:O2};  // whitewashed plaster
function lerpP(a,b,t){return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}
/* --- surface texture + prop helpers (AoE2-style detail) --- */
function masonry(g,P,Q,h,courses){
  // real stone blocks: staggered quads with varied tints, bevel highlights,
  // dark bed/head joints and the odd mossy stone near the ground
  const n=5;
  const TINTS=['rgba(255,255,255,.06)','rgba(0,0,0,.07)',null,
               'rgba(60,45,25,.08)','rgba(255,250,238,.1)'];
  for(let i=0;i<courses;i++){
    const y0=h*i/courses,y1=h*(i+1)/courses;
    for(let j=-1;j<n+1;j++){
      let t0=(j+(i%2?.5:0))/n,t1=t0+1/n;
      if(t1<=0||t0>=1)continue;
      t0=Math.max(0,t0);t1=Math.min(1,t1);
      const bl=facePt(P,Q,t0,y0),br=facePt(P,Q,t1,y0),
            tr=facePt(P,Q,t1,y1),tl=facePt(P,Q,t0,y1);
      const hsh=hash2(((P.x*7+i*13)|0)+j*101,((Q.y*3+j*29)|0)+i*7);
      const tint=TINTS[hsh%5];
      if(tint)poly(g,[bl,br,tr,tl],tint);
      if(i===0&&hsh%6===0)poly(g,[bl,br,tr,tl],'rgba(80,110,50,.17)');
      g.strokeStyle='rgba(255,255,255,.15)';g.lineWidth=.7;
      g.beginPath();g.moveTo(tl.x+.3,tl.y+.5);g.lineTo(tr.x-.3,tr.y+.5);g.stroke();
      g.strokeStyle='rgba(0,0,0,.24)';g.lineWidth=.8;
      g.beginPath();g.moveTo(bl.x,bl.y);g.lineTo(br.x,br.y);g.stroke();
      if(t1<1){g.beginPath();g.moveTo(br.x,br.y);g.lineTo(tr.x,tr.y);g.stroke();}
    }
  }
}
function planks(g,P,Q,h,n){
  // vertical board joints + one horizontal rail on a wooden face
  g.strokeStyle='rgba(30,18,8,.3)';g.lineWidth=.9;
  for(let j=1;j<n;j++){
    const a=facePt(P,Q,j/n,0),b2=facePt(P,Q,j/n,h);
    g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b2.x,b2.y);g.stroke();}
  g.strokeStyle='rgba(0,0,0,.14)';
  const hh=h*.55;
  g.beginPath();g.moveTo(P.x,P.y-hh);g.lineTo(Q.x,Q.y-hh);g.stroke();
}
function roofLines(g,x0,y0,w,d,hb,rh,n){
  // shingle rows on the visible slope: alternating row tint, per-shingle
  // joints, the odd sun-bleached shingle, eave shadow and a lit ridge
  const Dc=lift(ip(x0,y0+d),hb),Cc=lift(ip(x0+w,y0+d),hb);
  const Rs=lift(ip(x0,y0+d/2),hb+rh),Re=lift(ip(x0+w,y0+d/2),hb+rh);
  const m=8;
  for(let i=0;i<n;i++){
    const a0=lerpP(Dc,Rs,i/n),b0=lerpP(Cc,Re,i/n);
    const a1=lerpP(Dc,Rs,(i+1)/n),b1=lerpP(Cc,Re,(i+1)/n);
    poly(g,[a0,b0,b1,a1],i%2?'rgba(0,0,0,.05)':'rgba(255,255,255,.05)');
    g.strokeStyle='rgba(0,0,0,.2)';g.lineWidth=1;
    g.beginPath();g.moveTo(a0.x,a0.y);g.lineTo(b0.x,b0.y);g.stroke();
    g.strokeStyle='rgba(0,0,0,.12)';g.lineWidth=.7;
    for(let j2=1;j2<m;j2++){
      const tt=(j2+(i%2?.5:0))/m;if(tt>=1)continue;
      const p1=lerpP(a0,b0,tt),p2=lerpP(a1,b1,tt);
      g.beginPath();g.moveTo(p1.x,p1.y);g.lineTo(p2.x,p2.y);g.stroke();
    }
    const hsh=hash2(i*31+((x0*10)|0),(y0*10)|0);
    const bt=(hsh%(m-1))/m;
    poly(g,[lerpP(a0,b0,bt),lerpP(a0,b0,bt+1/m),
      lerpP(a1,b1,bt+1/m),lerpP(a1,b1,bt)],
      hsh%2?'rgba(255,240,210,.1)':'rgba(30,15,8,.09)');
  }
  g.strokeStyle='rgba(0,0,0,.28)';g.lineWidth=1.4;
  g.beginPath();g.moveTo(Dc.x,Dc.y+.7);g.lineTo(Cc.x,Cc.y+.7);g.stroke();
  g.strokeStyle='rgba(255,240,205,.45)';g.lineWidth=1.6;
  g.beginPath();g.moveTo(Rs.x,Rs.y);g.lineTo(Re.x,Re.y);g.stroke();
}
const HROOF=[ // castle+ house shingles, per-instance (clay/timber/BLUE slate)
  // concept-art pass: the roof mix is the strongest read in the reference —
  // hot terracotta beside real blue slate, not two browns and a grey
  {slope:'#c2673f',shade:'#9c4f2e',end:'#b05a35',o:'rgba(48,18,8,.5)'},
  {slope:'#9a7b57',shade:'#7b6043',end:'#8a6d4d',o:'rgba(30,20,10,.5)'},
  {slope:'#5a7ea8',shade:'#43617f',end:'#4e6f93',o:'rgba(16,24,36,.5)'}];
const HTHATCH=[ // dark/feudal thatch — grey-straw like the reference, less golden
  {top:'#bda878',bot:'#96824e',rid:'#cebd8c'},
  {top:'#b09b6a',bot:'#8a7647',rid:'#c1ac7c'},
  {top:'#c7b284',bot:'#a08c58',rid:'#d7c696'}];
function thatch(g,x0,y0,w,d,hb,rh,pal){
  // combed straw down the visible slope + ragged eave tufts + tied ridge cap
  const Dc=lift(ip(x0,y0+d),hb),Cc=lift(ip(x0+w,y0+d),hb);
  const Rs=lift(ip(x0,y0+d/2),hb+rh),Re=lift(ip(x0+w,y0+d/2),hb+rh);
  for(let j=0;j<26;j++){
    const tt=(j+.5)/26,h1=hash2(j*17+((x0*10)|0),j*29);
    const a=lerpP(Dc,Cc,tt),b2=lerpP(Rs,Re,tt);
    g.strokeStyle=h1%3?'rgba(90,66,25,.28)':'rgba(255,240,190,.22)';g.lineWidth=.9;
    g.beginPath();g.moveTo(b2.x,b2.y+1);
    g.lineTo(a.x+(h1%5-2)*.6,a.y-(h1%3)*.8);g.stroke();}
  g.strokeStyle=pal.bot;g.lineWidth=1.1;
  for(let j=0;j<12;j++){
    const a=lerpP(Dc,Cc,(j+.3)/12),h1=hash2(j*31,j*7);
    g.beginPath();g.moveTo(a.x,a.y-1);g.lineTo(a.x+(h1%3-1),a.y+2+(h1%3));g.stroke();}
  g.strokeStyle=pal.rid;g.lineWidth=2.4;
  g.beginPath();g.moveTo(Rs.x,Rs.y);g.lineTo(Re.x,Re.y);g.stroke();
  g.strokeStyle='rgba(90,66,30,.5)';g.lineWidth=.8;
  for(const t of [.2,.4,.6,.8]){const m=lerpP(Rs,Re,t);
    g.beginPath();g.moveTo(m.x-1.5,m.y-1.5);g.lineTo(m.x+1.5,m.y+1.5);g.stroke();}
}
function ivyAt(g,P,Q,h,seed){
  // climbing vine on a stone face — deterministic per sprite
  const rw=mulberry(seed);
  const t0=.12+rw()*.5,hh=h*(.6+rw()*.35);
  let pt=facePt(P,Q,t0,0),x=pt.x,y=pt.y;
  g.strokeStyle='rgba(52,74,30,.85)';g.lineWidth=1;
  g.beginPath();g.moveTo(x,y);
  for(let i=1;i<=4;i++){
    const n=facePt(P,Q,t0+(rw()-.5)*.14,hh*i/4);
    g.quadraticCurveTo(x+(rw()-.5)*4,y-hh/8,n.x,n.y);x=n.x;y=n.y;}
  g.stroke();
  for(let i=0;i<14;i++){
    const n=facePt(P,Q,t0+(rw()-.5)*.18,rw()*hh);
    g.fillStyle=i%3?'#4f6f2e':'#628a3a';
    g.beginPath();g.ellipse(n.x,n.y,1.5+rw(),1.1+rw()*.8,rw()*3,0,7);g.fill();}
}
function barrelAt(g,x,y){
  g.fillStyle='#8a6538';g.strokeStyle='rgba(30,20,8,.55)';g.lineWidth=.8;
  g.beginPath();g.ellipse(x,y-3.2,2.5,3.4,0,0,7);g.fill();g.stroke();
  g.strokeStyle='#4f3a1f';g.lineWidth=.9;
  g.beginPath();g.moveTo(x-2.4,y-4.6);g.lineTo(x+2.4,y-4.6);
  g.moveTo(x-2.4,y-1.9);g.lineTo(x+2.4,y-1.9);g.stroke();
  g.fillStyle='#a3743f';g.strokeStyle='rgba(30,20,8,.45)';
  g.beginPath();g.ellipse(x,y-6.4,2.5,1,0,0,7);g.fill();g.stroke();
}
function crateAt(g,x,y){
  g.fillStyle='#a3743f';g.strokeStyle='rgba(30,20,8,.5)';g.lineWidth=.8;
  g.fillRect(x-2.8,y-5.4,5.6,5.4);g.strokeRect(x-2.8,y-5.4,5.6,5.4);
  g.beginPath();g.moveTo(x-2.8,y-5.4);g.lineTo(x+2.8,y);
  g.moveTo(x+2.8,y-5.4);g.lineTo(x-2.8,y);g.stroke();
}
function hayAt(g,x,y){
  g.fillStyle='#d9b45a';g.strokeStyle='#b8933e';g.lineWidth=.9;
  g.beginPath();g.ellipse(x,y-2.6,4.6,3.2,0,0,7);g.fill();g.stroke();
  g.beginPath();g.moveTo(x-3.4,y-4.2);g.lineTo(x-1.2,y-2);
  g.moveTo(x+.4,y-5);g.lineTo(x+2.4,y-2.6);g.stroke();
}
/* Pre-render grain: seeded dither speckle composited 'source-atop' so it only
   lands on painted pixels. Applied ONCE at sprite-cache build — this is what
   turns smooth vector fills into surfaces that read like 90s pre-rendered art. */
function spriteGrain(c,seed,strength){
  const g=c.getContext('2d');
  g.setTransform(1,0,0,1,0,0);
  g.globalCompositeOperation='source-atop';
  const gr=mulberry((seed|0)+7);
  const n=Math.round(c.width*c.height/19);
  const k=strength||1;
  for(let i=0;i<n;i++){
    g.fillStyle=gr()<.52
      ?'rgba(28,20,10,'+((.05+gr()*.09)*k).toFixed(3)+')'
      :'rgba(255,242,214,'+((.04+gr()*.07)*k).toFixed(3)+')';
    g.fillRect(gr()*c.width,gr()*c.height,1.4,1.4);
  }
  g.globalCompositeOperation='source-over';
}
function mkIsoSpr(s,H,fn){
  const w=2*s*IW+56,h=H+2*s*IH+16;
  const c=document.createElement('canvas');
  c.width=w*TREZ;c.height=h*TREZ;
  const g=c.getContext('2d');
  g.setTransform(TREZ,0,0,TREZ,(s*IW+28)*TREZ,(H+2)*TREZ);
  g.lineJoin='round';fn(g,s);
  spriteGrain(c,s*131+H*17+w,1.35); // dense pre-render dither on every building
  return{c,ox:s*IW+28,oy:H+2,w,h,H};
}
function dirtPad(g,s,alpha){
  // two-pass cast shadow to the south-east (sun from the north-west):
  // a long faint throw plus a denser contact shadow weld the building down
  const M=ip(s/2,s/2);
  // soft cool baked drop shadow (three fading passes read as a blur)
  g.fillStyle='rgba(22,25,34,.08)';
  g.beginPath();g.ellipse(M.x+s*IW*.42,M.y+s*IH*.32,s*IW*1.18,s*IH*.88,.18,0,7);g.fill();
  g.fillStyle='rgba(22,25,34,.11)';
  g.beginPath();g.ellipse(M.x+s*IW*.4,M.y+s*IH*.3,s*IW*1.05,s*IH*.76,.18,0,7);g.fill();
  g.fillStyle='rgba(22,25,34,.16)';
  g.beginPath();g.ellipse(M.x+s*IW*.34,M.y+s*IH*.26,s*IW*.9,s*IH*.6,.16,0,7);g.fill();
  poly(g,[ip(-.08,-.08),ip(s+.08,-.08),ip(s+.08,s+.08),ip(-.08,s+.08)],
    'rgba(122,98,58,'+(alpha||.4)+')');
}
function faceLines(g,P,Q,hTop,n,col){
  g.strokeStyle=col;g.lineWidth=.9;
  for(let i=1;i<n;i++){const hh=hTop*i/n;
    g.beginPath();g.moveTo(P.x,P.y-hh);g.lineTo(Q.x,Q.y-hh);g.stroke();}
}
function faceBeams(g,P,Q,h){
  // aged plaster stipple between the timbers
  g.fillStyle='rgba(120,95,60,.13)';
  for(let i=0;i<9;i++){
    const pt2=facePt(P,Q,((i*37+13)%89)/89,((i*23+7)%(h*10))/10);
    g.fillRect(pt2.x,pt2.y,1.2,1.2);
  }
  g.fillStyle='rgba(255,250,235,.14)';
  for(let i=0;i<5;i++){
    const pt2=facePt(P,Q,((i*53+29)%89)/89,((i*31+3)%(h*10))/10);
    g.fillRect(pt2.x,pt2.y,1.2,1.2);
  }
  // half-timber frame with drop shadow
  g.strokeStyle='rgba(30,18,8,.25)';g.lineWidth=2.2;
  for(const t of [.1,.5,.9]){
    const a=facePt(P,Q,t,0),b=facePt(P,Q,t,h);
    g.beginPath();g.moveTo(a.x+.6,a.y+.4);g.lineTo(b.x+.6,b.y+.4);g.stroke();}
  g.strokeStyle='#5f4526';g.lineWidth=1.4;
  for(const t of [.1,.5,.9]){
    const a=facePt(P,Q,t,0),b=facePt(P,Q,t,h);
    g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();}
  const a1=facePt(P,Q,.1,0),a2=facePt(P,Q,.5,h),a3=facePt(P,Q,.5,0),a4=facePt(P,Q,.9,h);
  g.beginPath();g.moveTo(a1.x,a1.y);g.lineTo(a2.x,a2.y);
  g.moveTo(a3.x,a3.y);g.lineTo(a4.x,a4.y);g.stroke();
}
function bannerAt(g,x,y,p,len){
  g.strokeStyle='#4a3a24';g.lineWidth=1.4;
  g.beginPath();g.moveTo(x,y);g.lineTo(x,y-len);g.stroke();
  // waving swallowtail pennant
  g.fillStyle=TEAMS[p].main;
  g.beginPath();
  g.moveTo(x,y-len);
  g.quadraticCurveTo(x+6,y-len-2,x+11,y-len+1);
  g.quadraticCurveTo(x+7,y-len+2.4,x+11,y-len+4.6);
  g.quadraticCurveTo(x+5,y-len+5.6,x,y-len+5.2);
  g.closePath();g.fill();
  g.strokeStyle=TEAMS[p].dark;g.lineWidth=.8;g.stroke();
  // wind-lit fold
  g.fillStyle='rgba(255,255,255,.2)';
  g.beginPath();g.moveTo(x,y-len);
  g.quadraticCurveTo(x+6,y-len-2,x+11,y-len+1);
  g.quadraticCurveTo(x+6,y-len,x,y-len+1.6);g.closePath();g.fill();
  // gold finial
  g.fillStyle='#e3b23c';g.beginPath();g.arc(x,y-len-1,1.1,0,7);g.fill();
}
const ISO_ART={
  tc(g,s,p,ab){
    dirtPad(g,2,.45);
    const b1=isoBlock(g,.08,.08,1.84,1.84,0,18,STONE);
    masonry(g,b1.D,b1.C,18,4);
    masonry(g,b1.C,b1.B,18,4);
    ivyAt(g,b1.D,b1.C,16,23);
    const b2=isoBlock(g,.2,.2,1.6,1.6,18,11,CREAMW);
    faceBeams(g,b2.D,b2.C,11);faceBeams(g,b2.C,b2.B,11);
    const rf=roofGable(g,-.08,-.08,2.16,2.16,29,17,ab===2?HROOF[2]:TERRA);
    roofLines(g,-.08,-.08,2.16,2.16,29,17,5);
    if(ab===2){ // Imperial: gilded ridge cap + finials on the seat of power
      g.strokeStyle='#c9971f';g.lineWidth=2.2;
      g.beginPath();g.moveTo(rf.Rs.x,rf.Rs.y-1);g.lineTo(rf.Re.x,rf.Re.y-1);g.stroke();
      g.strokeStyle='rgba(255,240,190,.55)';g.lineWidth=.9;
      g.beginPath();g.moveTo(rf.Rs.x,rf.Rs.y-2);g.lineTo(rf.Re.x,rf.Re.y-2);g.stroke();
      g.fillStyle='#e5c95c';
      for(const q of [rf.Rs,rf.Re]){g.beginPath();g.arc(q.x,q.y-2,1.8,0,7);g.fill();}
    }
    // arched door with team-color awning
    archWin(g,b1.C,b1.B,.36,.64,0,12,'#3a2a18','#6b5330');
    const d3=facePt(b1.C,b1.B,.5,0),d4=facePt(b1.C,b1.B,.5,11);
    g.strokeStyle='#93744a';g.lineWidth=.8;
    g.beginPath();g.moveTo(d3.x,d3.y);g.lineTo(d4.x,d4.y);g.stroke();
    poly(g,[facePt(b1.C,b1.B,.32,13),facePt(b1.C,b1.B,.68,13),
      facePt(b1.C,b1.B,.66,16),facePt(b1.C,b1.B,.34,16)],TEAMS[p].main,TEAMS[p].dark,1);
    // small arched windows on the west face
    for(const t of [.22,.62])
      archWin(g,b1.D,b1.C,t,t+.14,8,14,'#3a2a18','#6b5330');
    barrelAt(g,ip(2.28,1.3).x,ip(2.28,1.3).y);
    crateAt(g,ip(1.2,2.34).x,ip(1.2,2.34).y);
    bannerAt(g,(rf.Rs.x+rf.Re.x)/2,(rf.Rs.y+rf.Re.y)/2,p,13);
  },
  house(g,s,p,ab,vr){
    // three age looks: thatch hut (Dark/Feudal) -> shingled cottage (Castle)
    // -> stone townhouse with slate and a chimney (Imperial)
    vr=vr||0;
    dirtPad(g,1,.35);
    const b=isoBlock(g,.06,.06,.88,.88,0,13,ab===2?STONE:CREAMW);
    if(ab===2){
      masonry(g,b.D,b.C,13,3);
      masonry(g,b.C,b.B,13,3);
    }else{
      faceBeams(g,b.C,b.B,13);
      g.strokeStyle='#5f4526';g.lineWidth=1.2;
      for(const t of [.1,.9]){
        const a=facePt(b.D,b.C,t,0),b2=facePt(b.D,b.C,t,13);
        g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b2.x,b2.y);g.stroke();}
    }
    if(ab===2){
      roofGable(g,-.1,-.1,1.2,1.2,13,12,HROOF[2]); // slate, a touch steeper
      roofLines(g,-.1,-.1,1.2,1.2,13,12,4);
      // stone chimney with a wisp of soot shading
      const ch=ip(.24,.24);
      g.fillStyle='#8e887d';g.fillRect(ch.x-2.2,ch.y-13-14,4.4,9);
      g.strokeStyle='rgba(26,28,32,.5)';g.lineWidth=.8;
      g.strokeRect(ch.x-2.2,ch.y-13-14,4.4,9);
      g.fillStyle='#6f747a';g.fillRect(ch.x-2.8,ch.y-13-15.4,5.6,2);
      g.fillStyle='rgba(30,28,26,.35)';g.fillRect(ch.x-1.4,ch.y-13-13.4,2.8,1.6);
    }else if(ab===1){
      roofGable(g,-.1,-.1,1.2,1.2,13,11,HROOF[vr]);
      roofLines(g,-.1,-.1,1.2,1.2,13,11,4);
    }else{
      const hp2=HTHATCH[vr];
      roofGable(g,-.1,-.1,1.2,1.2,13,11,
        {slope:hp2.top,shade:hp2.bot,end:hp2.top,o:'rgba(60,45,18,.5)'});
      thatch(g,-.1,-.1,1.2,1.2,13,11,hp2);
    }
    archWin(g,b.C,b.B,.4,.62,0,9,'#3a2a18','#6b5330');
    archWin(g,b.D,b.C,.35,.55,5,9,'#3a2a18',null);
    crateAt(g,ip(1.28,.55).x,ip(1.28,.55).y);
  },
  farm(g,s,p){
    poly(g,[ip(-.02,-.02),ip(1.02,-.02),ip(1.02,1.02),ip(-.02,1.02)],'#8a6a41','#6d5231',1.4);
    // furrow rows
    g.strokeStyle='#6d5231';g.lineWidth=1.6;
    for(let f=.1;f<1;f+=.135){
      const a=ip(.03,f),b=ip(.97,f);
      g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();}
    g.strokeStyle='rgba(210,180,120,.4)';g.lineWidth=.8;
    for(let f=.165;f<1;f+=.135){
      const a=ip(.03,f),b=ip(.97,f);
      g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();}
    // dense crops in every row
    for(let i=0;i<6;i++)for(let j=0;j<7;j++){
      const pt=ip(.08+i*.16+(j%2)*.04,.1+j*.13);
      g.fillStyle=(i+j)%3?'#6d8f3e':'#7fa04a';
      g.fillRect(pt.x-.9,pt.y-3.4,1.8,3.4);
      g.fillStyle='#d9c25a';
      g.fillRect(pt.x-.5,pt.y-4.2,1,1);}
    // low wattle border
    g.strokeStyle='#b09468';g.lineWidth=1.2;
    poly(g,[ip(-.02,-.02),ip(1.02,-.02),ip(1.02,1.02),ip(-.02,1.02)],null,'#b09468',1.2);
  },
  camp(g,s,p){
    dirtPad(g,1,.45);
    // log cabin: stacked horizontal logs with visible round ends at the corner
    const b=isoBlock(g,.08,.08,.84,.84,0,12,{l:'#8a6538',r:'#75552c',t:'#9c7544',o:O2});
    g.strokeStyle='rgba(30,18,8,.4)';g.lineWidth=1;
    for(let i=1;i<4;i++){const hh=12*i/4;
      g.beginPath();g.moveTo(b.D.x,b.D.y-hh);g.lineTo(b.C.x,b.C.y-hh);
      g.lineTo(b.B.x,b.B.y-hh);g.stroke();}
    // log ends stacked at the near corner
    for(let i=0;i<4;i++){
      const yy=b.C.y-1.6-i*3;
      g.fillStyle=i%2?'#a3743f':'#93683a';g.strokeStyle='rgba(30,18,8,.5)';g.lineWidth=.7;
      g.beginPath();g.ellipse(b.C.x,yy,1.9,1.5,0,0,7);g.fill();g.stroke();
      g.strokeStyle='rgba(60,40,18,.6)';
      g.beginPath();g.ellipse(b.C.x,yy,.9,.7,0,0,7);g.stroke();
    }
    // plank lean-to roof overhanging the door side
    poly(g,[lift(b.D,17),lift(b.C,17),{x:b.B.x+3,y:b.B.y-9},
      {x:b.A.x+3,y:lift(b.A,17).y+(b.B.y-9-lift(b.C,17).y)}],'#b08a52','rgba(30,18,8,.5)',1);
    g.strokeStyle='rgba(30,18,8,.3)';g.lineWidth=.9;
    for(const t of [.25,.5,.75]){
      const a=lerpP(lift(b.D,17),lift(b.C,17),t),
            c2=lerpP({x:b.A.x+3,y:lift(b.A,17).y+(b.B.y-9-lift(b.C,17).y)},{x:b.B.x+3,y:b.B.y-9},t);
      g.beginPath();g.moveTo(a.x,a.y);g.lineTo(c2.x,c2.y);g.stroke();}
    // stores out front: sacks, barrel, crate
    const M=ip(.62,1.18);
    g.fillStyle='#c9b07f';g.strokeStyle=O2;g.lineWidth=.8;
    g.beginPath();g.ellipse(M.x-4,M.y-3,4.2,3.2,0,0,7);g.fill();g.stroke();
    g.beginPath();g.ellipse(M.x+2.5,M.y-2,3.6,2.8,0,0,7);g.fill();g.stroke();
    barrelAt(g,ip(1.2,.45).x,ip(1.2,.45).y);
    crateAt(g,ip(.4,1.32).x-8,ip(.4,1.32).y);
    bannerAt(g,lift(b.A,17).x,lift(b.A,17).y,p,9);
  },
  barracks(g,s,p,ab){
    dirtPad(g,2,.45);
    // timber-framed hall: stone plinth, whitewashed plaster, terracotta roof
    const b=isoBlock(g,.06,.06,1.88,1.88,0,22,CREAMW);
    // stone plinth over the bottom of both faces
    poly(g,[b.D,b.C,facePt(b.D,b.C,1,7),facePt(b.D,b.C,0,7)],'#8e887d');
    poly(g,[b.C,b.B,facePt(b.C,b.B,1,7),facePt(b.C,b.B,0,7)],'#716f6d');
    masonry(g,b.D,b.C,7,2);
    masonry(g,b.C,b.B,7,2);
    faceBeams(g,b.D,b.C,22);faceBeams(g,b.C,b.B,22);
    const brf=roofGable(g,-.08,-.08,2.16,2.16,22,15,ab===2?HROOF[2]:TERRA);
    roofLines(g,-.08,-.08,2.16,2.16,22,15,5);
    if(ab===2){ // Imperial: war pennants along the slate ridge
      for(const f2 of [.2,.5,.8]){
        const qx=brf.Rs.x+(brf.Re.x-brf.Rs.x)*f2,qy=brf.Rs.y+(brf.Re.y-brf.Rs.y)*f2;
        g.strokeStyle='#4a3a24';g.lineWidth=1;
        g.beginPath();g.moveTo(qx,qy);g.lineTo(qx,qy-7);g.stroke();
        g.fillStyle=TEAMS[p].main;
        g.beginPath();g.moveTo(qx,qy-7);g.lineTo(qx+5.5,qy-5.8);g.lineTo(qx,qy-4.6);g.closePath();g.fill();
      }
    }
    archWin(g,b.C,b.B,.4,.6,0,14,'#2c2013','#4a3a24');
    g.strokeStyle='#b9bec4';g.lineWidth=.9;
    for(const t of [.44,.5,.56]){
      const a=facePt(b.C,b.B,t,0),c2=facePt(b.C,b.B,t,12);
      g.beginPath();g.moveTo(a.x,a.y);g.lineTo(c2.x,c2.y);g.stroke();}
    for(const t of [.2,.66]) // small arched windows above the plinth, west face
      archWin(g,b.D,b.C,t,t+.12,10,15,'#3a2a18','#6b5330');
    // two team shields flanking the gate
    for(const st of [.24,.76]){
      const sh=facePt(b.C,b.B,st,15);
      g.fillStyle=TEAMS[p].main;
      g.beginPath();g.moveTo(sh.x-3.4,sh.y-2.6);g.lineTo(sh.x+3.4,sh.y-2.6);
      g.quadraticCurveTo(sh.x+3.4,sh.y+1.6,sh.x,sh.y+3.4);
      g.quadraticCurveTo(sh.x-3.4,sh.y+1.6,sh.x-3.4,sh.y-2.6);g.closePath();g.fill();
      g.strokeStyle=TEAMS[p].trim;g.lineWidth=.9;g.stroke();}
    // weapon rack: crossed spears against the west wall
    const wr=facePt(b.D,b.C,.2,0);
    g.strokeStyle='#8a5a2b';g.lineWidth=1.2;
    g.beginPath();g.moveTo(wr.x-4,wr.y+1);g.lineTo(wr.x+2,wr.y-14);
    g.moveTo(wr.x+2,wr.y+1);g.lineTo(wr.x-4,wr.y-14);g.stroke();
    g.fillStyle='#d8dbdf';
    g.beginPath();g.moveTo(wr.x+2,wr.y-14);g.lineTo(wr.x+3.4,wr.y-17);g.lineTo(wr.x+3.4,wr.y-13.6);g.closePath();g.fill();
    g.beginPath();g.moveTo(wr.x-4,wr.y-14);g.lineTo(wr.x-5.4,wr.y-17);g.lineTo(wr.x-5.4,wr.y-13.6);g.closePath();g.fill();
  },
  range(g,s,p){
    dirtPad(g,2,.45);
    const b=isoBlock(g,.06,.06,1.88,1.88,0,15,{l:'#9d7440',r:'#8a6538',t:'#a3743f',o:O2});
    planks(g,b.D,b.C,15,6);
    planks(g,b.C,b.B,15,6);
    poly(g,[lift(b.A,26),lift(b.B,26),lift(b.C,17),lift(b.D,17)],'#7a5a30',O2);
    g.strokeStyle='rgba(30,18,8,.28)';g.lineWidth=.9;
    for(const t of [.33,.66]){
      const a=lerpP(lift(b.A,26),lift(b.B,26),t),c2=lerpP(lift(b.D,17),lift(b.C,17),t);
      g.beginPath();g.moveTo(a.x,a.y);g.lineTo(c2.x,c2.y);g.stroke();}
    g.strokeStyle='#93744a';g.lineWidth=1.6;
    g.beginPath();g.moveTo(b.D.x,b.D.y-17);g.lineTo(b.C.x,b.C.y-17);g.lineTo(b.B.x,b.B.y-26);g.stroke();
    const tg=facePt(b.C,b.B,.55,8);
    g.fillStyle='#e8e0c8';g.beginPath();g.arc(tg.x,tg.y,5,0,7);g.fill();
    g.fillStyle='#b03a30';g.beginPath();g.arc(tg.x,tg.y,3.2,0,7);g.fill();
    g.fillStyle='#e8e0c8';g.beginPath();g.arc(tg.x,tg.y,1.7,0,7);g.fill();
    g.fillStyle='#332414';g.beginPath();g.arc(tg.x,tg.y,.7,0,7);g.fill();
    // arrows stuck in the target
    g.strokeStyle='#6b4a2a';g.lineWidth=.9;
    g.beginPath();g.moveTo(tg.x-1.2,tg.y-.6);g.lineTo(tg.x-5.5,tg.y-3.4);
    g.moveTo(tg.x+1.4,tg.y+.8);g.lineTo(tg.x+4.8,tg.y+3.6);g.stroke();
    g.fillStyle='#e8e0c8';
    g.beginPath();g.arc(tg.x-5.5,tg.y-3.4,1,0,7);g.fill();
    g.beginPath();g.arc(tg.x+4.8,tg.y+3.6,1,0,7);g.fill();
    poly(g,[facePt(b.D,b.C,.3,0),facePt(b.D,b.C,.48,0),
      facePt(b.D,b.C,.48,11),facePt(b.D,b.C,.3,11)],'#332414');
    g.strokeStyle=TEAMS[p].main;g.lineWidth=2;
    g.beginPath();g.moveTo(b.C.x,b.C.y-15);g.lineTo(b.B.x,b.B.y-15);g.stroke();
    barrelAt(g,ip(2.24,1.5).x,ip(2.24,1.5).y);
  },
  stable(g,s,p){
    dirtPad(g,2,.45);
    const b=isoBlock(g,.06,.06,1.88,1.88,0,15,{l:'#8f5f3a',r:'#7c4f2e',t:'#9a6a42',o:O2});
    planks(g,b.D,b.C,15,6);
    planks(g,b.C,b.B,15,6);
    roofGable(g,-.1,-.1,2.2,2.2,15,13,TERRA);
    roofLines(g,-.1,-.1,2.2,2.2,15,13,4);
    poly(g,[facePt(b.C,b.B,.32,0),facePt(b.C,b.B,.68,0),
      facePt(b.C,b.B,.68,12),facePt(b.C,b.B,.32,12)],'#2c2013','#6b5330',1.2);
    const dm=facePt(b.C,b.B,.5,0),dm2=facePt(b.C,b.B,.5,12);
    g.strokeStyle='#6b5330';g.lineWidth=1.2;
    g.beginPath();g.moveTo(dm.x,dm.y);g.lineTo(dm2.x,dm2.y);g.stroke();
    hayAt(g,ip(1.72,2.2).x,ip(1.72,2.2).y);
    hayAt(g,ip(2.24,1.7).x,ip(2.24,1.7).y-1);
    g.strokeStyle=TEAMS[p].main;g.lineWidth=2;
    g.beginPath();g.moveTo(b.D.x,b.D.y-14);g.lineTo(b.C.x,b.C.y-14);g.stroke();
  },
  siege(g,s,p){
    dirtPad(g,2,.5);
    const b=isoBlock(g,.06,.06,1.88,1.88,0,15,{l:'#7a5830',r:'#684a27',t:'#86633a',o:O2});
    planks(g,b.D,b.C,15,5);
    planks(g,b.C,b.B,15,5);
    roofGable(g,-.1,-.1,2.2,2.2,15,11,
      {slope:'#5f4526',shade:'#4f3a1f',end:'#574021',o:'rgba(30,18,8,.5)'});
    roofLines(g,-.1,-.1,2.2,2.2,15,11,4);
    // log pile beside the works
    for(let i=0;i<3;i++){
      const lp=ip(2.26,1.4+i*.16);
      g.fillStyle=i%2?'#93683a':'#a3743f';g.strokeStyle='rgba(30,18,8,.5)';g.lineWidth=.7;
      g.beginPath();g.ellipse(lp.x,lp.y-1.5-(i===1?2.4:0),1.7,1.4,0,0,7);g.fill();g.stroke();}
    poly(g,[facePt(b.C,b.B,.25,0),facePt(b.C,b.B,.75,0),
      facePt(b.C,b.B,.75,14),facePt(b.C,b.B,.25,14)],'#241a10','#4a3a24',1.2);
    const wc=facePt(b.C,b.B,.42,5);
    g.strokeStyle='#8a6538';g.lineWidth=1.6;
    g.beginPath();g.arc(wc.x,wc.y,4.5,0,7);g.stroke();
    g.beginPath();g.moveTo(wc.x-4.5,wc.y);g.lineTo(wc.x+4.5,wc.y);
    g.moveTo(wc.x,wc.y-4.5);g.lineTo(wc.x,wc.y+4.5);g.stroke();
    g.strokeStyle='#caa66b';g.lineWidth=2.2;
    const bm1=facePt(b.C,b.B,.56,2),bm2=facePt(b.C,b.B,.72,12);
    g.beginPath();g.moveTo(bm1.x,bm1.y);g.lineTo(bm2.x,bm2.y);g.stroke();
  },
  tower(g,s,p){
    dirtPad(g,1,.4);
    // flared footing
    const ft2=isoBlock(g,.04,.04,.92,.92,0,6,{l:'#847c6f',r:'#6f675c',t:'#8f877a',o:O2});
    const b=isoBlock(g,.12,.12,.76,.76,6,36,STONE);
    masonry(g,b.D,b.C,36,7);
    masonry(g,b.C,b.B,36,7);
    ivyAt(g,b.D,b.C,30,61);
    const ppt=isoBlock(g,.02,.02,.96,.96,42,7,
      {l:'#847c6f',r:'#6f675c',t:'#8f877a',o:O2});
    for(const [e1,e2] of [[ppt.D2,ppt.C2],[ppt.C2,ppt.B2]])
      for(let i=0;i<2;i++){
        const E=lerpP(e1,e2,(i+.35)/2);
        poly(g,[{x:E.x-2.4,y:E.y+1},{x:E.x+2.4,y:E.y+1},{x:E.x+2.4,y:E.y-4},{x:E.x-2.4,y:E.y-4}],'#7e7668',O2);}
    poly(g,[facePt(b.C,b.B,.44,20),facePt(b.C,b.B,.54,20),
      facePt(b.C,b.B,.54,32),facePt(b.C,b.B,.44,32)],'#332414');
    // conical clay roof over the crenellated cap (concept art)
    const tap=coneRoof(g,.02,.02,.96,.96,49,20,TERRA,.07);
    g.strokeStyle='#c8a24a';g.lineWidth=1.6;
    g.beginPath();g.moveTo(tap.x,tap.y+1);g.lineTo(tap.x,tap.y-5);g.stroke();
    bannerAt(g,tap.x,tap.y-5,p,10);
  },
  castle(g,s,p){
    dirtPad(g,2,.5);
    const turret=(tx,ty,h)=>{
      const t=isoBlock(g,tx,ty,.6,.6,0,h,STONE);
      masonry(g,t.D,t.C,h,8);
      masonry(g,t.C,t.B,h,8);
      // arrow slit
      poly(g,[facePt(t.C,t.B,.42,h*.45),facePt(t.C,t.B,.52,h*.45),
        facePt(t.C,t.B,.52,h*.68),facePt(t.C,t.B,.42,h*.68)],'#332414');
      for(const [e1,e2] of [[t.D2,t.C2],[t.C2,t.B2]])
        for(let i=0;i<2;i++){
          const E=lerpP(e1,e2,(i+.35)/2);
          poly(g,[{x:E.x-2,y:E.y+1},{x:E.x+2,y:E.y+1},{x:E.x+2,y:E.y-3.6},{x:E.x-2,y:E.y-3.6}],'#7e7668',O2);}
      // blue slate spire over each turret (concept art)
      const ap=coneRoof(g,tx-.03,ty-.03,.66,.66,h+4,17,SLATE,0);
      g.strokeStyle='#c8a24a';g.lineWidth=1.4;
      g.beginPath();g.moveTo(ap.x,ap.y+1);g.lineTo(ap.x,ap.y-4.5);g.stroke();
      return t;
    };
    turret(0,0,52);
    const main=isoBlock(g,.18,.18,1.64,1.64,0,36,STONE);
    masonry(g,main.D,main.C,36,7);
    masonry(g,main.C,main.B,36,7);
    ivyAt(g,main.D,main.C,30,7);
    for(const [e1,e2] of [[main.D2,main.C2],[main.C2,main.B2]])
      for(let i=0;i<4;i++){
        const E=lerpP(e1,e2,(i+.3)/4);
        poly(g,[{x:E.x-3,y:E.y+1},{x:E.x+3,y:E.y+1},{x:E.x+3,y:E.y-5},{x:E.x-3,y:E.y-5}],'#7e7668',O2);}
    poly(g,[facePt(main.C,main.B,.4,0),facePt(main.C,main.B,.6,0),
      facePt(main.C,main.B,.6,16),facePt(main.C,main.B,.4,16)],'#241a10','#4a3a24',1.2);
    g.strokeStyle='#b9bec4';g.lineWidth=.9;
    for(const t of [.44,.5,.56]){
      const a=facePt(main.C,main.B,t,0),c2=facePt(main.C,main.B,t,15);
      g.beginPath();g.moveTo(a.x,a.y);g.lineTo(c2.x,c2.y);g.stroke();}
    for(const t of [.3,.7]){
      poly(g,[facePt(main.C,main.B,t,22),facePt(main.C,main.B,t+.06,22),
        facePt(main.C,main.B,t+.06,30),facePt(main.C,main.B,t,30)],'#332414');}
    turret(1.4,0,52);turret(0,1.4,52);
    const ft=turret(1.4,1.4,58);
    bannerAt(g,ft.A2.x,ft.A2.y-4,p,13);
  },
  wall(g,s,p){
    poly(g,[ip(0,.3),ip(1,.3),ip(1,.7),ip(0,.7)],'rgba(122,98,58,.3)');
    for(let i=0;i<5;i++){
      const x=-20+i*10,hv=(i*37)%4,hh=15+hv;
      g.fillStyle=i%2?'#8a6538':'#79572e';
      g.fillRect(x-2.6,13-hh,5.2,hh);
      g.fillStyle=i%2?'#9c7544':'#8a6538';
      g.beginPath();g.moveTo(x-2.6,13-hh);g.lineTo(x,13-hh-4);g.lineTo(x+2.6,13-hh);g.closePath();g.fill();
      g.strokeStyle='rgba(30,20,8,.35)';g.lineWidth=.8;
      g.strokeRect(x-2.6,13-hh,5.2,hh);
    }
    g.strokeStyle='#5f4526';g.lineWidth=2.4;
    g.beginPath();g.moveTo(-23,4);g.lineTo(23,4);g.stroke();
  },
  swall(g,s,p){
    poly(g,[ip(0,.3),ip(1,.3),ip(1,.7),ip(0,.7)],'rgba(110,105,95,.35)');
    // low stone curtain with crenellated top
    g.fillStyle='#8f877a';g.strokeStyle='rgba(28,20,10,.5)';g.lineWidth=.9;
    g.fillRect(-23,13-16,46,16);g.strokeRect(-23,13-16,46,16);
    g.strokeStyle='rgba(0,0,0,.16)';
    for(let hh=4;hh<16;hh+=4){g.beginPath();g.moveTo(-23,13-hh);g.lineTo(23,13-hh);g.stroke();}
    for(let i=0;i<6;i++){const x=-20+i*8+((i%2)*3);
      g.beginPath();g.moveTo(x,13-16);g.lineTo(x,13-12);g.stroke();}
    g.fillStyle='#a29a8d';
    for(let x=-23;x<23;x+=9)g.fillRect(x,13-20,5,4);
    g.strokeStyle='rgba(28,20,10,.45)';
    for(let x=-23;x<23;x+=9)g.strokeRect(x,13-20,5,4);
  },
  sgate(g,s,p){
    poly(g,[ip(0,.3),ip(1,.3),ip(1,.7),ip(0,.7)],'rgba(110,105,95,.4)');
    for(const gx of [-25,19]){
      g.fillStyle='#8f877a';g.strokeStyle='rgba(28,20,10,.5)';g.lineWidth=.9;
      g.fillRect(gx,13-26,6,26);g.strokeRect(gx,13-26,6,26);
      g.fillStyle='#a29a8d';g.fillRect(gx-1,13-29,8,4);g.strokeRect(gx-1,13-29,8,4);
      g.strokeStyle='rgba(0,0,0,.16)';
      for(let hh=5;hh<26;hh+=5){g.beginPath();g.moveTo(gx,13-hh);g.lineTo(gx+6,13-hh);g.stroke();}
    }
    g.fillStyle='#7b7366';g.fillRect(-25,13-24,50,5);
    g.strokeStyle='rgba(28,20,10,.5)';g.strokeRect(-25,13-24,50,5);
    g.fillStyle=TEAMS[p].main;
    g.beginPath();g.moveTo(0,13-30);g.lineTo(8,13-27.5);g.lineTo(0,13-25);g.closePath();g.fill();
  },
  market(g,s,p){
    dirtPad(g,2,.5);
    const b=isoBlock(g,.06,.06,1.88,1.88,0,12,{l:'#a3855a',r:'#8f7148',t:'#b09468',o:O2});
    planks(g,b.D,b.C,12,5);planks(g,b.C,b.B,12,5);
    // plank decking across the rooftop terrace
    g.strokeStyle='rgba(30,18,8,.18)';g.lineWidth=.9;
    for(let i=1;i<7;i++){
      const a=lerpP(b.A2,b.D2,i/7),c2=lerpP(b.B2,b.C2,i/7);
      g.beginPath();g.moveTo(a.x,a.y);g.lineTo(c2.x,c2.y);g.stroke();}
    g.fillStyle='rgba(255,250,235,.08)';
    poly(g,[b.A2,lerpP(b.A2,b.D2,.5),lerpP(b.B2,b.C2,.5),b.B2],g.fillStyle);
    // striped awning over the stall front
    const A1=lift(b.C,12),A2=lift(b.B,12);
    const O1={x:A1.x+8,y:A1.y-2},O2b={x:A2.x+8,y:A2.y-2};
    poly(g,[A1,A2,O2b,O1],'#c9b07f','rgba(30,18,8,.5)',1);
    g.fillStyle=TEAMS[p].main;
    for(const t of [.12,.44,.76]){
      poly(g,[lerpP(A1,A2,t),lerpP(A1,A2,t+.16),lerpP(O1,O2b,t+.16),lerpP(O1,O2b,t)],TEAMS[p].main);}
    // goods on display
    barrelAt(g,ip(1.2,2.3).x,ip(1.2,2.3).y);
    crateAt(g,ip(1.7,2.28).x,ip(1.7,2.28).y);
    g.fillStyle='#e3b23c';g.strokeStyle='rgba(30,18,8,.5)';g.lineWidth=.7;
    g.beginPath();g.ellipse(ip(.7,2.26).x,ip(.7,2.26).y-2,2.6,1.8,0,0,7);g.fill();g.stroke();
    // scales pole
    const sp2=lift(ip(.3,.3),12);
    g.strokeStyle='#5f4526';g.lineWidth=1.4;
    g.beginPath();g.moveTo(sp2.x,sp2.y);g.lineTo(sp2.x,sp2.y-12);g.stroke();
    bannerAt(g,sp2.x,sp2.y-2,p,10);
  },
  dock(g,s,p){
    // plank pier standing on piles over the water, with a little boathouse
    // (no dirtPad — it sits in the river)
    const deckC='#a3855a',deckS='#8f7148';
    // piles first (visible under the deck edges)
    g.strokeStyle='#5f4526';g.lineWidth=1.8;
    for(const[px2,py2] of [[.15,.15],[1.85,.15],[.15,1.85],[1.85,1.85],[1,.1],[.1,1],[1.9,1],[1,1.9]]){
      const q=ip(px2,py2);
      g.beginPath();g.moveTo(q.x,q.y-8);g.lineTo(q.x,q.y+3);g.stroke();
    }
    // water shadow under the decking
    g.fillStyle='rgba(14,26,36,.3)';
    poly(g,[ip(-.05,-.05),ip(2.05,-.05),ip(2.05,2.05),ip(-.05,2.05)],'rgba(14,26,36,.3)');
    // raised deck
    const A=lift(ip(-.05,-.05),8),B=lift(ip(2.05,-.05),8),
          C=lift(ip(2.05,2.05),8),D=lift(ip(-.05,2.05),8);
    poly(g,[A,B,C,D],deckC,'rgba(58,42,26,.5)',1);
    // plank lines across the deck
    g.strokeStyle='rgba(58,42,26,.3)';g.lineWidth=.9;
    for(let i=1;i<8;i++){
      const a=lerpP(A,D,i/8),b2=lerpP(B,C,i/8);
      g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b2.x,b2.y);g.stroke();}
    // warm/cool deck light
    poly(g,[A,lerpP(A,B,.5),lerpP(D,C,.5),D],'rgba(255,224,166,.08)');
    poly(g,[lerpP(A,B,.5),B,C,lerpP(D,C,.5)],'rgba(46,54,74,.1)');
    // boathouse on the back corner
    const b=isoBlock(g,.12,.12,.85,.85,8,10,{l:'#93744a',r:'#7c6039',t:'#a3855a',o:'rgba(58,42,26,.5)'});
    roofGable(g,.02,.02,1.05,1.05,18,9,TERRA);
    roofLines(g,.02,.02,1.05,1.05,18,9,3);
    // crane arm swung over the water with a hanging crate
    const cb=lift(ip(1.5,1.5),8);
    g.strokeStyle='#5f4526';g.lineWidth=1.8;
    g.beginPath();g.moveTo(cb.x,cb.y);g.lineTo(cb.x,cb.y-16);g.stroke();
    g.strokeStyle='#6d5231';g.lineWidth=1.4;
    g.beginPath();g.moveTo(cb.x,cb.y-15);g.lineTo(cb.x+12,cb.y-10);g.stroke();
    g.strokeStyle='rgba(40,30,16,.8)';g.lineWidth=.7;
    g.beginPath();g.moveTo(cb.x+11,cb.y-10.4);g.lineTo(cb.x+11,cb.y-4);g.stroke();
    crateAt(g,cb.x+11,cb.y-1.4);
    // coiled rope + barrel on the deck
    barrelAt(g,lift(ip(.5,1.6),8).x,lift(ip(.5,1.6),8).y);
    g.strokeStyle='#c9b07f';g.lineWidth=1.1;
    const rp=lift(ip(1.6,.4),8);
    g.beginPath();g.ellipse(rp.x,rp.y,2.4,1.2,0,0,7);g.stroke();
    g.beginPath();g.ellipse(rp.x,rp.y,1.3,.6,0,0,7);g.stroke();
    bannerAt(g,lift(ip(.12,.12),18).x,lift(ip(.12,.12),18).y,p,10);
  },
  blacksmith(g,s,p){
    dirtPad(g,2,.5);
    // stone workshop with an open smithing porch out front
    const b=isoBlock(g,.06,.06,1.5,1.88,0,14,STONE);
    masonry(g,b.D,b.C,14,3);
    masonry(g,b.C,b.B,14,3);
    roofGable(g,-.08,-.08,1.72,2.12,14,12,TERRA);
    roofLines(g,-.08,-.08,1.72,2.12,14,12,4);
    // squat chimney poking through the roof, smoke-stained at the mouth
    const ch=lift(ip(.42,.5),30);
    g.fillStyle='#8e887d';g.strokeStyle='rgba(58,42,26,.5)';g.lineWidth=.9;
    g.fillRect(ch.x-2.6,ch.y-7,5.2,9);g.strokeRect(ch.x-2.6,ch.y-7,5.2,9);
    g.fillStyle='#716f6d';g.fillRect(ch.x-3.2,ch.y-9,6.4,2.6);
    g.fillStyle='rgba(30,26,22,.75)';
    g.beginPath();g.ellipse(ch.x,ch.y-8.8,2.1,.9,0,0,7);g.fill();
    // open porch: plank lean-to over the forge
    const p1=lift(ip(1.56,.2),12),p2=lift(ip(1.56,1.8),12),
          p3=lift(ip(2.3,1.8),7),p4=lift(ip(2.3,.2),7);
    poly(g,[p1,p2,p3,p4],'#93744a','rgba(58,42,26,.5)',1);
    g.strokeStyle='rgba(30,18,8,.3)';g.lineWidth=.9;
    for(const tt of [.33,.66]){
      const a=lerpP(p1,p2,tt),c2=lerpP(p4,p3,tt);
      g.beginPath();g.moveTo(a.x,a.y);g.lineTo(c2.x,c2.y);g.stroke();}
    // posts holding the lean-to
    g.strokeStyle='#5f4526';g.lineWidth=1.6;
    for(const py of [.35,1.65]){
      const top=lift(ip(2.24,py),7),bot=ip(2.24,py);
      g.beginPath();g.moveTo(top.x,top.y);g.lineTo(bot.x,bot.y);g.stroke();}
    // the forge: brick hearth with a warm glow
    const fh=ip(1.85,.62);
    g.fillStyle='#7a5347';g.strokeStyle='rgba(58,42,26,.55)';g.lineWidth=.8;
    g.fillRect(fh.x-3.4,fh.y-6.2,6.8,6.2);g.strokeRect(fh.x-3.4,fh.y-6.2,6.8,6.2);
    g.fillStyle='#e2761e';
    g.beginPath();g.ellipse(fh.x,fh.y-2.4,2.2,1.5,0,0,7);g.fill();
    g.fillStyle='#ffd75e';
    g.beginPath();g.ellipse(fh.x,fh.y-2.4,1.1,.8,0,0,7);g.fill();
    // anvil on a stump
    const an=ip(1.85,1.4);
    g.fillStyle='#6b4a2a';g.fillRect(an.x-1.6,an.y-3,3.2,3);
    g.fillStyle='#5c6066';g.strokeStyle='rgba(30,26,22,.6)';g.lineWidth=.7;
    g.beginPath();
    g.moveTo(an.x-3,an.y-3.4);g.lineTo(an.x+3.2,an.y-3.4);g.lineTo(an.x+2.2,an.y-4.8);
    g.lineTo(an.x-1.8,an.y-4.8);g.closePath();g.fill();g.stroke();
    g.strokeStyle='#9aa0a6';g.lineWidth=.7;
    g.beginPath();g.moveTo(an.x-2.8,an.y-4.6);g.lineTo(an.x+2,an.y-4.6);g.stroke();
    // barrel of tools + horseshoes on the wall
    barrelAt(g,ip(1.2,2.3).x,ip(1.2,2.3).y);
    g.strokeStyle='#8a8f96';g.lineWidth=1;
    for(const tt of [.3,.5]){
      const hs=facePt(b.C,b.B,tt,9);
      g.beginPath();g.arc(hs.x,hs.y,1.5,Math.PI*.15,Math.PI*.85,true);g.stroke();}
    bannerAt(g,lift(ip(.06,.06),26).x,lift(ip(.06,.06),26).y,p,10);
  },
  monastery(g,s,p){
    dirtPad(g,2,.45);
    const b=isoBlock(g,.06,.06,1.88,1.88,0,20,CREAMW);
    masonry(g,b.D,b.C,20,4);
    masonry(g,b.C,b.B,20,4);
    ivyAt(g,b.C,b.B,17,41);ivyAt(g,b.D,b.C,17,97);
    const rf=roofGable(g,-.08,-.08,2.12,2.12,20,14,SLATE); // concept-art blue slate
    roofLines(g,-.08,-.08,2.12,2.12,20,14,4);
    // bell gable + cross
    const mx=(rf.Rs.x+rf.Re.x)/2,my=(rf.Rs.y+rf.Re.y)/2;
    g.fillStyle='#ddcfa9';g.strokeStyle='rgba(28,20,10,.5)';g.lineWidth=.9;
    g.fillRect(mx-4,my-12,8,10);g.strokeRect(mx-4,my-12,8,10);
    g.fillStyle='#332414';g.beginPath();g.arc(mx,my-7,2,0,7);g.fill();
    g.fillStyle='#e3b23c';g.beginPath();g.arc(mx,my-6.4,1.2,0,7);g.fill();
    g.strokeStyle='#e5c95c';g.lineWidth=1.6;
    g.beginPath();g.moveTo(mx,my-13);g.lineTo(mx,my-20);
    g.moveTo(mx-2.6,my-17.5);g.lineTo(mx+2.6,my-17.5);g.stroke();
    // arched door + windows
    archWin(g,b.C,b.B,.42,.58,0,12,'#3a2a18','#6b5330');
    for(const t of [.2,.8])
      archWin(g,b.C,b.B,t,t+.1,7,13,'#3a2a18',null);
  },
  university(g,s,p){
    dirtPad(g,2,.45);
    const b=isoBlock(g,.06,.06,1.88,1.88,0,22,STONE);
    masonry(g,b.D,b.C,22,5);
    masonry(g,b.C,b.B,22,5);
    ivyAt(g,b.D,b.C,18,61);
    const rf=roofGable(g,-.08,-.08,2.12,2.12,22,14,
      {slope:'#7d8288',shade:'#61666c',end:'#6f747a',o:'rgba(26,28,32,.5)'}); // slate
    roofLines(g,-.08,-.08,2.12,2.12,22,14,4);
    // little observatory dome astride the ridge
    const mx=(rf.Rs.x+rf.Re.x)/2,my=(rf.Rs.y+rf.Re.y)/2;
    g.fillStyle='#8d9298';g.strokeStyle='rgba(26,28,32,.5)';g.lineWidth=.9;
    g.fillRect(mx-5,my-8,10,7);g.strokeRect(mx-5,my-8,10,7);
    g.fillStyle='#5d8a9c';
    g.beginPath();g.arc(mx,my-8,5,Math.PI,0);g.closePath();g.fill();g.stroke();
    g.fillStyle='rgba(255,240,204,.35)';
    g.beginPath();g.arc(mx-1.6,my-9.6,1.7,0,7);g.fill();
    g.strokeStyle='#e3b23c';g.lineWidth=1.2;
    g.beginPath();g.moveTo(mx,my-13);g.lineTo(mx,my-17);g.stroke();
    g.fillStyle='#e3b23c';g.beginPath();g.arc(mx,my-17.6,1.1,0,7);g.fill();
    // tall arched scholar's windows, lamplit
    archWin(g,b.C,b.B,.14,.3,4,15,'#2c2416','#6b5330');
    archWin(g,b.C,b.B,.42,.58,0,13,'#3a2a18','#6b5330'); // door
    archWin(g,b.C,b.B,.7,.86,4,15,'#2c2416','#6b5330');
    for(const t of [.24,.6])
      archWin(g,b.D,b.C,t,t+.13,6,15,'#2c2416',null);
    g.fillStyle='rgba(240,206,110,.5)'; // candle glow in the upper panes
    const w1=facePt(b.C,b.B,.2,9),w2=facePt(b.C,b.B,.78,9);
    g.fillRect(w1.x-1.4,w1.y-2.4,2.8,2.4);g.fillRect(w2.x-1.4,w2.y-2.4,2.8,2.4);
    crateAt(g,ip(2.3,1.1).x,ip(2.3,1.1).y);
  },
  wonder(g,s,p){
    dirtPad(g,2,.5);
    // stepped marble plinth
    const b0=isoBlock(g,-.04,-.04,2.08,2.08,0,8,CREAMW);
    const b1=isoBlock(g,.12,.12,1.76,1.76,8,20,CREAMW);
    masonry(g,b1.D,b1.C,20,4);
    masonry(g,b1.C,b1.B,20,4);
    // colonnade on the lit faces
    g.strokeStyle='#b9a678';g.lineWidth=1.7;
    for(const t of [.14,.34,.66,.86]){
      const a=facePt(b1.C,b1.B,t,1),c2=facePt(b1.C,b1.B,t,19);
      g.beginPath();g.moveTo(a.x,a.y);g.lineTo(c2.x,c2.y);g.stroke();}
    // upper drum
    const b2=isoBlock(g,.4,.4,1.2,1.2,28,12,STONE);
    ivyAt(g,b2.D,b2.C,10,29);
    // great gilded dome
    const tp=ip(1.5,1.5); // roof center in iso space
    const cy=tp.y-44;
    g.fillStyle='#c9971f';g.strokeStyle='rgba(94,64,10,.6)';g.lineWidth=1;
    g.beginPath();g.arc(tp.x,cy+6,13,Math.PI,0);g.closePath();g.fill();g.stroke();
    g.fillStyle='#e5c95c';
    g.beginPath();g.arc(tp.x-4,cy+3,4.6,0,7);g.fill();
    g.fillStyle='rgba(255,248,220,.75)';
    g.beginPath();g.arc(tp.x-5.5,cy+1.5,1.8,0,7);g.fill();
    g.strokeStyle='rgba(94,64,10,.4)';g.lineWidth=.8;
    for(const dx of [-8,-3,3,8]){
      g.beginPath();g.moveTo(tp.x+dx,cy+6-Math.sqrt(Math.max(0,169-dx*dx))*.96);
      g.quadraticCurveTo(tp.x+dx*.8,cy+2,tp.x+dx*.55,cy+6);g.stroke();}
    // golden finial + team standards at the plinth corners
    g.strokeStyle='#e3b23c';g.lineWidth=1.4;
    g.beginPath();g.moveTo(tp.x,cy-7);g.lineTo(tp.x,cy-13);g.stroke();
    g.fillStyle='#e5c95c';g.beginPath();g.arc(tp.x,cy-14,1.6,0,7);g.fill();
    bannerAt(g,ip(.1,2.2).x,ip(.1,2.2).y-6,p,11);
    bannerAt(g,ip(2.2,.1).x,ip(2.2,.1).y-6,p,11);
    // grand arched portal
    archWin(g,b1.C,b1.B,.42,.58,0,14,'#2c2416','#8a6a2f');
  },
  gate(g,s,p){
    poly(g,[ip(0,.3),ip(1,.3),ip(1,.7),ip(0,.7)],'rgba(122,98,58,.4)');
    for(const gx of [-24,19]){
      g.fillStyle='#79572e';g.fillRect(gx,13-22,5.5,22);
      g.fillStyle='#9c7544';
      g.beginPath();g.moveTo(gx,13-22);g.lineTo(gx+2.7,13-27);g.lineTo(gx+5.5,13-22);g.closePath();g.fill();
      g.strokeStyle='rgba(30,20,8,.4)';g.lineWidth=.9;g.strokeRect(gx,13-22,5.5,22);
    }
    g.fillStyle='#5f4526';g.fillRect(-25,13-21,50,4);
    g.strokeStyle='rgba(30,20,8,.4)';g.strokeRect(-25,13-21,50,4);
    g.fillStyle=TEAMS[p].main;
    g.beginPath();g.moveTo(0,13-27);g.lineTo(8,13-24.5);g.lineTo(0,13-22);g.closePath();g.fill();
  },
};
/* Snow rim: whiten the top few pixels of every opaque column — the classic
   sprite trick; snow settles on every upward surface (ridges, eaves, chimney
   tops) without knowing any per-building geometry. Runs ONCE per cache build. */
function snowRim(c,lvl){
  const g2=c.getContext('2d');
  let im;try{im=g2.getImageData(0,0,c.width,c.height);}catch(e){return;}
  const d=im.data,w=c.width,h=c.height;
  const depth=lvl===2?13:7,al=lvl===2?.92:.62;
  for(let x=0;x<w;x++){
    for(let y=0;y<h;y++){
      const i=(y*w+x)*4;
      if(d[i+3]>60){
        for(let k=0;k<depth&&y+k<h;k++){
          const j=((y+k)*w+x)*4;
          if(d[j+3]<=60)break;
          const wgt=al*(1-k/depth);
          d[j]+= (246-d[j])*wgt; d[j+1]+=(249-d[j+1])*wgt; d[j+2]+=(253-d[j+2])*wgt;
        }
        break;
      }
    }
  }
  g2.putImageData(im,0,0);
}
function getBldSpr(type,p,built,stage,vr,sl){
  stage=built?0:(stage||0);
  sl=built?(sl||0):0;               // construction sites don't hold snow
  const age=G?G.P[p].age:3;
  const ab=age>=3?2:age>=2?1:0; // 0 thatch era · 1 shingle era · 2 imperial stone-and-gold
  vr=type==='house'?(vr||0):0;      // variance only where the cache stays tiny
  const key=type+'_'+p+'_'+(built?1:0)+'_'+stage+'_'+ab+'_'+vr+'_'+sl;
  if(ISPR[key])return ISPR[key];
  let sp;
  if(!built){
    const s=BLDS[type].size;
    sp=mkIsoSpr(s,24,(g,ss)=>{
      dirtPad(g,ss,.55);
      const M=ip(ss/2,ss/2);
      // lumber pile on site at every stage
      poly(g,[{x:M.x-9,y:M.y+2},{x:M.x+5,y:M.y-5},{x:M.x+9,y:M.y-3},{x:M.x-5,y:M.y+4}],'#caa66b',O2);
      poly(g,[{x:M.x-7,y:M.y-2},{x:M.x+7,y:M.y-9},{x:M.x+10,y:M.y-7},{x:M.x-4,y:M.y}],'#b8945a',O2);
      if(stage===0){
        // staked-out plot with rope lines
        for(const [cx,cy] of [[0,0],[ss,0],[ss,ss],[0,ss]]){
          const P=ip(cx,cy);
          g.fillStyle='#6b4a2a';g.fillRect(P.x-1.2,P.y-6,2.4,6);
        }
        g.strokeStyle='rgba(200,175,130,.8)';g.lineWidth=1;
        g.setLineDash([3,3]);
        const A=ip(0,0),B=ip(ss,0),C2=ip(ss,ss),D=ip(0,ss);
        g.beginPath();g.moveTo(A.x,A.y-4);g.lineTo(B.x,B.y-4);g.lineTo(C2.x,C2.y-4);
        g.lineTo(D.x,D.y-4);g.closePath();g.stroke();
        g.setLineDash([]);
      }else{
        if(stage===2){
          // half-raised timber walls
          const w=isoBlock(g,.1,.1,ss-.2,ss-.2,0,8,{l:'#a3855a',r:'#8f7148',t:'#b09468',o:O2});
          planks(g,w.D,w.C,8,4);planks(g,w.C,w.B,8,4);
        }
        const ph=stage===1?13:19;
        for(const [cx,cy] of [[0,0],[ss,0],[ss,ss],[0,ss]]){
          const P=ip(cx,cy);
          g.fillStyle='#6b4a2a';g.fillRect(P.x-1.6,P.y-ph,3.2,ph);
        }
        g.strokeStyle='#6b4a2a';g.lineWidth=1.8;
        const A=ip(0,0),B=ip(ss,0),D=ip(0,ss);
        g.beginPath();g.moveTo(A.x,A.y-ph+2);g.lineTo(B.x,B.y-ph+2);
        g.moveTo(A.x,A.y-ph+2);g.lineTo(D.x,D.y-ph+2);g.stroke();
        if(stage===2){
          // scaffold brace + walk plank
          g.strokeStyle='#93744a';g.lineWidth=1.3;
          const C2=ip(ss,ss);
          g.beginPath();g.moveTo(D.x,D.y-2);g.lineTo(C2.x,C2.y-ph+3);
          g.moveTo(C2.x,C2.y-2);g.lineTo(B.x,B.y-ph+3);g.stroke();
          g.strokeStyle='#b08a52';g.lineWidth=2.2;
          g.beginPath();g.moveTo(D.x,D.y-ph+4);g.lineTo(C2.x,C2.y-ph+4);g.stroke();
        }
      }
    });
  }else sp=mkIsoSpr(BLDS[type].size,IHT[type],(g,ss)=>ISO_ART[type](g,ss,p,ab,vr));
  if(sl)snowRim(sp.c,sl);
  ISPR[key]=sp;return sp;
}
/* ---------- entity drawing ---------- */
function drawBld(b){
  const d=BLDS[b.type];
  const bl=elevTile(b.tx+b.size/2,b.ty+b.size/2)*10;
  const pt=isoPt(b.tx,b.ty),pc=isoPt(b.tx+b.size/2,b.ty+b.size/2);
  pt.y-=bl;pc.y-=bl;
  if(G.sel.includes(b.id)||(G.inspect&&G.inspect.id===b.id)){
    ctx.strokeStyle=G.inspect&&G.inspect.id===b.id?'rgba(230,230,230,.7)':'rgba(255,255,255,.95)';ctx.lineWidth=1.8;
    ctx.beginPath();ctx.ellipse(pc.x,pc.y,b.size*IW*.82,b.size*IH*.82,0,0,7);ctx.stroke();
    if(b.rally&&b.p===localP){ // the rally flag, with a dashed guide from the door
      const rp=isoPt(b.rally.x+.5,b.rally.y+.5);rp.y-=elevTile(b.rally.x,b.rally.y)*10;
      ctx.save();
      ctx.setLineDash([4,4]);ctx.strokeStyle='rgba(240,216,120,.55)';ctx.lineWidth=1.4;
      ctx.beginPath();ctx.moveTo(pc.x,pc.y);ctx.lineTo(rp.x,rp.y);ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle='#6b4e12';ctx.lineWidth=1.6;
      ctx.beginPath();ctx.moveTo(rp.x,rp.y);ctx.lineTo(rp.x,rp.y-14);ctx.stroke();
      ctx.fillStyle=TEAMS[localP].main;
      ctx.beginPath();ctx.moveTo(rp.x,rp.y-14);ctx.lineTo(rp.x+9,rp.y-11);ctx.lineTo(rp.x,rp.y-8);
      ctx.closePath();ctx.fill();
      ctx.strokeStyle='rgba(0,0,0,.4)';ctx.lineWidth=.7;ctx.stroke();
      ctx.restore();
    }
  }
  // forge-rendered town (G1); the procedural sprite below stays the fallback
  // AND the metrics source for the flash/HP/queue overlays
  const bR=bsprDraw(b,pt,bl);
  const stage=b.built?0:Math.min(2,Math.floor(3*b.prog/BLDS[b.type].bt));
  const sp=getBldSpr(b.type,b.p,b.built,stage,hash2(b.tx,b.ty)%3,wxSnowLvl);
  // buildings draw larger than their footprint art (BLD_VS2D — tuned by
  // Daniel, currently +25% over the 1.13 base), anchored at the south corner
  // so they gain presence without shifting their base. VISUAL ONLY. Walls and
  // farms stay footprint-true: they tile edge-to-edge.
  const BS=d.thin||d.farm?1:BLD_VS2D;
  if(!bR){
    if(BS===1)ctx.drawImage(sp.c,pt.x-sp.ox,pt.y-sp.oy,sp.w,sp.h);
    else{
      const southY=pt.y+2*b.size*IH;
      ctx.drawImage(sp.c,pt.x-sp.ox*BS,southY-(sp.oy+2*b.size*IH)*BS,sp.w*BS,sp.h*BS);
    }
  }
  if(BLDS[b.type].gate&&b.built){
    let open=false;
    for(const u2 of G.units){if(!allied(u2.p,b.p))continue;
      if(Math.hypot(u2.x-(b.tx+.5),u2.y-(b.ty+.5))<1.5){open=true;break;}}
    ctx.fillStyle=b.type==='sgate'?'#9a948a':'#8a6538';ctx.strokeStyle='rgba(30,20,8,.4)';ctx.lineWidth=.8;
    if(open){
      ctx.fillRect(pc.x-20,pc.y-16,4,13);ctx.strokeRect(pc.x-20,pc.y-16,4,13);
      ctx.fillRect(pc.x+16,pc.y-16,4,13);ctx.strokeRect(pc.x+16,pc.y-16,4,13);
    }else{
      ctx.fillRect(pc.x-17,pc.y-17,34,15);ctx.strokeRect(pc.x-17,pc.y-17,34,15);
      ctx.strokeStyle='rgba(30,20,8,.35)';ctx.lineWidth=.7;
      for(let lx=pc.x-13;lx<pc.x+15;lx+=4.2){
        ctx.beginPath();ctx.moveTo(lx,pc.y-17);ctx.lineTo(lx,pc.y-2);ctx.stroke();}
      ctx.strokeStyle='#5f4526';ctx.lineWidth=1.6;
      ctx.beginPath();ctx.moveTo(pc.x-17,pc.y-10);ctx.lineTo(pc.x+17,pc.y-10);ctx.stroke();
    }
  }
  if(b.flash>0){
    ctx.globalAlpha=Math.min(.4,b.flash*2.6);
    ctx.fillStyle='#fff';
    if(bR)ctx.fillRect(bR.x,bR.y,bR.w,bR.h);
    else ctx.fillRect(pt.x-sp.ox,pt.y-sp.oy,sp.w,sp.h);
    ctx.globalAlpha=1;
  }
  if(b.built&&b.hp<b.maxhp*.75&&!d.thin&&!d.farm)drawFlames(b);
  const barY=pt.y-sp.oy-3,barX=pc.x-15;
  if(!b.built){
    ctx.fillStyle='rgba(16,12,6,.75)';ctx.fillRect(barX,barY,30,4);
    ctx.fillStyle='#e5c95c';ctx.fillRect(barX+.5,barY+.5,29*(b.prog/d.bt),3);
  }else if(b.hp<b.maxhp){
    ctx.fillStyle='rgba(16,12,6,.75)';ctx.fillRect(barX,barY,30,4);
    ctx.fillStyle=b.hp/b.maxhp>.4?'#5c9141':'#c2493d';
    ctx.fillRect(barX+.5,barY+.5,29*(b.hp/b.maxhp),3);
  }
  if(b.built&&b.queue.length){
    const t=b.queue[0]==='AGE'?AGE_TIME[G.P[b.p].age+1]:UNITS[b.queue[0]].train;
    const qy=pc.y+b.size*IH+3;
    ctx.fillStyle='rgba(16,12,6,.75)';ctx.fillRect(barX,qy,30,3.5);
    ctx.fillStyle='#efe2bd';ctx.fillRect(barX+.5,qy+.5,29*(b.qt/t),2.5);
  }
}
/* Fire and smoke on damaged buildings, by tier: below 75% HP a building
   smoulders (smoke only), below 50% it burns, below 25% it's an inferno.
   Everything is STATELESS — derived from G.t, b.id and hp each frame, so
   there are no particle arrays to grow, nothing to serialize, and two
   lockstep peers can disagree about every pixel of it. */
function drawFlames(b){
  const r=b.hp/b.maxhp;
  const tier=r<.25?2:r<.5?1:0;              // 0 smoulder, 1 burning, 2 inferno
  const pc=isoPt(b.tx+b.size/2,b.ty+b.size/2);
  pc.y-=elevTile(b.tx+b.size/2,b.ty+b.size/2)*10;
  const d=BLDS[b.type];
  if(tier>=1){ // scorched ground creeping out from a burning building
    const sc=Math.min(1,(1-r)*1.6);
    ctx.globalAlpha=.16+.12*tier;
    ctx.fillStyle='#191410';
    ctx.beginPath();ctx.ellipse(pc.x,pc.y+b.size*6,b.size*13*sc,b.size*6.5*sc,0,0,7);
    ctx.fill();ctx.globalAlpha=1;
  }
  const BSv=d.thin||d.farm?1:BLD_VS2D;
  const roofH=(IHT[b.type]||18)*BSv;        // anchor heights track the drawn art
  const nA=1+tier;                          // 1..3 fire points
  for(let i=0;i<nA;i++){
    const h=hash2(b.id*31+i*7,b.id*13+i*29);
    // anchor scattered over the footprint, lifted onto the body/roof
    const ax=pc.x+(((h%100)/100)-.5)*b.size*IW*.9;
    const ay=pc.y-roofH*(.25+((h>>>7)%40)/100)+b.size*IH*.3;
    // --- smoke first, flames paint over its base ---
    const puffs=tier===0?2:3;
    for(let s2=0;s2<puffs;s2++){
      const p=((G.t*.42)+(h>>>3)/97+s2/puffs)%1;
      const rise=(34+b.size*10+tier*9)*p;
      const sway=Math.sin(p*5.2+h)*5.5*p;
      const rad=3.4+8.5*p+tier*1.2;
      const al=(tier===0?.32:.45)*(1-p)*(p>.06?1:p/.06);
      const g2=52+70*p;                     // dark near the fire, paler as it thins
      ctx.fillStyle='rgba('+(g2|0)+','+((g2*.97)|0)+','+((g2*.94)|0)+','+al.toFixed(3)+')';
      ctx.beginPath();ctx.ellipse(ax+sway,ay-6-rise,rad,rad*.82,0,0,7);ctx.fill();
    }
    if(tier===0)continue;                   // smouldering: smoke without flame
    // --- layered flame tongues, two flicker phases so it never loops visibly ---
    const fl=.62+.26*Math.sin(G.t*13+b.id*3+i*2.4)+.16*Math.sin(G.t*7.3+i*5.1+b.id);
    const hgt=(11+tier*6+b.size*3)*fl;
    const tongue=(w,hh,col)=>{
      ctx.fillStyle=col;
      ctx.beginPath();
      ctx.moveTo(ax-w,ay);
      ctx.quadraticCurveTo(ax-w*.6,ay-hh*.55,ax+Math.sin(G.t*9+i)*w*.4,ay-hh);
      ctx.quadraticCurveTo(ax+w*.6,ay-hh*.55,ax+w,ay);ctx.closePath();ctx.fill();
    };
    tongue(4.4+tier,hgt,'rgba(168,52,12,.72)');          // deep red base
    tongue(3.2+tier*.6,hgt*.82,'rgba(226,110,30,.88)');  // orange body
    tongue(1.9,hgt*.55,'rgba(250,210,90,.92)');          // yellow core
    if(tier===2)tongue(1,hgt*.32,'rgba(255,250,225,.9)');// white heart
    // warm glow licking the wall behind the fire
    ctx.fillStyle='rgba(255,150,50,'+(.05+.04*fl).toFixed(3)+')';
    ctx.beginPath();ctx.ellipse(ax,ay-2,11+tier*3,7+tier*2,0,0,7);ctx.fill();
  }
}
/* ---------- directional unit rig: shared 3D-joint projection core ----------
   local space: x = unit's right, y = forward, z = up (pre-scale px).
   phi = ground screen angle of the world heading (isoPt basis: screen dir of
   (wx,wy) is ((wx-wy),(wx+wy)*0.5)); quantized to 8 octants for the
   pre-rendered-sprite AoE2 read. depth d: bigger = nearer the camera. */
const R8=Math.PI/4,ZS=1.22,GY=4;
function q8(phi){return Math.round(phi/R8)*R8;}
function screenPhi(u){
  if(u.hdg===undefined)return (u.face||1)>0?0:Math.PI; // portraits + old saves
  const wx=Math.cos(u.hdg),wy=Math.sin(u.hdg);
  return Math.atan2(wx+wy,wx-wy);
}
function rigProj(phi){
  const c=Math.cos(phi),s=Math.sin(phi);
  const p=(x,y,z)=>{const gx=y*c-x*s,gy=y*s+x*c;return{x:gx,y:gy*.5-z*ZS+GY,d:gy};};
  p.c=c;p.s=s;
  p.a=Math.atan2(.5*s,c);              // screen angle of the forward axis
  p.fs=Math.sqrt(c*c+.25*s*s);         // forward foreshorten: 1 profile, .5 head-on
  return p;
}
function legPose(ph,stride,lift,duty){ // stance: planted linear back-slide; swing: forward + sin lift
  ph-=Math.floor(ph);
  if(ph<duty)return{dy:stride*(.5-ph/duty),dz:0};
  const k=(ph-duty)/(1-duty);
  return{dy:stride*(k-.5),dz:lift*Math.sin(Math.PI*k)};
}
function bump01(x){x-=Math.floor(x);return x<.16?Math.sin(x/.16*Math.PI):0;}
function gaitOf(u,t){
  const hasPath=!!(u.path&&u.path.length);
  const spd=u.spd!==undefined?u.spd:(hasPath?speedOf(u):0);
  const mv=spd>.05;
  let ph=u.gaitPh!==undefined?u.gaitPh:t*.16;
  ph=Math.floor(ph*10)/10; // 10 hard poses per cycle — the pre-rendered sprite feel
  const canter=spd>1.1&&u.type!=='elephant';
  const lift=!mv?0:canter?.7*(bump01(ph-.42)+bump01(ph-.92))
                        :.18*Math.abs(Math.sin(Math.PI*2*ph));
  return{mv,spd,ph,canter,lift};
}
// one attack timeline for every rof (fixes chukonu rof 1.0 never showing a read):
// windup coils through the last .3s of the countdown, damage fires at the reset,
// strike pose .12s after, recover .3s. k: 0 rest / 1 windup / 2 strike / 3 recover
function atkPhase(u){
  if(u.state!=='attack')return null;
  const d=UNITS[u.type],rof=d.ram?2.4:(d.rof||1.5);
  const cd=u.cd>0?u.cd:0,el=rof-u.cd;
  if(cd>0&&cd<=.3)return{k:1,f:1-cd/.3};
  if(el>=0&&el<.12)return{k:2,f:el/.12};
  if(el>=.12&&el<.42)return{k:3,f:(el-.12)/.3};
  return{k:0,f:0};
}
// octant facing with hysteresis so turning units don't flicker between poses
function octPhi(u){
  const phi=screenPhi(u);
  if(u._oct===undefined||Math.abs(wrapA(phi-u._oct*R8))>R8/2+.14)
    u._oct=Math.round(phi/R8);
  return u._oct*R8;
}
/* ---------- humanoid rig: one direction-aware renderer for all infantry ---------- */
const MAN_COSTUME={
  villager:{tunic:'team',legC:'#5a4023',belt:'rope',helm:'straw',weapon:'tool'},
  militia: {tunic:'team',legC:'#3c2f1e',belt:'mail',helm:'steel',weapon:'sword',shield:true},
  spear:   {tunic:'#c9b07f',legC:'#4a3a26',helm:'kettle',weapon:'spear',buckler:true,tabard:true},
  woad:    {tunic:'#d8b58e',legC:'#c49a70',helm:'topknot',weapon:'spear',paint:true},
  archer:  {tunic:'dark',legC:'#4a3a26',belt:'leather',helm:'cap',weapon:'bow',quiver:true},
  skirm:   {tunic:'#8a6538',legC:'#4a3a26',belt:'leather',helm:'band',weapon:'javelin',buckler:true,sash:true},
  monk:    {tunic:'#b09468',legC:'#6b5330',helm:'hood',weapon:'staff',robe:true},
  samurai: {tunic:'team',legC:'#3c2f1e',belt:'leather',helm:'topknot',weapon:'sword',sash:true},
  jaguar:  {tunic:'#c9a15e',legC:'#c49a70',helm:'jaguar',weapon:'sword',spots:true},
  eagle:   {tunic:'team',legC:'#c49a70',helm:'plume',weapon:'spear',paint:true},
  plumed:  {tunic:'dark',legC:'#4a3a26',belt:'leather',helm:'plume',weapon:'bow',quiver:true,sash:true},
  petard:  {tunic:'#8a6538',legC:'#4a3a26',belt:'leather',helm:'steel',weapon:'bomb'},
  handcannon:{tunic:'team',legC:'#4a3a26',belt:'leather',helm:'kettle',weapon:'gun'},
  king:     {tunic:'team',legC:'#4a3a26',helm:'crown',weapon:'none',robe:true},
};
function drawManRig(u,t,TC,mc){
  const phi=octPhi(u),pr=rigProj(phi),s=pr.s,c=pr.c,sgn=c>=0?1:-1;
  const g=gaitOf(u,t);
  const ap=atkPhase(u);
  // stiffer, sprite-like gait; standing units breathe so they never read as frozen
  const bob=g.mv?Math.abs(Math.sin(Math.PI*2*g.ph))*.3
                :Math.sin(t*.55+(u.id||0)*1.7)*.22;
  const tunicC=mc.tunic==='team'?TC.main:mc.tunic==='dark'?TC.dark:mc.tunic;
  const working=u.state==='gather'||u.state==='farming'||u.state==='building';
  ctx.save();ctx.translate(0,-bob);
  if(ap&&(ap.k===2||ap.k===3)&&mc.weapon!=='bow'&&mc.weapon!=='javelin'&&mc.weapon!=='staff'){
    const k=ap.k===2?2.4*ap.f:2.4*(1-ap.f)*.5; // directional melee lunge (restrained)
    ctx.translate(Math.cos(pr.a)*k,Math.sin(pr.a)*k);}
  /* legs (or robe hem) */
  if(mc.robe){
    ctx.fillStyle=tunicC;ctx.strokeStyle=OUT;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(-3.6,4);ctx.quadraticCurveTo(0,5.2,3.6,4);
    ctx.lineTo(2.9,-1);ctx.lineTo(-2.9,-1);ctx.closePath();ctx.fill();ctx.stroke();
    if(g.mv){ctx.strokeStyle='rgba(30,20,8,.3)';ctx.lineWidth=.7;
      const kx=Math.sin(Math.PI*2*g.ph)*1.2;
      ctx.beginPath();ctx.moveTo(kx,-0.5);ctx.lineTo(kx*.6,3.6);ctx.stroke();}
  }else{
    const legJ=[{x:-1.15,off:0},{x:1.15,off:.5}];
    const legDraw=(L,near)=>{
      const lp=g.mv?legPose(g.ph+L.off,2.4,1.5,.58):{dy:L.x<0?-.22:.22,dz:0};
      const hip=pr(L.x,0,6.1),knee=pr(L.x,lp.dy*.45+.6,3.1+lp.dz*.5),ft=pr(L.x,lp.dy,lp.dz);
      ctx.strokeStyle='rgba(64,44,26,.52)';ctx.lineWidth=near?3:2.6;
      ctx.beginPath();ctx.moveTo(hip.x,hip.y);ctx.quadraticCurveTo(knee.x,knee.y,ft.x,ft.y);ctx.stroke();
      ctx.strokeStyle=mc.legC;ctx.lineWidth=near?1.9:1.5;
      ctx.beginPath();ctx.moveTo(hip.x,hip.y);ctx.quadraticCurveTo(knee.x,knee.y,ft.x,ft.y);ctx.stroke();
      if(near){ctx.strokeStyle='#2e2012';ctx.lineWidth=1.8;
        ctx.beginPath();ctx.moveTo(ft.x-.5,ft.y+.05);ctx.lineTo(ft.x+1.4,ft.y+.05);ctx.stroke();}
    };
    const l0d=pr(legJ[0].x,0,0).d;
    legDraw(legJ[0],l0d>=0);legDraw(legJ[1],l0d<0);
  }
  /* back gear behind the torso when it faces away from camera */
  const quiver=()=>{if(!mc.quiver)return;
    const Q=pr(-1.9,-2,10.3);
    ctx.save();ctx.translate(Q.x,Q.y);ctx.rotate(.45*sgn);
    ctx.fillStyle='#6b4a2a';ctx.strokeStyle=OUT;ctx.lineWidth=.7;
    ctx.fillRect(-1.2,-2.6,2.4,5.8);ctx.strokeRect(-1.2,-2.6,2.4,5.8);
    ctx.strokeStyle='#e8e0c8';ctx.lineWidth=.7;
    ctx.beginPath();ctx.moveTo(-.5,-2.6);ctx.lineTo(-.6,-4.2);
    ctx.moveTo(.3,-2.6);ctx.lineTo(.3,-4);ctx.stroke();
    ctx.fillStyle='#b03a30';ctx.beginPath();ctx.arc(-.6,-4.3,.5,0,7);ctx.fill();
    ctx.restore();};
  const sack=()=>{if(!(u.carry>3))return;
    const B=pr(-2.2,-1.6,9.6);
    ctx.fillStyle=u.carryType==='food'?'#b03a30':u.carryType==='gold'?'#e3b23c':'#c9b07f';
    ctx.strokeStyle=OUT;ctx.lineWidth=.8;
    ctx.beginPath();ctx.ellipse(B.x,B.y,2.5,2.9,-.3*sgn,0,7);ctx.fill();ctx.stroke();};
  if(s>=-.2){quiver();sack();}
  const shieldDraw=()=>{
    if(mc.shield){ // heater-ish round shield on the left arm
      const Q=pr(-2.9,.7,9.5);
      ctx.fillStyle=TC.dark;ctx.strokeStyle='#8a6a2f';ctx.lineWidth=1.1;
      ctx.beginPath();ctx.ellipse(Q.x,Q.y,2.7*pr.fs+.5,3.7,pr.a,0,7);ctx.fill();ctx.stroke();
      ctx.strokeStyle=TC.trim;ctx.lineWidth=.8;
      ctx.beginPath();ctx.ellipse(Q.x,Q.y,1.7*pr.fs+.35,2.5,pr.a,0,7);ctx.stroke();
      ctx.fillStyle='#d8dbdf';ctx.strokeStyle='#7e858d';ctx.lineWidth=.5;
      ctx.beginPath();ctx.arc(Q.x,Q.y,.95,0,7);ctx.fill();ctx.stroke();
    }else if(mc.buckler){
      const Q=pr(-2.9,.7,9.4);
      ctx.fillStyle=TC.dark;ctx.strokeStyle='#8a6a2f';ctx.lineWidth=1;
      ctx.beginPath();ctx.ellipse(Q.x,Q.y,2.3*pr.fs+.4,2.4,pr.a,0,7);ctx.fill();ctx.stroke();
      ctx.strokeStyle=TC.trim;ctx.lineWidth=.7;
      ctx.beginPath();ctx.ellipse(Q.x,Q.y,1.5*pr.fs+.25,1.55,pr.a,0,7);ctx.stroke();
      ctx.fillStyle='#d8dbdf';ctx.beginPath();ctx.arc(Q.x,Q.y,.75,0,7);ctx.fill();
    }};
  if((mc.shield||mc.buckler)&&c>=0)shieldDraw();
  /* torso: near-cylindrical, silhouette constant across headings */
  const wide=mc.shield?4.6:4.2;
  const body=()=>{ctx.beginPath();
    ctx.moveTo(-2.9,-10.7);ctx.quadraticCurveTo(-wide-.2,-8,-wide,-2.6);
    ctx.lineTo(wide,-2.6);ctx.quadraticCurveTo(wide+.2,-8,2.9,-10.7);
    ctx.quadraticCurveTo(0,-11.7,-2.9,-10.7);ctx.closePath();};
  ctx.fillStyle=tunicC;body();ctx.fill();
  volShade(body);
  ctx.strokeStyle=OUT;ctx.lineWidth=1.1;body();ctx.stroke();
  if(mc.paint){ // woad warpaint across the bare chest
    ctx.strokeStyle='#3a5f9e';ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(-3,-9);ctx.lineTo(3,-6);
    ctx.moveTo(-3,-6);ctx.lineTo(3,-3.2);ctx.stroke();
  }
  if(mc.spots){ // jaguar-pelt rosettes
    ctx.fillStyle='rgba(60,42,20,.75)';
    for(const[px2,py2] of [[-2.6,-8.6],[1.8,-9.4],[-.6,-6.2],[2.8,-5],[-3.2,-4.4],[.8,-3.6]]){
      ctx.beginPath();ctx.arc(px2,py2,.75,0,7);ctx.fill();}
  }
  if(mc.tabard){ // padded jack quilting + team tabard
    ctx.strokeStyle='rgba(120,95,55,.5)';ctx.lineWidth=.6;
    for(const hy of [-9,-7,-5]){ctx.beginPath();ctx.moveTo(-3.8,hy);ctx.lineTo(3.8,hy);ctx.stroke();}
    ctx.fillStyle=TC.main;ctx.fillRect(-1.7,-10.4,3.4,7.6);
    ctx.fillStyle='rgba(22,13,5,.18)';ctx.fillRect(.4,-10.4,1.3,7.6);
  }
  if(mc.sash){ctx.strokeStyle=TC.main;ctx.lineWidth=1.8;
    ctx.beginPath();ctx.moveTo(-2.6,-10);ctx.lineTo(2.6,-3.4);ctx.stroke();}
  if(mc.belt==='mail'){
    ctx.fillStyle='#9aa0a6';ctx.fillRect(-4.2,-4.4,8.4,2.2);
    if(!RIG_LOD){
      ctx.strokeStyle='rgba(60,64,70,.55)';ctx.lineWidth=.5;
      for(const lx of [-3,-1.4,.2,1.8,3.4]){
        ctx.beginPath();ctx.moveTo(lx,-4.4);ctx.lineTo(lx,-2.2);ctx.stroke();}
    }
    ctx.fillStyle='rgba(255,255,255,.25)';ctx.fillRect(-4.2,-4.4,8.4,.7);
  }else if(mc.belt==='rope'){
    ctx.fillStyle=TC.dark;ctx.fillRect(-4,-4.6,8,1.7);
    ctx.fillStyle='#c9b07f';ctx.fillRect(-.8,-4.8,1.6,2.1);
  }else if(mc.belt==='leather'){
    ctx.fillStyle='#6b4a2a';ctx.fillRect(-3.6,-4.6,7.2,1.4);
  }else if(mc.robe){
    ctx.fillStyle=TC.main;ctx.fillRect(-4,-4.6,8,1.4);
  }
  if((mc.shield||mc.buckler)&&c<0)shieldDraw();
  if(s<-.2){quiver();sack();}
  /* arms + weapon */
  const swing=g.mv&&!working?Math.sin(Math.PI*2*g.ph)*1.9:0;
  const armIdle=(side,swg)=>{ // sleeve upper + skin forearm + hand, swings along facing
    const sh=pr(side*2.6,0,10.6),el=pr(side*2.7,swg*.5,8.6),hd2=pr(side*2.7,swg,6.9);
    limb(sh.x,sh.y,el.x,el.y,tunicC,1.8);
    limb(el.x,el.y,hd2.x,hd2.y,SKIN,1.5);hand(hd2.x,hd2.y);};
  if(mc.weapon==='tool'){
    if(working){
      // real tool stroke: slow lift, snap down on the strike, brief settle —
      // a plain sine read as limp waving
      // phased so the blade bottoms out exactly as the resource tick fires
      // (gatherT wraps at 1 and spawns the chips) — the hit and the chips land together
      const ph=(u.gatherT||0)%1;
      let a;
      if(ph<.18)a=-1.1+(ph/.18)*.6;                      // settle after the last blow
      else if(ph<.80)a=-.5+Math.pow((ph-.18)/.62,.8)*1.5; // lift and hold high
      else a=1.0-Math.pow((ph-.80)/.20,.7)*2.1;           // snap down onto the wood
      const sh=pr(2.3,1,10.2);
      ctx.save();ctx.translate(sh.x,sh.y);ctx.rotate(pr.a*.6+a);
      limb(0,0,2.4,.6,tunicC,1.7);
      limb(2.4,.6,4.5,1,SKIN,1.5);hand(4.7,1);
      ctx.strokeStyle='#6b4a2a';ctx.lineWidth=1.4;
      ctx.beginPath();ctx.moveTo(4.5,1);ctx.lineTo(7,0);ctx.stroke();
      ctx.fillStyle='#9aa0a6';ctx.fillRect(6,-2.4,2.6,3);
      ctx.fillStyle='#d8dbdf';ctx.fillRect(6.2,-2.2,2.2,1);
      ctx.restore();
      armIdle(-1,0);
    }else{armIdle(-1,-swing);armIdle(1,swing);}
  }else if(mc.weapon==='sword'){
    armIdle(-1,-swing*.5);
    const rest=-1.0;
    const swingA=!ap?rest:ap.k===1?rest-.9*ap.f          // coil back
      :ap.k===2?-1.9+2.6*ap.f                            // sweep through the arc
      :ap.k===3?.7+(rest-.7)*ap.f:rest;                  // settle
    const ang=swingA+pr.a*.5;
    const sh=pr(2.5,.6,10.4);
    ctx.save();ctx.translate(sh.x,sh.y);ctx.rotate(ang);
    limb(0,0,2.2,.5,tunicC,1.6);
    hand(2.5,.5);
    ctx.strokeStyle='#8a8f96';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(3,.4);ctx.lineTo(10.8,.4);ctx.stroke();
    ctx.strokeStyle='#eef1f4';ctx.lineWidth=.7;
    ctx.beginPath();ctx.moveTo(3.2,-.1);ctx.lineTo(10.6,-.1);ctx.stroke();
    ctx.strokeStyle='#8a6a2f';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(2.8,-1.9);ctx.lineTo(2.8,2.6);ctx.stroke();
    ctx.restore();
  }else if(mc.weapon==='spear'){
    const th=!ap?0:ap.k===1?-1.4*ap.f:ap.k===2?9*ap.f:ap.k===3?9*(1-ap.f):0;
    const s0=pr(1.2,-2.2+th,7.2),s1=pr(.5,6.2+th,14.2);
    ctx.strokeStyle='#8a5a2b';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(s0.x,s0.y);ctx.lineTo(s1.x,s1.y);ctx.stroke();
    const dx=s1.x-s0.x,dy=s1.y-s0.y,dl=Math.hypot(dx,dy)||1,ux=dx/dl,uy=dy/dl;
    ctx.fillStyle='#d8dbdf';ctx.strokeStyle='#7e858d';ctx.lineWidth=.5;
    ctx.beginPath();ctx.moveTo(s1.x+ux*2.6,s1.y+uy*2.6);
    ctx.lineTo(s1.x-uy*1.2,s1.y+ux*1.2);ctx.lineTo(s1.x+uy*1.2,s1.y-ux*1.2);ctx.closePath();ctx.fill();ctx.stroke();
    hand(s0.x+dx*.34,s0.y+dy*.34);hand(s0.x+dx*.58,s0.y+dy*.58);
    armIdle(-1,-swing*.4);
  }else if(mc.weapon==='bow'){
    const H=pr(2.5,2.4,10.4),bul=3.2*pr.fs+.8,dir=pr(0,1,0).x>=0?0:Math.PI;
    ctx.strokeStyle='#7a5230';ctx.lineWidth=1.8;
    ctx.beginPath();ctx.ellipse(H.x,H.y,bul,4.6,0,dir-1.12,dir+1.12);ctx.stroke();
    ctx.strokeStyle='rgba(240,230,200,.85)';ctx.lineWidth=.7;
    const e1x=H.x+bul*Math.cos(dir-1.12),e1y=H.y+4.6*Math.sin(dir-1.12),
          e2x=H.x+bul*Math.cos(dir+1.12),e2y=H.y+4.6*Math.sin(dir+1.12);
    ctx.beginPath();ctx.moveTo(e1x,e1y);ctx.lineTo(e2x,e2y);ctx.stroke();
    if(u.state==='attack'&&u.cd>0&&u.cd<=.5){ // nock + draw + hold, loose at fire
      const a2=pr(2.5,6.6,10.4);
      ctx.strokeStyle='#4a3a24';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(H.x,H.y);ctx.lineTo(a2.x,a2.y);ctx.stroke();
      ctx.fillStyle='#d8dbdf';
      ctx.beginPath();ctx.moveTo(a2.x,a2.y);ctx.lineTo(a2.x+(a2.x-H.x)*.14-.7,a2.y-.8);
      ctx.lineTo(a2.x+(a2.x-H.x)*.14-.7,a2.y+.8);ctx.closePath();ctx.fill();
      const ch=pr(1.2,.8,11.6);hand(ch.x,ch.y);
    }
    const sh=pr(2.2,.4,10.6);
    limb(sh.x,sh.y,H.x,H.y,tunicC,1.5);hand(H.x,H.y);
    armIdle(-1,-swing*.4);
  }else if(mc.weapon==='javelin'){
    const th=!ap?0:ap.k===1?-1.2*ap.f:ap.k===2?8*ap.f:ap.k===3?8*(1-ap.f):0;
    const j0=pr(1.4,.2+th,7.8),j1=pr(.7,6.4+th,13.6);
    ctx.strokeStyle='#8a5a2b';ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(j0.x,j0.y);ctx.lineTo(j1.x,j1.y);ctx.stroke();
    const dx=j1.x-j0.x,dy=j1.y-j0.y,dl=Math.hypot(dx,dy)||1;
    ctx.fillStyle='#d8dbdf';
    ctx.beginPath();ctx.moveTo(j1.x+dx/dl*2.4,j1.y+dy/dl*2.4);
    ctx.lineTo(j1.x-dy/dl*1.1,j1.y+dx/dl*1.1);ctx.lineTo(j1.x+dy/dl*1.1,j1.y-dx/dl*1.1);ctx.closePath();ctx.fill();
    hand(j0.x+dx*.4,j0.y+dy*.4);
    armIdle(-1,-swing*.4);
  }else if(mc.weapon==='gun'){
    // handgonne held level across the chest; kicks and flashes on the shot
    const kick=ap&&ap.k===2?-(1-ap.f)*1.2:0;
    const g0=pr(1.6,-1.6+kick,9.4),g1=pr(1.2,5.4+kick,10.6);
    ctx.strokeStyle='#6a4a26';ctx.lineWidth=2.6;
    ctx.beginPath();ctx.moveTo(g0.x,g0.y);ctx.lineTo(g1.x,g1.y);ctx.stroke();
    ctx.strokeStyle='#4c5158';ctx.lineWidth=1.9;
    const gm=.35;
    ctx.beginPath();ctx.moveTo(g0.x+(g1.x-g0.x)*gm,g0.y+(g1.y-g0.y)*gm);ctx.lineTo(g1.x,g1.y);ctx.stroke();
    hand(g0.x+(g1.x-g0.x)*.3,g0.y+(g1.y-g0.y)*.3);
    hand(g0.x+(g1.x-g0.x)*.62,g0.y+(g1.y-g0.y)*.62);
    if(ap&&ap.k===2&&ap.f<.5){ // muzzle flash + smoke puff
      ctx.fillStyle='rgba(255,214,110,'+(0.9-ap.f*1.6)+')';
      ctx.beginPath();ctx.arc(g1.x,g1.y,2.6,0,7);ctx.fill();
      ctx.fillStyle='rgba(220,216,206,.35)';
      ctx.beginPath();ctx.arc(g1.x,g1.y-1.5,3.4,0,7);ctx.fill();
    }
    armIdle(-1,-swing*.3);
  }else if(mc.weapon==='staff'){
    const b0=pr(2.7,.4,1.2),b1=pr(2.7,.4,14.4);
    ctx.strokeStyle='#8a5a2b';ctx.lineWidth=1.4;
    ctx.beginPath();ctx.moveTo(b0.x,b0.y);ctx.lineTo(b1.x,b1.y);ctx.stroke();
    ctx.strokeStyle='#e5c95c';ctx.lineWidth=1.3;
    const c1=pr(2.7,.4,15.8),c2=pr(2.7,.4,17.4),c3=pr(1.7,.4,16.6),c4=pr(3.7,.4,16.6);
    ctx.beginPath();ctx.moveTo(b1.x,b1.y);ctx.lineTo(c2.x,c2.y);
    ctx.moveTo(c3.x,c3.y);ctx.lineTo(c4.x,c4.y);ctx.stroke();
    armIdle(-1,-swing*.4);
  }else if(mc.weapon==='none'){ // unarmed (the King): plain arms, and a gold
    armIdle(-1,-swing*.4);      // scepter held at rest in the right hand
    armIdle(1,swing*.4);
    const sc0=pr(2.7,.4,5.4),sc1=pr(2.7,.4,10.8);
    ctx.strokeStyle='#c9a227';ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(sc0.x,sc0.y);ctx.lineTo(sc1.x,sc1.y);ctx.stroke();
    ctx.fillStyle='#e5c95c';ctx.beginPath();ctx.arc(sc1.x,sc1.y,1.1,0,7);ctx.fill();
  }
  /* head */
  const H2=pr(0,.3,13.9);
  const facing=s>-.2;
  ctx.fillStyle=SKIN;ctx.strokeStyle=OUT;ctx.lineWidth=.9;
  ctx.beginPath();ctx.arc(H2.x,H2.y,2.95,0,7);ctx.fill();ctx.stroke();
  if(facing&&!RIG_LOD)faceEye(H2.x,H2.y,2.95);
  if(mc.helm==='straw'){
    ctx.fillStyle='#5a3d22';
    ctx.beginPath();ctx.arc(H2.x,H2.y-.5,2.9,Math.PI*.9,Math.PI*2.1);ctx.fill();
    ctx.fillStyle='#c9b07f';ctx.strokeStyle='#8a6a2f';ctx.lineWidth=.6;
    ctx.beginPath();ctx.ellipse(H2.x,H2.y-2.2,3.6,1.2,0,0,7);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.arc(H2.x,H2.y-2.8,1.9,Math.PI,2*Math.PI);ctx.fill();ctx.stroke();
  }else if(mc.helm==='steel'){
    ctx.fillStyle='#b9bec4';ctx.strokeStyle='#7e858d';ctx.lineWidth=.8;
    ctx.beginPath();ctx.arc(H2.x,H2.y-.6,3.15,Math.PI*.95,Math.PI*2.05);ctx.fill();ctx.stroke();
    ctx.strokeStyle='#eef1f4';ctx.lineWidth=.6;
    ctx.beginPath();ctx.arc(H2.x-.5,H2.y-.9,2.45,Math.PI*1.15,Math.PI*1.65);ctx.stroke();
    if(facing){ctx.strokeStyle='#b9bec4';ctx.lineWidth=1.2;
      ctx.beginPath();ctx.moveTo(H2.x+.6,H2.y-.4);ctx.lineTo(H2.x+.6,H2.y+1.7);ctx.stroke();}
    const age=G?G.P[u.p].age:0;
    if(age>=2||u.type==='teuton'){
      ctx.fillStyle='#b9bec4';ctx.strokeStyle='#7e858d';ctx.lineWidth=.7;
      const pl=pr(-3.1,.3,9.7),prr=pr(3.1,.3,9.7);
      ctx.beginPath();ctx.arc(pl.x,pl.y,1.7,0,7);ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.arc(prr.x,prr.y,1.7,0,7);ctx.fill();ctx.stroke();
    }
    if(age>=3&&u.type==='militia'){
      ctx.strokeStyle='#e3b23c';ctx.lineWidth=1.3;
      ctx.beginPath();ctx.moveTo(H2.x-2.4,H2.y-3.2);ctx.quadraticCurveTo(H2.x,H2.y-5.4,H2.x+2.4,H2.y-3.2);ctx.stroke();
    }
    if(u.type==='berserker'){
      ctx.strokeStyle='#e8e0c8';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(H2.x-3,H2.y-2);ctx.quadraticCurveTo(H2.x-5.2,H2.y-4,H2.x-4.5,H2.y-6);
      ctx.moveTo(H2.x+3,H2.y-2);ctx.quadraticCurveTo(H2.x+5.2,H2.y-4,H2.x+4.5,H2.y-6);ctx.stroke();
    }
    if(u.type==='teuton'){
      ctx.fillStyle='#b9bec4';ctx.strokeStyle='#7e858d';ctx.lineWidth=.8;
      ctx.fillRect(H2.x-3.2,H2.y-3.6,6.4,4.8);ctx.strokeRect(H2.x-3.2,H2.y-3.6,6.4,4.8);
      if(facing){ctx.fillStyle='#2c2f33';ctx.fillRect(H2.x-2.2,H2.y-1.7,4.4,1);}
    }
  }else if(mc.helm==='kettle'){
    ctx.fillStyle='#b9bec4';ctx.strokeStyle='#7e858d';ctx.lineWidth=.8;
    ctx.beginPath();ctx.ellipse(H2.x,H2.y-1.4,4.1,1.5,0,0,7);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.arc(H2.x,H2.y-2,2.3,Math.PI,0);ctx.fill();
    ctx.strokeStyle='#eef1f4';ctx.lineWidth=.6;
    ctx.beginPath();ctx.ellipse(H2.x-.8,H2.y-1.7,2.6,.8,0,Math.PI*1.1,Math.PI*1.9);ctx.stroke();
  }else if(mc.helm==='topknot'){
    ctx.fillStyle='#7c5a34';
    ctx.beginPath();ctx.arc(H2.x,H2.y-3,1.3,0,7);ctx.fill();
    ctx.beginPath();ctx.arc(H2.x,H2.y-1.8,2.85,Math.PI,2*Math.PI);ctx.fill();
    if(facing){ctx.strokeStyle='#3a5f9e';ctx.lineWidth=.8;
      ctx.beginPath();ctx.moveTo(H2.x+1,H2.y+.8);ctx.lineTo(H2.x+2.4,H2.y+.3);ctx.stroke();}
  }else if(mc.helm==='cap'){
    ctx.fillStyle=TC.main;
    ctx.beginPath();ctx.arc(H2.x,H2.y-.4,3.05,Math.PI*.85,Math.PI*2.15);
    ctx.lineTo(H2.x-sgn*4.2,H2.y+2.5);ctx.closePath();ctx.fill();
  }else if(mc.helm==='band'){
    ctx.strokeStyle=TC.main;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(H2.x-2.8,H2.y-.7);ctx.lineTo(H2.x+2.8,H2.y-.7);ctx.stroke();
  }else if(mc.helm==='hood'){
    ctx.fillStyle=tunicC;
    ctx.beginPath();ctx.arc(H2.x,H2.y-.4,3.1,facing?Math.PI*.8:0,facing?Math.PI*2.2:7);ctx.fill();
  }else if(mc.helm==='jaguar'){ // spotted pelt hood with ears
    ctx.fillStyle='#c9a15e';
    ctx.beginPath();ctx.arc(H2.x,H2.y-.4,3.15,Math.PI*.85,Math.PI*2.15);ctx.fill();
    ctx.beginPath();ctx.moveTo(H2.x-2.6,H2.y-2);ctx.lineTo(H2.x-3.4,H2.y-4.4);ctx.lineTo(H2.x-1.4,H2.y-3);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.moveTo(H2.x+2.6,H2.y-2);ctx.lineTo(H2.x+3.4,H2.y-4.4);ctx.lineTo(H2.x+1.4,H2.y-3);ctx.closePath();ctx.fill();
    ctx.fillStyle='rgba(60,42,20,.75)';
    for(const[ox2,oy2] of [[-1.8,-2.4],[.4,-3],[1.9,-2.2]]){
      ctx.beginPath();ctx.arc(H2.x+ox2,H2.y+oy2,.6,0,7);ctx.fill();}
  }else if(mc.helm==='crown'){ // gold circlet with points — the King
    ctx.fillStyle='#5a3d22';
    ctx.beginPath();ctx.arc(H2.x,H2.y-.6,2.95,Math.PI*.9,Math.PI*2.1);ctx.fill();
    ctx.fillStyle='#e3b23c';ctx.strokeStyle='#8a6a2f';ctx.lineWidth=.6;
    ctx.fillRect(H2.x-2.7,H2.y-3.3,5.4,1.5);ctx.strokeRect(H2.x-2.7,H2.y-3.3,5.4,1.5);
    for(const px3 of [-2.0,-.7,.7,2.0]){
      ctx.beginPath();ctx.moveTo(H2.x+px3-.55,H2.y-3.3);ctx.lineTo(H2.x+px3,H2.y-5.1);
      ctx.lineTo(H2.x+px3+.55,H2.y-3.3);ctx.closePath();ctx.fill();ctx.stroke();
    }
    ctx.fillStyle='#b03a30';ctx.beginPath();ctx.arc(H2.x,H2.y-2.55,.55,0,7);ctx.fill();
  }else if(mc.helm==='plume'){ // eagle-feather crest, team-tinted
    ctx.fillStyle='#7c5a34';
    ctx.beginPath();ctx.arc(H2.x,H2.y-1.2,2.9,Math.PI,2*Math.PI);ctx.fill();
    for(let f2=0;f2<5;f2++){
      const fa=Math.PI*(1.12+f2*.19);
      ctx.strokeStyle=f2%2?TC.main:'#e8e0c8';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(H2.x,H2.y-2.4);
      ctx.lineTo(H2.x+Math.cos(fa)*5.4,H2.y-2.4+Math.sin(fa)*5.4);ctx.stroke();}
  }
  if(mc.weapon==='bomb'){ // the petard's keg, hugged tight, fuse sparking
    const B=pr(2.2,1.2,9.6);
    ctx.fillStyle='#3a3a40';ctx.strokeStyle='rgba(64,44,26,.6)';ctx.lineWidth=.8;
    ctx.beginPath();ctx.arc(B.x,B.y,2.6,0,7);ctx.fill();ctx.stroke();
    ctx.strokeStyle='#8a8f96';ctx.lineWidth=.6;
    ctx.beginPath();ctx.arc(B.x,B.y,1.7,0,7);ctx.stroke();
    ctx.strokeStyle='#6b4a2a';ctx.lineWidth=.8;
    ctx.beginPath();ctx.moveTo(B.x+1,B.y-2.2);ctx.quadraticCurveTo(B.x+2.4,B.y-3.8,B.x+1.6,B.y-4.6);ctx.stroke();
    ctx.fillStyle=Math.sin(t*14)>0?'#ffd75e':'#e2761e';
    ctx.beginPath();ctx.arc(B.x+1.6,B.y-4.6,.7,0,7);ctx.fill();
    hand(B.x-2.2,B.y-.4);hand(B.x+.6,B.y+2.2);
  }
  /* monk extras */
  if(mc.weapon==='staff'&&u.state==='heal'){
    const a=.45+.35*Math.sin(t*2);
    ctx.strokeStyle='rgba(240,230,150,'+a+')';ctx.lineWidth=1.2;
    ctx.beginPath();ctx.arc(0,-8,6.5,0,7);ctx.stroke();
  }
  if(mc.weapon==='staff'&&u.relic){
    ctx.fillStyle='#c9a227';ctx.strokeStyle='#8a6a2f';ctx.lineWidth=.8;
    ctx.fillRect(-3,-21.5,6,3.4);ctx.strokeRect(-3,-21.5,6,3.4);
    ctx.fillStyle='#e5c95c';
    ctx.beginPath();ctx.moveTo(-3,-21.5);ctx.quadraticCurveTo(0,-24,3,-21.5);ctx.closePath();ctx.fill();
  }
  ctx.restore();
}
const CAV_COSTUME={
  scout:     {body:'#8a6b42',leg:'#5f4a2c',mane:'#6d5231',rider:'#7a5230',hat:'cap',   weapon:'spear'},
  knight:    {body:'#6b4a2f',leg:'#4f3620',mane:'#54381e',rider:'team',   hat:'steel', weapon:'lance',caparison:true,shield:true,armLeg:true},
  cataphract:{body:'#8d9299',leg:'#4f3620',mane:'#6f757c',rider:'team',   hat:'steel', weapon:'lance',barding:true,shield:true,armLeg:true},
  mangudai:  {body:'#8a6b42',leg:'#5f4a2c',mane:'#6d5231',rider:'#7a5230',hat:'fur',   weapon:'bow'},
  mameluke:  {body:'#c0a266',leg:'#96794a',mane:'#a3874f',rider:'#7a5230',hat:'turban',weapon:'scimitar',camel:true},
  conquistador:{body:'#54381e',leg:'#3c2a16',mane:'#2e2012',rider:'team', hat:'steel', weapon:'gun'},
  tarkan:    {body:'#8a6b42',leg:'#5f4a2c',mane:'#6d5231',rider:'#7a5230',hat:'fur',   weapon:'torch'},
  missionary:{body:'#8a6b42',leg:'#5f4a2c',mane:'#6d5231',rider:'#b09468',hat:'cowl'}
};
function poseHorse(u,t,cs){
  const g=gaitOf(u,t);
  const hips=[[-1.7,-4.3],[-1.6,3.6],[1.7,-4.3],[1.6,3.6]];   // LH LF RH RF
  const off  =g.canter?[0,.5,.5,0]:[0,.25,.5,.75];            // canter: diagonal pairs
  const stride=g.canter?3.6:2.3,liftA=g.canter?2.4:1.3,duty=g.canter?.42:.62;
  const legsJ=hips.map((h,i)=>{
    const lp=g.mv?legPose(g.ph+off[i],stride,liftA,duty):{dy:i%2?.3:-.3,dz:0};
    return{x:h[0],hy:h[1],fy:h[1]+lp.dy,fz:lp.dz,front:i%2===1};
  });
  const nod=g.mv?Math.sin(Math.PI*2*g.ph+1.2)*(g.canter?.8:.35):Math.sin(t*.25)*.25;
  const vols=[{y:-4.2,z:8.6,L:3.2,H:3.4},{y:0,z:8.1,L:3.4,H:3.1},{y:3.7,z:8.8,L:2.8,H:3.3}];
  if(cs.camel)vols.push({y:-.4,z:10.6,L:2.5,H:2.2});
  return{g,legsJ,nod,vols,
    neckB:{y:4.0,z:9.8},
    head:{y:cs.camel?6.0:8.6,z:(cs.camel?15.6:14.6)+nod*.35},
    tail:{y:-6.0,z:9.0}};
}
function drawHorseRig(u,t,TC,cs){
  const phi=octPhi(u),pr=rigProj(phi),c=pr.c,s=pr.s,sgn=c>=0?1:-1;
  const P=poseHorse(u,t,cs),g=P.g;
  ctx.save();ctx.translate(0,-g.lift);
  const apB=atkPhase(u); // directional mount surge on the strike
  if(apB&&(apB.k===2||apB.k===3)){
    const k=apB.k===2?4*apB.f:4*(1-apB.f)*.5;
    ctx.translate(Math.cos(pr.a)*k,Math.sin(pr.a)*k);}
  const legDraw=(J,near)=>{
    const top=pr(J.x,J.hy,8),knee=pr(J.x,(J.hy+J.fy)/2+(J.front?.5:-.6),3.6+J.fz*.5),ft=pr(J.x,J.fy,J.fz);
    if(!near){ctx.strokeStyle='rgba(24,15,6,.85)';ctx.lineWidth=2.1;
      ctx.beginPath();ctx.moveTo(top.x,top.y);ctx.quadraticCurveTo(knee.x,knee.y,ft.x,ft.y);ctx.stroke();return;}
    ctx.strokeStyle='rgba(64,44,26,.5)';ctx.lineWidth=2.6;
    ctx.beginPath();ctx.moveTo(top.x,top.y);ctx.quadraticCurveTo(knee.x,knee.y,ft.x,ft.y);ctx.stroke();
    ctx.strokeStyle=cs.leg;ctx.lineWidth=1.7;
    ctx.beginPath();ctx.moveTo(top.x,top.y);ctx.quadraticCurveTo(knee.x,knee.y,ft.x,ft.y);ctx.stroke();
    ctx.strokeStyle='#2e2012';ctx.lineWidth=1.8;
    ctx.beginPath();ctx.moveTo(ft.x-.8,ft.y);ctx.lineTo(ft.x+.8,ft.y);ctx.stroke();
  };
  for(const J of P.legsJ)if(pr(J.x,J.hy,0).d< -.28)legDraw(J,false);
  for(const J of P.legsJ)if(pr(J.x,J.hy,0).d>=-.28)legDraw(J,true);
  const headGrp=()=>{
    const nb=pr(0,P.neckB.y,P.neckB.z),hd=pr(0,P.head.y,P.head.z),mz=pr(0,P.head.y+1.9,P.head.z-.6);
    ctx.strokeStyle=OUT;ctx.lineWidth=4.4;
    ctx.beginPath();ctx.moveTo(nb.x,nb.y);ctx.quadraticCurveTo((nb.x+hd.x)/2,(nb.y+hd.y)/2-1.2,hd.x,hd.y);ctx.stroke();
    ctx.strokeStyle=cs.body;ctx.lineWidth=3.4;
    ctx.beginPath();ctx.moveTo(nb.x,nb.y);ctx.quadraticCurveTo((nb.x+hd.x)/2,(nb.y+hd.y)/2-1.2,hd.x,hd.y);ctx.stroke();
    ctx.fillStyle=cs.body;ctx.strokeStyle=OUT;ctx.lineWidth=.9;
    ctx.beginPath();ctx.ellipse(hd.x,hd.y,2.1,1.6,pr.a,0,7);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(hd.x,hd.y-1.1);ctx.lineTo(mz.x,mz.y-.5);ctx.lineTo(mz.x,mz.y+.6);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.moveTo(hd.x-.7,hd.y-1.4);ctx.lineTo(hd.x-.2,hd.y-3.2);ctx.lineTo(hd.x+.6,hd.y-1.4);ctx.closePath();ctx.fill();
    if(!cs.camel){const m0=pr(-.5,4.2,10.2),m1=pr(-.5,7.6,14.2);
      ctx.strokeStyle=cs.mane;ctx.lineWidth=1.8;
      ctx.beginPath();ctx.moveTo(m0.x,m0.y);ctx.quadraticCurveTo((m0.x+m1.x)/2,(m0.y+m1.y)/2-1,m1.x,m1.y);ctx.stroke();}
    if(s>.25&&!RIG_LOD){ // face details only close-up and facing the viewer
      ctx.fillStyle='#2e2012';
      ctx.beginPath();ctx.arc(hd.x+.6,hd.y-.5,.5,0,7);ctx.fill();
      ctx.beginPath();ctx.arc(mz.x-.2,mz.y,.35,0,7);ctx.fill();
      const rh=pr(1.4,1.4,12.8);
      ctx.strokeStyle='rgba(74,50,32,.8)';ctx.lineWidth=.6;
      ctx.beginPath();ctx.moveTo(mz.x,mz.y+.3);ctx.quadraticCurveTo((mz.x+rh.x)/2,(mz.y+rh.y)/2+1,rh.x,rh.y);ctx.stroke();
    }
  };
  const bodyGrp=()=>{
    const vols=s>=0?P.vols:[...P.vols].reverse();     // far->near by depth
    const volPath=v=>{const q=pr(0,v.y,v.z);ctx.ellipse(q.x,q.y,v.L*pr.fs+1,v.H+.7*Math.abs(s),pr.a,0,7);};
    for(const v of vols){ctx.fillStyle=cs.body;ctx.beginPath();volPath(v);ctx.fill();
      ctx.strokeStyle=OUT;ctx.lineWidth=1;ctx.stroke();}
    ctx.save();ctx.beginPath();for(const v of vols)volPath(v);ctx.clip();
    const b0=pr(0,0,5.6);
    ctx.fillStyle='rgba(20,12,4,.28)';
    ctx.beginPath();ctx.ellipse(b0.x,b0.y,7.5*pr.fs+1.2,1.9,pr.a,0,7);ctx.fill();
    ctx.fillStyle='rgba(255,240,205,.18)';ctx.fillRect(-12,b0.y-10,11,8);
    ctx.restore();
  };
  if(s<-.15){headGrp();bodyGrp();}else bodyGrp();
  const t0=pr(0,P.tail.y,P.tail.z),t1=pr(Math.sin(t*.35)*.8,-7.8,2.2);
  ctx.strokeStyle=cs.mane;ctx.lineWidth=cs.camel?1.4:2.2;
  ctx.beginPath();ctx.moveTo(t0.x,t0.y);ctx.quadraticCurveTo(t0.x+(t1.x-t0.x)*.3,t0.y+3,t1.x,t1.y);ctx.stroke();
  if(cs.caparison){
    const panel=(px,fill)=>{
      const a=pr(0,4.4,10.4),b=pr(0,-5.2,10.1),h1=pr(px,-5.5,2.7);
      ctx.fillStyle=fill;ctx.beginPath();
      ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(h1.x,h1.y);
      for(let i=1;i<=4;i++){const q=pr(px,-5.5+10.1*i/4,2.8),mm=pr(px,-5.5+10.1*(i-.5)/4,1.8);
        ctx.quadraticCurveTo(mm.x,mm.y,q.x,q.y);}
      ctx.closePath();ctx.fill();};
    panel(-sgn*2.3,TC.dark);
    panel(sgn*2.3,TC.main);
    ctx.strokeStyle=TC.dark;ctx.lineWidth=1;ctx.stroke();
    const r1=pr(sgn*2.3,-5,5.6),r2=pr(sgn*2.3,4.2,5.9);
    ctx.strokeStyle=TC.trim;ctx.lineWidth=.8;
    ctx.beginPath();ctx.moveTo(r1.x,r1.y);ctx.lineTo(r2.x,r2.y);ctx.stroke();
  }else if(cs.barding){
    ctx.strokeStyle='#6f757c';ctx.lineWidth=.8;ctx.beginPath();
    for(const ly of[-3.5,-1,1.5,4]){const a=pr(0,ly,9.9),b=pr(sgn*2,ly,4.2);
      ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}
    ctx.stroke();
    const sp=pr(0,-.2,11.2);
    ctx.fillStyle=TC.main;ctx.strokeStyle=TC.dark;ctx.lineWidth=1;
    ctx.fillRect(sp.x-3.4,sp.y-1.7,6.8,3.4);ctx.strokeRect(sp.x-3.4,sp.y-1.7,6.8,3.4);
  }else{
    const sp=pr(0,-.2,11.0);
    ctx.fillStyle=TC.main;ctx.strokeStyle=TC.dark;ctx.lineWidth=.9;
    ctx.fillRect(sp.x-3,sp.y-1.5,6,3);ctx.strokeRect(sp.x-3,sp.y-1.5,6,3);
  }
  if(s>=-.15)headGrp();
  drawRiderRig(u,t,TC,pr,cs,g);
  ctx.restore();
}
function drawRiderRig(u,t,TC,pr,cs,g){
  const s=pr.s,c=pr.c;
  const bump=g.canter?Math.abs(Math.sin(Math.PI*2*g.ph))*.5:0;   // rider posts
  const teamC=cs.rider==='team'?TC.main:cs.rider;
  const legC=cs.armLeg?'#8d9299':'#4a3220';
  const ap=atkPhase(u),amp=cs.weapon==='lance'?8:7;
  const th=!ap?0:ap.k===1?-1.5*ap.f:ap.k===2?amp*ap.f:ap.k===3?amp*(1-ap.f):0;
  const T=pr(0,.05,13.2+bump),SH=pr(0,.3,15.3+bump),HD=pr(0,.5,17.9+bump);
  const shield=()=>{const Q=pr(-2.1,.4,13.9+bump);
    ctx.fillStyle=TC.dark;ctx.strokeStyle=TC.trim;ctx.lineWidth=1;
    ctx.beginPath();ctx.ellipse(Q.x,Q.y,2.2*pr.fs+.5,3,pr.a,0,7);ctx.fill();ctx.stroke();
    ctx.fillStyle='#d8dbdf';ctx.beginPath();ctx.arc(Q.x,Q.y,.8,0,7);ctx.fill();};
  if(Math.abs(s)>.5){const k=pr(-1.9,.1,10.4),f=pr(-2.1,.5,5.6);
    limb(k.x,k.y,f.x,f.y,legC,1.6);}
  const fa=pr(-1.5,1.6,13.6+bump);limb(SH.x,SH.y,fa.x,fa.y,teamC,1.4);
  if(cs.shield&&c>=0)shield();
  ctx.fillStyle=teamC;ctx.strokeStyle=OUT;ctx.lineWidth=1;
  ctx.beginPath();ctx.ellipse(T.x,T.y,2.7,3.8,0,0,7);ctx.fill();ctx.stroke();
  if(cs.rider==='team'){ctx.save();ctx.beginPath();ctx.ellipse(T.x,T.y,2.7,3.8,0,0,7);ctx.clip();
    ctx.fillStyle='rgba(22,13,5,.22)';ctx.fillRect(T.x+.4,T.y-5,6,10);
    ctx.fillStyle='rgba(255,244,212,.16)';ctx.fillRect(T.x-6.4,T.y-5,6,10);ctx.restore();
    ctx.strokeStyle=TC.trim;ctx.lineWidth=.7;
    ctx.beginPath();ctx.moveTo(T.x-2.2,T.y+1.4);ctx.lineTo(T.x+2.2,T.y+1.4);ctx.stroke();
  }else{ctx.fillStyle=TC.main;ctx.fillRect(T.x-2.2,T.y-2.6,4.4,1.5);}
  const nk=pr(1.9,.1,10.4),nf=pr(2.1,.5,5.6);limb(nk.x,nk.y,nf.x,nf.y,legC,1.7);
  if(cs.weapon==='lance'){
    const l0=pr(1.5,-2.4,11.6+bump),l1=pr(.8,7.6+th,13.9+bump);
    ctx.strokeStyle='#caa66b';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(l0.x,l0.y);ctx.lineTo(l1.x,l1.y);ctx.stroke();
    const dx=l1.x-l0.x,dy=l1.y-l0.y,dl=Math.hypot(dx,dy)||1,ux=dx/dl,uy=dy/dl;
    ctx.fillStyle='#d8dbdf';
    ctx.beginPath();ctx.moveTo(l1.x+ux*2.2,l1.y+uy*2.2);
    ctx.lineTo(l1.x-uy*1.1,l1.y+ux*1.1);ctx.lineTo(l1.x+uy*1.1,l1.y-ux*1.1);ctx.closePath();ctx.fill();
    hand(l0.x+dx*.55,l0.y+dy*.55);
  }else if(cs.weapon==='spear'){
    const s0=pr(1.4,-1.8,11.4+bump),s1=pr(.7,4.4,17+bump);
    ctx.strokeStyle='#8a5a2b';ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(s0.x,s0.y);ctx.lineTo(s1.x,s1.y);ctx.stroke();
    hand(s0.x+(s1.x-s0.x)*.5,s0.y+(s1.y-s0.y)*.5);
  }else if(cs.weapon==='bow'){
    const H=pr(.9,2.4,13.8+bump),bul=3.4*pr.fs+.9,dir=pr(0,1,0).x>=0?0:Math.PI;
    ctx.strokeStyle='#7a5230';ctx.lineWidth=1.6;
    ctx.beginPath();ctx.ellipse(H.x,H.y,bul,4.3,0,dir-1.1,dir+1.1);ctx.stroke();
    const e1x=H.x+bul*Math.cos(dir-1.1),e1y=H.y+4.3*Math.sin(dir-1.1),
          e2x=H.x+bul*Math.cos(dir+1.1),e2y=H.y+4.3*Math.sin(dir+1.1);
    ctx.strokeStyle='rgba(240,230,200,.85)';ctx.lineWidth=.7;
    ctx.beginPath();ctx.moveTo(e1x,e1y);ctx.lineTo(e2x,e2y);ctx.stroke();
    if(u.state==='attack'&&u.cd>0&&u.cd<=.5){ // draw-hold before the loose
      const a2=pr(.9,6.8,13.8+bump);
      ctx.strokeStyle='#4a3a24';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(H.x,H.y);ctx.lineTo(a2.x,a2.y);ctx.stroke();}
    hand(H.x,H.y);
  }else if(cs.weapon==='scimitar'){
    const h0=pr(1.8,.4,14+bump),h1=pr(2.1,2.6+th,17.6+bump);
    ctx.strokeStyle='#d8dbdf';ctx.lineWidth=1.6;
    ctx.beginPath();ctx.moveTo(h0.x,h0.y);ctx.quadraticCurveTo(h0.x+(h1.x-h0.x)*.7,h0.y+(h1.y-h0.y)*.3,h1.x,h1.y);ctx.stroke();
    hand(h0.x,h0.y);
  }else if(cs.weapon==='gun'){ // Conquistador's arquebus
    const g0=pr(1.6,.2,14+bump),g1=pr(1.2,4.6,15+bump);
    ctx.strokeStyle='#4a3220';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(g0.x,g0.y);ctx.lineTo(g1.x,g1.y);ctx.stroke();
    ctx.strokeStyle='#8a8f96';ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(g0.x+(g1.x-g0.x)*.35,g0.y+(g1.y-g0.y)*.35);ctx.lineTo(g1.x,g1.y);ctx.stroke();
    hand(g0.x+(g1.x-g0.x)*.3,g0.y+(g1.y-g0.y)*.3);
    if(u.state==='attack'&&u.cd>0&&u.cd>rofOf(u)-.18){ // muzzle smoke on the shot
      ctx.fillStyle='rgba(240,232,210,.8)';
      ctx.beginPath();ctx.arc(g1.x,g1.y,2.2,0,7);ctx.fill();
      ctx.fillStyle='rgba(250,210,120,.9)';
      ctx.beginPath();ctx.arc(g1.x,g1.y,1,0,7);ctx.fill();}
  }else if(cs.weapon==='torch'){ // Tarkan's firebrand
    const t0=pr(1.7,.4,14+bump),t1=pr(1.9,2.8+th,17.2+bump);
    ctx.strokeStyle='#6b4a2a';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(t0.x,t0.y);ctx.lineTo(t1.x,t1.y);ctx.stroke();
    const fl=.8+.3*Math.sin(t*11+u.id);
    ctx.fillStyle='rgba(226,110,30,.9)';
    ctx.beginPath();ctx.moveTo(t1.x-1.4,t1.y);ctx.quadraticCurveTo(t1.x-1,t1.y-3*fl,t1.x,t1.y-4.2*fl);
    ctx.quadraticCurveTo(t1.x+1,t1.y-3*fl,t1.x+1.4,t1.y);ctx.closePath();ctx.fill();
    ctx.fillStyle='rgba(250,210,90,.95)';
    ctx.beginPath();ctx.arc(t1.x,t1.y-1.2*fl,1,0,7);ctx.fill();
    hand(t0.x,t0.y);
  }
  if(cs.shield&&c<0)shield();
  ctx.fillStyle=SKIN;ctx.strokeStyle=OUT;ctx.lineWidth=.9;
  ctx.beginPath();ctx.arc(HD.x,HD.y,2.4,0,7);ctx.fill();ctx.stroke();
  if(cs.hat==='cowl'){ // Missionary's hooded robe
    ctx.fillStyle=cs.rider;
    ctx.beginPath();ctx.arc(HD.x,HD.y-.3,2.7,Math.PI*.8,Math.PI*2.2);ctx.fill();
  }else if(cs.hat==='steel'){
    ctx.fillStyle='#b9bec4';ctx.strokeStyle='#7e858d';ctx.lineWidth=.8;
    ctx.beginPath();ctx.arc(HD.x,HD.y-.5,2.6,Math.PI*.9,Math.PI*2.1);ctx.fill();ctx.stroke();
    const pl=pr(0,-2.2,17.6+bump);
    ctx.strokeStyle=TC.dark;ctx.lineWidth=1.8;
    ctx.beginPath();ctx.moveTo(HD.x,HD.y-3);ctx.quadraticCurveTo((HD.x+pl.x)/2,HD.y-4,pl.x,pl.y);ctx.stroke();
  }else if(cs.hat==='fur'){ctx.fillStyle='#6b4a2a';
    ctx.beginPath();ctx.arc(HD.x,HD.y-.6,2.5,Math.PI,2*Math.PI);ctx.fill();
    ctx.fillStyle='#c9b07f';ctx.fillRect(HD.x-2.3,HD.y-.8,4.6,1.1);
  }else if(cs.hat==='turban'){ctx.fillStyle='#e8e0c8';
    ctx.beginPath();ctx.arc(HD.x,HD.y-.6,2.5,Math.PI*.9,Math.PI*2.1);ctx.fill();
    ctx.fillRect(HD.x-2.5,HD.y-1,5,1.4);
  }else{ctx.fillStyle='#5a3d22';
    ctx.beginPath();ctx.arc(HD.x,HD.y-.5,2.4,Math.PI,2*Math.PI);ctx.fill();}
}
function drawElephantRig(u,t,TC){
  const phi=octPhi(u),pr=rigProj(phi),s=pr.s,c=pr.c,sgn=c>=0?1:-1;
  const g=gaitOf(u,t);
  const roll=g.mv?Math.sin(Math.PI*2*g.ph)*.5:0;
  const legsJ=[[-2.6,-3.8,0],[-2.5,3.4,.25],[2.6,-3.8,.5],[2.5,3.4,.75]];
  const col=(lx,ly,lp,near)=>{
    const top=pr(lx,ly,8.8),ft=pr(lx,ly+lp.dy,lp.dz);
    ctx.strokeStyle='rgba(64,44,26,.5)';ctx.lineWidth=near?4.2:3.6;
    ctx.beginPath();ctx.moveTo(top.x,top.y);ctx.lineTo(ft.x,ft.y);ctx.stroke();
    if(near){ctx.strokeStyle='#7e7e86';ctx.lineWidth=3.2;
      ctx.beginPath();ctx.moveTo(top.x,top.y);ctx.lineTo(ft.x,ft.y);ctx.stroke();}
  };
  const poses=legsJ.map(L=>g.mv?legPose(g.ph+L[2],2.2,1,.7):{dy:0,dz:0});
  legsJ.forEach((L,i)=>{if(pr(L[0],L[1],0).d< -.3)col(L[0],L[1],poses[i],false);});
  legsJ.forEach((L,i)=>{if(pr(L[0],L[1],0).d>=-.3)col(L[0],L[1],poses[i],true);});
  const headGrp=()=>{
    const HD=pr(roll*.6,6.6,11.2);
    const ear=(ex,strk)=>{const E=pr(roll*.6+ex,5.6,11.6);
      ctx.fillStyle='#7e7e86';ctx.beginPath();
      ctx.ellipse(E.x,E.y,2.5,3.3,(ex>0?-.3:.3)+Math.sin(t*.5)*.12,0,7);ctx.fill();
      if(strk){ctx.strokeStyle=OUT;ctx.lineWidth=1;ctx.stroke();}};
    ear(-3.6,false);
    ctx.fillStyle='#8d8d95';ctx.strokeStyle=OUT;ctx.lineWidth=1.1;
    ctx.beginPath();ctx.arc(HD.x,HD.y,4.2,0,7);ctx.fill();ctx.stroke();
    ear(3.6,true);
    const sw2=Math.sin(t*.6+(u.id||0))*(g.mv?1:.6);
    const t0=pr(roll*.6,9.4,9.4),t1=pr(sw2,10.6,4.6),t2=pr(sw2*1.7,10.2,.8);
    ctx.strokeStyle='#8d8d95';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(t0.x,t0.y);ctx.quadraticCurveTo(t1.x,t1.y,t2.x,t2.y);ctx.stroke();
    if(s>-.35){
      const u1=pr(1.6,8.6,7.6),u2=pr(2.3,10.8,5.4),v1=pr(-1.6,8.6,7.6),v2=pr(-2.3,10.8,5.4);
      ctx.strokeStyle='#e8e0c8';ctx.lineWidth=1.7;ctx.beginPath();
      ctx.moveTo(u1.x,u1.y);ctx.quadraticCurveTo((u1.x+u2.x)/2,u2.y,u2.x,u2.y);
      ctx.moveTo(v1.x,v1.y);ctx.quadraticCurveTo((v1.x+v2.x)/2,v2.y,v2.x,v2.y);ctx.stroke();
      const E=pr(roll*.6+sgn*3.1,7,11.8);
      ctx.fillStyle='#2e2012';ctx.beginPath();ctx.arc(E.x,E.y,.6,0,7);ctx.fill();
    }
  };
  const bodyGrp=()=>{
    const B=pr(roll*.6,-.8,9.8);
    ctx.fillStyle='#8d8d95';ctx.strokeStyle=OUT;ctx.lineWidth=1.1;
    ctx.beginPath();ctx.ellipse(B.x,B.y,6.6*pr.fs+3.2,5.6+1.0*Math.abs(s),pr.a,0,7);ctx.fill();ctx.stroke();
    ctx.fillStyle='rgba(20,12,4,.28)';
    ctx.beginPath();ctx.ellipse(B.x,B.y+3.6,5.6*pr.fs+2,1.8,pr.a,0,7);ctx.fill();
    ctx.fillStyle='rgba(255,240,205,.14)';
    ctx.beginPath();ctx.ellipse(B.x-3,B.y-2.6,2.8,2,0,0,7);ctx.fill();
  };
  if(s<-.15){headGrp();bodyGrp();}else{bodyGrp();headGrp();}
  // howdah: skirt cloth + rimmed platform riding the roll
  const rx=roll*.6;
  const sk=[pr(-3.2+rx,-3.8,15.2),pr(3.2+rx,-3.8,15.2),pr(3.4+rx,2.6,15.2),pr(-3.4+rx,2.6,15.2)];
  const sb=[pr(-2.8+rx,-3.2,11.6),pr(2.8+rx,-3.2,11.6),pr(3+rx,2.1,11.6),pr(-3+rx,2.1,11.6)];
  ctx.fillStyle=TC.dark;
  ctx.beginPath();ctx.moveTo(sk[0].x,sk[0].y);ctx.lineTo(sk[1].x,sk[1].y);
  ctx.lineTo(sb[1].x,sb[1].y);ctx.lineTo(sb[0].x,sb[0].y);ctx.closePath();ctx.fill();
  ctx.fillStyle=TC.main;ctx.strokeStyle=TC.dark;ctx.lineWidth=1.1;
  ctx.beginPath();ctx.moveTo(sk[0].x,sk[0].y);ctx.lineTo(sk[1].x,sk[1].y);
  ctx.lineTo(sk[2].x,sk[2].y);ctx.lineTo(sk[3].x,sk[3].y);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.strokeStyle=TC.trim;ctx.lineWidth=.8;
  ctx.beginPath();ctx.moveTo(sk[0].x,sk[0].y);ctx.lineTo(sk[1].x,sk[1].y);ctx.stroke();
  const R=pr(rx,-.9,17),RH=pr(rx,-.7,19.6);
  ctx.fillStyle=TC.dark;ctx.strokeStyle=OUT;ctx.lineWidth=.8;
  ctx.beginPath();ctx.ellipse(R.x,R.y,2.4,3.1,0,0,7);ctx.fill();ctx.stroke();
  ctx.fillStyle=SKIN;
  ctx.beginPath();ctx.arc(RH.x,RH.y,2.1,0,7);ctx.fill();ctx.stroke();
  ctx.fillStyle=TC.main; // headwrap so the rider reads at distance
  ctx.beginPath();ctx.arc(RH.x,RH.y-.5,2.2,Math.PI,2*Math.PI);ctx.fill();
  const apE=atkPhase(u);
  const th=!apE?0:apE.k===1?-1.4*apE.f:apE.k===2?7*apE.f:apE.k===3?7*(1-apE.f):0;
  const w0=pr(.7+rx,1.2+th*.15,17.2),w1=pr(.3+rx,7+th,20.2);
  ctx.strokeStyle='#8a5a2b';ctx.lineWidth=1.3;
  ctx.beginPath();ctx.moveTo(w0.x,w0.y);ctx.lineTo(w1.x,w1.y);ctx.stroke();
  const dx=w1.x-w0.x,dy=w1.y-w0.y,dl=Math.hypot(dx,dy)||1;
  ctx.fillStyle='#d8dbdf';
  ctx.beginPath();ctx.moveTo(w1.x+dx/dl*2,w1.y+dy/dl*2);
  ctx.lineTo(w1.x-dy/dl,w1.y+dx/dl);ctx.lineTo(w1.x+dy/dl,w1.y-dx/dl);ctx.closePath();ctx.fill();
}
function drawRamRig(u,t,TC){
  const phi=octPhi(u),pr=rigProj(phi),c=pr.c,s=pr.s,sgn=c>=0?1:-1;
  const mv=(u.spd||0)>.05;
  const ph=u.gaitPh!==undefined?u.gaitPh:t*.08;
  const rot=u.wheelRot!==undefined?u.wheelRot:(mv?t*.9:0);
  const apR=atkPhase(u); // beam retracts on windup, slams on the strike
  const lunge=!apR?0:apR.k===1?-2*apR.f:apR.k===2?-2+6*apR.f:apR.k===3?4*(1-apR.f):0;
  const HL=8.8,HW=4.3,Z0=2,Z1=8.5,ZR=12;
  ctx.save();if(mv)ctx.rotate(Math.sin(ph*6.283)*.03);
  const wrx=2.7*pr.fs+.5;
  const wheel=(wx,wy,near)=>{
    const W=pr(wx,wy,1.8);
    ctx.fillStyle='#3c2814';ctx.beginPath();
    ctx.ellipse(W.x,W.y,wrx,2.7,pr.a,0,7);ctx.fill();
    if(near){ctx.strokeStyle=OUT;ctx.lineWidth=.8;ctx.stroke();
      ctx.fillStyle='#54381e';ctx.beginPath();ctx.arc(W.x,W.y,1,0,7);ctx.fill();
      const e1=pr(wx,wy+Math.cos(rot)*1.8,1.8+Math.sin(rot)*1.8),
            e2=pr(wx,wy-Math.cos(rot)*1.8,1.8-Math.sin(rot)*1.8);
      ctx.strokeStyle='#54381e';ctx.lineWidth=.9;
      ctx.beginPath();ctx.moveTo(e1.x,e1.y);ctx.lineTo(e2.x,e2.y);ctx.stroke();}
  };
  for(const wy of[-5.2,0,5.2])wheel(-sgn*HW,wy,false);
  if(mv){ctx.strokeStyle='#4a3220';ctx.lineWidth=1.3;ctx.beginPath();
    for(let i=0;i<4;i++){const fy=-4.5+i*3,d2=Math.sin(ph*6.283+i*2.4)*.8;
      const a=pr(sgn*2.4,fy+d2,1.6),b=pr(sgn*2.4,fy+d2*.4,0);
      ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}
    ctx.stroke();}
  const quad=(p1,p2,p3,p4,fill,strk)=>{ctx.fillStyle=fill;
    ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);
    ctx.lineTo(p3.x,p3.y);ctx.lineTo(p4.x,p4.y);ctx.closePath();ctx.fill();
    if(strk){ctx.strokeStyle=OUT;ctx.lineWidth=.9;ctx.stroke();}};
  const drawBeam=()=>{
    const b0=pr(0,5.5,4.5),b1=pr(0,10.8+lunge,4.5),b2=pr(0,12.6+lunge,4.5);
    ctx.strokeStyle='#54381e';ctx.lineWidth=2.8;
    ctx.beginPath();ctx.moveTo(b0.x,b0.y);ctx.lineTo(b1.x,b1.y);ctx.stroke();
    ctx.strokeStyle='#9aa0a6';ctx.lineWidth=3.6;
    ctx.beginPath();ctx.moveTo(b1.x,b1.y);ctx.lineTo(b2.x,b2.y);ctx.stroke();
  };
  if(s<0)drawBeam();
  quad(pr(0,HL,ZR),pr(0,-HL,ZR),pr(-sgn*HW,-HL,Z1),pr(-sgn*HW,HL,Z1),'#7a5830',false);
  ctx.fillStyle='rgba(0,0,0,.22)';ctx.fill();
  quad(pr(sgn*HW,HL,Z0),pr(sgn*HW,-HL,Z0),pr(sgn*HW,-HL,Z1),pr(sgn*HW,HL,Z1),'#7a5830',true);
  ctx.strokeStyle='rgba(0,0,0,.22)';ctx.lineWidth=1.1;ctx.beginPath();
  for(const py of[-4,0,4]){const a=pr(sgn*HW,py,Z0),b=pr(sgn*HW,py,Z1);
    ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}
  ctx.stroke();
  quad(pr(0,HL,ZR),pr(0,-HL,ZR),pr(sgn*HW,-HL,Z1),pr(sgn*HW,HL,Z1),'#93744a',true);
  if(Math.abs(s)>.38){const ey=s>=0?HL:-HL;
    const g1=pr(-HW,ey,Z0),g2=pr(-HW,ey,Z1),g3=pr(0,ey,ZR),g4=pr(HW,ey,Z1),g5=pr(HW,ey,Z0);
    ctx.fillStyle='#7a5830';ctx.beginPath();
    ctx.moveTo(g1.x,g1.y);ctx.lineTo(g2.x,g2.y);ctx.lineTo(g3.x,g3.y);
    ctx.lineTo(g4.x,g4.y);ctx.lineTo(g5.x,g5.y);ctx.closePath();ctx.fill();
    ctx.strokeStyle=OUT;ctx.lineWidth=.9;ctx.stroke();}
  for(const wy of[-5.2,0,5.2])wheel(sgn*HW,wy,true);
  if(s>=0)drawBeam();
  const m0=pr(0,-.5,ZR),m1=pr(0,-.5,16);
  ctx.strokeStyle='#4a3a24';ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(m0.x,m0.y);ctx.lineTo(m1.x,m1.y);ctx.stroke();
  const f1=pr(0,-.5,15.7),f2=pr(0,-3.6,14.6+Math.sin(t*.7)*.3),f3=pr(0,-.5,13.8);
  ctx.fillStyle=TC.main;ctx.beginPath();
  ctx.moveTo(f1.x,f1.y);ctx.lineTo(f2.x,f2.y);ctx.lineTo(f3.x,f3.y);ctx.closePath();ctx.fill();
  ctx.restore();
}
/* ---- siege engine rigs (CD update) — same conventions as the ram ---- */
function siegeWheel(pr,wx,wy,near,r){
  const W=pr(wx,wy,r*.7),s=pr.s!==undefined?pr.s:1;
  ctx.fillStyle='#3c2814';ctx.beginPath();
  ctx.ellipse(W.x,W.y,Math.max(1,r*pr.fs+.4),r,pr.a,0,7);ctx.fill();
  if(near){ctx.strokeStyle=OUT;ctx.lineWidth=.8;ctx.stroke();
    ctx.strokeStyle='#c9a15e';ctx.lineWidth=.6;
    ctx.beginPath();ctx.ellipse(W.x,W.y,Math.max(.6,r*.5*pr.fs),r*.5,pr.a,0,7);ctx.stroke();}
}
function drawScorpion(u,t,TC){
  const phi=octPhi(u),pr=rigProj(phi),sgn=pr.c>=0?1:-1;
  const ap=atkPhase(u);
  ctx.save();
  siegeWheel(pr,-sgn*2.6,1.2,false,2.2);
  // wooden bed between the wheels
  const quad=(a,b,c2,d2,fill,st)=>{ctx.fillStyle=fill;ctx.beginPath();
    ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(c2.x,c2.y);ctx.lineTo(d2.x,d2.y);
    ctx.closePath();ctx.fill();if(st){ctx.strokeStyle=OUT;ctx.lineWidth=.8;ctx.stroke();}};
  quad(pr(-2.2,-4.6,3.2),pr(2.2,-4.6,3.2),pr(2.2,4,4.6),pr(-2.2,4,4.6),'#7a5830',true);
  // the great bow across the front
  const draw=!ap?0:ap.k===1?1.4*ap.f:ap.k===2?1.4*(1-ap.f*2):0;
  const bl=pr(-4.6,4.4,6),br=pr(4.6,4.4,6),bm=pr(0,5.6,6.4);
  ctx.strokeStyle='#54381e';ctx.lineWidth=1.8;
  ctx.beginPath();ctx.moveTo(bl.x,bl.y);ctx.quadraticCurveTo(bm.x,bm.y,br.x,br.y);ctx.stroke();
  const st0=pr(0,.4-draw,6.2);
  ctx.strokeStyle='rgba(230,222,200,.8)';ctx.lineWidth=.8;
  ctx.beginPath();ctx.moveTo(bl.x,bl.y);ctx.lineTo(st0.x,st0.y);ctx.lineTo(br.x,br.y);ctx.stroke();
  // the bolt in its groove
  const b0=pr(0,-.6-draw,6.4),b1=pr(0,4.8,6.8);
  ctx.strokeStyle='#4a3a24';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(b0.x,b0.y);ctx.lineTo(b1.x,b1.y);ctx.stroke();
  ctx.fillStyle='#c9ccd1';ctx.beginPath();
  ctx.moveTo(b1.x,b1.y);ctx.lineTo(b1.x-1.4,b1.y-1.6);ctx.lineTo(b1.x+1.4,b1.y-1.6);ctx.closePath();ctx.fill();
  // crewman crouched behind
  const H=pr(0,-4.2,8);
  ctx.fillStyle=TC.main;ctx.strokeStyle=OUT;ctx.lineWidth=.8;
  ctx.beginPath();ctx.ellipse(H.x,H.y+2.2,2,2.6,0,0,7);ctx.fill();ctx.stroke();
  ctx.fillStyle=SKIN;ctx.beginPath();ctx.arc(H.x,H.y-.6,1.7,0,7);ctx.fill();ctx.stroke();
  siegeWheel(pr,sgn*2.6,1.2,true,2.2);
  ctx.restore();
}
function drawMangonel(u,t,TC){
  const phi=octPhi(u),pr=rigProj(phi),sgn=pr.c>=0?1:-1;
  const ap=atkPhase(u);
  // throwing arm: cocked back at rest, whips forward on release
  const arm=!ap?-.85:ap.k===1?-.85-.25*ap.f:ap.k===2?-1.1+2.1*ap.f:ap.k===3?1-(1.85)*ap.f:-.85;
  ctx.save();
  siegeWheel(pr,-sgn*3,-2.6,false,2.4);siegeWheel(pr,-sgn*3,2.8,false,2.4);
  const quad=(a,b,c2,d2,fill,st)=>{ctx.fillStyle=fill;ctx.beginPath();
    ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(c2.x,c2.y);ctx.lineTo(d2.x,d2.y);
    ctx.closePath();ctx.fill();if(st){ctx.strokeStyle=OUT;ctx.lineWidth=.9;ctx.stroke();}};
  // heavy timber chassis
  quad(pr(-3,-5.4,2.6),pr(3,-5.4,2.6),pr(3,5,4),pr(-3,5,4),'#7a5830',true);
  // side uprights
  ctx.strokeStyle='#54381e';ctx.lineWidth=2.2;
  for(const sx of[-2.2,2.2]){
    const u0=pr(sx,.6,4),u1=pr(sx,.6,9.4);
    ctx.beginPath();ctx.moveTo(u0.x,u0.y);ctx.lineTo(u1.x,u1.y);ctx.stroke();}
  // crossbar
  {const c0=pr(-2.2,.6,9.4),c1=pr(2.2,.6,9.4);
   ctx.strokeStyle='#6a4a26';ctx.lineWidth=1.8;
   ctx.beginPath();ctx.moveTo(c0.x,c0.y);ctx.lineTo(c1.x,c1.y);ctx.stroke();}
  // the arm, pivoting at the crossbar; cup on the end
  const ay=Math.sin(arm)*7.2,az=9.4+Math.cos(arm)*-7.2*0+Math.cos(arm)*7.2-7.2;
  const a0=pr(0,.6,9.4),a1=pr(0,.6+Math.sin(arm)*7.6,9.4+Math.cos(arm)*7.6-1.4);
  ctx.strokeStyle='#8a5a2b';ctx.lineWidth=2.4;
  ctx.beginPath();ctx.moveTo(a0.x,a0.y);ctx.lineTo(a1.x,a1.y);ctx.stroke();
  ctx.fillStyle='#4a3a24';ctx.beginPath();ctx.arc(a1.x,a1.y,2,0,7);ctx.fill();
  if(!ap||ap.k===1){ // a boulder waits in the cup
    ctx.fillStyle='#8d8478';ctx.beginPath();ctx.arc(a1.x,a1.y-1.2,1.6,0,7);ctx.fill();
    ctx.fillStyle='rgba(255,244,214,.4)';ctx.beginPath();ctx.arc(a1.x-.5,a1.y-1.7,.6,0,7);ctx.fill();}
  // rope skeins + crew
  ctx.strokeStyle='rgba(214,196,150,.75)';ctx.lineWidth=1;
  {const r0=pr(-2.2,.6,5),r1=pr(2.2,.6,5);
   ctx.beginPath();ctx.moveTo(r0.x,r0.y);ctx.lineTo(r1.x,r1.y);ctx.stroke();}
  const H=pr(-sgn*1.2,-4.8,7.6);
  ctx.fillStyle=TC.main;ctx.strokeStyle=OUT;ctx.lineWidth=.8;
  ctx.beginPath();ctx.ellipse(H.x,H.y+2,1.9,2.5,0,0,7);ctx.fill();ctx.stroke();
  ctx.fillStyle=SKIN;ctx.beginPath();ctx.arc(H.x,H.y-.8,1.6,0,7);ctx.fill();ctx.stroke();
  siegeWheel(pr,sgn*3,-2.6,true,2.4);siegeWheel(pr,sgn*3,2.8,true,2.4);
  ctx.restore();
}
function drawTreb(u,t,TC){
  // tall A-frame with counterweight box and a long sling arm; packs flat to move
  let phi=octPhi(u);
  phi=Math.round((phi-Math.PI/4)/(Math.PI/2))*(Math.PI/2)+Math.PI/4;
  const pr=rigProj(phi),sgn=pr.c>=0?1:-1;
  const ap=atkPhase(u);
  const packed=!u.setup&&(u.spd||0)>.02;
  // arm angle: packed = lying flat; set up = counterweight down, arm high
  const arm=packed?.12:!ap?1.05:ap.k===1?1.05+.2*ap.f:ap.k===2?1.25-2.2*ap.f:ap.k===3?-.95+2.0*ap.f:1.05;
  ctx.save();
  const quad=(a,b,c2,d2,fill,st)=>{ctx.fillStyle=fill;ctx.beginPath();
    ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(c2.x,c2.y);ctx.lineTo(d2.x,d2.y);
    ctx.closePath();ctx.fill();if(st){ctx.strokeStyle=OUT;ctx.lineWidth=.9;ctx.stroke();}};
  // ground sled
  quad(pr(-3.4,-6,1.4),pr(3.4,-6,1.4),pr(3.4,6,2.2),pr(-3.4,6,2.2),'#6a4a26',true);
  // A-frame legs both sides
  ctx.strokeStyle='#54381e';ctx.lineWidth=2.4;
  for(const sx of[-2.6,2.6]){
    for(const sy of[-3.6,3.6]){
      const l0=pr(sx,sy,1.8),l1=pr(sx,0,12.2);
      ctx.beginPath();ctx.moveTo(l0.x,l0.y);ctx.lineTo(l1.x,l1.y);ctx.stroke();}}
  // axle
  {const x0=pr(-2.6,0,12.2),x1=pr(2.6,0,12.2);
   ctx.strokeStyle='#6a4a26';ctx.lineWidth=2;
   ctx.beginPath();ctx.moveTo(x0.x,x0.y);ctx.lineTo(x1.x,x1.y);ctx.stroke();}
  // the great arm: short end carries the counterweight box, long end the sling
  const pivY=0,pivZ=12.2;
  const longY=Math.sin(arm)*10.5,longZ=Math.cos(arm)*10.5;
  const shortY=-Math.sin(arm)*3.6,shortZ=-Math.cos(arm)*3.6;
  const aL=pr(0,pivY+longY,pivZ+longZ),aS=pr(0,pivY+shortY,pivZ+shortZ);
  ctx.strokeStyle='#8a5a2b';ctx.lineWidth=2.6;
  ctx.beginPath();ctx.moveTo(aS.x,aS.y);ctx.lineTo(aL.x,aL.y);ctx.stroke();
  // counterweight box on the short end
  ctx.fillStyle='#5f4526';ctx.strokeStyle=OUT;ctx.lineWidth=.9;
  ctx.fillRect(aS.x-2.6,aS.y-1.2,5.2,4.4);ctx.strokeRect(aS.x-2.6,aS.y-1.2,5.2,4.4);
  ctx.fillStyle='rgba(0,0,0,.2)';ctx.fillRect(aS.x+.4,aS.y-1.2,2.2,4.4);
  // sling rope + stone (visible while cocked)
  if(!packed&&(!ap||ap.k===1)){
    const s1=pr(0,pivY+longY*1.0,pivZ+longZ-3.2);
    ctx.strokeStyle='rgba(214,196,150,.8)';ctx.lineWidth=.9;
    ctx.beginPath();ctx.moveTo(aL.x,aL.y);ctx.lineTo(s1.x,s1.y);ctx.stroke();
    ctx.fillStyle='#8d8478';ctx.beginPath();ctx.arc(s1.x,s1.y,1.7,0,7);ctx.fill();
  }
  // team banner on the frame
  const f0=pr(0,-5.4,12.6),f1=pr(0,-5.4,16);
  ctx.strokeStyle='#4a3a24';ctx.lineWidth=1.1;
  ctx.beginPath();ctx.moveTo(f0.x,f0.y);ctx.lineTo(f1.x,f1.y);ctx.stroke();
  ctx.fillStyle=TC.main;ctx.beginPath();
  ctx.moveTo(f1.x,f1.y);ctx.lineTo(f1.x-sgn*4.6,f1.y+1.4);ctx.lineTo(f1.x,f1.y+2.8);ctx.closePath();ctx.fill();
  // crew
  const H=pr(sgn*2.2,-5,5.4);
  ctx.fillStyle=TC.main;ctx.strokeStyle=OUT;ctx.lineWidth=.8;
  ctx.beginPath();ctx.ellipse(H.x,H.y+2,1.9,2.5,0,0,7);ctx.fill();ctx.stroke();
  ctx.fillStyle=SKIN;ctx.beginPath();ctx.arc(H.x,H.y-.8,1.6,0,7);ctx.fill();ctx.stroke();
  ctx.restore();
}
function drawBombard(u,t,TC){
  const phi=octPhi(u),pr=rigProj(phi),sgn=pr.c>=0?1:-1;
  const ap=atkPhase(u);
  const kick=ap&&ap.k===2?-(1-ap.f)*1.6:0;
  ctx.save();
  siegeWheel(pr,-sgn*2.8,.6,false,2.8);
  // carriage
  const quad=(a,b,c2,d2,fill,st)=>{ctx.fillStyle=fill;ctx.beginPath();
    ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(c2.x,c2.y);ctx.lineTo(d2.x,d2.y);
    ctx.closePath();ctx.fill();if(st){ctx.strokeStyle=OUT;ctx.lineWidth=.9;ctx.stroke();}};
  quad(pr(-2.2,-5.2,2.4),pr(2.2,-5.2,2.4),pr(2.2,2.6,4.2),pr(-2.2,2.6,4.2),'#6a4a26',true);
  // the bronze barrel, slightly raised toward the muzzle
  const b0=pr(0,-3.4+kick,6.2),b1=pr(0,5.2+kick,8.2);
  ctx.strokeStyle='rgba(30,24,14,.55)';ctx.lineWidth=4.6;
  ctx.beginPath();ctx.moveTo(b0.x,b0.y);ctx.lineTo(b1.x,b1.y);ctx.stroke();
  ctx.strokeStyle='#7d6a3a';ctx.lineWidth=3.6;
  ctx.beginPath();ctx.moveTo(b0.x,b0.y);ctx.lineTo(b1.x,b1.y);ctx.stroke();
  ctx.strokeStyle='rgba(255,240,190,.4)';ctx.lineWidth=1.1;
  ctx.beginPath();ctx.moveTo(b0.x-1,b0.y-1);ctx.lineTo(b1.x-1,b1.y-1);ctx.stroke();
  // reinforcing rings
  ctx.strokeStyle='#4c4126';ctx.lineWidth=1;
  for(const f of[.25,.5,.78]){
    const rx=b0.x+(b1.x-b0.x)*f,ry=b0.y+(b1.y-b0.y)*f;
    ctx.beginPath();ctx.ellipse(rx,ry,2.4,1.5,Math.atan2(b1.y-b0.y,b1.x-b0.x)+Math.PI/2,0,7);ctx.stroke();}
  // muzzle flash
  if(ap&&ap.k===2&&ap.f<.4){
    ctx.fillStyle='rgba(255,214,110,'+(1-ap.f*2.2)+')';
    ctx.beginPath();ctx.arc(b1.x,b1.y,3.6,0,7);ctx.fill();
    ctx.fillStyle='rgba(226,222,212,.4)';
    ctx.beginPath();ctx.arc(b1.x,b1.y-2,4.6,0,7);ctx.fill();}
  // powder kegs + gunner
  const K=pr(-sgn*2,-3.8,5);
  ctx.fillStyle='#3a3a40';ctx.strokeStyle=OUT;ctx.lineWidth=.7;
  ctx.beginPath();ctx.arc(K.x,K.y,1.8,0,7);ctx.fill();ctx.stroke();
  const H=pr(sgn*1.6,-4.6,7.4);
  ctx.fillStyle=TC.main;ctx.strokeStyle=OUT;ctx.lineWidth=.8;
  ctx.beginPath();ctx.ellipse(H.x,H.y+2,1.9,2.5,0,0,7);ctx.fill();ctx.stroke();
  ctx.fillStyle=SKIN;ctx.beginPath();ctx.arc(H.x,H.y-.8,1.6,0,7);ctx.fill();ctx.stroke();
  siegeWheel(pr,sgn*2.8,.6,true,2.8);
  ctx.restore();
}
function drawTradeCart(u,t,TC){
  // two-wheel goods cart behind a plodding ox; team colour on the canopy.
  // Diagonal-snapped like the war wagon so it never collapses end-on.
  let phi=octPhi(u);
  phi=Math.round((phi-Math.PI/4)/(Math.PI/2))*(Math.PI/2)+Math.PI/4;
  const pr=rigProj(phi),s=pr.s,c=pr.c,sgn=c>=0?1:-1;
  const g=gaitOf(u,t);
  const wob=g.mv?Math.sin(Math.PI*2*g.ph)*.9:0;
  ctx.save();
  const HW=2.7,HL=3.8,Z0=2.0,Z1=5.6,ZR=8.4;
  const quad=(a,b,cc,d,fill,stroke)=>{ctx.fillStyle=fill;ctx.beginPath();
    ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(cc.x,cc.y);ctx.lineTo(d.x,d.y);
    ctx.closePath();ctx.fill();
    if(stroke){ctx.strokeStyle='rgba(64,44,26,.5)';ctx.lineWidth=.9;ctx.stroke();}};
  /* the ox, out in front (units face -y in rig space here, matching the
     wagon's rear archer at +y) */
  const oxCY=-HL-3.6;
  ctx.strokeStyle='#4a3a26';ctx.lineWidth=1.6;               // legs first
  for(const off of [-1.4,1.4]){
    for(const ly of [oxCY-1.5,oxCY+1.5]){
      const hp2=pr(off,ly,2.4),lp=pr(off+((ly<oxCY)?wob:-wob)*.25,ly,0);
      ctx.beginPath();ctx.moveTo(hp2.x,hp2.y);ctx.lineTo(lp.x,lp.y);ctx.stroke();}}
  const oxb=pr(0,oxCY,3.0);
  ctx.fillStyle='#7d6a4e';ctx.strokeStyle=OUT;ctx.lineWidth=1;
  ctx.beginPath();ctx.ellipse(oxb.x,oxb.y,4.2,3.0,pr.a*.2,0,7);ctx.fill();ctx.stroke();
  const oxh=pr(0,oxCY-2.6,2.2);
  ctx.fillStyle='#6d5a40';ctx.beginPath();ctx.ellipse(oxh.x,oxh.y,2.0,1.7,0,0,7);ctx.fill();ctx.stroke();
  ctx.strokeStyle='#e8e2d2';ctx.lineWidth=1.1;               // horns
  ctx.beginPath();ctx.moveTo(oxh.x-1.5,oxh.y-1.1);ctx.quadraticCurveTo(oxh.x-2.9,oxh.y-2.4,oxh.x-2.1,oxh.y-2.9);ctx.stroke();
  ctx.beginPath();ctx.moveTo(oxh.x+1.5,oxh.y-1.1);ctx.quadraticCurveTo(oxh.x+2.9,oxh.y-2.4,oxh.x+2.1,oxh.y-2.9);ctx.stroke();
  const yk0=pr(0,oxCY+1.4,3.2),yk1=pr(0,-HL+.4,2.8);          // yoke pole
  ctx.strokeStyle='#6b4a2a';ctx.lineWidth=1.3;
  ctx.beginPath();ctx.moveTo(yk0.x,yk0.y);ctx.lineTo(yk1.x,yk1.y);ctx.stroke();
  const wheel=(wx,near)=>{const q=pr(wx,.6,2.7);
    ctx.fillStyle='#54381e';ctx.strokeStyle='rgba(64,44,26,.6)';ctx.lineWidth=.8;
    ctx.beginPath();ctx.ellipse(q.x,q.y,Math.max(1,2.8*Math.abs(s)),2.8,0,0,7);ctx.fill();
    if(near){ctx.stroke();ctx.strokeStyle='#c9a15e';ctx.lineWidth=.7;
      ctx.beginPath();ctx.ellipse(q.x,q.y,Math.max(.6,1.5*Math.abs(s)),1.5,0,0,7);ctx.stroke();}};
  wheel(-sgn*HW,false);
  // low plank bed
  quad(pr(-sgn*HW,-HL,Z0),pr(-sgn*HW,HL,Z0),pr(-sgn*HW,HL,Z1),pr(-sgn*HW,-HL,Z1),'#5f4526',false);
  const ey=s>=0?-HL:HL;
  quad(pr(-HW,ey,Z0),pr(HW,ey,Z0),pr(HW,ey,Z1),pr(-HW,ey,Z1),'#6d5231',true);
  quad(pr(sgn*HW,-HL,Z0),pr(sgn*HW,HL,Z0),pr(sgn*HW,HL,Z1),pr(sgn*HW,-HL,Z1),'#7a5830',true);
  ctx.strokeStyle='rgba(255,244,214,.3)';ctx.lineWidth=.9;
  {const a=pr(sgn*HW,-HL,Z1),b=pr(sgn*HW,HL,Z1);
   ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  // the goods: grain sacks and a gold chest riding openly up front
  for(const [sx2,sy2,col] of [[-1.1,-2.2,'#c9b07f'],[1.1,-1.4,'#b8a06a']]){
    const q=pr(sx2,sy2,Z1);
    ctx.fillStyle=col;ctx.strokeStyle=OUT;ctx.lineWidth=.8;
    ctx.beginPath();ctx.ellipse(q.x,q.y,1.9,1.6,0,0,7);ctx.fill();ctx.stroke();
  }
  {const q=pr(0,-.4,Z1);
   ctx.fillStyle='#e3b23c';ctx.strokeStyle='#8a6a2f';ctx.lineWidth=.8;
   ctx.fillRect(q.x-1.7,q.y-1.4,3.4,2.1);ctx.strokeRect(q.x-1.7,q.y-1.4,3.4,2.1);}
  // arched team canopy over the rear half
  const rib=(ty2)=>{const a=pr(-HW,ty2,Z1),m=pr(0,ty2,ZR),b=pr(HW,ty2,Z1);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(m.x,m.y,b.x,b.y);};
  ctx.fillStyle=TC.main;
  rib(1.0);const bEnd=pr(HW,HL,Z1),aEnd=pr(-HW,HL,Z1),mEnd=pr(0,HL,ZR);
  ctx.lineTo(bEnd.x,bEnd.y);ctx.quadraticCurveTo(mEnd.x,mEnd.y,aEnd.x,aEnd.y);ctx.closePath();ctx.fill();
  ctx.strokeStyle=TC.dark;ctx.lineWidth=.9;
  for(const ty2 of[1.0,HL*.55,HL]){rib(ty2);ctx.stroke();}
  wheel(sgn*HW,true);
  ctx.restore();
}
function drawWarWagon(u,t,TC){
  // Korean War Wagon: armored cart with a team-color canopy and bow slits.
  // Heading snaps to the diagonals so the cart never collapses end-on.
  let phi=octPhi(u);
  phi=Math.round((phi-Math.PI/4)/(Math.PI/2))*(Math.PI/2)+Math.PI/4;
  const pr=rigProj(phi),s=pr.s,c=pr.c,sgn=c>=0?1:-1;
  ctx.save();
  const HW=3.6,HL=6.4,Z0=1.6,Z1=8.2,ZR=12.4;
  const quad=(a,b,cc,d,fill,stroke)=>{ctx.fillStyle=fill;ctx.beginPath();
    ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(cc.x,cc.y);ctx.lineTo(d.x,d.y);
    ctx.closePath();ctx.fill();
    if(stroke){ctx.strokeStyle='rgba(64,44,26,.5)';ctx.lineWidth=.9;ctx.stroke();}};
  const wheel=(wx,wy,near)=>{const q=pr(wx,wy,2.6);
    ctx.fillStyle='#54381e';ctx.strokeStyle='rgba(64,44,26,.6)';ctx.lineWidth=.8;
    ctx.beginPath();ctx.ellipse(q.x,q.y,Math.max(1,2.6*Math.abs(s)),2.6,0,0,7);ctx.fill();
    if(near){ctx.stroke();
      ctx.strokeStyle='#c9a15e';ctx.lineWidth=.7;
      ctx.beginPath();ctx.ellipse(q.x,q.y,Math.max(.6,1.4*Math.abs(s)),1.4,0,0,7);ctx.stroke();}};
  wheel(-sgn*HW,-4.2,false);wheel(-sgn*HW,4.2,false);
  // far side wall
  quad(pr(-sgn*HW,-HL,Z0),pr(-sgn*HW,HL,Z0),pr(-sgn*HW,HL,Z1),pr(-sgn*HW,-HL,Z1),'#5f4526',false);
  // end walls
  const ey=s>=0?-HL:HL;
  quad(pr(-HW,ey,Z0),pr(HW,ey,Z0),pr(HW,ey,Z1),pr(-HW,ey,Z1),'#6d5231',true);
  // near side wall with bow slits
  quad(pr(sgn*HW,-HL,Z0),pr(sgn*HW,HL,Z0),pr(sgn*HW,HL,Z1),pr(sgn*HW,-HL,Z1),'#7a5830',true);
  ctx.strokeStyle='rgba(28,18,8,.7)';ctx.lineWidth=1.2;
  for(const sy2 of[-3.6,0,3.6]){
    const a=pr(sgn*HW,sy2,4.2),b=pr(sgn*HW,sy2,6.2);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  // sunlit top edge on the near wall
  ctx.strokeStyle='rgba(255,244,214,.3)';ctx.lineWidth=.9;
  {const a=pr(sgn*HW,-HL,Z1),b=pr(sgn*HW,HL,Z1);
   ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  // arched team-color canopy with pale ribs
  const rib=(ty2)=>{const a=pr(-HW,ty2,Z1),m=pr(0,ty2,ZR),b=pr(HW,ty2,Z1);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(m.x,m.y,b.x,b.y);};
  ctx.fillStyle=TC.main;
  rib(-HL);const bEnd=pr(HW,HL,Z1),aEnd=pr(-HW,HL,Z1),mEnd=pr(0,HL,ZR);
  ctx.lineTo(bEnd.x,bEnd.y);ctx.quadraticCurveTo(mEnd.x,mEnd.y,aEnd.x,aEnd.y);ctx.closePath();ctx.fill();
  ctx.save();ctx.clip();
  ctx.fillStyle='rgba(42,48,66,.22)';ctx.fillRect(1,-40,30,60);      // cool shade flank
  ctx.fillStyle='rgba(255,240,204,.16)';ctx.fillRect(-31,-40,30,60); // warm lit flank
  ctx.restore();
  ctx.strokeStyle=TC.dark;ctx.lineWidth=.9;
  for(const ty2 of[-HL,-HL/2,0,HL/2,HL]){rib(ty2);ctx.stroke();}
  // archer peeking out the back with a bow
  if(Math.abs(s)>.3){
    const hx=pr(0,s>=0?HL*.7:-HL*.7,ZR-1.2);
    ctx.fillStyle=SKIN;ctx.strokeStyle=OUT;ctx.lineWidth=.8;
    ctx.beginPath();ctx.arc(hx.x,hx.y,1.9,0,7);ctx.fill();ctx.stroke();
    ctx.fillStyle='#7c5a34';
    ctx.beginPath();ctx.arc(hx.x,hx.y-.5,1.85,Math.PI,2*Math.PI);ctx.fill();
  }
  wheel(sgn*HW,-4.2,true);wheel(sgn*HW,4.2,true);
  ctx.restore();
}
function drawShip(u,t,TC){
  // shared hull/sail painter for the whole navy — snapped to diagonal headings
  // like the war wagon so a boat never collapses end-on
  const type=u.type;
  let phi=octPhi(u);
  phi=Math.round((phi-Math.PI/4)/(Math.PI/2))*(Math.PI/2)+Math.PI/4;
  const pr=rigProj(phi),s=pr.s,c=pr.c,sgn=c>=0?1:-1;
  const bob=Math.sin(t*.9+u.id*2.1)*.45; // gentler swell
  ctx.save();ctx.translate(0,bob);
  let P={ // per-type hull proportions
    fishing:{HL:3.4,HW:1.5,Z:3.4,hull:'#8a6538',sail:.6},
    cog:{HL:4.6,HW:2.4,Z:4.6,hull:'#7a5830',sail:1},
    transport:{HL:5.2,HW:2.6,Z:4,hull:'#93744a',sail:.8},
    galley:{HL:6.2,HW:1.9,Z:3.8,hull:'#6d5231',sail:1,ramProw:true,oars:true},
    fireship:{HL:5.4,HW:1.9,Z:3.8,hull:'#54381e',sail:.7,oars:true,brazier:true},
    demo:{HL:4.2,HW:1.9,Z:3.4,hull:'#5f4526',sail:.55,barrels:true},
    longboat:{HL:6.6,HW:1.7,Z:3.2,hull:'#4f3a1f',sail:.9,dragon:true,shields:true,oars:true},
    turtle:{HL:5.8,HW:2.6,Z:4.4,hull:'#4a4a50',shell:true,dragon:true},
    cannongalleon:{HL:6.4,HW:2.4,Z:4.6,hull:'#6a4a26',sail:1.05,cannon:true},
  }[type]||{HL:5,HW:2,Z:4,hull:'#7a5830',sail:1};
  P=Object.assign({},P); // scale pass — hulls need presence beside land units
  P.HL*=1.35;P.HW*=1.3;P.Z*=1.15;if(P.sail)P.sail*=1.15;
  const bow=y=>pr(0,y,P.Z*.55);
  // wake ripples astern when moving
  if(u.spd>.2){
    ctx.strokeStyle='rgba(228,242,246,.4)';ctx.lineWidth=1;
    const w1=pr(0,-P.HL-1.2,0),w2=pr(0,-P.HL-2.6,0);
    ctx.beginPath();ctx.ellipse(w1.x,w1.y,3.2,1.3,0,0,7);ctx.stroke();
    ctx.strokeStyle='rgba(228,242,246,.2)';
    ctx.beginPath();ctx.ellipse(w2.x,w2.y,4.4,1.7,0,0,7);ctx.stroke();
  }
  // hull: sheer-line polygon swept bow->stern, lit west / cool east
  const hullPath=(dz)=>{
    ctx.beginPath();
    const b0=pr(0,P.HL,1.4+dz),m1=pr(sgn*P.HW,P.HL*.45,dz),m2=pr(sgn*P.HW,-P.HL*.55,dz),
          st=pr(0,-P.HL,1.6+dz),m3=pr(-sgn*P.HW,-P.HL*.55,dz),m4=pr(-sgn*P.HW,P.HL*.45,dz);
    ctx.moveTo(b0.x,b0.y);ctx.lineTo(m1.x,m1.y);ctx.lineTo(m2.x,m2.y);ctx.lineTo(st.x,st.y);
    ctx.lineTo(m3.x,m3.y);ctx.lineTo(m4.x,m4.y);ctx.closePath();
  };
  ctx.fillStyle=shadeCol(P.hull,-.08);hullPath(0);ctx.fill();
  ctx.fillStyle=P.hull;hullPath(P.Z);ctx.fill();
  ctx.save();hullPath(P.Z);ctx.clip();
  ctx.fillStyle='rgba(42,48,66,.25)';ctx.fillRect(1,-40,30,80);
  ctx.fillStyle='rgba(255,240,204,.18)';ctx.fillRect(-31,-40,30,80);
  ctx.restore();
  ctx.strokeStyle='rgba(64,44,26,.55)';ctx.lineWidth=1;hullPath(P.Z);ctx.stroke();
  // gunwale highlight
  ctx.strokeStyle='rgba(255,244,214,.3)';ctx.lineWidth=.8;
  {const a=pr(sgn*P.HW,P.HL*.45,P.Z),b=pr(sgn*P.HW,-P.HL*.55,P.Z);
   ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  if(P.oars&&u.spd>.2){ // dipping oars
    ctx.strokeStyle='rgba(64,44,26,.6)';ctx.lineWidth=1;
    for(const oy of[-P.HL*.35,0,P.HL*.35]){
      const o0=pr(sgn*P.HW,oy,P.Z*.7),dip=Math.sin(t*4+oy)*1.2;
      ctx.beginPath();ctx.moveTo(o0.x,o0.y);ctx.lineTo(o0.x+sgn*4,o0.y+3+dip);ctx.stroke();}
  }
  if(P.ramProw){ // bronze beak at the waterline
    const r0=pr(0,P.HL,1.2),r1=pr(0,P.HL+1.6,.6);
    ctx.strokeStyle='#c98a3f';ctx.lineWidth=2.2;
    ctx.beginPath();ctx.moveTo(r0.x,r0.y);ctx.lineTo(r1.x,r1.y);ctx.stroke();
  }
  if(P.dragon){ // carved prow rearing high
    const d0=pr(0,P.HL*.95,P.Z),d1=pr(0,P.HL*1.15,P.Z+5.5);
    ctx.strokeStyle=P.shell?'#7a8288':'#6d5231';ctx.lineWidth=2.4;
    ctx.beginPath();ctx.moveTo(d0.x,d0.y);ctx.quadraticCurveTo(d0.x+(d1.x-d0.x)*.2,d1.y+2,d1.x,d1.y);ctx.stroke();
    ctx.fillStyle=P.shell?'#8e989e':'#7a5830';
    ctx.beginPath();ctx.arc(d1.x,d1.y,1.6,0,7);ctx.fill();
    ctx.fillStyle='#e2761e';ctx.beginPath();ctx.arc(d1.x+sgn,d1.y,.5,0,7);ctx.fill();
  }
  if(P.shields){ // round shields along the gunwale
    for(let i2=0;i2<4;i2++){
      const q=pr(sgn*P.HW,P.HL*.4-i2*P.HL*.28,P.Z*.85);
      ctx.fillStyle=i2%2?TC.main:'#c9b07f';ctx.strokeStyle='rgba(64,44,26,.6)';ctx.lineWidth=.7;
      ctx.beginPath();ctx.arc(q.x,q.y,1.7,0,7);ctx.fill();ctx.stroke();}
  }
  if(P.barrels){ // powder kegs heaped amidships with a sparking fuse
    for(const[ox2,oy2] of [[-.7,-.8],[.7,-.6],[0,.8]]){
      const q=pr(ox2,oy2,P.Z+1.4);
      ctx.fillStyle='#3a3a40';ctx.strokeStyle='rgba(64,44,26,.6)';ctx.lineWidth=.7;
      ctx.beginPath();ctx.ellipse(q.x,q.y,1.8,2.2,0,0,7);ctx.fill();ctx.stroke();}
    const fq=pr(0,0,P.Z+4);
    ctx.fillStyle=Math.sin(t*14)>0?'#ffd75e':'#e2761e';
    ctx.beginPath();ctx.arc(fq.x,fq.y,.8,0,7);ctx.fill();
  }
  if(P.cannon){ // cannon galleon: a bronze bow gun on a squat carriage
    const c0=pr(0,P.HL*.35,P.Z+1.2),c1=pr(0,P.HL*.95,P.Z+2.4);
    ctx.strokeStyle='rgba(30,24,14,.5)';ctx.lineWidth=3.4;
    ctx.beginPath();ctx.moveTo(c0.x,c0.y);ctx.lineTo(c1.x,c1.y);ctx.stroke();
    ctx.strokeStyle='#7d6a3a';ctx.lineWidth=2.5;
    ctx.beginPath();ctx.moveTo(c0.x,c0.y);ctx.lineTo(c1.x,c1.y);ctx.stroke();
    ctx.strokeStyle='rgba(255,240,190,.35)';ctx.lineWidth=.8;
    ctx.beginPath();ctx.moveTo(c0.x-.8,c0.y-.8);ctx.lineTo(c1.x-.8,c1.y-.8);ctx.stroke();
    ctx.fillStyle='#3a3a40'; // kegs beside the gun
    const K=pr(-.9,P.HL*.15,P.Z+1.2);
    ctx.beginPath();ctx.ellipse(K.x,K.y,1.5,1.9,0,0,7);ctx.fill();
  }
  if(P.brazier){ // fire ship: iron pot of flame at the bow
    const q=pr(0,P.HL*.7,P.Z+2);
    ctx.fillStyle='#3a3a40';ctx.fillRect(q.x-1.6,q.y-1,3.2,2);
    const fl=.8+.3*Math.sin(t*10+u.id);
    ctx.fillStyle='rgba(226,110,30,.9)';
    ctx.beginPath();ctx.moveTo(q.x-1.5,q.y-1);ctx.quadraticCurveTo(q.x-1,q.y-4*fl,q.x,q.y-5*fl);
    ctx.quadraticCurveTo(q.x+1,q.y-4*fl,q.x+1.5,q.y-1);ctx.closePath();ctx.fill();
    ctx.fillStyle='rgba(250,210,90,.95)';ctx.beginPath();ctx.arc(q.x,q.y-2*fl,1,0,7);ctx.fill();
  }
  if(P.shell){ // turtle ship: iron carapace with spikes
    const sh=(dz)=>{ctx.beginPath();
      const a=pr(0,P.HL*.75,P.Z+dz),b=pr(sgn*P.HW*.85,0,P.Z+dz+2.4),
            cc=pr(0,-P.HL*.75,P.Z+dz),d2=pr(-sgn*P.HW*.85,0,P.Z+dz+2.4);
      ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(b.x,b.y-3,cc.x,cc.y);
      ctx.quadraticCurveTo(d2.x,d2.y-3,a.x,a.y);ctx.closePath();};
    ctx.fillStyle='#5c6066';sh(0);ctx.fill();
    ctx.save();sh(0);ctx.clip();
    ctx.fillStyle='rgba(42,48,66,.3)';ctx.fillRect(1,-40,30,80);
    ctx.fillStyle='rgba(255,240,204,.2)';ctx.fillRect(-31,-40,30,80);
    ctx.strokeStyle='rgba(30,30,36,.5)';ctx.lineWidth=.7;
    for(let i2=-2;i2<=2;i2++){const a=pr(sgn*i2*.8,P.HL*.7,P.Z),b=pr(sgn*i2*.8,-P.HL*.7,P.Z);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    ctx.restore();
    ctx.strokeStyle='rgba(30,30,36,.6)';ctx.lineWidth=.9;sh(0);ctx.stroke();
    ctx.fillStyle='#8e989e'; // spikes
    for(const[ox2,oy2] of [[0,P.HL*.4],[.9,0],[-.9,0],[0,-P.HL*.4]]){
      const q=pr(ox2,oy2,P.Z+3.4);
      ctx.beginPath();ctx.moveTo(q.x-1,q.y);ctx.lineTo(q.x,q.y-2.6);ctx.lineTo(q.x+1,q.y);ctx.closePath();ctx.fill();}
  }else if(P.sail){ // mast + team-striped sail
    const m0=pr(0,0,P.Z),m1=pr(0,0,P.Z+11*P.sail);
    ctx.strokeStyle='#5f4526';ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(m0.x,m0.y);ctx.lineTo(m1.x,m1.y);ctx.stroke();
    const sw2=5.5*P.sail,sh2=7.5*P.sail,belly=Math.abs(s)*1.6+.6;
    const sTop=pr(0,0,P.Z+10.5*P.sail),sBot=pr(0,0,P.Z+3.5*P.sail);
    ctx.fillStyle='#e8e0c8';
    ctx.beginPath();
    ctx.moveTo(sTop.x-sw2,sTop.y);ctx.quadraticCurveTo(sTop.x,sTop.y-1,sTop.x+sw2,sTop.y);
    ctx.lineTo(sBot.x+sw2,sBot.y);ctx.quadraticCurveTo(sBot.x+sgn*belly,sBot.y+2,sBot.x-sw2,sBot.y);
    ctx.closePath();ctx.fill();
    ctx.save();ctx.clip();
    ctx.fillStyle=TC.main; // team stripe across the canvas
    ctx.fillRect(sTop.x-sw2,(sTop.y+sBot.y)/2-1.4*P.sail,sw2*2,2.8*P.sail);
    ctx.fillStyle='rgba(42,48,66,.16)';ctx.fillRect(sTop.x,sTop.y-12,sw2+2,26);
    ctx.fillStyle='rgba(255,240,204,.2)';ctx.fillRect(sTop.x-sw2-2,sTop.y-12,sw2+2,26);
    ctx.restore();
    ctx.strokeStyle='rgba(64,44,26,.4)';ctx.lineWidth=.7;ctx.stroke();
  }
  if(type==='fishing'){ // rod arced over the stern with a taut line
    const f0=pr(0,-P.HL*.7,P.Z+1),f1=pr(0,-P.HL*1.5,P.Z+5);
    ctx.strokeStyle='#8a5a2b';ctx.lineWidth=.9;
    ctx.beginPath();ctx.moveTo(f0.x,f0.y);ctx.quadraticCurveTo((f0.x+f1.x)/2,f1.y,f1.x,f1.y);ctx.stroke();
    ctx.strokeStyle='rgba(240,240,240,.5)';ctx.lineWidth=.5;
    ctx.beginPath();ctx.moveTo(f1.x,f1.y);ctx.lineTo(f1.x,f1.y+7);ctx.stroke();
  }
  ctx.restore();
}
/* Wildlife rigs. One quadruped painter, three costumes — silhouette does the
   work: sheep are round and low-slung, deer stand tall on thin legs, boar are a
   forward-heavy wedge with tusks. Facing is a horizontal flip plus a squeeze
   when the beast is head-on; they never fight in formation, so the full octant
   projection the cavalry uses would be spent on nothing here. */
/* `y` is the barrel's centre in rig space, chosen so hoof (y + H*.25 + legLen)
   lands at ~3.2 — the ground line the two-legged rigs stand on. Get it wrong and
   the beast floats above its own shadow. */
const BEAST={
  sheep:{L:5.2,H:3.6,y:-1.1,legLen:3.4,neck:.14,fleece:true,
    body:'#ded9cc',shade:'#bab2a0',leg:'#6d5c46',head:'#4f4437',ear:'#584c40'},
  deer:{L:5.6,H:3.4,y:-3.3,legLen:5.6,neck:.34,antler:true,rump:true,
    body:'#a97d4e',shade:'#c49a68',leg:'#6b4c30',head:'#9a7145',ear:'#7d5a36'},
  boar:{L:6.2,H:4.2,y:-1.5,legLen:3.6,neck:.02,tusk:true,
    body:'#604d3d',shade:'#4a3a2d',leg:'#3a2d24',head:'#4c3d31',ear:'#3f3228'},
};
function drawBeastRig(u,t,TC,B){
  const hd=u.hdg||0,ch=Math.cos(hd);
  const dir=ch>=0?1:-1;
  const fs=.42+.58*Math.abs(ch);        // foreshorten as it turns toward the camera
  const moving=(u.spd!==undefined?u.spd>.05:!!(u.path&&u.path.length));
  const gait=moving?Math.sin(t*.8):0;
  const bob=moving?Math.abs(Math.sin(t*.8))*.45:Math.sin(t*.11+(u.id||0)*1.3)*.2;
  const X=x=>x*fs*dir;
  const by=B.y;
  ctx.save();ctx.translate(0,-bob);
  const legAt=(x,ph,near)=>{
    const sw=gait*Math.sin(ph)*1.6;
    const x0=X(x),x1=X(x+sw),y0=by+B.H*.25,y1=y0+B.legLen;
    ctx.strokeStyle=near?'rgba(64,44,26,.5)':'rgba(28,18,8,.8)';
    ctx.lineWidth=near?2.4:1.9;
    ctx.beginPath();ctx.moveTo(x0,y0);ctx.quadraticCurveTo((x0+x1)/2,(y0+y1)/2,x1,y1);ctx.stroke();
    if(near){ctx.strokeStyle=B.leg;ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(x0,y0);ctx.quadraticCurveTo((x0+x1)/2,(y0+y1)/2,x1,y1);ctx.stroke();}
    ctx.strokeStyle='#2b2016';ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(x1-.7,y1);ctx.lineTo(x1+.7,y1);ctx.stroke();
  };
  legAt(-B.L*.6,0,false);legAt(B.L*.55,3.14,false);   // far pair
  const barrel=()=>{ctx.beginPath();ctx.ellipse(0,by,B.L*fs,B.H,0,0,7);};
  ctx.fillStyle=B.body;barrel();ctx.fill();
  ctx.strokeStyle=OUT;ctx.lineWidth=.9;barrel();ctx.stroke();
  volShade(barrel);
  if(B.fleece){                                        // curls along the back
    ctx.strokeStyle='rgba(255,252,240,.5)';ctx.lineWidth=.8;
    for(let i=-2;i<=2;i++){
      ctx.beginPath();ctx.arc(X(i*B.L*.3),by-B.H*.52,1.1,3.4,6.1);ctx.stroke();}
  }else{
    ctx.fillStyle=B.shade;
    ctx.beginPath();ctx.ellipse(0,by+B.H*.42,B.L*fs*.82,B.H*.36,0,0,7);ctx.fill();
  }
  if(B.rump){ctx.fillStyle='rgba(246,240,226,.75)';
    ctx.beginPath();ctx.ellipse(X(-B.L*.78),by-B.H*.12,1.9*fs+.5,1.5,0,0,7);ctx.fill();}
  legAt(-B.L*.6,3.14,true);legAt(B.L*.55,0,true);      // near pair
  const nx=X(B.L*.72),ny=by-B.H*.35;
  const hx=X(B.L*(1.02+B.neck)),hy=by-B.H*(.55+B.neck*.9);
  ctx.strokeStyle=OUT;ctx.lineWidth=3.4;
  ctx.beginPath();ctx.moveTo(nx,ny);ctx.lineTo(hx,hy);ctx.stroke();
  ctx.strokeStyle=B.body;ctx.lineWidth=2.4;
  ctx.beginPath();ctx.moveTo(nx,ny);ctx.lineTo(hx,hy);ctx.stroke();
  const hw=2.2*(fs*.5+.5);
  ctx.fillStyle=B.head;ctx.strokeStyle=OUT;ctx.lineWidth=.7;
  ctx.beginPath();ctx.ellipse(hx,hy,hw,1.5,dir*.25,0,7);ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.ellipse(hx+dir*hw*.8,hy+.55,hw*.5,.9,0,0,7);ctx.fill();
  if(B.tusk){
    ctx.strokeStyle='#efe9d6';ctx.lineWidth=.9;
    ctx.beginPath();ctx.moveTo(hx+dir*hw*.9,hy+1.1);
    ctx.quadraticCurveTo(hx+dir*hw*1.5,hy+.2,hx+dir*hw*1.3,hy-1.2);ctx.stroke();
  }
  if(B.antler){
    ctx.strokeStyle='#9a8358';ctx.lineWidth=.85;
    for(const s2 of[-1,1]){
      const ax=hx+s2*.5*dir;
      ctx.beginPath();
      ctx.moveTo(ax,hy-1.2);ctx.lineTo(ax+dir*.9,hy-4.2);
      ctx.moveTo(ax+dir*.45,hy-2.7);ctx.lineTo(ax+dir*1.9,hy-3.4);
      ctx.moveTo(ax+dir*.75,hy-3.7);ctx.lineTo(ax-dir*.5,hy-4.7);ctx.stroke();
    }
  }else{
    ctx.fillStyle=B.ear;
    ctx.beginPath();ctx.ellipse(hx-dir*1.2,hy-1.3,.8,1.2,dir*.5,0,7);ctx.fill();
  }
  if(!RIG_LOD){ctx.fillStyle='#26180c';
    ctx.beginPath();ctx.arc(hx+dir*.6,hy-.3,.42,0,7);ctx.fill();}
  const tx0=X(-B.L*.95),ty0=by-B.H*.35;
  ctx.strokeStyle=B.leg;ctx.lineWidth=B.tusk?1.1:1.4;
  ctx.beginPath();ctx.moveTo(tx0,ty0);
  ctx.quadraticCurveTo(tx0-dir*1.4,ty0+.4+Math.sin(t*.4)*.4,tx0-dir*1.1,ty0+2.2);ctx.stroke();
  ctx.restore();
}
function drawUnitBody(u,t,sw,TC){
  if(UNITS[u.type].animal)return drawBeastRig(u,t,TC,BEAST[u.type]||BEAST.sheep);
  if(UNITS[u.type].ship)return drawShip(u,t,TC);
  if(u.type==='knight'||u.type==='cataphract')drawKnight(u,t,sw,TC);
  else if(u.type==='scout'||u.type==='mameluke'||u.type==='mangudai'
    ||u.type==='conquistador'||u.type==='tarkan'||u.type==='missionary')drawScout(u,t,sw,TC);
  else if(u.type==='elephant')drawElephant(u,t,sw,TC);
  else if(u.type==='monk')drawMonk(u,t,sw,TC);
  else if(u.type==='ram')drawRam(u,t,TC);
  else if(u.type==='scorpion')drawScorpion(u,t,TC);
  else if(u.type==='mangonel')drawMangonel(u,t,TC);
  else if(u.type==='treb')drawTreb(u,t,TC);
  else if(u.type==='bombard')drawBombard(u,t,TC);
  else if(u.type==='handcannon')drawManRigT(u,t,TC,'handcannon');
  else if(u.type==='warwagon')drawWarWagon(u,t,TC);
  else if(u.type==='tradecart')drawTradeCart(u,t,TC);
  else if(u.type==='king')drawManRigT(u,t,TC,'king');
  else if(u.type==='archer'||u.type==='longbow'||u.type==='chukonu'||u.type==='janissary'
    ||u.type==='plumed')drawArcher(u,t,sw,TC,false);
  else if(u.type==='skirmisher'||u.type==='axeman')drawArcher(u,t,sw,TC,true);
  else if(u.type==='militia'||u.type==='berserker'||u.type==='teuton'||u.type==='huskarl')drawSword(u,t,sw,TC);
  else if(u.type==='samurai'||u.type==='jaguar')drawManRigT(u,t,TC,u.type);
  else if(u.type==='petard')drawManRigT(u,t,TC,'petard');
  else if(u.type==='spearman'||u.type==='woad'||u.type==='eagle')drawSpear(u,t,sw,TC);
  else drawVillager(u,t,sw,TC);
}
function drawManRigT(u,t,TC,key){drawManRig(u,t,TC,MAN_COSTUME[key]);}
// AoE2-style square portraits, rendered once from the live painters and cached as dataURLs
const PORTRAITS={};
function portraitFor(kind,type,p){
  const pAge=G?G.P[p].age:3;
  const ab=pAge>=3?2:pAge>=2?1:0; // building art has three age looks now
  const key=kind+'_'+type+'_'+p
    +(kind==='u'&&type==='militia'?'_'+(G?G.P[p].age:0):'')
    +(kind==='b'?'_'+ab:'');
  if(PORTRAITS[key])return PORTRAITS[key];
  const S=88,c=document.createElement('canvas');c.width=c.height=S;
  const g=c.getContext('2d');
  /* Painted card backdrops (mobile-game reference art): buildings sit in a
     little landscape — hazy sky down to a grass ground band — while units get
     a warm smoky studio dark so team colours carry the tile. One function
     feeds every button and card in the game, so this is the whole UI's look. */
  if(kind==='b'||kind==='res'){
    const bg=g.createLinearGradient(0,0,0,S);
    bg.addColorStop(0,'#7d98ac');bg.addColorStop(.42,'#b3b492');
    bg.addColorStop(.58,'#8f9a5c');bg.addColorStop(1,'#55663a');
    g.fillStyle=bg;g.fillRect(0,0,S,S);
    g.fillStyle='rgba(255,244,200,.20)';                      // low sun haze
    g.beginPath();g.ellipse(S*.32,S*.30,S*.34,S*.16,0,0,7);g.fill();
    g.fillStyle='rgba(28,36,18,.30)';                         // ground shadow
    g.beginPath();g.ellipse(S/2,S*.86,S*.42,S*.10,0,0,7);g.fill();
  }else{
    const bg=g.createRadialGradient(S*.38,S*.30,6,S/2,S*.55,S*.85);
    bg.addColorStop(0,'#6b6154');bg.addColorStop(.6,'#453c30');bg.addColorStop(1,'#241f18');
    g.fillStyle=bg;g.fillRect(0,0,S,S);
    g.fillStyle='rgba(0,0,0,.30)';g.fillRect(0,S*.74,S,S*.26);
  }
  // corner vignette so every tile reads as a framed painting
  const vg=g.createRadialGradient(S/2,S/2,S*.34,S/2,S/2,S*.72);
  vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,'rgba(10,8,4,.38)');
  g.fillStyle=vg;g.fillRect(0,0,S,S);
  if(kind==='u'){
    const fake={type,p,state:'idle',cd:0,carry:0,gatherT:0,face:1};
    const big=!!UNITS[type].cav||type==='ram'||type==='elephant'||!!UNITS[type].siege;
    const k=big?4.2:5.6;
    const old=ctx;ctx=g;
    try{g.setTransform(k,0,0,k,S/2,S/2+(big?17:14)*k-S*.12);g.lineCap='round';g.lineJoin='round';
      drawUnitBody(fake,0,0,TEAMS[p]);}
    finally{ctx=old;}
    g.setTransform(1,0,0,1,0,0);
  }else if(kind==='b'){
    const sp=getBldSpr(type,p,true);
    const k=Math.min((S-6)/sp.w,(S-6)/sp.h);
    g.drawImage(sp.c,S/2-sp.w*k/2,S-4-sp.h*k,sp.w*k,sp.h*k);
  }else if(kind==='res'){
    const sp=getResSpr(type,3);
    const k=Math.min((S-10)/sp.w,(S-10)/sp.h);
    g.drawImage(sp.c,S/2-sp.w*k/2,S-6-sp.h*k,sp.w*k,sp.h*k);
  }else{ // crest: team shield on parchment ground
    const TC=TEAMS[p];
    g.fillStyle=TC.main;g.strokeStyle='#120d07';g.lineWidth=2.5;
    g.beginPath();g.moveTo(S/2,S*.16);
    g.quadraticCurveTo(S*.82,S*.2,S*.8,S*.42);
    g.quadraticCurveTo(S*.78,S*.7,S/2,S*.85);
    g.quadraticCurveTo(S*.22,S*.7,S*.2,S*.42);
    g.quadraticCurveTo(S*.18,S*.2,S/2,S*.16);g.closePath();g.fill();g.stroke();
    g.strokeStyle=TC.trim;g.lineWidth=1.6;
    g.beginPath();g.moveTo(S/2,S*.2);g.lineTo(S/2,S*.8);
    g.moveTo(S*.26,S*.44);g.lineTo(S*.74,S*.44);g.stroke();
    g.fillStyle='#f0d878';
    g.beginPath();g.arc(S/2,S*.44,5,0,7);g.fill();
  }
  g.strokeStyle='#111';g.lineWidth=4;g.strokeRect(2,2,S-4,S-4);
  g.strokeStyle='#c9a227';g.lineWidth=2;g.strokeRect(3.5,3.5,S-7,S-7);
  g.strokeStyle='rgba(255,240,190,.5)';g.lineWidth=.8;g.strokeRect(5,5,S-10,S-10);
  return PORTRAITS[key]=c.toDataURL();
}
/* Occluded-ally silhouettes: when a friendly unit walks behind a building or
   tree canopy, redraw it as a flat team-color ghost so it never vanishes.
   (The one engine-spec idea grafted into the old game — pure QoL, no balance.) */
let ghostC=null,ghostG=null;
/* Building VISUAL scale, both renderers — Daniel tunes this by feel (+40%
   was too much, +25% is current). One constant per renderer; the roof-click
   boxes, occlusion bounds, 3D pick volume, shadows and rings all read these,
   so a retune is exactly two numbers. 2D multiplies the 1.13 art base. */
const BLD_VS2D=1.41;   // 1.13 × 1.25
function unitOccluded(u,px,py){
  for(const b of G.blds){
    if(!b.built)continue;
    const hgt=IHT[b.type]||30;
    if(hgt<30)continue;                       // walls and farms are too low to hide anyone
    const fp=isoE(b.tx+b.size,b.ty+b.size);   // building sprite's lowest corner
    if(fp.y<=py+2)continue;                   // painted before the unit — can't cover it
    // sprites draw at BLD_VS2D from the south anchor, so they reach higher and
    // wider than the footprint art these bounds were first tuned against
    if(fp.y-py>(hgt+b.size*13)*BLD_VS2D+6)continue;  // unit is above the sprite's top
    const cx=isoE(b.tx+b.size/2,b.ty+b.size/2).x;
    if(Math.abs(cx-px)<b.size*26*BLD_VS2D+14)return true;
  }
  const ux=Math.floor(u.x),uy=Math.floor(u.y);
  for(let dy=-3;dy<=4;dy++)for(let dx=-3;dx<=4;dx++){
    const s=dx+dy;if(s<1||s>4)continue;       // only tiles painted after the unit
    const r=G.res[(ux+dx)+','+(uy+dy)];
    if(!r||r.type!=='wood')continue;
    const rp=isoE(r.x+.5,r.y+.5);
    if(Math.abs(rp.x-px)<=20&&rp.y>py+1&&rp.y-py<52)return true;
  }
  return false;
}
function drawGhosts(){
  for(const u of G.units){
    if(u.hp<=0||!allied(u.p,localP))continue;
    const pp=isoE(u.x,u.y),px=pp.x,py=pp.y;
    if(px<cullX0||px>cullX1||py<cullY0||py>cullY1)continue;
    if(!tileVis(u.x,u.y))continue;
    if(!unitOccluded(u,px,py))continue;
    if(!ghostC){ghostC=document.createElement('canvas');ghostC.width=110;ghostC.height=124;
      ghostG=ghostC.getContext('2d');}
    ghostG.setTransform(1,0,0,1,0,0);
    ghostG.clearRect(0,0,110,124);
    ghostG.translate(55,88);ghostG.scale(1.24,1.24);ghostG.lineCap='round';
    const old=ctx;ctx=ghostG;
    try{drawUnitBody(u,G.t*9+u.id*1.71,0,TEAMS[u.p]);}
    finally{ctx=old;}
    ghostG.setTransform(1,0,0,1,0,0);
    ghostG.globalCompositeOperation='source-in';
    ghostG.fillStyle=TEAMS[u.p].main;
    ghostG.fillRect(0,0,110,124);
    ghostG.globalCompositeOperation='source-over';
    ctx.globalAlpha=.42;
    ctx.drawImage(ghostC,px-55,py-88);
    ctx.globalAlpha=1;
  }
}
/* ---------- UNIT SPRITES ---------------------------------------------------
   Pre-rendered 8-facing sheets built in Blender (see blender/README.md). Sheet
   row k IS octant k straight out of octPhi(), so there is no remapping here.
   Entirely cosmetic: the simulation never reads any of this, and if the sheets
   are missing or blocked -- the ARTIFACT's CSP blocks every fetch -- each unit
   silently keeps its procedural rig. That fallback is the whole safety story;
   do not make any of this load-bearing.
---------------------------------------------------------------------------- */
const USPR={meta:null,base:null,tried:false,img:{},tint:{}};
let spritesOn=true;
const SPR_SCALE=0.40;   // sheet px -> world-iso px: a 55px man lands at ~22px, matching the rigs
const SPR_GROUND=4.3;   // the rigs plant their feet this far below the unit's screen point
// types with no sheet (elephant, tradecart, warwagon) are simply absent and fall back
const SPR_ALIAS={villager:'villager',militia:'militia',spearman:'spearman',
  archer:'archer',skirmisher:'skirmisher',scout:'scout',knight:'knight',ram:'ram',
  petard:'petard',scorpion:'scorpion',mangonel:'mangonel',treb:'treb',
  bombard:'bombard',handcannon:'handcannon',monk:'monk',missionary:'missionary',
  longbow:'longbow',axeman:'axeman',berserker:'berserker',mangudai:'mangudai',
  teuton:'teuton',woad:'woad',cataphract:'cataphract',mameluke:'mameluke',
  huskarl:'huskarl',chukonu:'chukonu',janissary:'janissary',samurai:'samurai',
  jaguar:'jaguar',eagle:'eagle',plumed:'plumed',king:'king',
  fishing:'fishing',cog:'cog',transport:'transport',galley:'galley',
  fireship:'fireship',demo:'demo',longboat:'longboat',turtle:'turtle',
  cannongalleon:'cannongalleon',sheep:'sheep',deer:'deer',boar:'boar'};
function sprInit(){
  if(USPR.tried)return;USPR.tried=true;
  // 'sprites/' when served as the PWA (app/), 'app/sprites/' from the repo root
  const paths=['sprites/','app/sprites/'];
  (function next(i){
    if(i>=paths.length)return;
    fetch(paths[i]+'sprites.json').then(r=>r.ok?r.json():Promise.reject(0))
      .then(j=>{USPR.meta=j;USPR.base=paths[i];})
      .catch(()=>next(i+1));
  })(0);
}
function sprKey(u){
  let k=SPR_ALIAS[u.type];if(!k)return null;
  // line upgrades are a visual READ of player age, never the other way round
  const P=G.P[u.p];
  if(P&&P.age>=2){if(u.type==='spearman')k='pikeman';else if(u.type==='archer')k='crossbowman';}
  return k;
}
function sprAnimOf(u,meta,moving){
  const A=meta.anims;
  if(u.state==='attack'&&A.attack)return'attack';
  if(A.work&&(u.state==='gather'||u.state==='farming'||u.state==='building'))return'work';
  if(u.state==='convert'&&A.attack)return'attack';
  if(moving&&A.walk)return'walk';
  return A.idle?'idle':Object.keys(A)[0];
}
function sprFrame(u,m,an){
  if(an==='attack'){
    // ride the real swing timing so the strike frame lands on the hit
    const ap=atkPhase(u);
    if(ap&&ap.k){
      const f=ap.k===1?ap.f*.34:ap.k===2?.34+ap.f*.20:.54+ap.f*.46;
      return Math.max(0,Math.min(m.frames-1,(f*m.frames)|0));
    }
  }
  const k=(G.t*m.fps+(u.id||0)*2.7)|0;
  return ((k%m.frames)+m.frames)%m.frames;
}
function sprTint(base,mask,team){
  // every team palette entry shares one hue, so the blue channel alone carries
  // the shading band: k = blue/0xd4 recovers it, k*target repaints the pixel
  const c=document.createElement('canvas');c.width=base.width;c.height=base.height;
  const g=c.getContext('2d');g.drawImage(base,0,0);
  const mc=document.createElement('canvas');mc.width=base.width;mc.height=base.height;
  const mg=mc.getContext('2d');mg.drawImage(mask,0,0);
  const bd=g.getImageData(0,0,c.width,c.height),md=mg.getImageData(0,0,c.width,c.height);
  const hx=(TEAMS[team]&&TEAMS[team].main)||'#2a56d4';
  const tr=parseInt(hx.substr(1,2),16),tg=parseInt(hx.substr(3,2),16),tb=parseInt(hx.substr(5,2),16);
  const B=bd.data,M=md.data;
  for(let i=0;i<B.length;i+=4){
    if(B[i+3]===0||M[i]<128)continue;
    const k=B[i+2]/0xd4;
    B[i]=Math.min(255,tr*k);B[i+1]=Math.min(255,tg*k);B[i+2]=Math.min(255,tb*k);
  }
  g.putImageData(bd,0,0);return c;
}
function sprImg(k,src){
  let v=USPR.img[k];
  if(v===undefined){
    USPR.img[k]=null;
    const im=new Image();
    im.onload=()=>{USPR.img[k]=im;};im.onerror=()=>{USPR.img[k]=false;};
    im.src=USPR.base+src;
    return null;
  }
  return v||null;
}
function sprGet(key,an,p){
  const m=USPR.meta[key].anims[an];
  const team=(p===GAIA||p===undefined)?0:p;   // wildlife carries no player colour
  const ck=key+'/'+an+'/'+team;
  const hit=USPR.tint[ck];if(hit)return hit;
  const base=sprImg(key+'/'+an,m.sheet);if(!base)return null;
  // player 0 is the colour already baked into the sheet: no mask fetch at all
  if(team===0||!m.mask){USPR.tint[ck]=base;return base;}
  const msk=sprImg(key+'/'+an+'/m',m.mask);if(!msk)return null;
  USPR.tint[ck]=sprTint(base,msk,team);return USPR.tint[ck];
}
function sprDraw(u,moving){
  if(!spritesOn||!USPR.meta)return false;
  const key=sprKey(u);if(!key)return false;
  const meta=USPR.meta[key];if(!meta)return false;
  const an=sprAnimOf(u,meta,moving),m=meta.anims[an];if(!m)return false;
  const img=sprGet(key,an,u.p);if(!img)return false;
  octPhi(u);                                   // same hysteresis the rigs use
  const d=((u._oct%8)+8)%8,cw=meta.cell[0],ch=meta.cell[1],S=SPR_SCALE;
  const f=sprFrame(u,m,an);
  ctx.drawImage(img,f*cw,d*ch,cw,ch,
    -meta.anchorX*S,SPR_GROUND-meta.anchorY*S,cw*S,ch*S);
  return true;
}
function toggleSprites(){
  spritesOn=!spritesOn;
  const b=document.getElementById('sprBtn');if(b)b.classList.toggle('sel',spritesOn);
  toast(spritesOn?(USPR.meta?'Rendered sprites':'Rendered sprites (no sheets found - procedural art)')
                 :'Procedural art');
}
/* ===== Blender BUILDING sprites (graphics campaign G1) =====================
   The same forge, camera and toon materials the units already use, applied to
   the town. One image per (building, age) plus a team mask, rendered at 2x the
   game's native tile scale (atlas ppt = 52 px per IW). drawBld tries bsprDraw
   first and falls back to the procedural art whenever it returns false — the
   identical safety story sprDraw established. Construction sites, rubble and
   the thin wall tiler stay procedural on purpose. */
const BSPR={meta:null,base:'',img:{},tint:{},tried:false};
function bsprInit(){
  if(BSPR.tried)return;BSPR.tried=true;
  const paths=['bsprites/','app/bsprites/'];
  (function next(i){
    if(i>=paths.length)return;
    fetch(paths[i]+'bsprites.json').then(r=>r.ok?r.json():Promise.reject(0))
      .then(j=>{BSPR.meta=j;BSPR.base=paths[i];})
      .catch(()=>next(i+1));
  })(0);
}
function bimg(k,src){
  let v=BSPR.img[k];
  if(v===undefined){
    BSPR.img[k]=null;
    const im=new Image();
    im.onload=()=>{BSPR.img[k]=im;};im.onerror=()=>{BSPR.img[k]=false;};
    im.src=BSPR.base+src;
    return null;
  }
  return v||null;
}
function bsprGet(type,age,team,sl){
  const e=BSPR.meta.blds[type];if(!e)return null;
  const A=e.ages[age];if(!A)return null;
  const ck=type+'/'+age+'/'+team+'/'+(sl|0);
  const hit=BSPR.tint[ck];if(hit)return hit;
  const base=bimg(type+'/'+age,A.sheet);if(!base)return null;
  let out=base;
  if(team!==0){
    const msk=bimg(type+'/'+age+'/m',A.mask);if(!msk)return null;
    out=sprTint(base,msk,team);          // the unit tinter works on any sheet
  }
  if(sl){ // snow settles on the new roofs exactly like it did on the old
    const c=document.createElement('canvas');c.width=A.w;c.height=A.h;
    c.getContext('2d').drawImage(out,0,0);
    snowRim(c,sl);out=c;
  }
  BSPR.tint[ck]=out;return out;
}
function bsprDraw(b,pt0,bl){
  if(!spritesOn||!BSPR.meta)return false;
  const d=BLDS[b.type];
  if(d.thin||!b.built)return false;        // walls tile; sites scaffold — both stay procedural
  const e=BSPR.meta.blds[b.type];if(!e)return false;
  const P=G.P[b.p];
  const age=Math.min(3,(P&&P.age)|0);
  const A=e.ages[age];if(!A)return false;
  const img=bsprGet(b.type,age,b.p,wxSnowLvl);if(!img)return false;
  const ps=isoPt(b.tx+b.size,b.ty+b.size); // the footprint's south corner
  ps.y-=bl;
  const BS=d.farm?1:BLD_VS2D;
  /* ppt = sheet px per IW-halfwidth (52 at R=2), so game px per sheet px is
     26/ppt; times the visual scale BS. Written out so a future ppt change
     (an HD pack at R=3, say) needs no code edit. */
  const kk=BS*26/BSPR.meta.ppt;
  const rx=ps.x-A.ax*kk,ry=ps.y-A.ay*kk,rw=A.w*kk,rh=A.h*kk;
  // soft SE contact shadow so the art sits ON the ground instead of floating —
  // same sun the sheets were lit by (key from the upper-left)
  if(!d.farm){
    const pc2=isoPt(b.tx+b.size/2,b.ty+b.size/2);pc2.y-=bl;
    ctx.globalAlpha=.16;
    ctx.fillStyle='#1c1408';
    ctx.beginPath();
    ctx.ellipse(pc2.x+b.size*4,pc2.y+2,b.size*IW*.92,b.size*IH*.85,0,0,7);
    ctx.fill();
    ctx.globalAlpha=1;
  }
  ctx.drawImage(img,rx,ry,rw,rh);
  return {x:rx,y:ry,w:rw,h:rh};  // the caller draws the flash over this rect
}
function drawUnit(u){
  const pp=isoE(u.x,u.y),px=pp.x,py=pp.y;
  if(px<cullX0||px>cullX1||py<cullY0||py>cullY1)return;
  const moving=u.spd!==undefined?u.spd>.05:!!(u.path&&u.path.length);
  const t=G.t*9+u.id*1.71;
  const sw=moving?Math.sin(t):0; // legacy param, unused by the rigs
  const big=!!UNITS[u.type].cav||u.type==='ram'||!!UNITS[u.type].ship||!!UNITS[u.type].siege;
  if(G.sel.includes(u.id)||(G.inspect&&G.inspect.id===u.id)){
    // white ellipse, exactly like the original
    ctx.strokeStyle=G.inspect&&G.inspect.id===u.id?'rgba(230,230,230,.7)':'rgba(255,255,255,.95)';ctx.lineWidth=1.4;
    ctx.beginPath();ctx.ellipse(px,py+4,big?12:9,big?5.5:4.2,0,0,7);ctx.stroke();
  }
  ctx.fillStyle='rgba(24,27,36,.16)'; // soft baked shadow: two passes fake a blur
  ctx.beginPath();ctx.ellipse(px+(big?3:2),py+4.3,big?12:8.4,big?4.5:3.3,.14,0,7);ctx.fill();
  ctx.fillStyle='rgba(24,27,36,.2)';
  ctx.beginPath();ctx.ellipse(px+(big?3:2),py+4.3,big?9.5:6.5,big?3.4:2.5,.14,0,7);ctx.fill();
  ctx.save();ctx.translate(px,py);
  if(!sprDraw(u,moving)){
    ctx.scale(1.24,1.24); // rigs orient, bob, and lunge themselves — AoE2 upright walk
                          // (1.18 +5% per Daniel; corpse+ghost scales must match)
    ctx.lineCap='round';
    drawUnitBody(u,t,sw,TEAMS[u.p]);
  }
  ctx.restore();
  if(u.flash>0){
    ctx.globalAlpha=Math.min(.55,u.flash*3.4);
    ctx.fillStyle='#fff';
    ctx.beginPath();ctx.arc(px,py-8,big?10:7,0,7);ctx.fill();
    ctx.globalAlpha=1;
  }
  if(u.hp<u.maxhp){
    ctx.fillStyle='rgba(16,12,6,.75)';ctx.fillRect(px-7,py-(big?22:19),14,2.6);
    ctx.fillStyle=u.hp/u.maxhp>.4?'#5c9141':'#c2493d';
    ctx.fillRect(px-6.6,py-(big?21.6:18.6),13.2*(u.hp/u.maxhp),1.8);
  }
}
function limb(x1,y1,x2,y2,col,w){
  ctx.strokeStyle='rgba(64,44,26,.5)';ctx.lineWidth=w+1;
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  ctx.strokeStyle=col;ctx.lineWidth=w;
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
}
function volShade(pathFn){
  // clip to the shape: cool ambient fill on the shaded flank, warm key light on
  // the sunlit flank, plus a pale rim along the lit edge — replaces outlines
  ctx.save();ctx.beginPath();pathFn();ctx.clip();
  ctx.fillStyle='rgba(42,48,66,.22)';ctx.fillRect(.8,-34,22,44);
  ctx.fillStyle='rgba(255,240,204,.16)';ctx.fillRect(-22,-34,21.2,44);
  ctx.strokeStyle='rgba(255,244,214,.28)';ctx.lineWidth=1.6;
  ctx.beginPath();pathFn();ctx.stroke(); // clipped: reads as a thin inner rim
  ctx.restore();
}
function hand(x,y){ctx.fillStyle=SKIN;ctx.strokeStyle=OUT;ctx.lineWidth=.6;
  ctx.beginPath();ctx.arc(x,y,1.15,0,7);ctx.fill();ctx.stroke();}
function faceEye(hx,hy,r){
  ctx.fillStyle='rgba(150,90,50,.3)';
  ctx.beginPath();ctx.arc(hx-r*.4,hy+r*.25,r*.45,0,7);ctx.fill();
  ctx.fillStyle='#33200f';
  ctx.beginPath();ctx.arc(hx+r*.42,hy-r*.1,.5,0,7);ctx.fill();
}
function legs(sw,col){
  const one=(x0,dx)=>{
    const bend=Math.abs(sw)*.9+.2;
    ctx.strokeStyle='rgba(64,44,26,.52)';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(x0,-3.4);ctx.quadraticCurveTo(x0+dx*.45+bend,.4,x0+dx,4);ctx.stroke();
    ctx.strokeStyle=col;ctx.lineWidth=1.9;
    ctx.beginPath();ctx.moveTo(x0,-3.4);ctx.quadraticCurveTo(x0+dx*.45+bend,.4,x0+dx,4);ctx.stroke();
    ctx.strokeStyle='#2e2012';ctx.lineWidth=1.8;
    ctx.beginPath();ctx.moveTo(x0+dx-.4,4.1);ctx.lineTo(x0+dx+1.6,4.1);ctx.stroke();
  };
  one(-1.6,sw*2.4);one(1.6,-sw*2.4);
}
function drawVillager(u,t,sw,TC){drawManRig(u,t,TC,MAN_COSTUME.villager);}
function drawVillager_legacy(u,t,sw,TC){
  legs(sw,'#5a4023');
  // shirt with flared skirt, shaded for volume
  const body=()=>{ctx.beginPath();
    ctx.moveTo(-2.9,-10.6);ctx.quadraticCurveTo(-4.6,-8,-4.4,-2.6);
    ctx.lineTo(4.4,-2.6);ctx.quadraticCurveTo(4.6,-8,2.9,-10.6);
    ctx.quadraticCurveTo(0,-11.6,-2.9,-10.6);ctx.closePath();};
  ctx.fillStyle=TC.main;body();ctx.fill();
  volShade(body);
  ctx.strokeStyle=OUT;ctx.lineWidth=1.1;body();ctx.stroke();
  // rope belt with knot
  ctx.fillStyle=TC.dark;ctx.fillRect(-4,-4.6,8,1.7);
  ctx.fillStyle='#c9b07f';ctx.fillRect(-.8,-4.8,1.6,2.1);
  const working=u.state==='gather'||u.state==='farming'||u.state==='building';
  if(working){
    const a=Math.sin(u.gatherT*6.283)*0.95-0.5;
    ctx.save();ctx.translate(2.6,-8);ctx.rotate(a);
    limb(0,0,2.4,.6,TC.main,1.7);   // sleeve
    limb(2.4,.6,4.5,1,SKIN,1.5);    // forearm
    hand(4.7,1);
    ctx.strokeStyle='#6b4a2a';ctx.lineWidth=1.4;
    ctx.beginPath();ctx.moveTo(4.5,1);ctx.lineTo(7,0);ctx.stroke();
    ctx.fillStyle='#9aa0a6';ctx.fillRect(6,-2.4,2.6,3);
    ctx.fillStyle='#d8dbdf';ctx.fillRect(6.2,-2.2,2.2,1);
    ctx.restore();
  }else{
    limb(-3.1,-8.4,-3.2,-6,TC.main,1.8);
    limb(-3.2,-6,-3.1-sw*1.6,-2.8,SKIN,1.5);hand(-3.1-sw*1.6,-2.6);
    limb(3.1,-8.4,3.2,-6,TC.main,1.8);
    limb(3.2,-6,3.1+sw*1.6,-2.8,SKIN,1.5);hand(3.1+sw*1.6,-2.6);
  }
  if(u.carry>3){
    ctx.fillStyle=u.carryType==='food'?'#b03a30':u.carryType==='gold'?'#e3b23c':'#c9b07f';
    ctx.strokeStyle=OUT;ctx.lineWidth=.8;
    ctx.beginPath();ctx.ellipse(-4.4,-8.5,2.6,3,-.3,0,7);ctx.fill();ctx.stroke();
    ctx.strokeStyle='rgba(30,20,8,.35)';ctx.lineWidth=.6;
    ctx.beginPath();ctx.moveTo(-5.6,-9.5);ctx.quadraticCurveTo(-4.4,-8.2,-3.2,-9.2);ctx.stroke();
  }
  // head: face, hair, straw cap
  ctx.fillStyle=SKIN;ctx.strokeStyle=OUT;ctx.lineWidth=.9;
  ctx.beginPath();ctx.arc(0,-13.4,3.1,0,7);ctx.fill();ctx.stroke();
  faceEye(0,-13.4,3.1);
  ctx.fillStyle='#5a3d22';
  ctx.beginPath();ctx.arc(0,-13.9,3,Math.PI*.9,Math.PI*2.1);ctx.fill();
  ctx.fillStyle='#c9b07f';ctx.strokeStyle='#8a6a2f';ctx.lineWidth=.6;
  ctx.beginPath();ctx.ellipse(0,-15.6,3.6,1.2,0,0,7);ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.arc(0,-16.2,1.9,Math.PI,2*Math.PI);ctx.fill();ctx.stroke();
}
function drawSword(u,t,sw,TC){drawManRig(u,t,TC,MAN_COSTUME.militia);}
function drawSword_legacy(u,t,sw,TC){
  legs(sw,'#3c2f1e');
  const body=()=>{ctx.beginPath();
    ctx.moveTo(-3.1,-10.8);ctx.quadraticCurveTo(-4.9,-8,-4.6,-2.6);
    ctx.lineTo(4.6,-2.6);ctx.quadraticCurveTo(4.9,-8,3.1,-10.8);
    ctx.quadraticCurveTo(0,-11.8,-3.1,-10.8);ctx.closePath();};
  ctx.fillStyle=TC.main;body();ctx.fill();
  volShade(body);
  ctx.strokeStyle=OUT;ctx.lineWidth=1.1;body();ctx.stroke();
  // mail skirt with ring rows
  ctx.fillStyle='#9aa0a6';ctx.fillRect(-4.2,-4.4,8.4,2.2);
  ctx.strokeStyle='rgba(60,64,70,.55)';ctx.lineWidth=.5;
  for(const lx of [-3,-1.4,.2,1.8,3.4]){
    ctx.beginPath();ctx.moveTo(lx,-4.4);ctx.lineTo(lx,-2.2);ctx.stroke();}
  ctx.fillStyle='rgba(255,255,255,.25)';ctx.fillRect(-4.2,-4.4,8.4,.7);
  // sword arm with sleeve + hand, blade with fuller and crossguard
  const recent=u.state==='attack'&&u.cd>1.15;
  const ang=recent?-1.5+(1.5-u.cd)*7:-1.0;
  ctx.save();ctx.translate(3.4,-8.2);ctx.rotate(ang);
  limb(0,0,2.2,.5,TC.main,1.6);
  hand(2.5,.5);
  ctx.strokeStyle='#8a8f96';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(3,.4);ctx.lineTo(10.8,.4);ctx.stroke();
  ctx.strokeStyle='#eef1f4';ctx.lineWidth=.7;
  ctx.beginPath();ctx.moveTo(3.2,-.1);ctx.lineTo(10.6,-.1);ctx.stroke();
  ctx.strokeStyle='#8a6a2f';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(2.8,-1.9);ctx.lineTo(2.8,2.6);ctx.stroke();
  ctx.restore();
  // shield: leather rim, team face, iron boss
  ctx.fillStyle=TC.dark;ctx.strokeStyle='#8a6a2f';ctx.lineWidth=1.2;
  ctx.beginPath();ctx.ellipse(-4.4,-6.8,2.8,3.9,.15,0,7);ctx.fill();ctx.stroke();
  ctx.strokeStyle=TC.trim;ctx.lineWidth=.8;
  ctx.beginPath();ctx.ellipse(-4.4,-6.8,1.8,2.7,.15,0,7);ctx.stroke();
  ctx.fillStyle='#d8dbdf';ctx.strokeStyle='#7e858d';ctx.lineWidth=.5;
  ctx.beginPath();ctx.arc(-4.4,-6.8,1,0,7);ctx.fill();ctx.stroke();
  // head with face, helm with gleam + nose guard
  ctx.fillStyle=SKIN;ctx.strokeStyle=OUT;ctx.lineWidth=.9;
  ctx.beginPath();ctx.arc(0,-13.2,3,0,7);ctx.fill();ctx.stroke();
  faceEye(0,-13.2,3);
  ctx.fillStyle='#b9bec4';ctx.strokeStyle='#7e858d';ctx.lineWidth=.8;
  ctx.beginPath();ctx.arc(0,-13.8,3.2,Math.PI*.95,Math.PI*2.05);ctx.fill();ctx.stroke();
  ctx.strokeStyle='#eef1f4';ctx.lineWidth=.6;
  ctx.beginPath();ctx.arc(-.5,-14.1,2.5,Math.PI*1.15,Math.PI*1.65);ctx.stroke();
  ctx.strokeStyle='#b9bec4';ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(.6,-13.6);ctx.lineTo(.6,-11.5);ctx.stroke();
  const age=G.P[u.p].age;
  if(age>=2||u.type==='teuton'){
    ctx.fillStyle='#b9bec4';ctx.strokeStyle='#7e858d';ctx.lineWidth=.7;
    ctx.beginPath();ctx.arc(-3.2,-9.8,1.7,0,7);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.arc(3.2,-9.8,1.7,0,7);ctx.fill();ctx.stroke();
  }
  if(age>=3&&u.type==='militia'){
    ctx.strokeStyle='#e3b23c';ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(-2.4,-16.4);ctx.quadraticCurveTo(0,-18.6,2.4,-16.4);ctx.stroke();
  }
  if(u.type==='berserker'){
    ctx.strokeStyle='#e8e0c8';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(-3,-15.2);ctx.quadraticCurveTo(-5.2,-17.2,-4.5,-19.2);
    ctx.moveTo(3,-15.2);ctx.quadraticCurveTo(5.2,-17.2,4.5,-19.2);ctx.stroke();
  }
  if(u.type==='teuton'){
    ctx.fillStyle='#b9bec4';ctx.strokeStyle='#7e858d';ctx.lineWidth=.8;
    ctx.fillRect(-3.2,-16.8,6.4,4.8);ctx.strokeRect(-3.2,-16.8,6.4,4.8);
    ctx.fillStyle='#2c2f33';ctx.fillRect(-2.2,-14.9,4.4,1);
  }
}
function drawSpear(u,t,sw,TC){drawManRig(u,t,TC,
  u.type==='woad'?MAN_COSTUME.woad:u.type==='eagle'?MAN_COSTUME.eagle:MAN_COSTUME.spear);}
function drawSpear_legacy(u,t,sw,TC){
  const woad=u.type==='woad';
  legs(sw,woad?'#c49a70':'#4a3a26');
  const body=()=>{ctx.beginPath();
    ctx.moveTo(-2.8,-10.6);ctx.quadraticCurveTo(-4.4,-8,-4.2,-2.6);
    ctx.lineTo(4.2,-2.6);ctx.quadraticCurveTo(4.4,-8,2.8,-10.6);
    ctx.quadraticCurveTo(0,-11.6,-2.8,-10.6);ctx.closePath();};
  ctx.fillStyle=woad?'#d8b58e':'#c9b07f';body();ctx.fill();
  volShade(body);
  ctx.strokeStyle=OUT;ctx.lineWidth=1.1;body();ctx.stroke();
  if(woad){
    // woad warpaint across bare chest
    ctx.strokeStyle='#3a5f9e';ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(-3,-9);ctx.lineTo(3,-6);
    ctx.moveTo(-3,-6);ctx.lineTo(3,-3.2);ctx.stroke();
  }else{
    // padded jack with quilt stitching + team tabard
    ctx.strokeStyle='rgba(120,95,55,.5)';ctx.lineWidth=.6;
    for(const hy of [-9,-7,-5]){ctx.beginPath();ctx.moveTo(-3.8,hy);ctx.lineTo(3.8,hy);ctx.stroke();}
    ctx.fillStyle=TC.main;ctx.fillRect(-1.7,-10.4,3.4,7.6);
    ctx.fillStyle='rgba(22,13,5,.18)';ctx.fillRect(.4,-10.4,1.3,7.6);
  }
  // buckler with painted ring
  ctx.fillStyle=TC.dark;ctx.strokeStyle='#8a6a2f';ctx.lineWidth=1;
  ctx.beginPath();ctx.arc(-4.2,-6.8,2.5,0,7);ctx.fill();ctx.stroke();
  ctx.strokeStyle=TC.trim;ctx.lineWidth=.7;
  ctx.beginPath();ctx.arc(-4.2,-6.8,1.6,0,7);ctx.stroke();
  ctx.fillStyle='#d8dbdf';ctx.beginPath();ctx.arc(-4.2,-6.8,.8,0,7);ctx.fill();
  // spear held two-handed
  const recent=u.state==='attack'&&u.cd>1.15;
  const th=recent?(1.5-u.cd)*9:0;
  ctx.strokeStyle='#8a5a2b';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(-.5+th,-.5);ctx.lineTo(8.5+th,-15);ctx.stroke();
  ctx.strokeStyle='rgba(255,235,200,.4)';ctx.lineWidth=.5;
  ctx.beginPath();ctx.moveTo(-.2+th,-.9);ctx.lineTo(8.6+th,-15.2);ctx.stroke();
  ctx.fillStyle='#d8dbdf';ctx.strokeStyle='#7e858d';ctx.lineWidth=.5;
  ctx.beginPath();ctx.moveTo(8.5+th,-15);ctx.lineTo(10.4+th,-18.2);ctx.lineTo(10.1+th,-14.6);ctx.closePath();ctx.fill();ctx.stroke();
  hand(2.2+th,-5);hand(4.6+th,-9);
  // head with face; kettle helm with lit brim (woad goes bareheaded with a topknot)
  ctx.fillStyle=SKIN;ctx.strokeStyle=OUT;ctx.lineWidth=.9;
  ctx.beginPath();ctx.arc(0,-13.2,3,0,7);ctx.fill();ctx.stroke();
  faceEye(0,-13.2,3);
  if(woad){
    ctx.fillStyle='#7c5a34';
    ctx.beginPath();ctx.arc(0,-16.2,1.3,0,7);ctx.fill();
    ctx.beginPath();ctx.arc(0,-15,2.9,Math.PI,2*Math.PI);ctx.fill();
    ctx.strokeStyle='#3a5f9e';ctx.lineWidth=.8;
    ctx.beginPath();ctx.moveTo(1,-12.4);ctx.lineTo(2.4,-12.9);ctx.stroke();
  }else{
    ctx.fillStyle='#b9bec4';ctx.strokeStyle='#7e858d';ctx.lineWidth=.8;
    ctx.beginPath();ctx.ellipse(0,-14.6,4.1,1.5,0,0,7);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.arc(0,-15.2,2.3,Math.PI,0);ctx.fill();
    ctx.strokeStyle='#eef1f4';ctx.lineWidth=.6;
    ctx.beginPath();ctx.ellipse(-.8,-14.9,2.6,.8,0,Math.PI*1.1,Math.PI*1.9);ctx.stroke();
  }
}
function drawHorse(u,t,sw,col,legC,maneC,camel){
  const g2=u.path&&u.path.length?Math.sin(t+2.2):0;
  const leg=(x,ph)=>{
    ctx.strokeStyle='rgba(64,44,26,.5)';ctx.lineWidth=2.6;
    ctx.beginPath();ctx.moveTo(x,-4);ctx.lineTo(x+ph,4);ctx.stroke();
    ctx.strokeStyle=legC;ctx.lineWidth=1.7;
    ctx.beginPath();ctx.moveTo(x,-4);ctx.lineTo(x+ph,4);ctx.stroke();
    ctx.strokeStyle='#2e2012';ctx.lineWidth=1.8;
    ctx.beginPath();ctx.moveTo(x+ph-.3,3.6);ctx.lineTo(x+ph+1,3.6);ctx.stroke();
  };
  leg(5,sw*2.6);leg(3.2,-sw*2);leg(-4,g2*2.6);leg(-5.6,-g2*2);
  // barrel chest, sloped rump — shaded for muscle
  const bodyP=()=>{ctx.beginPath();
    ctx.moveTo(-7.4,-4.2);
    ctx.quadraticCurveTo(-8.4,-8.2,-4.6,-8.8);
    ctx.quadraticCurveTo(0,-9.6,4.6,-8.6);
    ctx.quadraticCurveTo(7.8,-7.8,7.9,-4.8);
    ctx.quadraticCurveTo(7.6,-2.4,4.6,-2.4);
    ctx.quadraticCurveTo(0,-3.4,-4.6,-2.6);
    ctx.quadraticCurveTo(-7.6,-2.6,-7.4,-4.2);
    ctx.closePath();};
  ctx.fillStyle=col;bodyP();ctx.fill();
  ctx.save();bodyP();ctx.clip();
  // belly shadow, haunch + shoulder highlights
  ctx.fillStyle='rgba(20,12,4,.28)';
  ctx.beginPath();ctx.ellipse(0,-2.6,7.5,1.8,0,0,7);ctx.fill();
  ctx.fillStyle='rgba(255,240,205,.18)';
  ctx.beginPath();ctx.ellipse(-4.6,-6.8,2.6,2,0,0,7);ctx.fill();
  ctx.beginPath();ctx.ellipse(5,-6.6,2.2,1.8,0,0,7);ctx.fill();
  ctx.strokeStyle='rgba(20,12,4,.25)';ctx.lineWidth=.7;
  ctx.beginPath();ctx.moveTo(-3.2,-7.8);ctx.quadraticCurveTo(-2.4,-5.4,-3,-3);ctx.stroke();
  ctx.restore();
  ctx.strokeStyle=OUT;ctx.lineWidth=1;bodyP();ctx.stroke();
  if(camel){
    ctx.beginPath();ctx.ellipse(-1.5,-9.6,3.4,2.4,0,0,7);ctx.fill();ctx.stroke();
  }
  // arched neck
  ctx.fillStyle=col;
  ctx.beginPath();
  ctx.moveTo(3.8,-7.4);
  ctx.quadraticCurveTo(6,-13,8.4,-15.4);
  ctx.lineTo(10.4,-14);
  ctx.quadraticCurveTo(8.8,-10.4,7.6,-6.2);
  ctx.closePath();ctx.fill();
  ctx.strokeStyle=OUT;ctx.lineWidth=.9;ctx.stroke();
  // head with muzzle
  ctx.beginPath();
  ctx.moveTo(8.2,-16);
  ctx.quadraticCurveTo(11.4,-16.3,12.7,-13.8);
  ctx.quadraticCurveTo(12.9,-12.9,12,-12.7);
  ctx.quadraticCurveTo(10.2,-12.8,9,-13.9);
  ctx.closePath();ctx.fill();ctx.stroke();
  // ear
  ctx.beginPath();ctx.moveTo(8.6,-16.2);ctx.lineTo(9.3,-18);ctx.lineTo(10.2,-16);ctx.closePath();ctx.fill();
  // mane along the neck, tail behind
  if(!camel){
    ctx.strokeStyle=maneC;ctx.lineWidth=1.8;
    ctx.beginPath();ctx.moveTo(4.2,-7.8);ctx.quadraticCurveTo(6.4,-13.4,8.6,-16);ctx.stroke();
  }
  ctx.strokeStyle=maneC;ctx.lineWidth=camel?1.4:2.2;
  ctx.beginPath();ctx.moveTo(-7.5,-7);ctx.quadraticCurveTo(-9.8,-4.6,-9,-.6);ctx.stroke();
  // eye, nostril, bridle strap and rein back to the rider
  ctx.fillStyle='#2e2012';ctx.beginPath();ctx.arc(10.3,-14.6,.5,0,7);ctx.fill();
  ctx.beginPath();ctx.arc(12.3,-13.2,.35,0,7);ctx.fill();
  if(!camel){
    ctx.strokeStyle='#4a3220';ctx.lineWidth=.7;
    ctx.beginPath();ctx.moveTo(9.2,-15.2);ctx.lineTo(11.6,-13);ctx.stroke();
    ctx.strokeStyle='rgba(74,50,32,.8)';ctx.lineWidth=.6;
    ctx.beginPath();ctx.moveTo(11.2,-13.4);ctx.quadraticCurveTo(6,-11.5,1.5,-9.5);ctx.stroke();
  }
}
function drawScout(u,t,sw,TC){drawHorseRig(u,t,TC,CAV_COSTUME[u.type]||CAV_COSTUME.scout);}
function drawScout_legacy(u,t,sw,TC){
  const camel=u.type==='mameluke';
  const bodyC=camel?'#c0a266':'#8a6b42',legC=camel?'#96794a':'#5f4a2c',
        maneC=camel?'#a3874f':'#6d5231';
  drawHorse(u,t,sw,bodyC,legC,maneC,camel);
  ctx.fillStyle=TC.main;ctx.strokeStyle=TC.dark;ctx.lineWidth=.9;
  ctx.fillRect(-3.4,-8.4,6.4,3.6);ctx.strokeRect(-3.4,-8.4,6.4,3.6);
  // rider's near leg
  ctx.strokeStyle='#4a3220';ctx.lineWidth=1.7;
  ctx.beginPath();ctx.moveTo(1.2,-6.2);ctx.lineTo(1.9,-2.8);ctx.stroke();
  ctx.fillStyle='#7a5230';ctx.strokeStyle=OUT;ctx.lineWidth=1;
  ctx.beginPath();ctx.ellipse(-.5,-12.6,2.9,3.7,0,0,7);ctx.fill();ctx.stroke();
  ctx.fillStyle=TC.main;ctx.fillRect(-2.5,-13.6,4,1.6);
  if(u.type==='mangudai'){
    ctx.strokeStyle='#7a5230';ctx.lineWidth=1.6;
    ctx.beginPath();ctx.arc(4.5,-13,4.6,-1.1,1.1);ctx.stroke();
    ctx.strokeStyle='rgba(240,230,200,.85)';ctx.lineWidth=.7;
    ctx.beginPath();
    ctx.moveTo(4.5+4.6*Math.cos(-1.1),-13+4.6*Math.sin(-1.1));
    ctx.lineTo(4.5+4.6*Math.cos(1.1),-13+4.6*Math.sin(1.1));ctx.stroke();
    if(u.state==='attack'&&u.cd>1.1){
      ctx.strokeStyle='#4a3a24';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(4.5,-13);ctx.lineTo(9.5,-13);ctx.stroke();
    }
  }else if(camel){
    const th=u.state==='attack'&&u.cd>1.15?(1.5-u.cd)*7:0;
    ctx.strokeStyle='#d8dbdf';ctx.lineWidth=1.6;
    ctx.beginPath();ctx.moveTo(2+th,-11);ctx.lineTo(8.5+th,-16.5);ctx.stroke();
  }else{
    ctx.strokeStyle='#8a5a2b';ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(1,-9);ctx.lineTo(7.5,-17.5);ctx.stroke();
  }
  ctx.fillStyle=SKIN;ctx.strokeStyle=OUT;ctx.lineWidth=.9;
  ctx.beginPath();ctx.arc(-.5,-17.4,2.5,0,7);ctx.fill();ctx.stroke();
  if(camel){
    ctx.fillStyle='#e8e0c8';
    ctx.beginPath();ctx.arc(-.5,-18,2.5,Math.PI*.9,Math.PI*2.1);ctx.fill();
    ctx.fillRect(-3,-18.4,5,1.4);
  }else if(u.type==='mangudai'){
    ctx.fillStyle='#6b4a2a';
    ctx.beginPath();ctx.arc(-.5,-18,2.5,Math.PI,2*Math.PI);ctx.fill();
    ctx.fillStyle='#c9b07f';ctx.fillRect(-2.8,-18.2,4.6,1.1);
  }else{
    ctx.fillStyle='#5a3d22';
    ctx.beginPath();ctx.arc(-.5,-17.9,2.4,Math.PI,2*Math.PI);ctx.fill();
  }
}
function drawRam(u,t,TC){drawRamRig(u,t,TC);}
function drawRam_legacy(u,t,TC){
  const rock=u.path&&u.path.length?Math.sin(t*.8)*.05:0;
  ctx.save();ctx.rotate(rock);
  ctx.fillStyle='#3c2814';ctx.strokeStyle=OUT;ctx.lineWidth=.8;
  for(const wx of [-6.5,0,6.5]){
    ctx.beginPath();ctx.arc(wx,2.2,2.7,0,7);ctx.fill();ctx.stroke();
    ctx.fillStyle='#54381e';
    ctx.beginPath();ctx.arc(wx,2.2,1,0,7);ctx.fill();
    ctx.fillStyle='#3c2814';
  }
  ctx.fillStyle='#7a5830';ctx.strokeStyle=OUT;ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(-9.5,.5);
  ctx.ellipse(0,-4.5,9.5,6.5,0,Math.PI,0);
  ctx.lineTo(9.5,.5);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.strokeStyle='rgba(0,0,0,.22)';ctx.lineWidth=1.1;
  for(const lx of [-6,-2,2,6]){
    ctx.beginPath();ctx.moveTo(lx,.5);
    ctx.lineTo(lx,-4.5-6.3*Math.sqrt(1-(lx*lx)/(9.5*9.5)));ctx.stroke();
  }
  ctx.strokeStyle='#93744a';ctx.lineWidth=1.6;
  ctx.beginPath();ctx.moveTo(-9,-5);ctx.quadraticCurveTo(0,-11.5,9,-5);ctx.stroke();
  const lunge=u.state==='attack'&&u.cd>1.7?(2.4-u.cd)*4:0;
  ctx.fillStyle='#54381e';ctx.fillRect(8+lunge,-4.2,5.5,3);
  ctx.fillStyle='#9aa0a6';ctx.fillRect(12.8+lunge,-4.6,2.2,3.8);
  ctx.strokeStyle='#4a3a24';ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(0,-10.8);ctx.lineTo(0,-15.5);ctx.stroke();
  ctx.fillStyle=TC.main;
  ctx.beginPath();ctx.moveTo(0,-15.5);ctx.lineTo(7,-13.8);ctx.lineTo(0,-12.2);ctx.closePath();ctx.fill();
  ctx.restore();
}
function drawArcher(u,t,sw,TC,skirm){drawManRig(u,t,TC,
  skirm?MAN_COSTUME.skirm:u.type==='plumed'?MAN_COSTUME.plumed:MAN_COSTUME.archer);}
function drawArcher_legacy(u,t,sw,TC,skirm){
  legs(sw,'#4a3a26');
  const body=()=>{ctx.beginPath();
    ctx.moveTo(-2.6,-10.4);ctx.quadraticCurveTo(-4,-8,-3.9,-2.6);
    ctx.lineTo(3.9,-2.6);ctx.quadraticCurveTo(4,-8,2.6,-10.4);
    ctx.quadraticCurveTo(0,-11.4,-2.6,-10.4);ctx.closePath();};
  ctx.fillStyle=skirm?'#8a6538':TC.dark;body();ctx.fill();
  volShade(body);
  ctx.strokeStyle=OUT;ctx.lineWidth=1.1;body();ctx.stroke();
  // belt + quiver on the back
  ctx.fillStyle='#6b4a2a';ctx.fillRect(-3.6,-4.6,7.2,1.4);
  if(!skirm){
    ctx.fillStyle='#6b4a2a';ctx.strokeStyle=OUT;ctx.lineWidth=.7;
    ctx.save();ctx.translate(-3.2,-9.4);ctx.rotate(.45);
    ctx.fillRect(-1.3,-2.8,2.6,6.4);ctx.strokeRect(-1.3,-2.8,2.6,6.4);
    ctx.strokeStyle='#e8e0c8';ctx.lineWidth=.7;
    ctx.beginPath();ctx.moveTo(-.6,-2.8);ctx.lineTo(-.7,-4.6);
    ctx.moveTo(.3,-2.8);ctx.lineTo(.3,-4.4);ctx.moveTo(.9,-2.8);ctx.lineTo(1.1,-4.3);ctx.stroke();
    ctx.fillStyle='#b03a30';
    ctx.beginPath();ctx.arc(-.7,-4.7,.5,0,7);ctx.fill();
    ctx.restore();
  }
  if(skirm){
    ctx.strokeStyle=TC.main;ctx.lineWidth=1.8;
    ctx.beginPath();ctx.moveTo(-2.6,-10);ctx.lineTo(2.6,-3.4);ctx.stroke();
    ctx.fillStyle=TC.dark;ctx.strokeStyle=TC.trim;ctx.lineWidth=.8;
    ctx.beginPath();ctx.arc(-4,-6.5,2,0,7);ctx.fill();ctx.stroke();
    const th=u.state==='attack'&&u.cd>1.1?(1.5-u.cd)*8:0;
    ctx.strokeStyle='#8a5a2b';ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(1+th,-4);ctx.lineTo(8+th,-13.5);ctx.stroke();
    ctx.fillStyle='#d8dbdf';
    ctx.beginPath();ctx.moveTo(8+th,-13.5);ctx.lineTo(9.6+th,-16.2);ctx.lineTo(9.3+th,-13);ctx.closePath();ctx.fill();
  }else{
    // recurve bow with wrapped grip, drawn arrow, both hands
    ctx.strokeStyle='#7a5230';ctx.lineWidth=1.8;
    ctx.beginPath();ctx.arc(3.6,-8,5,-1.15,1.15);ctx.stroke();
    ctx.strokeStyle='rgba(255,235,200,.4)';ctx.lineWidth=.6;
    ctx.beginPath();ctx.arc(3.3,-8,4.8,-1.05,1.05);ctx.stroke();
    ctx.strokeStyle='#54381e';ctx.lineWidth=2.2;
    ctx.beginPath();ctx.arc(3.6,-8,5,-.22,.22);ctx.stroke();
    ctx.strokeStyle='rgba(240,230,200,.85)';ctx.lineWidth=.7;
    const bx1=3.6+5*Math.cos(-1.15),by1=-8+5*Math.sin(-1.15);
    const bx2=3.6+5*Math.cos(1.15),by2=-8+5*Math.sin(1.15);
    ctx.beginPath();ctx.moveTo(bx1,by1);ctx.lineTo(bx2,by2);ctx.stroke();
    if(u.state==='attack'&&u.cd>1.1){
      ctx.strokeStyle='#4a3a24';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(2.6,-8);ctx.lineTo(8.8,-8);ctx.stroke();
      ctx.fillStyle='#d8dbdf';
      ctx.beginPath();ctx.moveTo(8.8,-8);ctx.lineTo(10.2,-8.7);ctx.lineTo(10.2,-7.3);ctx.closePath();ctx.fill();
      hand(2.4,-8);
    }
    limb(1.8,-9.2,7.2,-8.2,skirm?'#8a6538':TC.dark,1.5);
    hand(8.4,-8);
  }
  ctx.fillStyle=SKIN;ctx.strokeStyle=OUT;ctx.lineWidth=.9;
  ctx.beginPath();ctx.arc(0,-13,2.9,0,7);ctx.fill();ctx.stroke();
  if(skirm){
    ctx.strokeStyle=TC.main;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(-2.8,-13.8);ctx.lineTo(2.8,-13.8);ctx.stroke();
  }else{
    ctx.fillStyle=TC.main;
    ctx.beginPath();ctx.arc(0,-13.4,3.1,Math.PI*.85,Math.PI*2.15);
    ctx.lineTo(-4.2,-10.5);ctx.closePath();ctx.fill();
  }
}
function drawKnight(u,t,sw,TC){drawHorseRig(u,t,TC,CAV_COSTUME[u.type]||CAV_COSTUME.knight);}
function drawKnight_legacy(u,t,sw,TC){
  const cata=u.type==='cataphract';
  drawHorse(u,t,sw,cata?'#8d9299':'#6b4a2f','#4f3620',cata?'#6f757c':'#54381e',false);
  if(cata){
    // lamellar barding over the body
    ctx.strokeStyle='#6f757c';ctx.lineWidth=.8;
    for(const lx of [-5,-1.5,2,5.5]){
      ctx.beginPath();ctx.moveTo(lx,-8.6);ctx.lineTo(lx,-2.6);ctx.stroke();}
  }
  if(!cata){
    // full draped caparison with scalloped hem — cavalry masses read as team color
    ctx.fillStyle=TC.main;ctx.strokeStyle=TC.dark;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(-6.5,-8.8);ctx.quadraticCurveTo(0,-10.2,5,-8.8);
    ctx.lineTo(5,-3.2);
    for(let sx=5;sx>-7;sx-=2.3)ctx.quadraticCurveTo(sx-1.15,-1.6,sx-2.3,-3.2);
    ctx.closePath();ctx.fill();ctx.stroke();
    ctx.strokeStyle=TC.trim;ctx.lineWidth=.8;
    ctx.beginPath();ctx.moveTo(-6,-4.4);ctx.lineTo(4.6,-4.4);ctx.stroke();
  }else{
    // small saddle rect so cataphract lamellar barding stays visible
    ctx.fillStyle=TC.main;ctx.strokeStyle=TC.dark;ctx.lineWidth=1;
    ctx.fillRect(-4,-9,7.5,5.5);ctx.strokeRect(-4,-9,7.5,5.5);
    ctx.strokeStyle=TC.trim;ctx.lineWidth=.8;
    ctx.beginPath();ctx.moveTo(-4,-4.6);ctx.lineTo(3.5,-4.6);ctx.stroke();
  }
  // rider's armored near leg
  ctx.strokeStyle='#8d9299';ctx.lineWidth=1.8;
  ctx.beginPath();ctx.moveTo(1.4,-6);ctx.lineTo(2.1,-2.6);ctx.stroke();
  const rbody=()=>{ctx.beginPath();ctx.ellipse(-.5,-13,3.1,4,0,0,7);};
  ctx.fillStyle=TC.main;rbody();ctx.fill();
  ctx.save();rbody();ctx.clip();
  ctx.fillStyle='rgba(22,13,5,.22)';ctx.fillRect(.2,-18,6,10);
  ctx.fillStyle='rgba(255,244,212,.16)';ctx.fillRect(-6,-18,6,10);
  ctx.restore();
  ctx.strokeStyle=OUT;ctx.lineWidth=1;rbody();ctx.stroke();
  ctx.strokeStyle=TC.trim;ctx.lineWidth=.7;
  ctx.beginPath();ctx.moveTo(-2.8,-11.4);ctx.lineTo(1.8,-11.4);ctx.stroke();
  ctx.fillStyle=TC.dark;ctx.strokeStyle=TC.trim;ctx.lineWidth=1;
  ctx.beginPath();ctx.ellipse(-4.6,-12.5,2.3,3.2,.15,0,7);ctx.fill();ctx.stroke();
  ctx.fillStyle='#d8dbdf';ctx.beginPath();ctx.arc(-4.6,-12.5,.8,0,7);ctx.fill();
  const thrust=u.state==='attack'&&u.cd>1.2?(1.5-u.cd)*8:0;
  ctx.strokeStyle='#caa66b';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(-1+thrust,-9.5);ctx.lineTo(10.5+thrust,-17.5);ctx.stroke();
  ctx.fillStyle='#d8dbdf';
  ctx.beginPath();ctx.moveTo(10.2+thrust,-17.1);ctx.lineTo(12.4+thrust,-18.8);ctx.lineTo(11.4+thrust,-16.2);ctx.closePath();ctx.fill();
  ctx.fillStyle=SKIN;ctx.strokeStyle=OUT;ctx.lineWidth=.9;
  ctx.beginPath();ctx.arc(-.5,-17.6,2.7,0,7);ctx.fill();ctx.stroke();
  ctx.fillStyle='#b9bec4';ctx.strokeStyle='#7e858d';ctx.lineWidth=.8;
  ctx.beginPath();ctx.arc(-.5,-18.1,2.9,Math.PI*.9,Math.PI*2.1);ctx.fill();ctx.stroke();
  ctx.strokeStyle=TC.dark;ctx.lineWidth=1.8;
  ctx.beginPath();ctx.moveTo(-1,-20.6);ctx.quadraticCurveTo(-4.5,-20,-6,-17.5);ctx.stroke();
}
let RELIC_SPR=null;
/* staged corpse + rubble sprites, lazily cached like getRelicSpr */
const CORPSE_SPR={};
function getCorpseSpr(p,big,st,ram){
  const key=ram?'ram':st===2?'sk'+(big?1:0):p+'_'+(big?1:0)+'_'+st;
  if(CORPSE_SPR[key])return CORPSE_SPR[key];
  const W=48,H=26,ax=W/2,ay=H/2+3;
  const c=document.createElement('canvas');c.width=W*TREZ;c.height=H*TREZ;
  const g=c.getContext('2d');g.setTransform(TREZ,0,0,TREZ,ax*TREZ,ay*TREZ);
  const L=big?8:5.5;
  if(ram){ // siege leaves timber, not bones
    g.fillStyle='rgba(110,88,52,.32)';
    g.beginPath();g.ellipse(0,2,14,5.5,.1,0,7);g.fill();
    poly(g,[{x:-11,y:2},{x:-2,y:-3},{x:2,y:-1},{x:-8,y:4}],'#6b4a2a',O2);
    poly(g,[{x:0,y:1},{x:10,y:-3},{x:12,y:-1},{x:3,y:3}],'#7d5a34',O2);
    g.strokeStyle='#4a3a24';g.lineWidth=1.2;
    g.beginPath();g.arc(8,3,3.2,0,7);g.stroke(); // fallen wheel
    for(let i=0;i<4;i++){const an=i*Math.PI/2+.4;
      g.beginPath();g.moveTo(8,3);g.lineTo(8+Math.cos(an)*3.2,3+Math.sin(an)*3.2);g.stroke();}
    g.strokeStyle='#93744a';g.lineWidth=.9;
    g.beginPath();g.arc(-9,4,1.8,0,7);g.stroke(); // rope coil
  }else if(st<2){
    if(st===1){g.fillStyle='rgba(96,76,44,.38)';
      g.beginPath();g.ellipse(0,1.5,L+5,4.6,.2,0,7);g.fill();}
    g.fillStyle=st?shadeCol(TEAMS[p].dark,-.12):TEAMS[p].dark;
    g.beginPath();g.ellipse(0,1,L,2.6,.2,0,7);g.fill();
    g.fillStyle=st?'#a98f6e':SKIN;
    g.beginPath();g.arc(L,.6,2.1,0,7);g.fill();
    g.strokeStyle='#6f5836';g.lineWidth=1; // dropped spear
    g.beginPath();g.moveTo(-L-6,4);g.lineTo(-L+3,-1);g.stroke();
  }else{
    g.fillStyle='rgba(110,88,52,.32)'; // trampled stain
    g.beginPath();g.ellipse(0,1.5,L+6,5,.2,0,7);g.fill();
    g.strokeStyle='#ddd2b8';g.lineWidth=1.1;
    g.beginPath();g.moveTo(-L,2.2);g.lineTo(L-2,0);g.stroke(); // spine
    for(let i=0;i<4;i++){const rx=-L+2+i*(big?3.2:2.2);
      g.beginPath();g.arc(rx,.6,2.1,-2.4,.6);g.stroke();}      // ribs
    g.fillStyle='#e6dcc4';g.beginPath();g.arc(L,.4,2,0,7);g.fill(); // skull
    g.fillStyle='#2a2118';g.fillRect(L-.9,-.4,.9,.9);
    g.fillStyle='#cfc4a8';g.fillRect(-L-4,3.5,3,1);g.fillRect(L-3,4,2.4,1);
  }
  const sp={c,ox:ax,oy:ay,w:W,h:H};CORPSE_SPR[key]=sp;return sp;
}
const RUB_SPR={};
function getRubbleSpr(s,p,v){
  const key=s+'_'+p+'_'+v;
  if(RUB_SPR[key])return RUB_SPR[key];
  const sp=mkIsoSpr(s,18,(g,ss)=>{
    dirtPad(g,ss,.5);
    const M=ip(ss/2,ss/2);
    g.fillStyle='rgba(38,30,20,.4)';
    g.beginPath();g.ellipse(M.x,M.y,ss*IW*.62,ss*IH*.6,0,0,7);g.fill();
    const h=(a,b2)=>((v*73+a*37+b2*19)%89)/89-.5;
    for(let i=0;i<6+ss*4;i++){ // faceted stone chunks
      const q=ip(ss/2+h(i,1)*ss*.85,ss/2+h(i,5)*ss*.85);
      const r=2.2+((i*29)%3);
      poly(g,[{x:q.x-r,y:q.y},{x:q.x,y:q.y-r*.8},{x:q.x+r,y:q.y-.5},{x:q.x+r*.4,y:q.y+r*.5}],
        i%3?'#9a8d74':'#7e725c',O2);}
    g.strokeStyle='#6b4a2a';g.lineWidth=2.4;
    for(let i=0;i<3+ss;i++){ // charred roof beams
      const q=ip(ss/2+h(i,9)*ss*.7,ss/2+h(i,3)*ss*.7);
      g.beginPath();g.moveTo(q.x-7,q.y+3);g.lineTo(q.x+8,q.y-4+h(i,7)*4);g.stroke();}
    poly(g,[{x:M.x+4,y:M.y+2},{x:M.x+10,y:M.y-1},{x:M.x+8,y:M.y+4}],TEAMS[p].main,O2);
  });
  RUB_SPR[key]=sp;return sp;
}
function getRelicSpr(){
  if(RELIC_SPR)return RELIC_SPR;
  const W=40,H=44,ax=W/2,ay=H-8;
  const c=document.createElement('canvas');c.width=W*TREZ;c.height=H*TREZ;
  const g=c.getContext('2d');g.setTransform(TREZ,0,0,TREZ,ax*TREZ,ay*TREZ);
  g.fillStyle='rgba(18,26,10,.3)';
  g.beginPath();g.ellipse(2,1,7,2.6,.14,0,7);g.fill();
  g.fillStyle='#8f877a';g.strokeStyle='rgba(28,20,10,.5)';g.lineWidth=.8;
  g.fillRect(-4.5,-4,9,4);g.strokeRect(-4.5,-4,9,4);
  g.fillStyle='#c9a227';g.strokeStyle='#8a6a2f';g.lineWidth=1;
  g.fillRect(-5,-10,10,6);g.strokeRect(-5,-10,10,6);
  g.fillStyle='#e5c95c';
  g.beginPath();g.moveTo(-5,-10);g.quadraticCurveTo(0,-14.5,5,-10);g.closePath();g.fill();g.stroke();
  g.fillStyle='#f5da7a';g.fillRect(-1,-9.6,2,5.2);
  g.strokeStyle='rgba(255,240,190,.9)';g.lineWidth=1;
  g.beginPath();g.moveTo(7.5,-15);g.lineTo(7.5,-11);g.moveTo(5.5,-13);g.lineTo(9.5,-13);g.stroke();
  RELIC_SPR={c,ox:ax,oy:ay,w:W,h:H};return RELIC_SPR;
}
function drawMonk(u,t,sw,TC){drawManRig(u,t,TC,MAN_COSTUME.monk);}
function drawMonk_legacy(u,t,sw,TC){
  legs(sw,'#6b5330');
  // hooded robe
  ctx.fillStyle='#b09468';ctx.strokeStyle=OUT;ctx.lineWidth=1.1;
  ctx.beginPath();
  ctx.moveTo(-3,-11);ctx.quadraticCurveTo(-4.8,-8,-4.6,-2.6);
  ctx.lineTo(4.6,-2.6);ctx.quadraticCurveTo(4.8,-8,3,-11);
  ctx.quadraticCurveTo(0,-12,-3,-11);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle=TC.main;ctx.fillRect(-4,-4.6,8,1.4);
  // staff topped with a golden cross
  ctx.strokeStyle='#8a5a2b';ctx.lineWidth=1.4;
  ctx.beginPath();ctx.moveTo(3.6,-1);ctx.lineTo(3.6,-15);ctx.stroke();
  ctx.strokeStyle='#e5c95c';ctx.lineWidth=1.3;
  ctx.beginPath();ctx.moveTo(3.6,-15);ctx.lineTo(3.6,-18.5);
  ctx.moveTo(2.2,-17);ctx.lineTo(5,-17);ctx.stroke();
  ctx.fillStyle=SKIN;ctx.strokeStyle=OUT;ctx.lineWidth=.9;
  ctx.beginPath();ctx.arc(0,-13.2,2.9,0,7);ctx.fill();ctx.stroke();
  ctx.fillStyle='#b09468';
  ctx.beginPath();ctx.arc(0,-13.6,3.1,Math.PI*.8,Math.PI*2.2);ctx.fill();
  if(u.state==='heal'){
    const a=.45+.35*Math.sin(t*2);
    ctx.strokeStyle='rgba(240,230,150,'+a+')';ctx.lineWidth=1.2;
    ctx.beginPath();ctx.arc(0,-8,6.5,0,7);ctx.stroke();
  }
  if(u.relic){
    ctx.fillStyle='#c9a227';ctx.strokeStyle='#8a6a2f';ctx.lineWidth=.8;
    ctx.fillRect(-3,-21.5,6,3.4);ctx.strokeRect(-3,-21.5,6,3.4);
    ctx.fillStyle='#e5c95c';
    ctx.beginPath();ctx.moveTo(-3,-21.5);ctx.quadraticCurveTo(0,-24,3,-21.5);ctx.closePath();ctx.fill();
  }
}
function drawElephant(u,t,sw,TC){drawElephantRig(u,t,TC);}
function drawElephant_legacy(u,t,sw,TC){
  const g2=u.path&&u.path.length?Math.sin(t+2.2):0;
  const leg=(x,ph)=>{
    ctx.strokeStyle='rgba(64,44,26,.5)';ctx.lineWidth=3.6;
    ctx.beginPath();ctx.moveTo(x,-5);ctx.lineTo(x+ph,4);ctx.stroke();
    ctx.strokeStyle='#7e7e86';ctx.lineWidth=2.8;
    ctx.beginPath();ctx.moveTo(x,-5);ctx.lineTo(x+ph,4);ctx.stroke();};
  leg(5.5,sw*1.6);leg(3,-sw*1.2);leg(-3.5,g2*1.6);leg(-5.8,-g2*1.2);
  ctx.fillStyle='#8d8d95';ctx.strokeStyle=OUT;ctx.lineWidth=1.1;
  ctx.beginPath();ctx.ellipse(-.5,-8,8.6,6,0,0,7);ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.arc(7.5,-10.5,4.4,0,7);ctx.fill();ctx.stroke();
  ctx.fillStyle='#7e7e86';
  ctx.beginPath();ctx.ellipse(5.8,-11,2.6,3.4,-.3,0,7);ctx.fill();ctx.stroke();
  ctx.strokeStyle='#8d8d95';ctx.lineWidth=2.6;
  ctx.beginPath();ctx.moveTo(10.8,-9.5);ctx.quadraticCurveTo(12.8,-6,11.6,-2.2);ctx.stroke();
  ctx.strokeStyle='#e8e0c8';ctx.lineWidth=1.6;
  ctx.beginPath();ctx.moveTo(9.6,-7.6);ctx.quadraticCurveTo(11.6,-6.8,12.8,-7.8);ctx.stroke();
  ctx.fillStyle='#2e2012';ctx.beginPath();ctx.arc(8.4,-11.4,.6,0,7);ctx.fill();
  // war platform + rider
  ctx.fillStyle=TC.main;ctx.strokeStyle=TC.dark;ctx.lineWidth=1;
  ctx.fillRect(-5,-15.5,8,4);ctx.strokeRect(-5,-15.5,8,4);
  ctx.fillStyle=TC.dark;
  ctx.beginPath();ctx.ellipse(-1,-17.5,2.4,3,0,0,7);ctx.fill();
  ctx.fillStyle=SKIN;ctx.strokeStyle=OUT;ctx.lineWidth=.8;
  ctx.beginPath();ctx.arc(-1,-20.8,2.2,0,7);ctx.fill();ctx.stroke();
  const th=u.state==='attack'&&u.cd>1.2?(1.5-u.cd)*7:0;
  ctx.strokeStyle='#8a5a2b';ctx.lineWidth=1.3;
  ctx.beginPath();ctx.moveTo(1+th,-16);ctx.lineTo(9+th,-21);ctx.stroke();
  ctx.fillStyle='#d8dbdf';
  ctx.beginPath();ctx.moveTo(9+th,-21);ctx.lineTo(11+th,-22.5);ctx.lineTo(10.2+th,-20);ctx.closePath();ctx.fill();
}
function drawCorpse(c){
  // staged decay: fresh (0-20s) -> darkened (20-60s) -> skeleton (to 150s)
  const age=c.max-c.t,st=age<20?0:age<60?1:2;
  const a=st===2?Math.min(.7,c.t/30*.7):(st?.62:.8);
  const big=!!(UNITS[c.type]&&UNITS[c.type].cav)||c.type==='elephant'||c.type==='ram';
  const sp=getCorpseSpr(c.p,big,st,c.type==='ram');
  const cp=isoE(c.x,c.y);
  // blood pool — soaks in over the first seconds, fades with the corpse.
  // Stateless off the corpse timer; never for ships (water) or the ram (machine).
  if(!(UNITS[c.type]&&UNITS[c.type].ship)&&c.type!=='ram'&&age>.25){
    const soak=Math.min(1,age/10),fade=Math.min(1,c.t/25);
    ctx.globalAlpha=.28*soak*fade;
    ctx.fillStyle='#5a1410';
    ctx.beginPath();ctx.ellipse(cp.x,cp.y+1.5,(5.5+4.5*soak)*(big?1.6:1),(3+2.4*soak)*(big?1.6:1),0,0,7);
    ctx.fill();ctx.globalAlpha=1;
  }
  // DEATH: the living rig topples over 0.5s in 6 hard-stepped poses (period
  // sprite sheets ran ~12fps — stepping reads truer than a smooth tween),
  // then hands off to the corpse sprite. Ships/rams keep their wreck art.
  const DT=.5;
  if(age<DT&&c.hdg!==undefined&&UNITS[c.type]&&!UNITS[c.type].ship&&c.type!=='ram'){
    const step=Math.min(5,Math.floor(age/DT*6)),f=step/5;
    const ease=f*f*(3-2*f);              // settle into the ground, no bounce
    ctx.save();ctx.translate(cp.x,cp.y);
    ctx.rotate(c.fall*1.32*ease);        // pivot at the feet, fall to one side
    ctx.translate(0,ease*2.2);           // sink as it goes down
    ctx.scale(1.24,1.24*(1-.3*ease));    // same scale drawUnit uses, flattening
    ctx.lineCap='round';ctx.lineJoin='round';
    const fake={type:c.type,p:c.p,state:'idle',cd:0,carry:0,gatherT:0,
      face:c.face||1,hdg:c.hdg,spd:0,vx:0,vy:0,gaitPh:0,id:0,gar:[]};
    try{drawUnitBody(fake,0,0,TEAMS[c.p]);}catch(e){}
    ctx.restore();
    return;
  }
  if(age<DT){ // ships, rams and old saves: the previous crumple
    const f=Math.floor(age/DT*3)/3;
    ctx.save();ctx.translate(cp.x,cp.y);
    if(c.h)ctx.scale(-1,1);
    ctx.rotate((1-f)*-.55);ctx.scale(1,.45+.55*f);
    ctx.globalAlpha=.85;
    ctx.drawImage(sp.c,-sp.ox,-sp.oy,sp.w,sp.h);
    ctx.restore();ctx.globalAlpha=1;return;
  }
  ctx.globalAlpha=a;
  if(c.h){ctx.save();ctx.translate(cp.x,cp.y);ctx.scale(-1,1);
    ctx.drawImage(sp.c,-sp.ox,-sp.oy,sp.w,sp.h);ctx.restore();}
  else ctx.drawImage(sp.c,cp.x-sp.ox,cp.y-sp.oy,sp.w,sp.h);
  ctx.globalAlpha=1;
}
function drawArrow(p){
  const f=p.t/p.dur;
  const a0=isoE(p.x0,p.y0),a1=isoE(p.x1,p.y1);
  const dx=a1.x-a0.x,dy=a1.y-a0.y;
  const dist=Math.hypot(dx,dy);
  let arc=Math.min(54,Math.max(10,dist*.17));
  if(p.kind==='stone')arc=Math.min(84,Math.max(26,dist*.34)); // lofted boulders
  if(p.kind==='ball')arc=Math.max(4,dist*.05);                 // flat cannon shot
  const px=ff=>a0.x+dx*ff,py=ff=>a0.y+dy*ff-Math.sin(ff*Math.PI)*arc;
  if(p.kind==='stone'||p.kind==='ball'){
    const x=px(f),y=py(f),r=p.kind==='stone'?3.1:2.2;
    const f1=Math.max(0,f-.12);
    ctx.strokeStyle='rgba(120,112,100,.3)';ctx.lineWidth=r*1.4;
    ctx.beginPath();ctx.moveTo(px(f1),py(f1));ctx.lineTo(x,y);ctx.stroke();
    ctx.fillStyle=p.kind==='stone'?'#8d8478':'#3a3d42';
    ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fill();
    ctx.fillStyle='rgba(255,244,214,.45)';
    ctx.beginPath();ctx.arc(x-r*.3,y-r*.35,r*.42,0,7);ctx.fill();
    return;
  }
  if(p.kind==='bolt'){
    const x=px(f),y=py(f);
    const vy=dy-Math.cos(f*Math.PI)*Math.PI*arc,ang=Math.atan2(vy,dx);
    ctx.save();ctx.translate(x,y);ctx.rotate(ang);
    ctx.strokeStyle='#54381e';ctx.lineWidth=1.8;
    ctx.beginPath();ctx.moveTo(-6.5,0);ctx.lineTo(4,0);ctx.stroke();
    ctx.fillStyle='#c9ccd1';
    ctx.beginPath();ctx.moveTo(4.4,0);ctx.lineTo(1.6,-1.7);ctx.lineTo(1.6,1.7);ctx.closePath();ctx.fill();
    ctx.restore();
    return;
  }
  // short fading motion streak behind the arrow
  const f1=Math.max(0,f-.09),f2=Math.max(0,f-.18);
  ctx.strokeStyle='rgba(235,225,200,.13)';ctx.lineWidth=1.3;
  ctx.beginPath();ctx.moveTo(px(f2),py(f2));ctx.lineTo(px(f1),py(f1));ctx.stroke();
  ctx.strokeStyle='rgba(235,225,200,.3)';
  ctx.beginPath();ctx.moveTo(px(f1),py(f1));ctx.lineTo(px(f),py(f));ctx.stroke();
  const x=px(f),y=py(f);
  const vy=dy-Math.cos(f*Math.PI)*Math.PI*arc;
  const ang=Math.atan2(vy,dx);
  ctx.save();ctx.translate(x,y);ctx.rotate(ang);
  ctx.strokeStyle='#4a3a24';ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(-4.5,0);ctx.lineTo(3,0);ctx.stroke();
  ctx.fillStyle='#d8dbdf';
  ctx.beginPath();ctx.moveTo(3,0);ctx.lineTo(1.2,-1.2);ctx.lineTo(1.2,1.2);ctx.closePath();ctx.fill();
  ctx.strokeStyle='rgba(240,230,200,.9)';ctx.lineWidth=.9;
  ctx.beginPath();ctx.moveTo(-4.5,0);ctx.lineTo(-3.2,-1.1);ctx.moveTo(-4.5,0);ctx.lineTo(-3.2,1.1);ctx.stroke();
  ctx.restore();
}
function drawFx(f){
  const a=Math.max(0,f.life/f.max);
  const fp=isoE(f.x,f.y),px=fp.x,py=fp.y;
  if(f.kind==='text'){ // floating resource tally
    ctx.save();
    ctx.font='bold 11px "Segoe UI",system-ui,sans-serif';
    ctx.textAlign='center';
    ctx.lineWidth=3;ctx.strokeStyle='rgba(12,9,4,'+(a*.85)+')';
    ctx.strokeText(f.txt,px,py);
    ctx.fillStyle=f.col||'#f0e29a';
    ctx.globalAlpha=a;ctx.fillText(f.txt,px,py);
    ctx.restore();
    return;
  }
  if(f.kind==='smoke'){
    ctx.fillStyle='rgba('+(f.col||'66,62,58')+','+(a*.4)+')';
    ctx.beginPath();ctx.arc(px,py,f.r*(2.2-a),0,7);ctx.fill();
  }else if(f.kind==='spark'){
    ctx.fillStyle='rgba(255,232,150,'+a+')';
    ctx.beginPath();ctx.arc(px,py,f.r*(1.6-a),0,7);ctx.fill();
    ctx.fillStyle='rgba(255,255,255,'+a*.9+')';
    ctx.beginPath();ctx.arc(px,py,f.r*.45,0,7);ctx.fill();
  }else{
    ctx.globalAlpha=a;ctx.fillStyle=f.col||'#caa66b';
    ctx.fillRect(px-1,py-1,2.2,2.2);ctx.globalAlpha=1;
  }
}
/* ---------- frame ---------- */
function draw(){
  if(!G||!vw||!vh)return;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle='#12160b';ctx.fillRect(0,0,vw,vh);
  const z=G.cam.z;
  ctx.save();
  ctx.scale(z,z);ctx.translate(-G.cam.x,-G.cam.y);
  ctx.imageSmoothingEnabled=true;
  // terrain skewed into the isometric plane
  ctx.save();
  ctx.transform(IW/(TILE*TREZT),IH/(TILE*TREZT),-IW/(TILE*TREZT),IH/(TILE*TREZT),0,0);
  ctx.drawImage(terrain,0,0);
  ctx.restore();
  // map border diamond
  const bc0=isoPt(0,0),bc1=isoPt(MAP,0),bc2=isoPt(MAP,MAP),bc3=isoPt(0,MAP);
  ctx.strokeStyle='#241c10';ctx.lineWidth=4;
  ctx.beginPath();ctx.moveTo(bc0.x,bc0.y);ctx.lineTo(bc1.x,bc1.y);
  ctx.lineTo(bc2.x,bc2.y);ctx.lineTo(bc3.x,bc3.y);ctx.closePath();ctx.stroke();
  ctx.strokeStyle='rgba(240,225,180,.16)';ctx.lineWidth=1.5;ctx.stroke();
  const vx0=G.cam.x-60,vx1=G.cam.x+vw/z+60,vy0=G.cam.y-100,vy1=G.cam.y+vh/z+60;
  cullX0=vx0;cullX1=vx1;cullY0=vy0;cullY1=vy1;
  RIG_LOD=z<.7;
  /* Animated water. The old version gave every tile an independent wiggle;
     real water moves as COHERENT swells, so crest brightness now rides two
     travelling waves evaluated in WORLD tile space — the same crest line
     sweeps across neighbouring tiles instead of each tile twinkling alone.
     Shore tiles (w.e) get a lapping foam arc on a slower third phase. All of
     it is render-side cosmetics on G.t; the sim never looks at any of this. */
  if(G.waterList)for(const w of G.waterList){
    const p=isoPt(w.x+.5,w.y+.5);
    if(p.x<vx0||p.x>vx1||p.y<vy0||p.y>vy1)continue;
    // two swell trains crossing at an angle, world-coherent
    const s1=Math.sin(w.x*.9+w.y*.55-G.t*1.8);
    const s2=Math.sin(w.x*.42-w.y*.78+G.t*1.15);
    const off=((G.t*5+w.h*3.7)%14)-7;
    const a1=.05+.11*Math.max(0,s1);
    ctx.strokeStyle='rgba(205,232,246,'+a1.toFixed(3)+')';
    ctx.lineWidth=1.3;
    ctx.beginPath();
    ctx.moveTo(p.x-9+off*.5,p.y-1+s1*1.6);
    ctx.quadraticCurveTo(p.x+off*.5,p.y-3.6+s1*1.6,p.x+9+off*.5,p.y-1+s1*1.6);
    ctx.stroke();
    const a2=.04+.08*Math.max(0,s2);
    ctx.strokeStyle='rgba(160,212,232,'+a2.toFixed(3)+')';
    ctx.beginPath();
    ctx.moveTo(p.x-5-off*.4,p.y+3+s2*1.2);
    ctx.quadraticCurveTo(p.x-off*.4,p.y+1.2+s2*1.2,p.x+5-off*.4,p.y+3+s2*1.2);
    ctx.stroke();
    // where the two trains peak together the surface catches the sun
    if(s1>.55&&s2>.45&&!RIG_LOD){
      const g2=Math.min(1,(s1+s2-1)*1.4);
      ctx.fillStyle='rgba(255,255,244,'+(g2*.7).toFixed(3)+')';
      ctx.fillRect(p.x+off-1,p.y-2+((w.h%5)-2),2.2,1.1);
      ctx.fillRect(p.x+off-.4,p.y-2.6+((w.h%5)-2),1.1,2.4);
    }
    // lapping foam where water meets land — swells in, sighs out
    if(w.e&&!RIG_LOD){
      const f=Math.sin(G.t*.9+w.h*1.1);
      if(f>0){
        ctx.strokeStyle='rgba(235,248,252,'+(f*.20).toFixed(3)+')';
        ctx.lineWidth=1.8;
        ctx.beginPath();
        ctx.moveTo(p.x-8,p.y+5.5-f);
        ctx.quadraticCurveTo(p.x,p.y+7.5-f*1.6,p.x+8,p.y+5.5-f);
        ctx.stroke();
      }
    }
  }
  for(const c of G.corpses){
    if(!tileVis(c.x,c.y))continue;
    drawCorpse(c);}
  // rubble piles where buildings fell — units walk over them
  for(const rb of G.rubble){
    if(!tileKnown(rb.tx+rb.size/2,rb.ty+rb.size/2))continue;
    const p2=isoPt(rb.tx,rb.ty);p2.y-=elevTile(rb.tx+rb.size/2,rb.ty+rb.size/2)*10;
    const age=rb.max-rb.t;
    // COLLAPSE: for the first .7s the structure itself buckles — it leans,
    // drops through its own footprint and squashes, then the pile takes over
    if(age<.7&&rb.type&&ISO_ART[rb.type]){
      const f=Math.min(1,age/.7),e=f*f;              // accelerating fall
      const bs=getBldSpr(rb.type,rb.p,true,0,hash2(rb.tx,rb.ty)%3);
      const southY=p2.y+2*rb.size*IH;
      ctx.save();
      ctx.translate(p2.x,southY);
      ctx.rotate(rb.tilt*.13*e);
      ctx.scale(1.13,1.13*(1-.72*e));                 // sink into its own base
      ctx.globalAlpha=1-.35*e;
      ctx.drawImage(bs.c,-bs.ox,-(bs.oy+2*rb.size*IH),bs.w,bs.h);
      ctx.restore();ctx.globalAlpha=1;
      continue;
    }
    const sp=getRubbleSpr(rb.size,rb.p,rb.v);
    ctx.globalAlpha=Math.min(.95,Math.min(rb.t/15,(age-.55)/.35));
    ctx.drawImage(sp.c,p2.x-sp.ox,p2.y-sp.oy,sp.w,sp.h);
    ctx.globalAlpha=1;
  }
  // spent arrows bristling from the ground — and from whoever caught one
  for(const s2 of G.stuck){
    if(s2.uid){ // riding a victim: track them, vanish when they fall
      const vic=G.units.find(x=>x.id===s2.uid&&x.hp>0);
      if(!vic){s2.t=0;continue;}
      s2.x=vic.x;s2.y=vic.y;
    }
    if(!tileVis(s2.x,s2.y))continue;
    const p2=isoE(s2.x,s2.y);
    ctx.globalAlpha=Math.min(.9,s2.t/2);
    ctx.save();
    if(s2.uid)ctx.translate(p2.x+s2.ox*IW,p2.y+s2.oy*IH*2);
    else ctx.translate(p2.x,p2.y);
    ctx.rotate(-.9+s2.a);
    ctx.strokeStyle='#4a3a24';ctx.lineWidth=1.1;
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(6.5,0);ctx.stroke();
    ctx.strokeStyle='rgba(240,230,200,.85)';ctx.lineWidth=.8;
    ctx.beginPath();ctx.moveTo(6.5,0);ctx.lineTo(5,-1.1);ctx.moveTo(6.5,0);ctx.lineTo(5,1.1);ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha=1;
  const diamondPath=(tx,ty,s2)=>{
    const q0=isoPt(tx,ty),q1=isoPt(tx+s2,ty),q2=isoPt(tx+s2,ty+s2),q3=isoPt(tx,ty+s2);
    ctx.beginPath();ctx.moveTo(q0.x,q0.y);ctx.lineTo(q1.x,q1.y);
    ctx.lineTo(q2.x,q2.y);ctx.lineTo(q3.x,q3.y);ctx.closePath();};
  if(G.pend){
    const ok=canPlaceType(G.pend.type,G.pend.tx,G.pend.ty);
    const gp=isoPt(G.pend.tx,G.pend.ty);
    const sp=getBldSpr(G.pend.type,0,true);
    ctx.globalAlpha=.55;
    ctx.drawImage(sp.c,gp.x-sp.ox,gp.y-sp.oy,sp.w,sp.h);
    ctx.globalAlpha=1;
    diamondPath(G.pend.tx,G.pend.ty,BLDS[G.pend.type].size);
    ctx.strokeStyle=ok?'#7dbb4e':'#c2493d';ctx.lineWidth=2;ctx.stroke();
    if(!ok){ctx.fillStyle='rgba(178,58,48,.3)';ctx.fill();}
  }
  if(G.placing==='wall'||G.placing==='swall'){
    if(G.wallA&&!G.pendLine){
      diamondPath(G.wallA.tx,G.wallA.ty,1);
      ctx.strokeStyle='#ffe082';ctx.lineWidth=2;ctx.stroke();
    }
    if(G.pendLine){
      const sp=getBldSpr(G.placing,0,true);
      for(const s2 of G.pendLine){
        const ok=canPlaceType(G.placing,s2.tx,s2.ty);
        const gp=isoPt(s2.tx,s2.ty);
        ctx.globalAlpha=.55;
        ctx.drawImage(sp.c,gp.x-sp.ox,gp.y-sp.oy,sp.w,sp.h);
        ctx.globalAlpha=1;
        if(!ok){diamondPath(s2.tx,s2.ty,1);
          ctx.fillStyle='rgba(178,58,48,.4)';ctx.fill();}
      }
    }
  }
  // sway is skipped when zoomed out or when last frame drew a wall of trees (perf)
  const swayOk=G.cam.z>=.9&&lastTreeCount<320&&!OPT.reduceMotion;
  let treeDrawn=0;
  const ents=[];
  for(const k in G.res){const r=G.res[k];
    ents.push({sy:(r.x+r.y+1)*IH,r});}
  for(const rl of G.relics){
    if(rl.held||rl.mon||!tileKnown(rl.x,rl.y))continue;
    ents.push({sy:(rl.x+rl.y+1)*IH,relic:rl});}
  for(const b of G.blds){
    if(!allied(b.p,localP)&&!b.seen)continue;
    ents.push({sy:(b.tx+b.ty+b.size)*IH,b});}
  for(const u of G.units){
    if(!allied(u.p,localP)&&!tileVis(u.x,u.y))continue;
    ents.push({sy:(u.x+u.y)*IH+.1,u});}
  ents.sort((a,b)=>a.sy-b.sy);
  const inspR=G.inspect&&G.inspect.res?G.res[G.inspect.res]:null;
  for(const e of ents){
    if(e.r){
      const rp=isoE(e.r.x+.5,e.r.y+.5);
      if(rp.x<vx0||rp.x>vx1||rp.y<vy0||rp.y>vy1)continue;
      if(e.r===inspR){
        ctx.strokeStyle='rgba(240,240,240,.9)';ctx.lineWidth=1.6;
        ctx.beginPath();ctx.ellipse(rp.x,rp.y+8,IW*.72,IH*.72,0,0,7);ctx.stroke();
      }
      const sp=getResSpr(e.r.sub||e.r.type,hash2(e.r.x*13,e.r.y*17));
      if(e.r.type==='wood')treeDrawn++;
      if(e.r.type==='wood'&&swayOk){
        // gentle wind sway, phase per tree, pivot at the trunk base
        // (skipped when zoomed out — invisible there and rotate is costly x2500 trees)
        const ang=Math.sin(G.t*.8+((e.r.x*13+e.r.y*29)%63)/10)*.007; // barely-there wind
        ctx.save();ctx.translate(rp.x,rp.y+8);ctx.rotate(ang);
        ctx.drawImage(sp.c,-sp.ox,-sp.oy,sp.w,sp.h);ctx.restore();
      }else ctx.drawImage(sp.c,rp.x-sp.ox,rp.y-sp.oy+8,sp.w,sp.h);
    }
    else if(e.relic){
      const rp=isoE(e.relic.x+.5,e.relic.y+.5);
      if(rp.x<vx0||rp.x>vx1||rp.y<vy0||rp.y>vy1)continue;
      const sp=getRelicSpr();
      ctx.drawImage(sp.c,rp.x-sp.ox,rp.y-sp.oy+6,sp.w,sp.h);
    }
    else if(e.b)drawBld(e.b);
    else drawUnit(e.u);
  }
  drawGhosts(); // occluded allies show through as team-color silhouettes
  for(const p of G.proj){
    if(!tileVis(p.x0,p.y0)&&!tileVis(p.x1,p.y1))continue;
    drawArrow(p);}
  for(const f of G.fx){
    if(!tileVis(f.x,f.y))continue;
    drawFx(f);}
  lastTreeCount=treeDrawn;
  if(fogDirty)renderFogCanvas();
  ctx.save();
  ctx.transform(IW,IH,-IW,IH,0,0);
  ctx.drawImage(fogS,0,0,MAP,MAP);
  // Slow-drifting mist, clipped to unexplored ground — shared with the 3D
  // fog pass, which finally draws it too (it was a known 3D gap).
  updateWisps();
  ctx.globalAlpha=.35;
  ctx.drawImage(wispC,0,0,MAP,MAP);
  ctx.globalAlpha=1;
  ctx.restore();
  ctx.restore();
  if(selBox){
    const r=view.getBoundingClientRect();
    const bx=Math.min(selBox.x0,selBox.x1)-r.left,by=Math.min(selBox.y0,selBox.y1)-r.top;
    const bw=Math.abs(selBox.x1-selBox.x0),bh=Math.abs(selBox.y1-selBox.y0);
    ctx.fillStyle='rgba(255,224,130,.08)';ctx.fillRect(bx,by,bw,bh);
    ctx.strokeStyle='rgba(255,224,130,.95)';ctx.lineWidth=1.5;
    ctx.setLineDash([6,4]);ctx.strokeRect(bx,by,bw,bh);ctx.setLineDash([]);
  }
  if(vig&&vig.width&&vig.height)ctx.drawImage(vig,0,0,vw,vh);
  if(G.ageFx>0){ // age-up bloom: warm wash that fades from the screen edges
    const a=Math.min(1,G.ageFx/1.4);
    const gr=ctx.createRadialGradient(vw/2,vh/2,Math.min(vw,vh)*.2,vw/2,vh/2,Math.hypot(vw,vh)*.55);
    gr.addColorStop(0,'rgba(255,226,140,0)');
    gr.addColorStop(1,'rgba(255,214,110,'+(a*.5).toFixed(3)+')');
    ctx.fillStyle=gr;ctx.fillRect(0,0,vw,vh);
    G.ageFx-=1/60;
  }
  drawMini();
}
/* Rebuild the drifting-mist canvas (unexplored-only). Every 3rd call, because
   rebuilding a 512px canvas with 9 composites per frame was one of the
   heaviest render costs and the mist creeps at 4.5px/s anyway. Shared by the
   2D draw and R3.drawFog — whichever renderer is live keeps the mist alive.
   wispVer lets the 3D path know when to re-upload its texture. */
let wispVer=0;
function updateWisps(stride){
  // 3D passes 6: it also pays a 512px texture UPLOAD per rebuild, and mist
  // creeping at 4.5px/s cannot tell 20Hz from 10Hz
  wispT=(wispT+1)%(stride||3);
  if(wispT!==0&&!fogWasDirty)return;
  wispCtx.globalCompositeOperation='source-over';
  wispCtx.clearRect(0,0,512,512);
  wispCtx.drawImage(maskS,0,0);
  wispCtx.globalCompositeOperation='source-in';
  const wx0=(G.t*4.5)%256,wy0=(G.t*2.6)%256;
  for(let oy=-1;oy<1;oy++)for(let ox=-1;ox<2;ox++)
    wispCtx.drawImage(noiseC,wx0+ox*256,wy0+oy*256,256,256);
  for(let ox=-1;ox<2;ox++)
    wispCtx.drawImage(noiseC,wx0+ox*256,wy0+256,256,256);
  fogWasDirty=false;wispVer++;
}
function miniDiamond(){mctx.beginPath();mctx.moveTo(100,10);mctx.lineTo(196,58);
  mctx.lineTo(100,106);mctx.lineTo(4,58);mctx.closePath();}
const MMD=[[100,10],[196,58],[100,106],[4,58]];
function drawMini(){
  const a=96/MAP,b2=48/MAP;
  mctx.setTransform(1,0,0,1,0,0);
  mctx.clearRect(0,0,200,116);
  mctx.save();miniDiamond();mctx.clip();
  mctx.fillStyle='#050505';mctx.fillRect(0,0,200,116);
  mctx.setTransform(a,b2,-a,b2,100,10);
  mctx.fillStyle='#3f8226';mctx.fillRect(0,0,MAP,MAP);
  mctx.fillStyle='#2b5d9d';
  for(const k in G.water){const[wx,wy]=k.split(',').map(Number);
    mctx.fillRect(wx,wy,1.2,1.2);}
  mctx.fillStyle='#c8a24e';
  for(const k in G.ford){const[fx2,fy2]=k.split(',').map(Number);
    mctx.fillRect(fx2,fy2,1.2,1.2);}
  if(miniResDirty)renderMiniRes();
  mctx.drawImage(miniResC,0,0,MAP,MAP);
  mctx.fillStyle='#f5da7a';
  for(const rl of G.relics)if(!rl.held&&!rl.mon)mctx.fillRect(rl.x-.5,rl.y-.5,2,2);
  for(const b of G.blds){
    if(!allied(b.p,localP)&&!b.seen)continue;
    mctx.fillStyle=b.p===localP?'#e8f0ff':TEAMS[b.p].main;
    mctx.fillRect(b.tx-.4,b.ty-.4,b.size+.8,b.size+.8);}
  for(const u of G.units){
    if(!allied(u.p,localP)&&!tileVis(u.x,u.y))continue;
    mctx.fillStyle=u.p===localP?'#fff':TEAMS[u.p].main;
    mctx.fillRect(u.x-.8,u.y-.8,1.6,1.6);}
  mctx.drawImage(fogC,0,0,MAP,MAP);
  mctx.drawImage(maskC,0,0,MAP,MAP); // unexplored = pure black on the minimap
  mctx.setTransform(1,0,0,1,0,0);
  const z=G.cam.z;
  mctx.strokeStyle='rgba(240,230,200,.95)';mctx.lineWidth=1;
  mctx.beginPath();
  const corners=[[0,0],[vw,0],[vw,vh],[0,vh]];
  corners.forEach(([cx,cy],i)=>{
    const t=invIso(G.cam.x+cx/z,G.cam.y+cy/z);
    const mx=100+(t.x-t.y)*a,my=10+(t.x+t.y)*b2;
    if(i===0)mctx.moveTo(mx,my);else mctx.lineTo(mx,my);
  });
  mctx.closePath();mctx.stroke();
  // attack pings: expanding red/white diamond pulses (classic alert flash)
  if(G.pings){
    while(G.pings.length&&G.t-G.pings[0].t>2.4)G.pings.shift();
    for(const pg of G.pings){
      // command pings carry an owner and show only to that owner's team;
      // legacy raid pings (no owner) keep showing to everyone locally
      if(pg.p!==undefined&&!allied(pg.p,localP))continue;
      const el=G.t-pg.t,ag=(el%.8)/.8;
      const mx=100+(pg.x-pg.y)*a,my=10+(pg.x+pg.y)*b2,r=3+ag*13;
      mctx.strokeStyle=((el/.8)|0)%2
        ?'rgba(255,255,255,'+(1-ag).toFixed(2)+')'
        :'rgba(235,45,30,'+(1-ag).toFixed(2)+')';
      mctx.lineWidth=1.8;
      mctx.beginPath();mctx.moveTo(mx,my-r*.55);mctx.lineTo(mx+r,my);
      mctx.lineTo(mx,my+r*.55);mctx.lineTo(mx-r,my);mctx.closePath();mctx.stroke();
    }
  }
  mctx.restore();
  // ornate gold frame with corner studs, stroked over the diamond edge
  mctx.lineJoin='round';miniDiamond();
  mctx.strokeStyle='#2a1608';mctx.lineWidth=7;mctx.stroke();
  mctx.strokeStyle='#8a6a1a';mctx.lineWidth=4.5;mctx.stroke();
  mctx.strokeStyle='#c9a227';mctx.lineWidth=2.5;mctx.stroke();
  mctx.strokeStyle='rgba(255,235,170,.8)';mctx.lineWidth=.9;mctx.stroke();
  for(const[sx,sy] of MMD){
    const gr=mctx.createRadialGradient(sx-1,sy-1,.5,sx,sy,4.5);
    gr.addColorStop(0,'#f5e6a0');gr.addColorStop(.6,'#c9a227');gr.addColorStop(1,'#6d5216');
    mctx.fillStyle=gr;mctx.beginPath();mctx.arc(sx,sy,4.2,0,7);mctx.fill();}
}
