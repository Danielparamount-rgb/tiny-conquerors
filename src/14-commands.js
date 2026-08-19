/* ================= commands ================= */
function cmdMove(u,tx,ty){u.state='move';u.target=null;u.resKey=null;u.farm=null;u.am=null;
  u.wq=null;u.pat=null; // a fresh order wipes queued waypoints and any patrol beat
  u.setup=null; // a moving trebuchet packs its arm away
  u.path=uPath(u,tx,ty,u.p)||[];}
function cmdAmove(u,tx,ty){
  if(u.type==='villager'||UNITS[u.type].monk)return cmdMove(u,tx,ty);
  u.state='amove';u.am={x:tx,y:ty};u.target=null;u.resKey=null;u.farm=null;u.scanT=0;
  u.wq=null;u.pat=null;
  u.path=uPath(u,tx,ty,u.p)||[];}
function cmdGarrison(u,b){
  if(u.type==='ram')return;
  u.state='toGar';u.garB=b.id;u.target=null;u.resKey=null;u.farm=null;u.am=null;
  const c=bldCenter(b);u.path=uPath(u,c.x,c.y,u.p)||[];}
function cmdGarrisonRam(u,carrier){ // infantry ride rams; anyone boards transports
  if(UNITS[u.type].ship)return;
  if(carrier.type==='ram'&&!INF.has(u.type))return;
  u.state='toGarU';u.garU=carrier.id;u.target=null;u.resKey=null;u.farm=null;u.am=null;
  u.path=uPath(u,carrier.x,carrier.y,u.p)||[];}
function groupDest(n,i,tx,ty,f){
  // spread a group into a formation instead of stacking on one tile.
  // f: 0 box (default — the original grid), 1 line abreast, 2 loose, 3 column.
  // The formation id travels IN the command so every lockstep peer spreads
  // the same group the same way.
  if(n===1)return[tx,ty];
  f=f|0;
  let cols,sp=1.4;
  if(f===1){cols=Math.min(n,10);sp=1.15;}
  else if(f===2){cols=Math.ceil(Math.sqrt(n));sp=2.4;}
  else if(f===3){cols=2;sp=1.15;}
  else cols=Math.ceil(Math.sqrt(n));
  const rows=Math.ceil(n/cols);
  let x=Math.round(tx+((i%cols)-(cols-1)/2)*sp);
  let y=Math.round(ty+(Math.floor(i/cols)-(rows-1)/2)*sp);
  x=Math.max(0,Math.min(MAP-1,x));y=Math.max(0,Math.min(MAP-1,y));
  if(!passable(x,y)){const a=nearFree(x,y,3);if(a){x=a.x;y=a.y;}else{x=tx;y=ty;}}
  return[x,y];}
function cmdGather(u,resKey){
  const r=G.res[resKey],fisher=UNITS[u.type].fisher;
  if(u.type!=='villager'&&!fisher)return cmdMove(u,r.x,r.y);
  if(!!fisher!==(r.type==='fish'))return cmdMove(u,r.x,r.y); // ships fish; villagers don't
  u.state='toRes';u.resKey=resKey;u.farm=null;
  u.path=uPath(u,r.x,r.y,u.p)||[];}
function cmdFarm(u,b){if(u.type!=='villager')return;
  u.state='toFarm';u.farm=b.id;u.resKey=null;
  const c=bldCenter(b);u.path=uPath(u,c.x,c.y,u.p)||[];}
/* ---- conversion (manual pp. 12, 48) ---- */
function convRange(p){return 5+2*ecoTier(p,'bp');} // Block Printing reaches further
function monkReady(u){return u.faithReady===undefined||G.t>=u.faithReady;}
function canConvert(u,ent,isBld){
  if(!UNITS[u.type].monk)return false;
  if(!isBld&&isAnimal(ent))return false; // no sermon moves a boar
  if(isBld)return !!ecoTier(u.p,'red')
    &&!['tc','castle','wall','gate','swall','sgate','farm','monastery','wonder'].includes(ent.type);
  const td=UNITS[ent.type];
  if(td.monk&&!ecoTier(u.p,'aton'))return false;      // Atonement: convert monks
  if((td.siege||td.ram)&&!ecoTier(u.p,'red'))return false; // Redemption: convert siege
  return true;
}
function convTimeFor(u,tgt,isBld){
  let T=isBld?8:5;
  if(!isBld){
    if(tgt.type==='scout')T*=1.5;                    // the scout line resists (manual)
    if(ecoTier(tgt.p,'faith'))T*=1.5;                // Faith
    if(teamHas(tgt.p,'convResist'))T*=1.6;           // Teuton team bonus
  }
  return T;
}
function finishConvert(u,t,isBld){
  u.faithReady=G.t+(ecoTier(u.p,'illum')?15:30);     // the monk must rest his voice
  const c=isBld?bldCenter(t):t;
  if(!isBld&&ecoTier(t.p,'her')){                    // Heresy: death before betrayal
    t.hp=0;
    if(t.p===localP)feed('Your soldier chose death over conversion',true);
  }else if(isBld){
    ejectGarrison(t);                                // the old garrison flees its post
    t.queue=[];t.qt=0;
    if(t.p===localP)feed('Warning! Your '+BLDS[t.type].name+' has been converted!',true);
    t.p=u.p;
    if(u.p===localP)feed(BLDS[t.type].name+' converted!');
  }else{
    if(t.p===localP)feed('Warning! A monk has converted your '+unitName(t.type,t.p)+'!',true);
    t.p=u.p;t.state='idle';t.path=null;t.target=null;t.resKey=null;t.farm=null;
    t.am=null;t.wave=null;t.relic=null;
    if(u.p===localP)feed(unitName(t.type,t.p)+' converted!');
  }
  for(let i=0;i<7;i++)G.fx.push({x:c.x+(Math.random()-.5),y:c.y-.4-Math.random(),
    vx:(Math.random()-.5)*.6,vy:-.7-Math.random()*.5,life:.7,max:.7,r:1.6,kind:'chip',col:'#f0e29a'});
  if(tileVis(c.x,c.y))snd('convert',c.x,c.y);
}
function cmdConvert(u,ent,isBld){
  u.state='toConv';u.target={id:ent.id,bld:isBld};u.convT=0;
  const c=isBld?bldCenter(ent):ent;u.path=uPath(u,c.x,c.y,u.p)||[];
}
function cmdAttack(u,ent,isBld){
  if(UNITS[u.type].monk){
    if(canConvert(u,ent,isBld)&&monkReady(u))return cmdConvert(u,ent,isBld);
    return cmdMove(u,isBld?ent.tx:ent.x,isBld?ent.ty:ent.y);
  }
  if(UNITS[u.type].passive)return cmdMove(u,isBld?ent.tx:ent.x,isBld?ent.ty:ent.y);
  if(u.type==='ram'&&!isBld)return cmdMove(u,ent.x,ent.y);
  u.state='attack';u.target={id:ent.id,bld:isBld};u.am=null;
  const c=isBld?bldCenter(ent):ent;u.path=uPath(u,c.x,c.y,u.p)||[];}
function cmdBuild(u,b){if(u.type!=='villager')return;
  u.state='toBuild';u.target={id:b.id,bld:true};
  const c=bldCenter(b);u.path=uPath(u,c.x,c.y,u.p)||[];}
/* ================= command layer (multiplayer step 2) =================
   Everything a HUMAN does is now expressed as a small serializable record —
   {k:kind, p:player, plus ids and numbers, never object references} — and
   pushed onto a queue instead of mutating G at the point of the tap. One
   chokepoint, one place where a match can intercept player intent.

   Solo play drains the queue the instant a command is issued, so behaviour and
   input latency are exactly what they were. A lockstep match will instead hold
   the queue, ship it to the peers, and call applyTick() once every peer's
   commands for that tick have arrived — the sim below needs no further change.

   The AI deliberately does NOT come through here. Under lockstep every peer
   runs the same deterministic aiThink() over the same state and reproduces the
   AI's orders locally; sending them would apply every decision twice.

   Handlers re-validate everything — ownership, cost, age, placement. The UI's
   own checks exist only to grey out buttons and explain refusals; a command
   arriving over a wire is never trusted. */
let netMode=false;   // true once a lockstep match owns the clock (localP is declared up with the state)
let cmdQ=[];         // commands issued this turn, not yet applied
// Put the seat back to solo. Every path that starts a NON-network game calls
// this, so a match that ended (or failed) can never leave the next skirmish
// believing it is player 3 of a room that no longer exists.
function resetNet(){
  netMode=false;localP=0;humanSlots=[0];netCivs=null;netTeams=null;cmdQ=[];
  netSendFrom=0;netReplay=null;netReplaying=false;
  try{dailyRun=null;}catch(e){}  // a fresh start is not the daily unless the daily button says so
}
function issue(k,d){
  if(REC.play)return null;      // a replay is watched, not commanded
  const c=Object.assign({k,p:localP},d);
  cmdQ.push(c);
  if(!netMode)drainCmds();      // solo: no round trip, apply at once
  return c;
}
function drainCmds(){
  // In a match the queue is not ours to apply — it is shipped to the peers and
  // comes back scheduled onto an agreed turn. Applying it here as well would
  // execute every local order twice, and only on this machine.
  if(netMode||!cmdQ.length)return;
  const q=cmdQ;cmdQ=[];
  for(const c of q){
    // replay recorder: every solo order, stamped with the tick it landed on.
    // Same determinism multiplayer rests on — seed + orders = the whole match.
    if(REC.rec&&!REC.play)REC.rec.cmds.push([Math.round(G.t/.05),c]);
    applyCmd(c);
  }
}
/* ================= replays ==================================================
   A replay is the match seed + settings + the tick-stamped command stream —
   the exact trick the multiplayer reconnect already uses (the relay journals
   commands and rebuilds the match by replaying them). Solo games record
   automatically; "Save replay" on the end screen keeps the last one. */
let REC={rec:null,play:null,idx:0,speed:1,last:null};
function recBegin(){
  if(netMode||REC.play){REC.rec=null;return;}
  REC.rec={v:1,seed:gameSeed,cmds:[],
    cfg:{m:mapSel,d:diffSel,tb:turboSel,t:teamSel,n:playersSel,c:civSel,
         rg:regicideSel,mi:mission?mission.id:null}};
}
function recFinish(){
  if(!REC.rec||REC.play)return;
  REC.rec.endT=Math.round(G.t);
  REC.last=REC.rec;REC.rec=null;
}
function replayList(){
  try{return JSON.parse(localStorage.getItem('tq_replays')||'[]');}catch(e){return[];}
}
function replaySave(r){
  if(!r)return false;
  try{
    const list=replayList();
    const d=new Date();
    r.name=(d.getMonth()+1)+'/'+d.getDate()+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)
      +' — '+CIVS[r.cfg.c].name+', '+MAPS[r.cfg.m].name+', '
      +Math.floor((r.endT||0)/60)+'m';
    list.unshift(r);
    while(list.length>6)list.pop();          // keep the six most recent
    localStorage.setItem('tq_replays',JSON.stringify(list));
    return true;
  }catch(e){return false;}                   // quota — an old long replay can blow it
}
function playReplay(r){
  resetNet();
  REC.rec=null;REC.play=r;REC.idx=0;REC.speed=1;
  mission=r.cfg.mi!=null?(MISSIONS.find(m=>m.id===r.cfg.mi)||null):null;
  mapSel=r.cfg.m;diffSel=r.cfg.d;turboSel=r.cfg.tb;teamSel=r.cfg.t;
  playersSel=r.cfg.n;civSel=r.cfg.c;regicideSel=r.cfg.rg;
  pendingSeed=r.seed>>>0;
  document.getElementById('startOverlay').style.display='none';
  document.getElementById('replayOverlay').style.display='none';
  initAudio();if(AC&&AC.state==='suspended')AC.resume();
  begin();
  const rb=document.getElementById('repBar');if(rb)rb.style.display='flex';
  toast('Replay — watching a recorded battle');
}
function exitReplay(){
  REC.play=null;REC.idx=0;
  const rb=document.getElementById('repBar');if(rb)rb.style.display='none';
  if(G)G.over=true;
  document.getElementById('endOverlay').style.display='none';
  document.getElementById('startOverlay').style.display='flex';
  updateContBtn();
}
function takeCmds(){const q=cmdQ;cmdQ=[];return q;}
function applyCmd(c){const h=CMDS[c.k];if(h)h(c);}
// Lockstep entry point: one command array per player, applied in player order.
// Deliberately NOT a sort — Array.sort's tie-breaking is one more thing two
// machines could quietly disagree about.
function applyTick(perPlayer){
  for(let p=0;p<perPlayer.length;p++){
    const q=perPlayer[p];if(!q)continue;
    for(const c of q){c.p=p;applyCmd(c);}
  }
}
/* A command names unit ids; the units are resolved here, at APPLY time, by
   walking G.units. Walking the sim's own array (rather than the id list, which
   carries the local selection's order) means every peer visits them in the
   same order. */
function cmdUnits(c){
  if(!c.u||!c.u.length)return[];
  const want=new Set(c.u),out=[];
  for(const u of G.units)if(u.p===c.p&&u.hp>0&&want.has(u.id))out.push(u);
  return out;
}
function cmdBld(c,id){
  const b=G.blds.find(x=>x.id===(id===undefined?c.id:id));
  return b&&b.p===c.p&&b.hp>0?b:null;
}
const CMDS={
  move(c){const us=cmdUnits(c),n=us.length;
    // cohesion: the whole formation marches at its slowest member's pace
    let gs=null;
    if(n>1){gs=1e9;for(const u of us)gs=Math.min(gs,speedOf(u));}
    for(let i=0;i<n;i++){const u=us[i],d=groupDest(n,i,c.x,c.y,c.f);
      // shift-queue: append a waypoint to a unit already walking a route
      if(c.sh&&(u.state==='move'||(u.wq&&u.wq.length))){
        if(!u.wq)u.wq=[];
        if(u.wq.length<12)u.wq.push([d[0],d[1]]);
      }else{cmdMove(u,d[0],d[1]);u.formSpd=gs;}}},
  amove(c){const us=cmdUnits(c),n=us.length;
    let gs=null;
    if(n>1){gs=1e9;for(const u of us)gs=Math.min(gs,speedOf(u));}
    for(let i=0;i<n;i++){const d=groupDest(n,i,c.x,c.y,c.f);
      cmdAmove(us[i],d[0],d[1]);us[i].formSpd=gs;}},
  stop(c){for(const u of cmdUnits(c)){u.state='idle';u.path=null;u.target=null;
    u.resKey=null;u.farm=null;u.am=null;u.wq=null;u.pat=null;u.spd=0;u.vx=0;u.vy=0;}},
  attack(c){
    const t=c.bld?G.blds.find(b=>b.id===c.id):G.units.find(u=>u.id===c.id);
    // your own flock is a legitimate target — that is what a sheep is FOR
    if(!t||t.hp<=0||(allied(t.p,c.p)&&!isAnimal(t)))return;
    for(const u of cmdUnits(c)){cmdAttack(u,t,!!c.bld);u.autoTgt=0;u.pat=null;u.wq=null;}},
  gather(c){if(!G.res[c.key])return;for(const u of cmdUnits(c))cmdGather(u,c.key);},
  farm(c){const b=cmdBld(c);if(!b||b.type!=='farm'||!b.built)return;
    for(const u of cmdUnits(c))cmdFarm(u,b);},
  build(c){const b=cmdBld(c);if(!b||b.built)return;
    for(const u of cmdUnits(c))cmdBuild(u,b);},
  gar(c){const b=cmdBld(c);if(!b||!b.built||!BLDS[b.type].garCap)return;
    let room=bldGarCap(b)-b.gar.length-G.units.filter(u=>u.garB===b.id&&u.hp>0).length;
    for(const u of cmdUnits(c)){
      if(room<=0)break;
      if(u.type==='ram')continue;
      cmdGarrison(u,b);room--;}},
  garU(c){
    const cr=G.units.find(u=>u.id===c.id&&u.hp>0);
    if(!cr||cr.p!==c.p||!UNITS[cr.type].garCap)return;
    const isRam=cr.type==='ram';
    let room=UNITS[cr.type].garCap-(cr.gar?cr.gar.length:0);
    for(const u of cmdUnits(c)){
      if(room<=0)break;
      if(u.id===cr.id||UNITS[u.type].ship)continue;
      if(isRam&&!INF.has(u.type))continue;   // only infantry ride rams
      cmdGarrisonRam(u,cr);room--;}},
  ungar(c){const b=cmdBld(c);if(!b)return;
    if(ejectGarrison(b)&&c.p===localP){snd('click');refreshPanel();}},
  unload(c){
    const u0=G.units.find(u=>u.id===c.id&&u.hp>0&&u.p===c.p);
    if(!u0||!u0.gar||!u0.gar.length)return;
    const ud=UNITS[u0.type];
    const shore=ud.ship?nearFree(Math.floor(u0.x),Math.floor(u0.y),4):null;
    if(ud.ship&&!shore)return;               // nowhere to set them down
    let n=0;
    for(const gu of u0.gar){
      if(shore){gu.x=shore.x+.5+(n%2)*.4;gu.y=shore.y+.5+((n/2)|0)*.4;}
      else{gu.x=u0.x+(SR()-.5);gu.y=u0.y+(SR()-.5);}
      gu.state='idle';gu.path=null;gu.target=null;gu.spd=0;gu.vx=0;gu.vy=0;
      G.units.push(gu);n++;}
    u0.gar=[];
    if(c.p===localP){snd('click');refreshPanel();}},
  relic(c){
    const r=G.relics.find(x=>x.id===c.rid);
    if(!r||r.held||r.mon)return;
    const m=cmdUnits(c).find(u=>UNITS[u.type].monk&&!UNITS[u.type].noRelic);
    if(!m)return;
    m.state='toRelic';m.relicT=r.id;m.target=null;m.path=uPath(m,r.x,r.y)||[];},
  enshrine(c){
    const b=cmdBld(c);if(!b||!b.built||b.type!=='monastery')return;
    const cc=bldCenter(b);
    for(const m of cmdUnits(c))if(m.relic){
      m.state='toMon';m.monB=b.id;m.path=uPath(m,cc.x,cc.y)||[];}},
  place(c){
    if(!BLDS[c.t]||!canPlaceType(c.t,c.tx,c.ty))return;
    const bc=bldCostOf(c.p,c.t);
    if(!canAfford(c.p,bc))return;
    pay(c.p,bc);
    const b=addBld(c.p,c.t,c.tx,c.ty,false);b.pendCost=bc;
    for(const v of cmdUnits(c))if(v.type==='villager')cmdBuild(v,b);
    if(c.p===localP){snd('place');updateTop();refreshPanel();}},
  placeLine(c){
    if(!BLDS[c.t])return;
    let built=0,first=null;
    for(const s of c.tiles){
      if(!canPlaceType(c.t,s[0],s[1]))continue;
      const bc=bldCostOf(c.p,c.t);
      if(!canAfford(c.p,bc))break;           // out of wood — keep what was laid
      pay(c.p,bc);
      const b=addBld(c.p,c.t,s[0],s[1],false);b.pendCost=bc;built++;
      if(!first)first=b;}
    if(first)for(const v of cmdUnits(c))if(v.type==='villager')cmdBuild(v,first);
    if(built&&c.p===localP){snd('place');updateTop();refreshPanel();}},
  train(c){
    const b=cmdBld(c);if(!b||!b.built)return;
    if(!trainsFor(b,c.p).includes(c.ut))return;  // tech-tree gate
    const d=UNITS[c.ut];if(!d)return;
    if(d.age!==undefined&&G.P[c.p].age<d.age)return;
    const uc=unitCostOf(c.p,c.ut);
    if(!canAfford(c.p,uc)||popUsed(c.p)>=popCap(c.p))return;
    pay(c.p,uc);b.queue.push(c.ut);
    if(c.p===localP){updateTop();refreshPanel();}},
  age(c){
    const b=cmdBld(c);if(!b||b.type!=='tc'||!b.built)return;
    const st=G.P[c.p];
    if(st.age>=3||st.aging)return;
    const nc=ageCostOf(c.p,st.age+1);
    if(!canAfford(c.p,nc))return;
    pay(c.p,nc);st.aging=true;b.queue.push('AGE');
    if(c.p===localP){updateTop();refreshPanel();}},
  tech(c){
    const p=c.p,st=G.P[p];
    if(c.kind==='bs'){
      const bs=bsOf(p),tier=bs[c.id];
      if(tier===undefined||tier>=3)return;
      const T=BS_TECHS[c.id],cost=T.costs[tier];
      if(st.age<tier+1||!canAfford(p,cost))return;
      pay(p,cost);bs[c.id]++;
      if(p===localP){snd('done');feed(T.names[tier]+' — researched');updateTop();refreshPanel();}
    }else if(c.kind==='uni'){
      const T=UNI_TECHS[c.id],un=uniOf(p);
      if(!T||un[c.id]||(T.req&&!un[T.req]))return;
      if(st.age<T.age||!canAfford(p,T.cost))return;
      pay(p,T.cost);un[c.id]=1;applyUni(p,c.id);
    }else if(c.kind==='eco'){
      const T=ECO_TECHS[c.id];if(!T)return;
      const tier=ecoTier(p,c.id);
      if(tier>=ecoMax(c.id))return;
      const cost=T.costs?T.costs[tier]:T.cost,needAge=T.ages?T.ages[tier]:T.age;
      if(st.age<needAge||!canAfford(p,cost))return;
      pay(p,cost);ecoOf(p)[c.id]=tier+1;applyEco(p,c.id);
      if(p===localP)feed((T.names?T.names[tier]:T.name)+' — researched');
    }else if(c.kind==='ut'){
      const T=UTECHS[c.id];
      if(!T||hasUt(p,c.id)||nextUtFor(p)!==c.id)return;
      if(st.age<T.age||!canAfford(p,T.cost))return;
      pay(p,T.cost);st.uts.push(c.id);applyUt(p,c.id);
      if(p===localP)updateTop();
    }else if(c.kind==='pt'){
      const cost={f:200,g:250};
      if(st.pt||st.age<3||!canAfford(p,cost))return;
      pay(p,cost);st.pt=true;
      if(p===localP){snd('done');feed('Parthian Tactics — researched');updateTop();refreshPanel();}
    }},
  trade(c){
    const p=c.p;
    if(!G.blds.some(b=>b.p===p&&b.type==='market'&&b.built))return;
    if(c.give===c.get||!'fwg'.includes(c.give)||!'fwg'.includes(c.get))return;
    const sar=civOf(p).mktRate;              // Saracens trade at a 5% fee
    const giveN=c.give==='g'?(sar?105:80):100;
    const getN=c.give==='g'?100:(sar?95:70);
    if(G.P[p][c.give]<giveN)return;
    G.P[p][c.give]-=giveN;G.P[p][c.get]+=getN;
    if(p===localP){snd('done');updateTop();refreshPanel();}},
  fishtrap(c){
    const b=cmdBld(c);if(!b||b.type!=='dock'||!b.built)return;
    const cost={w:100};if(!canAfford(c.p,cost))return;
    let spot=null;
    for(let r=2;r<7&&!spot;r++)for(let dy=-r;dy<=r&&!spot;dy++)for(let dx=-r;dx<=r&&!spot;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
      const x=b.tx+dx,y=b.ty+dy,k=x+','+y;
      if(x<1||y<1||x>=MAP-1||y>=MAP-1)continue;
      if(G.water[k]&&!G.res[k]&&!(G.navBlock&&G.navBlock[k]))spot={x,y,k};}
    if(!spot)return;
    pay(c.p,cost);
    G.res[spot.k]={type:'fish',x:spot.x,y:spot.y,amt:250};
    miniResDirty=true;resVer++;
    for(const sh of G.units)                 // an idle fishing boat steams straight to it
      if(sh.p===c.p&&UNITS[sh.type].fisher&&sh.hp>0&&sh.state==='idle'){cmdGather(sh,spot.k);break;}
    if(c.p===localP){snd('place');updateTop();feed('Fish Trap set');}},
  del(c){
    for(const id of (c.ids||[])){
      const u=G.units.find(x=>x.id===id);
      if(u&&u.p===c.p){u.hp=0;continue;}
      const b=G.blds.find(x=>x.id===id);
      if(b&&b.p===c.p&&b.type!=='tc')b.hp=0;}},
  /* Rally point on a production building. New units walk (or gather/farm) to
     it the moment they step out of the door. Lives on the building record, so
     it serializes with saves; set only through this handler, so lockstep peers
     always agree on it. */
  rally(c){
    const b=cmdBld(c);if(!b||!b.built)return;
    if(!trainsFor(b,c.p).length)return;
    if(c.off){b.rally=null;if(b.p===localP)toast('Rally point cleared');return;}
    if(!(c.x>=0&&c.y>=0&&c.x<MAP&&c.y<MAP))return;
    // NB the resource key travels as c.rk — c.k is the command KIND (issue()
    // stamps it), and a field called k here would overwrite it in transit.
    b.rally={x:c.x,y:c.y,k:(c.rk&&G.res[c.rk])?c.rk:null,fid:c.fid||null};
    if(b.p===localP){snd('click');toast(b.rally.k?'Rally point set — new villagers will gather there'
      :b.rally.fid?'Rally point set — new villagers will work that farm':'Rally point set');}},
  /* Unit stances: 0 aggressive (default — exactly the old behaviour),
     1 defensive (short leash, returns to post), 2 stand ground, 3 no attack. */
  stance(c){
    const s=c.s|0;if(s<0||s>3)return;
    for(const u of cmdUnits(c)){
      if(u.type==='villager'||isAnimal(u))continue;
      u.stance=s;u.post=null;
      if(s===3&&u.state==='attack'&&u.autoTgt){u.state='idle';u.target=null;u.path=null;}
    }
    if(c.p===localP)refreshPanel();},
  /* Patrol between where the unit stands and the tapped point, engaging
     whatever it meets (the attack case resumes the beat when the target
     dies, exactly like attack-move does). */
  patrol(c){
    const us=cmdUnits(c),n=us.length;
    for(let i=0;i<n;i++){const u=us[i];
      if(UNITS[u.type].passive||isAnimal(u))continue;
      const d=groupDest(n,i,c.x,c.y,c.f);
      u.pat={ax:Math.round(u.x),ay:Math.round(u.y),bx:d[0],by:d[1],leg:1};
      u.state='patrol';u.target=null;u.resKey=null;u.farm=null;u.am=null;u.setup=null;u.scanT=0;
      u.path=uPath(u,d[0],d[1],u.p)||[];}},
  /* Tribute: send 100 of a resource to another lord for a 25% carrying fee
     (the manual's default rate). Needs a Market — that is who moves the goods. */
  tribute(c){
    const p=c.p,to=c.to|0;
    if(to===p||to<0||to>=NP||!G.P[to])return;
    if(!G.blds.some(b=>b.p===p&&b.type==='market'&&b.built))return;
    if(!'fwg'.includes(c.give))return;
    const need=125;                    // 100 delivered + 25 fee
    if(G.P[p][c.give]<need)return;
    G.P[p][c.give]-=need;G.P[to][c.give]+=100;
    const RN={f:'food',w:'wood',g:'gold'};
    if(p===localP){snd('done');updateTop();feed('Tribute sent — 100 '+RN[c.give]);}
    if(to===localP){snd('done');updateTop();
      const who=netPlayers.find(pp=>pp.seat===p);
      feed((who?who.name:CIVS[G.P[p].civ].name)+' sends you 100 '+RN[c.give]);}},
  /* Map ping — travels through the command layer so allies on other machines
     see it too. Drawn only for the sender's team. */
  ping(c){
    if(!(c.x>=0&&c.y>=0&&c.x<MAP&&c.y<MAP))return;
    const pgs=G.pings||(G.pings=[]);
    pgs.push({x:c.x,y:c.y,t:G.t,p:c.p});if(pgs.length>6)pgs.shift();
    if(allied(c.p,localP)&&c.p!==localP){
      const who=netPlayers.find(pp=>pp.seat===c.p);
      feed((who?who.name:CIVS[G.P[c.p].civ].name)+' pings the map');snd('sel');}},
  /* Quick chat: a taunt id, not free text — nothing to type on a phone and
     nothing to moderate. Rides the same lockstep pipe as every other order. */
  taunt(c){
    const n=c.n|0;if(n<0||n>=TAUNTS.length)return;
    const who=netPlayers.find(pp=>pp.seat===c.p);
    feed((who?who.name:CIVS[G.P[c.p].civ].name)+': '+TAUNTS[n]);
    if(c.p!==localP)snd('sel');},
};
const TAUNTS=['Yes','No','Attack now!','Defend the base!','I need food','I need wood',
  'I need gold','Building a Wonder','Well played!','Help me!','On my way','Wait for my signal'];
