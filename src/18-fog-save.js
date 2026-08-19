/* ================= fog of war ================= */
let fogDirty=true,lastTreeCount=0,grainPat=null,dirtPatches=[];
let cullX0=-1e9,cullX1=1e9,cullY0=-1e9,cullY1=1e9; // unit screen-cull bounds, set each draw()
let RIG_LOD=false; // true below z .7 — rigs drop micro-detail (faces, mail rings, fletching)
function updateFog(){
  const V=G.vis;
  for(let i=0;i<V.length;i++)if(V[i]===2)V[i]=1;
  const mark=(cx,cy,r)=>{const r2=r*r;
    const y0=Math.max(0,(cy-r)|0),y1=Math.min(MAP-1,(cy+r)|0);
    const x0=Math.max(0,(cx-r)|0),x1=Math.min(MAP-1,(cx+r)|0);
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const dx=x+.5-cx,dy=y+.5-cy;
      if(dx*dx+dy*dy<=r2)V[y*MAP+x]=2;}};
  const spy=hasUt(localP,'atheism'); // Huns: spies — see what your enemies see
  for(const u of G.units)if((allied(u.p,localP)||spy)&&u.p!==GAIA){
    // a herded sheep is a walking (short-sighted) scout — that's half the point of them
    let r=u.type==='scout'?9:isAnimal(u)?3:6;
    if(allied(u.p,localP)){
      if(u.type==='villager')r+=civOf(u.p).vilLos||0;
      if(u.type==='scout'&&teamHas(u.p,'scoutLos'))r+=2;      // Mongol TB
      if(u.type==='knight'&&teamHas(u.p,'knightLos'))r+=2;    // Frank TB
      if((u.type==='galley'||u.type==='longboat'||u.type==='turtle')
        &&teamHas(u.p,'galleyLos'))r+=3;                      // Japanese TB
      if(INF.has(u.type)&&ecoTier(u.p,'track'))r+=2;          // Tracking
    }
    mark(u.x,u.y,r);
  }
  for(const b of G.blds)if(allied(b.p,localP)&&b.built){const c=bldCenter(b);
    mark(c.x,c.y,(b.type==='tower'||b.type==='tc'?9:6)+2*ecoTier(b.p,'watch'));} // Town Watch/Patrol
  for(const b of G.blds)if(b.p!==localP&&!b.seen){const c=bldCenter(b);
    if(V[(c.y|0)*MAP+(c.x|0)]===2)b.seen=true;}
  fogDirty=true;
}
function tileVis(x,y){return G.vis[(y|0)*MAP+(x|0)]===2;}
function tileKnown(x,y){return G.vis[(y|0)*MAP+(x|0)]>0;}
/* ================= save / load ================= */
function saveGame(key){
  if(!G||G.over)return false;
  try{
    const strip=u=>{const o=Object.assign({},u);o.path=null;o._gar=null;o._garU=null;
      if(o.gar)o.gar=o.gar.map(g=>Object.assign({},g,{path:null,_gar:null,_garU:null}));
      return o;};
    // v2 adds ts (for autosave recency) + the post-game tallies. loadGame
    // migrates v1 saves forward — bump this ONLY alongside a migration path.
    const data={v:2,ts:Date.now(),
      pstats:G.pstats||null,tl:G.tl||null,tlT:G.tlT,ageAt:G.ageAt||null,
      t:G.t,mapSel,diffSel,turboSel,regicide:G.regicide||0,seed:gameSeed,uid,np:NP,mapN:MAP,starts:START,teams:G.teams,
      wonderT:G.wonderT||null,relicT:G.relicT||null,
      mission:mission?mission.id:null,
      P:G.P,ais:G.ais,relics:G.relics,groups:G.groups,stats:G.stats,cam:G.cam,
      units:G.units.map(strip),
      blds:G.blds.map(b=>Object.assign({},b,{gar:(b.gar||[]).map(strip)})),
      res:G.res,map:G.map,water:G.water,ford:G.ford,
      elev:Array.from(G.elev),vis:Array.from(G.vis)};
    localStorage.setItem(key||'tq_save',JSON.stringify(data));
    return true;
  }catch(e){return false;}
}
function loadGame(key){
  let data;
  try{data=JSON.parse(localStorage.getItem(key||'tq_save'));}catch(e){return false;}
  if(!data||(data.v!==1&&data.v!==2))return false;
  mapSel=data.mapSel;diffSel=data.diffSel;turboSel=data.turboSel||0;uid=data.uid||1;
  const savedRegicide=data.regicide||0;   // applied to G after the literal below
  seedSim(data.seed||1);
  NP=data.np||data.P.length||2;
  setMapSize(data.mapN||64);
  START=data.starts||genStarts(NP);
  mission=data.mission!=null?(MISSIONS.find(m=>m.id===data.mission)||null):null;
  G={t:data.t,over:false,paused:false,units:data.units,blds:data.blds,res:data.res,
     proj:[],fx:[],corpses:[],rubble:[],stuck:[],pings:[],
     wallMap:{},gateMap:{},wallA:null,pendLine:null,
     P:data.P,sel:[],placing:null,pend:null,amode:false,
     cam:data.cam||{x:0,y:0,z:1},
     ais:data.ais||[null,data.ai||{wave:0,nextAtk:data.t+60,tick:0,attacking:false}],
     teams:data.teams||Array.from({length:NP},(_,i)=>i),
     relics:data.relics||[],groups:data.groups||{},
     wonderT:data.wonderT||null,relicT:data.relicT||null,
     stats:data.stats,lastRaidToast:-99,
     map:data.map,water:data.water,ford:data.ford};
  G.regicide=savedRegicide;
  // v1 → v2 migration: older saves lack the summary tallies — default them
  G.pstats=data.pstats||Array.from({length:GAIA+1},()=>({tr:0,lost:0,kills:0,razed:0,blost:0,gath:0}));
  G.tl=data.tl||[];G.tlT=data.tlT===undefined?10:data.tlT;
  G.ageAt=data.ageAt||Array.from({length:GAIA+1},()=>[0,0,0,0]);
  G.elev=Uint8Array.from(data.elev);
  G.vis=Uint8Array.from(data.vis);G.visT=0;
  G.navBlock={};
  cmdQ=[];
  // Saves made before the wildlife existed stop at the last real player. Pad the
  // per-player arrays out to GAIA so nothing ever reads a hole.
  for(let q=G.P.length;q<=GAIA;q++)G.P[q]={f:0,w:0,g:0,age:0,ageT:0,aging:false,civ:0,
    uts:[],bs:{atk:0,arw:0,ia:0,aa:0,ca:0},pt:false,uni:{},eco:{},mon:{}};
  for(let q=0;q<=GAIA;q++){
    if(G.ais[q]===undefined)G.ais[q]=null;
    if(G.teams[q]==null)G.teams[q]=q===GAIA?99:50+q;
  }
  for(const b of G.blds){
    if(!b.gar)b.gar=[];
    if(BLDS[b.type].thin)G.wallMap[b.tx+','+b.ty]=b;
    if(BLDS[b.type].gate)G.gateMap[b.tx+','+b.ty]=b;
    if(b.type==='dock')for(let y=b.ty;y<b.ty+b.size;y++)for(let x=b.tx;x<b.tx+b.size;x++)
      G.navBlock[x+','+y]=1;
  }
  for(const st of G.P){ // pre-manual saves lack tech state
    if(!st.uts)st.uts=[];
    if(!st.bs)st.bs={atk:0,arw:0,ia:0,aa:0,ca:0};
    if(st.pt===undefined)st.pt=false;
    if(!st.uni)st.uni={};if(!st.eco)st.eco={};if(!st.mon)st.mon={};
  }
  // old saves lack motion state — default it (units + garrisoned units)
  const seedMot=u=>{if(u.hdg===undefined)u.hdg=Math.atan2(MAP/2-u.y,MAP/2-u.x);
    if(u.spd===undefined)u.spd=0;if(u.vx===undefined){u.vx=0;u.vy=0;}
    if(u.gaitPh===undefined)u.gaitPh=0;
    if(UNITS[u.type].garCap&&!u.gar)u.gar=[];};
  for(const u of G.units){seedMot(u);if(u.gar)for(const gu of u.gar)seedMot(gu);}
  for(const b of G.blds)if(b.gar)for(const gu of b.gar)seedMot(gu);
  miniResDirty=true;fogDirty=true;resVer++;resGen++;
  updateFog();refreshTerrain();clampCam();
  updateTop();refreshPanel();
  return true;
}
function updateContBtn(){
  const has=!!localStorage.getItem('tq_save');
  document.getElementById('contBtn').style.display=has?'block':'none';
  // the autosave is offered separately when it is NEWER than the manual save
  let auto=null,man=null;
  try{auto=JSON.parse(localStorage.getItem('tq_autosave')||'null');}catch(e){}
  try{man=JSON.parse(localStorage.getItem('tq_save')||'null');}catch(e){}
  const rec=document.getElementById('recoverBtn');
  if(rec)rec.style.display=(auto&&(!man||(auto.ts||0)>(man.ts||0)))?'block':'none';
}
/* Autosave the moment the app is backgrounded — phones kill hidden tabs, and
   a 40-minute empire should not die with the tab. Multiplayer skips it: a
   lockstep seat cannot be resumed from a local save (reconnect handles that). */
function autoSave(){
  if(G&&!G.over&&!netMode&&!REC.play)saveGame('tq_autosave');
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)autoSave();});
window.addEventListener('pagehide',autoSave);
/* ================= end / toast ================= */
function endGame(win){
  if(G.over)return;G.over=true;
  const wasNet=netMode;
  // Every peer reaches this on the same turn, so nobody is cut off mid-battle.
  if(netMode){netMode=false;netClose();}
  recFinish();
  snd(win?'win':'lose');buzz(win?[30,60,30]:60);
  const m=Math.floor(G.t/60),s=Math.floor(G.t%60);
  let sub=win?'The enemy Town Hall lies in ruins.':'Your Town Hall has fallen.';
  if(mission){
    if(win){
      const prog=+(localStorage.getItem('tq_camp')||0);
      if(mission.id+1>prog)localStorage.setItem('tq_camp',mission.id+1);
      sub='Mission complete: '+mission.name+
        (mission.id<MISSIONS.length-1?' — the next trial awaits!':' — the campaign is won!');
    }else sub='Mission failed: '+mission.name+'. Try again, my liege.';
  }
  if(REC.play)sub='Replay over — that is how the battle went.';
  document.getElementById('endTitle').textContent=REC.play?'Replay finished':win?'Victory!':'Defeat';
  document.getElementById('endTitle').className=win?'win':'lose';
  document.getElementById('endSub').textContent=sub;
  document.getElementById('endStats').innerHTML=
    'Battle length: <b>'+m+'m '+s+'s</b> · Age reached: <b>'+AGES[G.P[localP].age]+'</b><br>'+
    'Soldiers trained: <b>'+G.stats.trained+'</b> · Enemy buildings razed: <b>'+G.stats.razed+'</b>';
  drawEndSummary();
  // rematch makes no sense after a lockstep match ends the socket; replays of replays neither
  document.getElementById('rematchBtn').style.display=(wasNet||REC.play)?'none':'';
  document.getElementById('saveRepBtn').style.display=(REC.last&&!REC.play)?'':'none';
  document.getElementById('saveRepBtn').textContent='🎬  Save replay';
  profileRecord(win,wasNet);
  if(typeof tm==='function')tm('game_end',{win:win?1:0,dur:Math.round(G.t),age:G.P[localP].age});
  document.getElementById('endOverlay').style.display='flex';
}
/* Post-game summary: AoE2's beloved score graph plus the honest numbers.
   Everything here reads the deterministic tallies kept in G.pstats/G.tl. */
function drawEndSummary(){
  const cv=document.getElementById('endGraph'),tb=document.getElementById('endTable');
  if(!cv||!tb)return;
  const g2=cv.getContext('2d');
  g2.fillStyle='#1d1712';g2.fillRect(0,0,cv.width,cv.height);
  const tl=G.tl||[];
  if(tl.length>1){
    let max=10;for(const row of tl)for(let p=0;p<NP;p++)max=Math.max(max,row[p]||0);
    const W=cv.width-34,H=cv.height-24,X0=30,Y0=6;
    g2.strokeStyle='rgba(200,180,140,.25)';g2.lineWidth=1;
    g2.font='9px sans-serif';
    for(let i=0;i<=3;i++){
      const y=Y0+H-(H*i/3);
      g2.beginPath();g2.moveTo(X0,y);g2.lineTo(X0+W,y);g2.stroke();
      g2.fillStyle='#a08c60';g2.fillText(Math.round(max*i/3),2,y+3);
    }
    for(let p=0;p<NP;p++){
      g2.strokeStyle=TEAMS[p].trim||TEAMS[p].main;g2.lineWidth=p===localP?2.2:1.3;
      g2.beginPath();
      for(let i=0;i<tl.length;i++){
        const x=X0+W*i/(tl.length-1),y=Y0+H-(H*Math.min(1,(tl[i][p]||0)/max));
        if(i)g2.lineTo(x,y);else g2.moveTo(x,y);
      }
      g2.stroke();
    }
    const mins=Math.round((tl.length-1)*10/60);
    g2.fillStyle='#a08c60';g2.fillText('0m',X0,cv.height-3);
    g2.fillText(mins+'m',X0+W-18,cv.height-3);
    cv.style.display='';
  }else cv.style.display='none';
  const ps=G.pstats;
  if(!ps){tb.innerHTML='';return;}
  let html='<table><tr><th>Lord</th><th>Age</th><th>Kills</th><th>Lost</th><th>Razed</th><th>Gathered</th></tr>';
  for(let p=0;p<NP;p++){
    const who=netPlayers.find(pp=>pp.seat===p);
    const nm=(who?who.name+' — ':'')+CIVS[G.P[p].civ].name+(p===localP?' (You)':'');
    const at=G.ageAt?G.ageAt[p]:null;
    const ageStr=AGES[G.P[p].age].replace(' Age','')
      +(at&&G.P[p].age>0?' @'+Math.floor(at[G.P[p].age]/60)+'m':'');
    html+='<tr style="color:'+(TEAMS[p].trim||TEAMS[p].main)+'"><td>'+nm+'</td><td>'+ageStr
      +'</td><td>'+ps[p].kills+'</td><td>'+ps[p].lost+'</td><td>'+ps[p].razed
      +'</td><td>'+Math.round(ps[p].gath)+'</td></tr>';
  }
  tb.innerHTML=html+'</table>';
}
/* Lifetime profile — games, wins, favourite civ. Local, no account, no server. */
function profileRecord(win,wasNet){
  if(REC.play)return;                       // watching is not playing
  try{
    const pr=JSON.parse(localStorage.getItem('tq_profile')||'{}');
    pr.games=(pr.games||0)+1;
    if(win)pr.wins=(pr.wins||0)+1;
    pr.time=(pr.time||0)+Math.round(G.t);
    pr.byCiv=pr.byCiv||{};
    const cn=CIVS[G.P[localP].civ].name;
    pr.byCiv[cn]=pr.byCiv[cn]||{g:0,w:0};
    pr.byCiv[cn].g++;if(win)pr.byCiv[cn].w++;
    if(wasNet)pr.mp=(pr.mp||0)+1;
    localStorage.setItem('tq_profile',JSON.stringify(pr));
  }catch(e){}
}
let toastTimer=null;
function toast(msg){const t=document.getElementById('toast');
  t.textContent=msg;t.style.opacity=1;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.style.opacity=0,3200);}
// AoE2-style running event log, top-left over the map
const feedEl=document.getElementById('feed');
function feed(msg,warn){
  const d=document.createElement('div');
  d.className='fl'+(warn?' warn':'');d.textContent=msg;
  feedEl.appendChild(d);
  while(feedEl.children.length>7)feedEl.firstChild.remove();
  setTimeout(()=>{d.classList.add('out');setTimeout(()=>d.remove(),900);},8000);
}
const DIFF_NAMES=['Squire','Knight','Warlord'];
const clockEl=document.getElementById('clock'),armyEl=document.getElementById('army'),scoreEl=document.getElementById('score');
let ovT=-1;
function updateOverlays(){ // throttled: writes at most once per game-second
  if(!G)return;
  const t=G.t|0;if(t===ovT)return;ovT=t;
  const hh=('0'+(t/3600|0)).slice(-2),mm=('0'+((t/60|0)%60)).slice(-2),ss=('0'+t%60).slice(-2);
  clockEl.textContent=hh+':'+mm+':'+ss+' ('+(mission?mission.name:DIFF_NAMES[diffSel])+')';
  updateArmyCounts();
  updateScores();
  updateIdleBtn();
  updateChatBtn();
  TUT.tick();
  COACH.tick();
}
function updateArmyCounts(){
  let cav=0,rng=0,inf=0,sg=0;
  for(const u of G.units){
    if(u.p!==localP||u.hp<=0||u.type==='villager'||isAnimal(u))continue;
    const d=UNITS[u.type];
    if(d.ram)sg++;else if(d.cav)cav++;else if(d.ranged)rng++;else if(!d.monk)inf++;
  }
  armyEl.textContent=(cav+sg+rng+inf)?
    'Cavalry: '+cav+'\nSiege Units: '+sg+'\nRanged Units: '+rng+'\nInfantry: '+inf:'';
}
function updateScores(){
  const cv=c=>(c.f||0)+(c.w||0)+(c.g||0);
  let html='';
  const cap=innerWidth<560&&NP>5?5:NP; // phones: don't stack 8 lines over the zoom buttons
  // your own line is never the one that gets cut, whatever seat you're in
  const rows=[];
  for(let p=0;p<NP&&rows.length<cap;p++)if(p!==localP)rows.push(p);
  if(rows.length>=cap)rows.pop();
  rows.unshift(localP);
  for(const p of rows){
    let s=Math.floor(G.P[p].f+G.P[p].w+G.P[p].g);
    for(const u of G.units)if(u.p===p&&u.hp>0)s+=cv(UNITS[u.type].cost);
    for(const b of G.blds)if(b.p===p&&b.built)s+=cv(BLDS[b.type].cost);
    const dead=!G.blds.some(b=>b.p===p&&b.type==='tc');
    html+='<div style="color:'+TEAMS[p].trim+(dead?';opacity:.45':'')+'">'
      +CIVS[G.P[p].civ].name+(p===localP?' (You)':'')+' '+s
      +' ('+AGES[G.P[p].age].replace(' Age','')+')</div>';
  }
  if(rows.length<NP)html+='<div style="color:#c9b587">+'+(NP-rows.length)+' more</div>';
  scoreEl.innerHTML=html;
}
