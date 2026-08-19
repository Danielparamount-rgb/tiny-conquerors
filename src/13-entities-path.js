/* ================= entities ================= */
function hasUt(p,id){const uts=G.P[p].uts;return !!(uts&&uts.includes(id));}
function uniOf(p){const st=G.P[p];if(!st.uni)st.uni={};return st.uni;}
function hasUni(p,id){return !!(G.P[p].uni&&G.P[p].uni[id]);}
function addUnit(p,type,tx,ty){
  const d=UNITS[type];
  const cv=CIVS[G.P[p].civ||0];
  let hp=statFor(type,p).hp;
  if(d.cav&&cv.cavHp&&type!=='missionary')hp*=cv.cavHp;
  if(INF.has(type)&&cv.infHpAge)hp*=cv.infHpAge[G.P[p].age];
  if(type==='scout'&&cv.scoutHp)hp*=cv.scoutHp;
  if((type==='janissary'||d.gun)&&cv.gunHp)hp*=cv.gunHp; // Turks: hardy gunpowder
  if(type==='fishing'&&cv.fishHp)hp*=cv.fishHp; // Japanese fishing fleet
  if(d.monk&&cv.monkHp)hp+=cv.monkHp;
  if(type==='ram'&&hasUt(p,'furor'))hp*=1.5;
  if(type==='eagle'&&hasUt(p,'eldorado'))hp+=40;
  if(type==='mameluke'&&hasUt(p,'zealotry'))hp+=30;
  if(type==='villager'&&hasUt(p,'supremacy'))hp+=40;
  if(type==='villager'&&ecoTier(p,'loom'))hp+=15;             // Loom
  if(d.cav&&!d.monk&&ecoTier(p,'bloodlines'))hp+=20;          // Bloodlines
  if(d.monk&&ecoTier(p,'sanc'))hp=Math.round(hp*1.5);         // Sanctity (monastery)
  hp=Math.round(hp);
  // `face` stays keyed to slot 0, NOT localP: it is written into the unit record,
  // so keying it to the viewer would have two peers build different units.
  const u={id:uid++,p,type,x:tx+.5,y:ty+.5,hp,maxhp:hp,face:p===0?1:-1,flash:0,
    hdg:dAtan2(MAP/2-(ty+.5),MAP/2-(tx+.5)),spd:0,vx:0,vy:0,gaitPh:0,
    state:'idle',path:null,target:null,carry:0,carryType:null,cd:0,gatherT:0,resKey:null,farm:null};
  if(d.garCap)u.gar=[];
  G.units.push(u);return u;
}
function speedOf(u){
  const d=UNITS[u.type],cv=civOf(u.p);
  let s=d.speed*(d.cav&&cv.cavSpd?cv.cavSpd:1);
  if(INF.has(u.type)&&cv.infSpd)s*=cv.infSpd;
  if(INF.has(u.type)&&ecoTier(u.p,'squires'))s*=1.1;          // Squires
  if(u.type==='villager'&&cv.vilSpd)s*=cv.vilSpd;
  if(u.type==='villager')s*=1+.1*ecoTier(u.p,'cart');         // Wheelbarrow / Hand Cart
  if(d.cav&&!d.monk&&ecoTier(u.p,'husb'))s*=1.1;              // Husbandry
  if(d.ship&&ecoTier(u.p,'dry'))s*=1.15;                      // Dry Dock
  if(u.type==='cog'&&turboSel)s*=2;                           // Turbo: trade works 2x
  if(d.monk&&ecoTier(u.p,'ferv'))s*=1.15;                     // Fervor
  if(u.type==='ram'||d.siege){
    if(hasUt(u.p,'drill'))s*=1.5;
    if(u.gar&&u.gar.length)s*=1+.08*u.gar.length; // manual: garrisoned rams move faster
  }
  if(u.type==='elephant'&&hasUt(u.p,'mahouts'))s*=1.3;
  return s;
}
function addBld(p,type,tx,ty,done){
  const d=BLDS[type];
  const cv=CIVS[G.P[p].civ||0];
  let bhpM=cv.bldHpAge?cv.bldHpAge[G.P[p].age]:(cv.bldHp||1);
  if(type==='tc'&&cv.tcHp)bhpM=cv.tcHp;
  if(hasUni(p,'mas'))bhpM*=1.1;   // Masonry
  if(hasUni(p,'arch'))bhpM*=1.1;  // Architecture
  const mhp=Math.round(d.hp*bhpM);
  const b={id:uid++,p,type,tx,ty,size:d.size,hp:done?mhp:1,maxhp:mhp,
    built:!!done,prog:done?d.bt:0,queue:[],qt:0,cd:0,occ:null,gar:[]};
  for(let y=ty;y<ty+d.size;y++)for(let x=tx;x<tx+d.size;x++){
    G.map[y][x]=1;
    if(type==='dock')(G.navBlock||(G.navBlock={}))[x+','+y]=1; // ships route around
  }
  if(d.thin)G.wallMap[tx+','+ty]=b;
  if(d.gate)G.gateMap[tx+','+ty]=b;
  G.blds.push(b);return b;
}
function bldCenter(b){return{x:b.tx+b.size/2,y:b.ty+b.size/2};}
function unitDef(u){return UNITS[u.type];}
function atkOf(u){
  const d=UNITS[u.type],bs=bsOf(u.p);
  let a=statFor(u.type,u.p).atk;
  if((INF.has(u.type)||(d.cav&&!d.ranged))&&!d.ram&&!d.petard&&!d.monk)
    a+=BS_ATK[bs.atk];                              // Forging line
  if(d.ranged&&!d.siege&&!d.gun)a+=BS_ARW[bs.arw];  // Fletching line (not siege/gunpowder)
  if(d.ranged&&!d.gun&&hasUni(u.p,'chem'))a+=1;     // Chemistry: +1 missile attack
  if(INF.has(u.type)&&hasUt(u.p,'garland'))a+=4;   // Aztec Garland Wars
  if(u.type==='chukonu'&&hasUt(u.p,'rocketry'))a+=2;
  if(u.type==='villager'&&hasUt(u.p,'supremacy'))a=9; // Spanish Supremacy
  if(u.type==='ram'&&u.gar&&u.gar.length)a+=u.gar.length*5; // garrisoned rams hit harder
  return a;
}
function rangeOf(u){
  const d=UNITS[u.type],cv=civOf(u.p);
  let r=statFor(u.type,u.p).rng;
  if(d.ranged&&r>1&&!d.siege&&!d.gun)r+=bsOf(u.p).arw; // Fletching line: +1 range per tier
  if(d.ranged&&!d.cav&&!d.siege&&!d.gun&&cv.archerRange)r+=cv.archerRange;
  if(d.ranged&&!d.cav&&!d.siege&&!d.gun&&hasUt(u.p,'yeomen'))r+=1;
  if(u.type==='axeman'&&hasUt(u.p,'bearded'))r+=1;
  if(u.type==='janissary'&&hasUt(u.p,'artillery'))r+=1.5;
  if((u.type==='bombard'||u.type==='cannongalleon')&&hasUt(u.p,'artillery'))r+=1.5;
  if(u.type==='mangonel'&&hasUt(u.p,'shinkichon'))r+=1; // Korean unique tech (1.0B: +1, was +2)
  if(u.type==='mangonel'&&teamHas(u.p,'mangonelRng'))r+=1; // Korean team bonus
  if(d.siege&&!d.ram&&hasUni(u.p,'se'))r+=1;        // Siege Engineers
  return r;
}
function rofOf(u){
  const d=UNITS[u.type],cv=civOf(u.p);
  let c=d.ram?2.4:(d.rof||1.5);
  if(INF.has(u.type)&&cv.infRofAge)c*=cv.infRofAge[G.P[u.p].age];
  if(u.type==='mangudai'&&cv.mangRof)c*=cv.mangRof;
  if(d.ranged&&!d.siege&&!d.gun&&!d.ship&&ecoTier(u.p,'thumb'))c*=.85; // Thumb Ring
  if(d.gun&&cv.gunRof)c*=cv.gunRof; // 1.0B: Spanish gunpowder fires faster (incl. Conquistador)
  if(u.type==='conquistador'&&cv.gunRof)c*=cv.gunRof;
  if((d.ram||d.siege)&&cv.siegeRof)c*=cv.siegeRof;  // Celts: siege fires faster
  if((u.type==='ram'||d.treb)&&hasUt(u.p,'kataparuto'))c*=.67;
  return c;
}
function carryCap(u){
  if(UNITS[u.type].fisher)return Math.round(15*TB());
  return Math.round((10+(civOf(u.p).vilCarry||0))*(1+.25*ecoTier(u.p,'cart'))*TB());}

/* ================= pathfinding ================= */
function passable(x,y){return x>=0&&y>=0&&x<MAP&&y<MAP&&!G.map[y][x];}
// naval passability: open water (incl. fords — shallows) not claimed by a dock
function passableW(x,y){
  if(x<0||y<0||x>=MAP||y>=MAP)return false;
  const k=x+','+y;
  return !!(G.water[k]||G.ford[k])&&!(G.navBlock&&G.navBlock[k]);
}
function uPath(u,tx,ty){return findPath(u.x,u.y,tx,ty,u.p,!!UNITS[u.type].ship);}
function findPath(sx,sy,tx,ty,team,naval){
  const ox=sx,oy=sy; // float start for string-pulling
  sx=Math.floor(sx);sy=Math.floor(sy);tx=Math.floor(tx);ty=Math.floor(ty);
  if(sx===tx&&sy===ty)return[];
  const passT=naval?passableW:passable;
  if(!passT(tx,ty)){const a=nearFree(tx,ty,6,naval);if(!a)return null;tx=a.x;ty=a.y;}
  const pass2=naval?passableW:(x,y)=>{
    if(x<0||y<0||x>=MAP||y>=MAP)return false;
    if(!G.map[y][x])return true;
    if(team===undefined)return false;
    const wb=G.wallMap[x+','+y];if(!wb)return false;
    if(allied(wb.p,team))return !!BLDS[wb.type].gate&&wb.built;
    return true;};
  const stepCost=(x,y)=>{if(team===undefined||naval)return 0;
    const wb=G.wallMap[x+','+y];return wb&&!allied(wb.p,team)?30:0;};
  const key=(x,y)=>y*MAP+x;
  const heap=[];
  const hpush=n=>{heap.push(n);let i=heap.length-1;
    while(i>0){const pi=(i-1)>>1;if(heap[pi].f<=heap[i].f)break;
      const t2=heap[pi];heap[pi]=heap[i];heap[i]=t2;i=pi;}};
  const hpop=()=>{const top=heap[0],last=heap.pop();
    if(heap.length){heap[0]=last;let i=0;
      for(;;){const l=i*2+1,r2=l+1;let s2=i;
        if(l<heap.length&&heap[l].f<heap[s2].f)s2=l;
        if(r2<heap.length&&heap[r2].f<heap[s2].f)s2=r2;
        if(s2===i)break;const t2=heap[s2];heap[s2]=heap[i];heap[i]=t2;i=s2;}}
    return top;};
  const start={x:sx,y:sy,g:0,f:0,par:null};
  hpush(start);
  const seen=new Map();seen.set(key(sx,sy),start);
  let best=null,exp=0;
  // node budget scales with the board — a fixed 7000 could not cross a 128 map
  const EXP_CAP=Math.max(7000,Math.round(MAP*MAP*.75));
  while(heap.length&&exp++<EXP_CAP){
    const n=hpop();
    if(n.x===tx&&n.y===ty){best=n;break;}
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;const nx=n.x+dx,ny=n.y+dy;
      if(!pass2(nx,ny))continue;
      if(dx&&dy&&(!pass2(n.x+dx,n.y)||!pass2(n.x,n.y+dy)))continue;
      const g=n.g+(dx&&dy?1.41:1)+stepCost(nx,ny),k=key(nx,ny);
      const ex=seen.get(k);
      if(ex&&ex.g<=g)continue;
      const node={x:nx,y:ny,g,f:g+hyp(tx-nx,ty-ny),par:n};
      seen.set(k,node);hpush(node);
    }
  }
  if(!best)return null;
  const path=[];let n=best;
  while(n.par){path.push({x:n.x+.5,y:n.y+.5});n=n.par;}
  path.reverse();return smoothPath(ox,oy,path,team,naval);
}
function nearFree(tx,ty,maxR=6,naval){
  const passT=naval?passableW:passable;
  for(let r=1;r<=maxR;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
    const x=tx+dx,y=ty+dy;if(passT(x,y))return{x,y};}
  return null;
}
/* ---------- motion: steering, string-pulling, clearance ---------- */
function wrapA(a){while(a>Math.PI)a-=2*Math.PI;while(a<-Math.PI)a+=2*Math.PI;return a;}
// per-class steering params derived from existing UNITS flags — no table edits
function motParams(u){
  const d=UNITS[u.type];
  if(d.ship)return{acc:3.5,dec:5,turn:2.0,k:3}; // ships carve slow, wide arcs
  if(d.ram)return{acc:5,dec:8,turn:2.5,k:3};
  if(d.cav)return{acc:9,dec:14.4,turn:4.5,k:2};
  return{acc:14,dec:22.4,turn:9,k:1};
}
// physical walkability for a continuous position — allied built gates pass,
// enemy walls do NOT (bashing goes through the waypoint check, never by walking in)
function walkTile(x,y,team,naval){
  const tx=Math.floor(x),ty=Math.floor(y);
  if(naval)return passableW(tx,ty);
  if(tx<0||ty<0||tx>=MAP||ty>=MAP)return false;
  if(!G.map[ty][tx])return true;
  const wb=G.wallMap[tx+','+ty];
  return !!(wb&&allied(wb.p,team)&&BLDS[wb.type].gate&&wb.built);
}
// LOS opacity: enemy walls OPAQUE (their +30-cost bash waypoints must survive
// smoothing so followPath's wall check still fires); allied built gates clear
function losBlocked(x,y,team,naval){
  if(naval)return !passableW(x,y);
  if(x<0||y<0||x>=MAP||y>=MAP)return true;
  if(!G.map[y][x])return false;
  if(team===undefined)return true;
  const wb=G.wallMap[x+','+y];
  return !(wb&&allied(wb.p,team)&&BLDS[wb.type].gate&&wb.built);
}
// supercover grid walk; exact corner crossings need BOTH adjacent tiles clear
// (mirrors the A* no-corner-cut rule)
function lineClear(x0,y0,x1,y1,team,naval){
  let tx=Math.floor(x0),ty=Math.floor(y0);
  const ex=Math.floor(x1),ey=Math.floor(y1);
  if(losBlocked(tx,ty,team,naval))return false;
  const dx=x1-x0,dy=y1-y0;
  const sx=dx>0?1:-1,sy=dy>0?1:-1;
  const tdx=dx!==0?Math.abs(1/dx):Infinity,tdy=dy!==0?Math.abs(1/dy):Infinity;
  let mx=dx!==0?(sx>0?(tx+1-x0):(x0-tx))*tdx:Infinity;
  let my=dy!==0?(sy>0?(ty+1-y0):(y0-ty))*tdy:Infinity;
  let guard=0;
  while((tx!==ex||ty!==ey)&&guard++<64){
    if(Math.abs(mx-my)<1e-9){
      if(losBlocked(tx+sx,ty,team,naval)||losBlocked(tx,ty+sy,team,naval))return false;
      tx+=sx;ty+=sy;mx+=tdx;my+=tdy;
    }else if(mx<my){tx+=sx;mx+=tdx;}
    else{ty+=sy;my+=tdy;}
    if(losBlocked(tx,ty,team,naval))return false;
  }
  return true;
}
// clearance ~0.35 tiles: center line + two parallels offset ±0.3 perpendicular
function hasLOS(x0,y0,x1,y1,team,naval){
  if(!lineClear(x0,y0,x1,y1,team,naval))return false;
  const dx=x1-x0,dy=y1-y0,L=hyp(dx,dy);
  if(L<1e-6)return true;
  const px=-dy/L*.3,py=dx/L*.3;
  return lineClear(x0+px,y0+py,x1+px,y1+py,team,naval)
      && lineClear(x0-px,y0-py,x1-px,y1-py,team,naval);
}
// greedy string-pull, 12-waypoint look-ahead window; final waypoint always kept.
// Called only from inside findPath — every call site inherits it untouched.
function smoothPath(ox,oy,path,team,naval){
  if(!path||path.length<2)return path;
  const out=[];
  let ax=ox,ay=oy,i=-1;
  while(i<path.length-1){
    let far=i+1;
    const lim=Math.min(path.length-1,i+1+12);
    for(let j=i+2;j<=lim;j++){
      if(hasLOS(ax,ay,path[j].x,path[j].y,team,naval))far=j;
      else break;
    }
    out.push(path[far]);ax=path[far].x;ay=path[far].y;i=far;
  }
  return out;
}
// cosmetic: turn a stationary unit's heading toward its work/attack target
function slewHdg(u,tx,ty,dt){
  if(u.hdg===undefined)return;
  const want=dAtan2(ty-u.y,tx-u.x),t=motParams(u).turn*dt;
  const diff=wrapA(want-u.hdg);
  u.hdg=wrapA(u.hdg+Math.max(-t,Math.min(t,diff)));
}
// lateral-only shove perpendicular to the unit's OWN heading, away from the other
// unit; skipped in narrow passages; never enters a blocked tile
function latShove(u,dx,dy,mag){
  if(u.hdg===undefined)return;
  const tx=Math.floor(u.x),ty=Math.floor(u.y);
  if(!passable(tx+1,ty)||!passable(tx-1,ty)||!passable(tx,ty+1)||!passable(tx,ty-1))return;
  const px=-dSin(u.hdg),py=dCos(u.hdg);
  const side=(dx*px+dy*py)>=0?-1:1;
  const nx=u.x+px*side*mag,ny=u.y+py*side*mag;
  if(walkTile(nx,ny,u.p)){u.x=nx;u.y=ny;}
}
