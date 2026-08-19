/* ================= input ================= */
const ptrs=new Map();
let panState=null,pinchBase=null,selBox=null,boxArm=false;
let formSel=0;      // formation for the next move/amove/patrol order (UI-side; travels in the command)
let shiftDown=false; // live shift state for shift-click train queueing
window.addEventListener('keydown',e=>{shiftDown=e.shiftKey;});
window.addEventListener('keyup',e=>{shiftDown=e.shiftKey;});
let lastTapT=0,lastTapId=0,mouseSeen=false;
function setBoxArm(v){boxArm=v;
  document.getElementById('boxBtn').classList.toggle('armed',v);}
document.getElementById('boxBtn').onclick=()=>{
  setBoxArm(!boxArm);
  if(boxArm)toast('Drag a box around your units to select them');
};
/* Pan by a SCREEN delta. In 2D that is the old two lines; in 3D the same
   gesture has to move the orbit target, and how far a pixel moves the world
   depends on the current yaw/pitch. Verified to reduce to the 2D arithmetic
   exactly at the home orientation. */
function panScreen(dx,dy){
  if(use3D){
    const t=R3.target(),d=R3.sd2t(dx,dy);
    camTo(t.x-d.x,t.y-d.y);clampCam();return;
  }
  G.cam.x-=dx/G.cam.z;G.cam.y-=dy/G.cam.z;clampCam();
}
/* Same two statements as centerOn but WITHOUT clampCam, so clampCam can move
   the camera without recursing into itself. */
function camTo(x,y){const p=isoPt(x,y);G.cam.x=p.x-vw/G.cam.z/2;G.cam.y=p.y-vh/G.cam.z/2;}
function onDown(e){
  e.currentTarget.setPointerCapture(e.pointerId);
  if(e.pointerType==='mouse')mouseSeen=true;
  const useBox=!G?.placing&&(boxArm||(e.pointerType==='mouse'&&e.button===0));
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY,sx:e.clientX,sy:e.clientY,moved:false,
    box:useBox&&ptrs.size===0,btn:e.button,mouse:e.pointerType==='mouse',
    shift:!!e.shiftKey,              // shift-queue: captured at press time
    yaw0:R3.yaw,pitch0:R3.pitch});   // additive; never read when !use3D
  if(ptrs.size===2){
    for(const p of ptrs.values())p.box=false;
    selBox=null;
    const[a,b]=[...ptrs.values()];
    pinchBase={d:Math.hypot(a.x-b.x,a.y-b.y),z:G.cam.z,
      cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,
      ang:Math.atan2(b.y-a.y,b.x-a.x),my:(a.y+b.y)/2,
      yaw:R3.yaw,pitch:R3.pitch,rot:false,tilt:false};
  }
}
/* Two-finger twist -> yaw, two-finger vertical -> pitch. Deadzones so a plain
   pinch-zoom never accidentally spins the world. 3D only. */
function twoFingerOrbit(a,b){
  const ang=Math.atan2(b.y-a.y,b.x-a.x);
  let dA=ang-pinchBase.ang;
  while(dA>Math.PI)dA-=2*Math.PI; while(dA<-Math.PI)dA+=2*Math.PI;
  if(!pinchBase.rot&&Math.abs(dA)>0.14)pinchBase.rot=true;
  if(pinchBase.rot)R3.yaw=pinchBase.yaw+dA;
  const dMy=(a.y+b.y)/2-pinchBase.my;
  if(!pinchBase.tilt&&Math.abs(dMy)>18)pinchBase.tilt=true;
  if(pinchBase.tilt)R3.setPitch(pinchBase.pitch+dMy*.005);
}
function onMove(e){
  const p=ptrs.get(e.pointerId);if(!p)return;
  const dx=e.clientX-p.x,dy=e.clientY-p.y;
  p.x=e.clientX;p.y=e.clientY;
  if(Math.hypot(e.clientX-p.sx,e.clientY-p.sy)>9)p.moved=true;
  if(!G||G.paused)return;
  if(ptrs.size===2&&pinchBase){
    const[a,b]=[...ptrs.values()];
    if(use3D)twoFingerOrbit(a,b);
    const d=Math.hypot(a.x-b.x,a.y-b.y);
    const nz=Math.max(.45,Math.min(2.2,pinchBase.z*d/pinchBase.d));
    zoomAt(nz,pinchBase.cx,pinchBase.cy);
  }else if(ptrs.size===1&&p.moved){
    // right/middle DRAG orbits in 3D; a right CLICK still commands, because
    // endPtr only issues a tap when p.moved is false. Unreachable in 2D.
    if(use3D&&(p.btn===2||p.btn===1)){
      R3.yaw=p.yaw0-(e.clientX-p.sx)*.006;
      R3.setPitch(p.pitch0+(e.clientY-p.sy)*.005);
    }
    else if(p.box){selBox={x0:p.sx,y0:p.sy,x1:e.clientX,y1:e.clientY};}
    else panScreen(dx,dy);
  }
}
function applyBox(x0,y0,x1,y1){
  const r=(use3D?view3:view).getBoundingClientRect(),z=G.cam.z;
  const bx0=Math.min(x0,x1),bx1=Math.max(x0,x1);
  const by0=Math.min(y0,y1),by1=Math.max(y0,y1);
  const ids=G.units.filter(u=>{
    if(u.p!==localP)return false;
    let sx,sy;
    /* Orthographic, so a screen rectangle IS the correct volume test — no
       frustum, no clipping. h=8 with NO elevation deliberately mirrors 2D's
       isoPt-not-isoE quirk below, so the two agree exactly at home. */
    if(use3D){const q=R3.project(u.x,u.y,8);sx=q.x+r.left;sy=q.y+r.top;}
    else{const p=isoPt(u.x,u.y);sx=(p.x-G.cam.x)*z+r.left;sy=(p.y-8-G.cam.y)*z+r.top;}
    return sx>=bx0&&sx<=bx1&&sy>=by0&&sy<=by1;
  }).map(u=>u.id);
  G.sel=ids;refreshPanel();
  if(ids.length)toast(ids.length+' selected');
}
function endPtr(e){
  const p=ptrs.get(e.pointerId);
  ptrs.delete(e.pointerId);
  if(ptrs.size<2)pinchBase=null;
  if(!p||!G||G.paused||G.over){selBox=null;return;}
  if(p.box&&p.moved){
    applyBox(p.sx,p.sy,p.x,p.y);
    selBox=null;setBoxArm(false);
    return;
  }
  selBox=null;
  if(p.moved)return;
  if(boxArm)setBoxArm(false);
  handleTap(p.sx,p.sy,p.mouse,p.btn===2,p.shift);
}
function onCancel(e){ptrs.delete(e.pointerId);if(ptrs.size<2)pinchBase=null;selBox=null;}
function onWheel(e){
  if(!G)return;e.preventDefault();
  const nz=e.deltaY<0?Math.min(2.2,G.cam.z*1.12):Math.max(.45,G.cam.z/1.12);
  zoomAt(nz,e.clientX,e.clientY);
}
/* Bound to BOTH canvases. #view3 is display:none in 2D mode and receives no
   events at all, so this is provably a no-op for the 2D path — which is the
   A/B reference for the whole rewrite and must not shift. Deliberately NOT
   bound to #viewwrap: placeMini() re-parents the minimap and zoom buttons into
   it below 760px, and wheel/contextmenu would then fire over the minimap. */
function bindView(el){
  el.addEventListener('pointerdown',onDown);
  el.addEventListener('pointermove',onMove);
  el.addEventListener('pointerup',endPtr);
  el.addEventListener('contextmenu',e=>e.preventDefault());
  el.addEventListener('pointercancel',onCancel);
  el.addEventListener('wheel',onWheel,{passive:false});
}
bindView(view);bindView(view3);
function zoomAt(nz,cx,cy){
  if(use3D){
    // keep the world point under the cursor fixed while zooming. sd2t scales
    // as 1/z, so d MUST be computed before G.cam.z changes.
    const rect=view3.getBoundingClientRect(),t=R3.target();
    const d=R3.sd2t(cx-rect.left-vw/2,cy-rect.top-vh/2);
    const k=1-G.cam.z/nz;
    G.cam.z=nz;camTo(t.x+d.x*k,t.y+d.y*k);clampCam();return;
  }
  const rect=view.getBoundingClientRect();
  const wx=G.cam.x+(cx-rect.left)/G.cam.z,wy=G.cam.y+(cy-rect.top)/G.cam.z;
  G.cam.z=nz;
  G.cam.x=wx-(cx-rect.left)/nz;G.cam.y=wy-(cy-rect.top)/nz;clampCam();
}
document.getElementById('homeBtn').onclick=()=>{if(G&&!G.over)selTC();};
let idleTapT=0;
document.getElementById('idleBtn').onclick=()=>{if(G&&!G.over){
  const now=performance.now();
  if(now-idleTapT<400){ // double-tap: grab EVERY idle villager at once
    const ids=G.units.filter(u=>u.p===localP&&u.type==='villager'&&u.state==='idle'&&u.hp>0).map(u=>u.id);
    if(ids.length){G.sel=ids;refreshPanel();toast(ids.length+' idle villager'+(ids.length>1?'s':'')+' selected');}
    idleTapT=0;snd('sel');return;
  }
  idleTapT=now;snd('click');cycleIdleVill();}};
// quick chat: taunt grid, multiplayer only (the button shows/hides with netMode)
{const cw=document.getElementById('chatWheel'),cb=document.getElementById('chatBtn');
 TAUNTS.forEach((t,i)=>{
   const b=document.createElement('button');
   b.textContent=t;b.setAttribute('role','menuitem');
   b.onclick=()=>{issue('taunt',{n:i});cw.style.display='none';snd('click');};
   cw.appendChild(b);});
 cb.onclick=()=>{cw.style.display=cw.style.display==='none'?'grid':'none';snd('click');};
}
function updateChatBtn(){ // called once per second from updateOverlays
  const cb=document.getElementById('chatBtn');
  if(cb)cb.style.display=netMode?'':'none';
  if(!netMode){const cw=document.getElementById('chatWheel');if(cw)cw.style.display='none';}
}
document.getElementById('panelBtn').onclick=()=>{
  const pn=document.getElementById('panel'),btn=document.getElementById('panelBtn');
  const hide=!pn.classList.contains('hidden');
  pn.classList.toggle('hidden',hide);
  btn.classList.toggle('up',hide);
  btn.textContent=hide?'▴':'▾';
  btn.title=hide?'Show the command panel':'Hide the command panel for a bigger map';
  snd('click');chkView(); // the map just grew/shrank — recalibrate immediately
};
// idle-villager counter, refreshed on the same 1/sec tick as the overlays
function updateIdleBtn(){
  const b=document.getElementById('idleBtn');if(!b||!G)return;
  const n=G.units.filter(u=>u.p===localP&&u.type==='villager'&&u.state==='idle'&&u.hp>0).length;
  b.classList.toggle('live',n>0);
  b.innerHTML='🧑‍🌾'+(n>0?'<b>'+(n>99?'99+':n)+'</b>':'');
  b.title=n?'Jump to an idle villager — '+n+' idle (.)':'No idle villagers (.)';
}
// remember whether the manual was left open
{const ht=document.getElementById('howto');
 if(ht){
   if(localStorage.getItem('tq_howto')==='1')ht.open=true;
   ht.addEventListener('toggle',()=>localStorage.setItem('tq_howto',ht.open?'1':'0'));
 }}
/* Always-visible deselect — same effect as Esc, one tap, never scrolls away.
   Cancels placement first (so it doubles as "get me out of build mode"). */
function clearSel(){
  if(!G)return;
  if(G.placing){G.placing=null;G.pend=null;G.wallA=null;G.pendLine=null;}
  else{G.sel=[];G.inspect=null;G.amode=false;G.pmode=false;}
  setBoxArm(false);snd('click');refreshPanel();
}
document.getElementById('deselBtn').onclick=clearSel;
function updateDeselBtn(){
  const b=document.getElementById('deselBtn');if(!b||!G)return;
  const n=G.sel.length;
  const live=!!(n||G.inspect||G.placing);
  b.classList.toggle('live',live);
  b.innerHTML='✕'+(n>1?'<b>'+n+'</b>':'');
  b.title=G.placing?'Cancel placement (Esc)':n?'Deselect '+n+' selected (Esc)':'Nothing selected';
}
document.getElementById('zin').onclick=()=>{if(G)zoomAt(Math.min(2.2,G.cam.z*1.25),vw/2,vh/2);};
document.getElementById('zout').onclick=()=>{if(G)zoomAt(Math.max(.45,G.cam.z/1.25),vw/2,vh/2);};
// minimap: tap to jump, DRAG to scan, double-tap to drop a rally ping
let miniDrag=false,miniLastTap=0;
function miniToTile(e){
  const r=mini.getBoundingClientRect();
  const mx=(e.clientX-r.left)/r.width*200,my=(e.clientY-r.top)/r.height*116;
  if(Math.abs(mx-100)/96+Math.abs(my-58)/48>1.06)return null; // transparent corners
  const a=96/MAP,b2=48/MAP;
  const u=(mx-100)/a,v=(my-10)/b2;
  return{tx:Math.max(0,Math.min(MAP,(u+v)/2)),ty:Math.max(0,Math.min(MAP,(v-u)/2))};
}
mini.addEventListener('pointerdown',e=>{
  if(!G)return;
  const t=miniToTile(e);if(!t)return;
  const now=performance.now();
  if(now-miniLastTap<330){ // double tap — ping the spot for yourself and your allies
    // through the command layer, so allies on OTHER machines see it too
    issue('ping',{x:Math.floor(t.tx),y:Math.floor(t.ty)});
    snd('click');feed('Ping — attention marked');
    miniLastTap=0;return;
  }
  miniLastTap=now;
  miniDrag=true;mini.setPointerCapture(e.pointerId);
  centerOn(t.tx,t.ty);
});
mini.addEventListener('pointermove',e=>{
  if(!miniDrag||!G)return;
  const t=miniToTile(e);if(t)centerOn(t.tx,t.ty);
});
const miniEnd=e=>{miniDrag=false;
  try{mini.releasePointerCapture(e.pointerId);}catch(err){}};
mini.addEventListener('pointerup',miniEnd);
mini.addEventListener('pointercancel',miniEnd);
function handleTap(cx,cy,mouse,right,shift){
  const d3=use3D;                    // capture once — a mid-tap toggle must not split the branch
  const rect=(d3?view3:view).getBoundingClientRect();
  const sx=cx-rect.left,sy=cy-rect.top;
  let wx,wy,tw,tx,ty,onMap;
  if(d3){
    const g=R3.pickGround(sx,sy);
    tw=g||{x:-1,y:-1};
    tx=Math.floor(tw.x);ty=Math.floor(tw.y);
    onMap=!!g&&tx>=0&&ty>=0&&tx<MAP&&ty<MAP;
  }else{
    wx=G.cam.x+sx/G.cam.z;wy=G.cam.y+sy/G.cam.z;
    tw=invIso(wx,wy);
    tx=Math.floor(tw.x);ty=Math.floor(tw.y);
    if(tx<0||ty<0||tx>=MAP||ty>=MAP)return;
    onMap=true;
  }
  /* NB the off-map early return above stays 2D-only ON PURPOSE. At the pitch
     floor a 40px castle roof unprojects ~3.7 tiles past its own footprint, so
     bailing out here would make every border building's roof, every edge
     canopy and every edge unit unclickable at any yaw that points the map edge
     away from the camera. The entity tests below are screen-space/volume
     tests — they never needed a valid ground tile. */
  // placement mode
  if(G.placing){
    if(right){G.placing=null;G.pend=null;G.wallA=null;G.pendLine=null;refreshPanel();return;}
    if(!onMap)return;
    const sz=BLDS[G.placing].size;
    const px2=Math.min(MAP-sz,Math.max(0,tx)),py2=Math.min(MAP-sz,Math.max(0,ty));
    if(G.placing==='wall'||G.placing==='swall'){
      if(!G.wallA){G.wallA={tx:px2,ty:py2};G.pendLine=null;}
      else G.pendLine=lineTiles(G.wallA.tx,G.wallA.ty,px2,py2);
      refreshPanel();return;
    }
    G.pend={type:G.placing,tx:px2,ty:py2};refreshPanel();return;}
  // hit tests are in iso SCREEN space so clicking the visible sprite works —
  // canopies/roofs rise above their ground tile; a tile-only test made you click "under" things
  let hitU=null;
  if(d3){
    /* SCREEN space, because a unit sprite is a screen-facing billboard — a
       fingertip is 13/22 CSS px wide however the camera is pointed. This is
       the SAME rule as 2D, algebraically restated: the 2D test is
       d_world < k/min(1,z); multiply both sides by z and it is
       d_screen < k*max(1,z). Not a retune. The .8 anisotropy stays in screen
       space: it compensates for a taller-than-wide sprite, and under an
       orthographic camera a billboard's screen aspect is pitch-independent. */
    let hd=(mouse?13:22)*Math.max(1,G.cam.z);
    for(const u of G.units){
      if(!allied(u.p,localP)&&!tileVis(u.x,u.y))continue;
      const big=!!UNITS[u.type].cav||u.type==='ram'||!!UNITS[u.type].ship||!!UNITS[u.type].siege;
      // elevF, matching what the 2D renderer draws with via isoE — pick must
      // follow DRAW, not the mesh, until stage 3 stands units on the mesh.
      const p=R3.project(u.x,u.y,elevF(u.x,u.y)*10+(big?10:8));
      const d=Math.hypot(p.x-sx,(p.y-sy)*.8);
      if(d<hd){hd=d;hitU=u;}}          // nearest wins — hd reassigned, as in 2D
  }else{
    let hd=(mouse?13:22)/Math.min(1,G.cam.z); // touch keeps a fingertip-sized target at any zoom
    for(const u of G.units){
      if(!allied(u.p,localP)&&!tileVis(u.x,u.y))continue;
      const p=isoE(u.x,u.y);
      const big=!!UNITS[u.type].cav||u.type==='ram'||!!UNITS[u.type].ship||!!UNITS[u.type].siege;
      const d=Math.hypot(p.x-wx,(p.y-(big?10:8)-wy)*.8);
      if(d<hd){hd=d;hitU=u;}}
  }
  let hitB=null;
  for(const b of G.blds){
    if(!allied(b.p,localP)&&!b.seen)continue;
    if(tx>=b.tx&&ty>=b.ty&&tx<b.tx+b.size&&ty<b.ty+b.size){hitB=b;break;}}
  if(!hitB&&!hitU){ // roof click: box from the visual top down to the footprint
    if(d3){
      /* A real volume, so a castle turret is clickable from any angle, and the
         ray parameter gives the true FRONT-MOST building instead of "first one
         in G.blds order". Half-extent 0.7*size TILES reproduces the 2D box's
         size*IW*.7 exactly; the height and the elevTile lift are the same
         numbers drawBld uses. */
      const R=R3.ray(sx,sy);let bt=Infinity;
      for(const b of G.blds){
        if(!allied(b.p,localP)&&!b.seen)continue;
        const g=elevTile(b.tx+b.size/2,b.ty+b.size/2)*10;
        const ht=(IHT[b.type]||18)*(b.built?1:.35);
        /* hx=0.35*size, NOT 0.7*size. The 2D test is a SCREEN box of half-width
           size*IW*0.7; a square world AABB projects to screen half-width
           (|dx|+|dz|)*IW = 2*hx*IW, so hx must be half of 0.7 to match. Using
           0.7 made the volume twice as wide as 2D and the A/B harness caught it
           immediately: clicking open ground beside a town hall issued `gar`
           instead of `move`. */
        // 3D massing is scaled R3.BVS for non-flat buildings — the pick volume
        // tracks the drawn geometry (the 0.35 identity still holds under it)
        const M3=R3.BMASS[b.type],vs3=(M3&&M3.r!=='flat')?R3.BVS:1;
        const cxT=b.tx+b.size/2,cyT=b.ty+b.size/2,hx=b.size*.35*vs3;
        const t=rayBox(R,cxT-hx,g*R3.HS,cyT-hx,cxT+hx,(g+ht*vs3)*R3.HS,cyT+hx);
        if(t!==null&&t<bt){bt=t;hitB=b;}}
    }else{
      for(const b of G.blds){
        if(!allied(b.p,localP)&&!b.seen)continue;
        const pc=isoPt(b.tx+b.size/2,b.ty+b.size/2);
        pc.y-=elevTile(b.tx+b.size/2,b.ty+b.size/2)*10;
        // sprites draw at BLD_VS2D from the south anchor — the click box must
        // cover the art the player actually sees, or tall roofs go dead
        const bs2=(BLDS[b.type].thin||BLDS[b.type].farm)?1:BLD_VS2D;
        const ht=(IHT[b.type]||18)*(b.built?1:.35)*bs2;
        if(Math.abs(wx-pc.x)<b.size*IW*.7*bs2&&wy>pc.y-ht-IH&&wy<pc.y+b.size*IH*.8){hitB=b;break;}}
    }
  }
  const selUnits=G.sel.map(id=>G.units.find(u=>u.id===id)).filter(u=>u&&u.p===localP);
  const haveSel=selUnits.length>0;
  let resKey=tx+','+ty;
  let res=onMap?G.res[resKey]:undefined;
  if(!res&&!hitU&&!hitB){ // canopy/sprite click: front-most resource whose art contains the point
    if(d3){
      /* Same tolerance band as 2D, expressed in screen px: the 2D test compares
         world px and BOTH sides scale by z, so 13 -> 13*z etc. is algebraically
         identical. Front-most now uses the real depth key, because "bigger
         screen y is nearer" only holds at the home yaw. */
      const z=G.cam.z;let bs=-1e9;
      for(const k in G.res){
        const r=G.res[k];
        if(!tileKnown(r.x,r.y))continue;
        const rp=R3.project(r.x+.5,r.y+.5,elevF(r.x+.5,r.y+.5)*10);
        if(Math.abs(rp.x-sx)>13*z)continue;
        const top=r.type==='wood'?36:22;
        if(sy<rp.y-top*z||sy>rp.y+14*z)continue;
        if(rp.d>bs){bs=rp.d;res=r;resKey=k;}
      }
    }else{
      let bs=-1e9;
      for(const k in G.res){
        const r=G.res[k];
        if(!tileKnown(r.x,r.y))continue;
        const rp=isoE(r.x+.5,r.y+.5);
        if(Math.abs(rp.x-wx)>13)continue;
        const top=r.type==='wood'?36:22;
        if(wy<rp.y-top||wy>rp.y+14)continue;
        if(rp.y>bs){bs=rp.y;res=r;resKey=k;}
      }
    }
  }
  // Nothing at all under the finger (sky, or off the board): don't let it fall
  // through to a move order or clear the selection.
  if(d3&&!onMap&&!hitU&&!hitB&&!res)return;
  // mouse: left-click only selects; commands go on right-click (attack-move tap is the exception)
  // Every branch below states an INTENT — issue() records it and the handler
  // carries it out; nothing here touches a unit directly any more.
  const selIds=selUnits.map(s=>s.id);
  if(haveSel&&(right||!mouse||G.amode)){
    if(hitU&&!allied(hitU.p,localP)){issue('attack',{u:selIds,id:hitU.id,bld:false});flashSel();return;}
    // a beast you already own is still meat — send anyone who can swing at it
    if(hitU&&isAnimal(hitU)&&selUnits.some(s=>!UNITS[s.type].passive&&!UNITS[s.type].monk)){
      issue('attack',{u:selIds,id:hitU.id,bld:false});
      if(hitU.p===localP)toast('Slaughtering — villagers will butcher the carcass');
      flashSel();return;}
    if(hitB&&!allied(hitB.p,localP)){issue('attack',{u:selIds,id:hitB.id,bld:true});flashSel();return;}
    if(res){issue('gather',{u:selIds,key:resKey});flashSel();return;}
    const relic=onMap?G.relics.find(r=>!r.held&&!r.mon&&Math.hypot(r.x+.5-tw.x,r.y+.5-tw.y)<1):null;
    const monks=selUnits.filter(s=>UNITS[s.type].monk&&!UNITS[s.type].noRelic); // Missionaries can't carry relics
    if(relic&&monks.length){
      issue('relic',{u:monks.map(m=>m.id),rid:relic.id});
      toast('Monk moving to the relic');return;}
    if(hitB&&hitB.p===localP&&hitB.built&&hitB.type==='monastery'&&monks.some(m=>m.relic)){
      issue('enshrine',{u:monks.map(m=>m.id),id:hitB.id});return;}
    if(hitB&&hitB.p===localP&&!hitB.built&&selUnits.some(s=>s.type==='villager')){
      issue('build',{u:selIds,id:hitB.id});flashSel();return;}
    if(hitB&&hitB.p===localP&&hitB.type==='farm'&&selUnits.some(s=>s.type==='villager')){
      issue('farm',{u:selIds,id:hitB.id});flashSel();return;}
    if(hitB&&hitB.p===localP&&hitB.built&&BLDS[hitB.type].garCap){
      // count locally only to phrase the toast — the handler decides who fits
      const room=bldGarCap(hitB)-hitB.gar.length
        -selUnits.filter(s=>s.garB===hitB.id).length;
      const n=Math.min(Math.max(0,room),selUnits.filter(s=>s.type!=='ram').length);
      issue('gar',{u:selIds,id:hitB.id});
      if(n){toast(n+' heading inside — select the building to release them');return;}
      toast(BLDS[hitB.type].name+' is full');return;
    }
    // manual: infantry can garrison inside a Battering Ram (faster ram, harder
    // hits); any land unit can board a Transport Ship moored at the shore
    if(hitU&&hitU.p===localP&&UNITS[hitU.type].garCap&&selUnits.some(s=>s.id!==hitU.id&&!UNITS[s.type].ship)){
      const isRam=hitU.type==='ram';
      const room=UNITS[hitU.type].garCap-(hitU.gar?hitU.gar.length:0);
      const eligible=selUnits.filter(s=>s.id!==hitU.id&&!UNITS[s.type].ship&&(!isRam||INF.has(s.type)));
      const n=Math.min(Math.max(0,room),eligible.length);
      issue('garU',{u:selIds,id:hitU.id});
      if(n){toast(n+(isRam?' climbing into the ram':' boarding the ship')+' — select it to release them');return;}
      toast(isRam?'The ram is full':'The ship is full');return;
    }
    // onMap guard: this is the branch that would corrupt GAMEPLAY rather than
    // just the UI — without it a tap past the board edge issues a move order to
    // a garbage tile.
    if(!hitU&&!hitB&&onMap){
      if(G.pmode){
        issue('patrol',{u:selIds,x:tx,y:ty,f:formSel});
        G.pmode=false;toast('Patrolling — they will walk the beat and engage what they meet');
        refreshPanel();return;
      }
      if(G.amode){
        issue('amove',{u:selIds,x:tx,y:ty,f:formSel});
        G.amode=false;toast('Attack-moving — they will fight through anything they meet');
        refreshPanel();return;
      }
      issue('move',{u:selIds,x:tx,y:ty,f:formSel,sh:shift?1:0});
      flashSel();return;}
  }
  // Rally point: an own production building is selected and the tap names a
  // spot, a resource, or a farm — plant the flag instead of deselecting.
  if(!haveSel&&G.sel.length===1&&onMap&&(right||!mouse)){
    const rb=G.blds.find(b=>b.id===G.sel[0]&&b.p===localP&&b.built);
    if(rb&&trainsFor(rb,localP).length
      &&!(hitB&&hitB.id===rb.id)
      &&!(hitU&&!isAnimal(hitU))){
      const fb=(hitB&&hitB.p===localP&&hitB.type==='farm'&&hitB.built)?hitB:null;
      issue('rally',{id:rb.id,x:tx,y:ty,rk:res?resKey:null,fid:fb?fb.id:null});
      return;
    }
  }
  if(right)return; // right-click never changes selection
  G.amode=false;G.pmode=false;
  G.inspect=null;
  // selection (double-tap an own unit: select all of that type on screen)
  if(hitU&&hitU.p===localP){
    const now=performance.now();
    if(now-lastTapT<400&&lastTapId===hitU.id){
      const z=G.cam.z;
      const ids=G.units.filter(u=>{
        if(u.p!==localP||u.type!==hitU.type)return false;
        let px,py;
        // mirrors the 2D line exactly: no rect offset, no body lift, no elevation
        if(d3){const q=R3.project(u.x,u.y,0);px=q.x;py=q.y;}
        else{const p=isoPt(u.x,u.y);px=(p.x-G.cam.x)*z;py=(p.y-G.cam.y)*z;}
        return px>=0&&px<=vw&&py>=0&&py<=vh;
      }).map(u=>u.id);
      G.sel=ids.length?ids:[hitU.id];
      toast(G.sel.length+' '+(hitU.type==='villager'?'villagers':unitName(hitU.type,localP)+'s')+' selected');
    }else G.sel=[hitU.id];
    snd('sel');
    lastTapT=now;lastTapId=hitU.id;
    refreshPanel();return;
  }
  if(hitB&&hitB.p===localP){G.sel=[hitB.id];refreshPanel();return;}
  // inspect anything else: enemy/ally units & buildings, trees, gold, berries
  if(hitU){G.sel=[];G.inspect={id:hitU.id};refreshPanel();return;}
  if(hitB){G.sel=[];G.inspect={id:hitB.id};refreshPanel();return;}
  if(res&&tileKnown(res.x,res.y)){G.sel=[];G.inspect={res:resKey};refreshPanel();return;}
  G.sel=[];refreshPanel();
}
function flashSel(){snd('ack');} // acknowledgment grunt on every issued order
function lineTiles(x0,y0,x1,y1){
  const out=[];let dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0);
  const sx2=x0<x1?1:-1,sy2=y0<y1?1:-1;let err=dx+dy;
  for(;;){out.push({tx:x0,ty:y0});
    if((x0===x1&&y0===y1)||out.length>60)break;
    const e2=2*err;
    if(e2>=dy){err+=dy;x0+=sx2;}
    if(e2<=dx){err+=dx;y0+=sy2;}}
  return out;
}

