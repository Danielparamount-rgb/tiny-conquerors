/* ================= economy helpers ================= */
function canAfford(p,cost){return(!cost.f||G.P[p].f>=cost.f)&&(!cost.w||G.P[p].w>=cost.w)&&(!cost.g||G.P[p].g>=cost.g);}
function pay(p,cost){G.P[p].f-=cost.f||0;G.P[p].w-=cost.w||0;G.P[p].g-=cost.g||0;}
function refund(p,cost){G.P[p].f+=cost.f||0;G.P[p].w+=cost.w||0;G.P[p].g+=cost.g||0;}
function popUsed(p){return G.units.filter(u=>u.p===p&&u.hp>0&&!isAnimal(u)) // livestock isn't a subject
    .reduce((s,u)=>s+1+(u.gar?u.gar.length:0),0)+ // ram passengers count too
  G.blds.filter(b=>b.p===p).reduce((s,b)=>s+b.queue.length+(b.gar?b.gar.length:0),0);}
function bldGarCap(b){const cap=BLDS[b.type].garCap||0;
  return b.type==='tower'?cap*(civOf(b.p).towerGar||1):cap;} // Teutons: double tower garrison
function popCap(p){
  const cv=civOf(p);
  const bonus=(cv.popBonus&&G.P[p].age>=3)?cv.popBonus:0; // Goths: +10 pop in Imperial
  if(cv.noHouse)return POP_MAX+bonus;                     // Huns need no Houses
  return Math.min(POP_MAX+bonus,G.blds.filter(b=>b.p===p&&b.built)
    .reduce((s,b)=>s+(b.type==='tc'?10:(BLDS[b.type].pop||0)),0));}
/* manual-derived cost adjustments (civ discounts) */
function unitCostOf(p,type){
  const cv=civOf(p),base=UNITS[type].cost,d=UNITS[type];let m=1;
  if(INF.has(type)&&cv.infCost&&G.P[p].age>=(cv.infCostAge||0))m=cv.infCost; // Goths: from Feudal (1.0B)
  if(cv.archCost&&(type==='archer'||type==='skirmisher'||type==='plumed'))m=cv.archCost;
  if(cv.counterCost&&(type==='spearman'||type==='skirmisher'))m=cv.counterCost;
  if(cv.shipCost&&d.ship&&!d.passive)m=cv.shipCost; // Vikings: warships -20%
  const shipw=d.ship&&ecoTier(p,'shipw');           // Shipwright: -20% ship wood
  if(m===1&&!shipw)return base;
  const c={};for(const k in base)c[k]=Math.round(base[k]*m);
  if(shipw&&c.w)c.w=Math.round(c.w*.8);
  return c;
}
function bldCostOf(p,type){
  const cv=civOf(p),base=BLDS[type].cost;let m=1;
  if(type==='castle'&&cv.castleCost)m=cv.castleCost;
  if(type==='tower'&&cv.towerCost)m=cv.towerCost;
  if(type==='camp'&&cv.campCost)m=cv.campCost;
  if(BLDS[type].thin&&teamHas(p,'wallCheap'))m*=.5;   // Mayan team bonus
  if(type==='dock'&&teamHas(p,'dockCheap'))m*=.75;    // Viking team bonus
  if(m===1)return base;
  const c={};for(const k in base)c[k]=Math.round(base[k]*m);return c;
}
function ageCostOf(p,age){
  const cv=civOf(p),base=AGE_COST[age];if(!base)return base;let m=1;
  if(cv.techDisc)m=cv.techDisc[age];              // Chinese: ages cost less
  if(age===3&&cv.impDisc)m=cv.impDisc;            // Byzantines: cheap Imperial
  if(turboSel===2)m*=.6;                          // Blitz: ages come cheap and fast
  if(m===1)return base;
  const c={};for(const k in base)c[k]=Math.round(base[k]*m);return c;
}
function trainsFor(b,p){
  // manual tech-tree adjustments: Eagle Warriors for the meso civs, Anarchy
  // Huskarls, Spanish Missionaries, Petards at every Castle, naval unique units
  const cv=civOf(p),def=BLDS[b.type];
  if(b.type==='castle')return[cv.uu,'petard','treb'].filter(tt=>tt!=='treb'||G.P[p].age>=3);
  let list=(def.trains||[]).slice();
  list=list.filter(tt=>!UNITS[tt].chem||hasUni(p,'chem')); // gunpowder needs Chemistry
  if(b.type==='barracks'){
    if(cv.eagles)list.push('eagle');
    if(hasUt(p,'anarchy'))list.push('huskarl');
  }
  if(b.type==='monastery'&&cv.missionaries)list.push('missionary');
  if(b.type==='dock'&&cv.uuShip)list.push(cv.uuShip); // Viking Longboat / Korean Turtle
  return list;
}
function costStr(c){const parts=[];if(c.f)parts.push(c.f+'🍖'.replace('🍖','F'));
  if(c.w)parts.push(c.w+'W');if(c.g)parts.push(c.g+'G');return parts.join(' ');}

/* ================= update loop ================= */
function step(dt){
  // Replay playback injects the recorded orders for this tick BEFORE the
  // normal drain, at the same boundary solo play applied them originally.
  if(REC.play){
    const tk=Math.round(G.t/.05);
    const cs=REC.play.cmds;
    while(REC.idx<cs.length&&cs[REC.idx][0]<=tk){applyCmd(cs[REC.idx][1]);REC.idx++;}
    if(REC.play.endT&&G.t>=REC.play.endT&&!G.over){
      G.paused=true;toast('Replay finished');}
  }
  // Player orders land at one fixed point in the tick. Solo play has already
  // drained them at issue time; a lockstep match fills the queue here instead.
  drainCmds();
  G.t+=dt;
  // Post-game timeline: one score sample per player every 10 game-seconds.
  // Deterministic (pure function of sim state), never hashed, saved with v2.
  if(G.tl){
    G.tlT=(G.tlT===undefined?10:G.tlT)-dt;
    if(G.tlT<=0){G.tlT+=10;
      const cv=c=>(c.f||0)+(c.w||0)+(c.g||0);
      const row=[];
      for(let p=0;p<NP;p++){
        let s=Math.floor(G.P[p].f+G.P[p].w+G.P[p].g);
        for(const u of G.units)if(u.p===p&&u.hp>0)s+=cv(UNITS[u.type].cost);
        for(const b of G.blds)if(b.p===p&&b.built)s+=cv(BLDS[b.type].cost);
        row.push(s);}
      G.tl.push(row);
      if(G.tl.length>1080)G.tl.shift();   // cap at 3 hours of samples
    }
  }
  // keep the inspect panel / selection card HP live without full rebuilds
  if(G.inspect&&!G.sel.length){
    G.inspT=(G.inspT||0)+dt;
    if(G.inspT>.5){G.inspT=0;updateInspect();}
  }else if(G.sel.length){
    G.inspT=(G.inspT||0)+dt;
    if(G.inspT>.3){G.inspT=0;updateCard();}
  }
  // AI trickle (cheat by difficulty) — every slot with an AI behind it, which in
  // a multiplayer match is no longer simply "everyone but player 0"
  const tr=DIFF[diffSel].trickle*dt;
  for(let p=0;p<NP;p++){if(!G.ais[p])continue;
    G.P[p].f+=tr;G.P[p].w+=tr;G.P[p].g+=tr*.6;}
  // buildings
  for(const b of G.blds){
    const d=BLDS[b.type];
    if(b.built){
      // production queue
      if(b.queue.length){
        b.qt+=dt;
        const ut=b.queue[0];
        if(ut==='AGE'){
          if(b.qt>=AGE_TIME[G.P[b.p].age+1]*(turboSel===2?.5:1)){b.queue.shift();b.qt=0;G.P[b.p].age++;G.P[b.p].aging=false;
            if(G.ageAt)G.ageAt[b.p][G.P[b.p].age]=Math.round(G.t);
            if(b.p===localP){toast('You have advanced to the '+AGES[G.P[localP].age]+'!');buzz(25);
              feed('You have advanced to the '+AGES[G.P[localP].age]);snd('age');updateTop();refreshPanel();
              G.ageFx=1.4; // golden bloom over the new age
              const ac=bldCenter(b);
              for(let i=0;i<22;i++)G.fx.push({x:ac.x+(Math.random()-.5)*2.4,y:ac.y+(Math.random()-.5)*1.6,
                vx:(Math.random()-.5)*1.2,vy:-1.4-Math.random()*1.6,life:1.1+Math.random()*.5,max:1.6,
                r:1.5,kind:'chip',col:i%2?'#ffe9a0':'#c9a227'});}}
        }else if(b.qt>=trainTimeOf(b,ut)){
          b.queue.shift();b.qt=0;
          const spot=(UNITS[ut].ship
            ?nearFree(b.tx+1,b.ty+1,5,true)   // ships launch onto open water
            :nearFree(b.tx+Math.floor(b.size/2),b.ty+b.size,4))||{x:b.tx,y:b.ty+b.size};
          const u=addUnit(b.p,ut,spot.x,spot.y);
          if(G.pstats)G.pstats[b.p].tr++;
          if(b.p===localP&&ut!=='villager')G.stats.trained++;
          if(b.p>0&&ut!=='villager')aiJoinDefense(u);
          if(b.rally){ // walk to the flag — or straight to work if it sits on a resource/farm
            const R=b.rally,rr=R.k?G.res[R.k]:null;
            if(rr&&(ut==='villager'||(UNITS[ut].fisher&&rr.type==='fish')))cmdGather(u,R.k);
            else if(R.fid&&ut==='villager'){
              const fb=G.blds.find(x=>x.id===R.fid&&x.built&&x.type==='farm');
              if(fb)cmdFarm(u,fb);else cmdMove(u,R.x,R.y);
            }else cmdMove(u,R.x,R.y);
          }
          if(b.p===localP){snd('train');refreshPanel();feed(unitName(ut,localP)+' Created');}
        }
      }
      // the garrison mends inside safe walls; Herbal Medicine works wonders
      if(b.gar&&b.gar.length){
        const hr=(ecoTier(b.p,'herb')?4:1)*dt;
        for(const gu of b.gar)if(gu.hp<gu.maxhp)gu.hp=Math.min(gu.maxhp,gu.hp+hr);
      }
      // tower / TC arrows
      if(d.atk){
        b.cd-=dt;
        if(b.cd<=0){
          const c=bldCenter(b);
          const cvB=civOf(b.p);
          let rng=d.rng+bsOf(b.p).arw*.5; // Fletching line reaches the towers too
          if(b.type==='tower'&&cvB.towerRangeAge)rng+=cvB.towerRangeAge[G.P[b.p].age];
          if((b.type==='tower'||b.type==='castle')&&hasUt(b.p,'shinkichon'))rng+=2;
          if(b.type==='castle'&&hasUt(b.p,'crenellations'))rng+=3;
          if(b.type==='tower'&&hasUt(b.p,'artillery'))rng+=1.5;
          const e=nearestEnemy(b.p,c.x,c.y,rng,true);
          const bt=b.type==='tower'&&hasUni(b.p,'btower'); // Bombard Tower upgrade
          let tAtk=Math.round(d.atk*((b.type==='tower'||b.type==='castle')?(cvB.towerAtk||1):1))
            +bsOf(b.p).arw
            +(b.gar?b.gar.length*2*(cvB.garArrow||1):0);
          if((b.type==='tower'||b.type==='castle')&&hasUt(b.p,'yeomen'))tAtk+=2;
          if(bt)tAtk+=6;
          if(e&&e.ent&&!e.bld&&UNITS[e.ent.type].ship&&hasUni(b.p,'heat'))
            tAtk=Math.round(tAtk*1.5); // Heated Shot: towers scorch ships
          if(e){b.cd=1.6;dealDamage(e,tAtk,b.p,bt?'siege':true);
            const ms=!bt&&!e.bld&&Math.random()<missChance(b.p);
            G.proj.push({x0:c.x,y0:c.y-1.2,
              x1:e.ex+(ms?(Math.random()-.5)*.9:0),y1:e.ey+(ms?(Math.random()-.5)*.9:0),t:0,
              dur:Math.max(.16,hyp(e.ex-c.x,e.ey-c.y)*(bt?.045:.07)),miss:ms,
              kind:bt?'ball':null});}
        }
      }
    }
  }
  // units
  for(const u of G.units){if(u.hp<=0)continue;
    if(UNITS[u.type].regen&&u.hp<u.maxhp) // Berserks heal over time (manual)
      u.hp=Math.min(u.maxhp,u.hp+dt*(hasUt(u.p,'berserkergang')?1.0:.4));
    updateUnit(u,dt);}
  // finalize garrison entries (deferred so we never splice mid-iteration)
  let garred=false;
  for(let i=G.units.length-1;i>=0;i--){const u=G.units[i];
    if(u._gar){const b=u._gar;u._gar=null;u.path=null;
      G.units.splice(i,1);b.gar.push(u);
      G.sel=G.sel.filter(id=>id!==u.id);
      if(b.p===localP)garred=true;}
    else if(u._garU){const rm=u._garU;u._garU=null;u.path=null;
      G.units.splice(i,1);rm.gar.push(u);
      G.sel=G.sel.filter(id=>id!==u.id);
      if(rm.p===localP)garred=true;}}
  if(garred){snd('done');refreshPanel();}
  // separation — stationary push + weak lateral shove between MOVING allies so
  // marching blobs spread out instead of stacking.
  // Bucketed by tile: the old all-pairs sweep was O(n²) and became the biggest
  // cost in 8-player games (188 units = ~17k pair tests EVERY step). Units only
  // interact within .36 tiles, so comparing a cell against itself and its four
  // forward neighbours covers every pair exactly once.
  {
    const cells=new Map();
    for(const u of G.units){
      if(u.hp<=0)continue;
      const k=(u.x|0)+','+(u.y|0);
      const c=cells.get(k);
      if(c)c.push(u);else cells.set(k,[u]);
    }
    sepGrid=cells; // creepToward reuses this to avoid crowding into a neighbour
    const pair=(a,b)=>{
      const dx=b.x-a.x,dy=b.y-a.y,d2=dx*dx+dy*dy;
      if(d2>=0.13||d2<=1e-6)return;
      const d=Math.sqrt(d2),push=(0.36-d)*0.35;
      const nx=dx/d*push,ny=dy/d*push;
      const aStill=!a.path||!a.path.length,bStill=!b.path||!b.path.length;
      if(aStill&&passable(Math.floor(a.x-nx),Math.floor(a.y-ny))){a.x-=nx;a.y-=ny;}
      if(bStill&&passable(Math.floor(b.x+nx),Math.floor(b.y+ny))){b.x+=nx;b.y+=ny;}
      if(!aStill&&!bStill&&allied(a.p,b.p)){
        const mag=Math.min(.25*dt,(0.36-d)*.9*dt);
        latShove(a,dx,dy,mag);latShove(b,-dx,-dy,mag);
      }
    };
    const FWD=[[1,0],[-1,1],[0,1],[1,1]]; // forward half — each pair seen once
    for(const [k,list] of cells){
      for(let i=0;i<list.length;i++)
        for(let j=i+1;j<list.length;j++)pair(list[i],list[j]);
      const ci=k.indexOf(','),cx=+k.slice(0,ci),cy=+k.slice(ci+1);
      for(const d of FWD){
        const nb=cells.get((cx+d[0])+','+(cy+d[1]));
        if(!nb)continue;
        for(let i=0;i<list.length;i++)
          for(let j=0;j<nb.length;j++)pair(list[i],nb[j]);
      }
    }
  }
  // projectiles
  for(let i=G.proj.length-1;i>=0;i--){const pr=G.proj[i];pr.t+=dt;
    if(pr.t>pr.dur){
      if(pr.miss){ // spent arrow sticks in the ground beside the fight
        G.stuck.push({x:pr.x1,y:pr.y1,t:8,max:8,a:(Math.random()-.5)*.6});
        if(G.stuck.length>50)G.stuck.shift();
        G.fx.push({x:pr.x1,y:pr.y1,vx:0,vy:-.8,life:.3,max:.3,r:1.2,kind:'chip',col:'#9b8a66'});
      }else if(pr.kind==='stone'||pr.kind==='ball'){ // siege impact: dust and rubble chips
        for(let di=0;di<4;di++)G.fx.push({x:pr.x1+(Math.random()-.5)*.6,y:pr.y1+(Math.random()-.5)*.4,
          vx:(Math.random()-.5)*.9,vy:-.5-Math.random()*.7,life:.7,max:.7,
          r:3+Math.random()*2.5,kind:'smoke',col:'150,136,104'});
        for(let di=0;di<3;di++)G.fx.push({x:pr.x1,y:pr.y1,vx:(Math.random()-.5)*3,
          vy:-1-Math.random()*1.4,life:.4,max:.4,r:1.4,kind:'chip',col:'#a89878'});
      }else{
        G.fx.push({x:pr.x1,y:pr.y1,vx:0,vy:0,life:.18,max:.18,r:2,kind:'spark'});
        if(pr.tid){ // arrow buried in the target — rides along until it fades
          const vic=G.units.find(x=>x.id===pr.tid&&x.hp>0);
          if(vic)G.stuck.push({uid:pr.tid,ox:(Math.random()-.5)*.34,oy:-.35-Math.random()*.3,
            t:2.2,max:2.2,a:(Math.random()-.5)*1.5,x:vic.x,y:vic.y});
          if(G.stuck.length>50)G.stuck.shift();
        }
      }
      G.proj.splice(i,1);}}
  // particles / flashes / corpses / smoke
  for(let i=G.fx.length-1;i>=0;i--){const f=G.fx[i];
    f.life-=dt;f.x+=f.vx*dt;f.y+=f.vy*dt;
    if(f.kind==='chip')f.vy+=8*dt;
    if(f.kind==='text')f.vy*=.97; // gentle rise, easing out
    if(f.life<=0)G.fx.splice(i,1);}
  for(const u of G.units)if(u.flash>0)u.flash-=dt;
  for(const b of G.blds){
    if(b.flash>0)b.flash-=dt;
    if(b.built&&b.hp<b.maxhp*.6){
      b.smokeT=(b.smokeT||0)-dt;
      if(b.smokeT<=0){b.smokeT=.4+Math.random()*.5;
        G.fx.push({x:b.tx+Math.random()*b.size,y:b.ty+Math.random()*b.size*.6,
          vx:(Math.random()-.5)*.3,vy:-.8-Math.random()*.5,life:1.6,max:1.6,
          r:2.5+Math.random()*2,kind:'smoke'});}}
  }
  for(let i=G.corpses.length-1;i>=0;i--){G.corpses[i].t-=dt;if(G.corpses[i].t<=0)G.corpses.splice(i,1);}
  for(let i=G.rubble.length-1;i>=0;i--){G.rubble[i].t-=dt;if(G.rubble[i].t<=0)G.rubble.splice(i,1);}
  for(let i=G.stuck.length-1;i>=0;i--){G.stuck[i].t-=dt;if(G.stuck[i].t<=0)G.stuck.splice(i,1);}
  // dead cleanup
  for(let i=G.units.length-1;i>=0;i--)if(G.units[i].hp<=0){
    const u=G.units[i];G.sel=G.sel.filter(id=>id!==u.id);
    if(!isAnimal(u)&&G.pstats)G.pstats[u.p].lost++;
    if(isAnimal(u))dropCarcass(u); // the kill becomes food on the ground
    if(u.relic){const r=G.relics.find(x=>x.id===u.relic);
      if(r){r.held=null;r.x=Math.max(1,Math.min(MAP-2,u.x|0));r.y=Math.max(1,Math.min(MAP-2,u.y|0));}}
    if(u.gar&&u.gar.length){ // a wrecked ram or transport spills its passengers
      const shore=UNITS[u.type].ship?nearFree(Math.floor(u.x),Math.floor(u.y),5):null;
      for(const gu of u.gar){
        if(UNITS[u.type].ship&&!shore){gu.hp=0;continue;} // drowned mid-channel
        const bx2=shore?shore.x+.5:u.x,by2=shore?shore.y+.5:u.y;
        gu.x=bx2+(SR()-.5);gu.y=by2+(SR()-.5);
        gu.state='idle';gu.path=null;gu.target=null;gu.spd=0;gu.vx=0;gu.vy=0;
        G.units.push(gu);}
      u.gar=[];
    }
    if(tileVis(u.x,u.y)){ // brief splinter flurry so kills feel physical
      for(let ci=0;ci<4;ci++)G.fx.push({x:u.x,y:u.y-.2,vx:(Math.random()-.5)*2.4,
        vy:-1.2-Math.random()*1.2,life:.4,max:.4,r:1.3,kind:'chip',
        col:ci===3?'#b8bdc2':TEAMS[u.p].main});
      G.fx.push({x:u.x,y:u.y-.3,vx:0,vy:-.4,life:.2,max:.2,r:2.2,kind:'spark'});
    }
    if(!isAnimal(u)){ // a hunted beast leaves a carcass, not a corpse — one body, not two
      G.corpses.push({x:u.x,y:u.y,p:u.p,type:u.type,t:150,max:150,h:Math.random()<.5?1:0,
        hdg:u.hdg,face:u.face,fall:Math.random()<.5?-1:1}); // pose for the topple
      if(G.corpses.length>140)G.corpses.shift();
    }
    G.units.splice(i,1);}
  for(let i=G.blds.length-1;i>=0;i--)if(G.blds[i].hp<=0)removeBld(i);
  // fog
  G.visT-=dt;if(G.visT<=0){G.visT=.35;updateFog();}
  // AI think
  for(let p=0;p<NP;p++){const ai=G.ais[p];if(!ai)continue;
    ai.tick-=dt;if(ai.tick<=0){ai.tick=.6;aiThink(p,ai);}}
  // relic gold trickle + monastery loss handling
  for(const r of G.relics){
    if(!r.mon)continue;
    const mb=G.blds.find(b=>b.id===r.mon);
    if(!mb){r.mon=null;continue;}
    G.P[mb.p].g+=.55*dt*(teamHas(mb.p,'relicGold')?1.33:1); // Aztec team bonus
  }
  // Wonder victory countdown — skirmish games, and the mission built around it
  if((!mission||mission.win.type==='wonder')&&G.wonderT){
    const wb=G.blds.find(b=>b.id===G.wonderT.id&&b.built&&b.hp>0);
    if(!wb){
      feed(allied(G.wonderT.p,localP)?'Your Wonder has fallen!':'The enemy Wonder has fallen!',!allied(G.wonderT.p,localP)?false:true);
      snd('horn');G.wonderT=null;updateTop();
    }else if(G.t>=G.wonderT.end)return endGame(allied(G.wonderT.p,localP));
  }
  // Relic victory: one team holds every relic long enough
  if(!mission&&G.relics.length>=3){
    let team=null,all=true;
    for(const r of G.relics){
      const mb=r.mon&&G.blds.find(b=>b.id===r.mon);
      if(!mb){all=false;break;}
      const tt=G.teams[mb.p];
      if(team===null)team=tt;
      else if(tt!==team){all=false;break;}
    }
    if(all&&team!==null){
      if(!G.relicT||G.relicT.team!==team){
        const bonus=G.P.some((st2,q)=>hasUt(q,'atheism'))?100:0;
        G.relicT={team,end:G.t+300+bonus};
        feed(team===G.teams[0]?'You hold every relic! Victory approaches…'
          :'The enemy holds every relic! Recover one before the countdown ends!',team!==G.teams[0]);
        snd('horn');updateTop();
      }else if(G.t>=G.relicT.end)return endGame(G.relicT.team===G.teams[0]);
    }else if(G.relicT){G.relicT=null;updateTop();}
  }
  // win/lose
  if(mission&&mission.win.type==='survive'&&G.t>=mission.win.time)return endGame(true);
  // campaign-arc win types (2026-08-19): wealth, kills, escort
  if(mission&&mission.win.type==='wealth'&&G.P[localP].g>=mission.win.n)return endGame(true);
  if(mission&&mission.win.type==='kills'&&G.pstats&&G.pstats[localP].kills>=mission.win.n)return endGame(true);
  if(mission&&mission.win.type==='escort'&&G.mEscort){
    const W=G.mEscort;
    const hero=G.units.find(u2=>u2.p===localP&&u2.type===mission.win.ut&&u2.hp>0)
      ||G.blds.some(b2=>b2.gar&&b2.gar.some(g2=>g2.type===mission.win.ut))  // garrisoned = alive, not arrived
      ||G.units.some(u2=>u2.gar&&u2.gar.some(g2=>g2.type===mission.win.ut));
    if(!hero)return endGame(false);          // the one you were sworn to protect is dead
    if(hero.x!==undefined&&hyp(hero.x-W.x,hero.y-W.y)<(W.r||3))return endGame(true);
    // a slow pulse on the destination so the player always knows the road
    if((G.t%8)<dt){const pgs=G.pings||(G.pings=[]);
      pgs.push({x:W.x,y:W.y,t:G.t});if(pgs.length>6)pgs.shift();}
  }
  if(mission&&mission.win.type==='relics'){
    const dep=G.relics.filter(r=>{if(!r.mon)return false;
      const b=G.blds.find(bb=>bb.id===r.mon);return b&&b.p===localP;}).length;
    if(dep>=mission.win.n)return endGame(true);
  }
  if(G.regicide){
    // Regicide: the crown is the win condition. A king inside a building or a
    // transport is alive — only death removes him from all three lists.
    const kingAlive=pred=>
      G.units.some(u2=>UNITS[u2.type].king&&pred(u2))||
      G.blds.some(b2=>b2.gar&&b2.gar.some(g2=>UNITS[g2.type].king&&pred(g2)))||
      G.units.some(u2=>u2.gar&&u2.gar.some(g2=>UNITS[g2.type].king&&pred(g2)));
    const pK=kingAlive(k=>k.p===localP),eK=kingAlive(k=>!allied(k.p,localP));
    if(!eK)endGame(true);else if(!pK)endGame(false);
    return;
  }
  const pTC=G.blds.find(b=>b.p===localP&&b.type==='tc');
  const eTC=G.blds.find(b=>!allied(b.p,localP)&&b.type==='tc');
  if(!eTC)endGame(true);else if(!pTC)endGame(false);
}
function wonderRaised(b){
  const bonus=G.P.some((st,q)=>hasUt(q,'atheism'))?100:0; // Hun Atheism stretches the clock
  G.wonderT={p:b.p,id:b.id,end:G.t+300+bonus};
  if(allied(b.p,localP))feed('Your Wonder is complete! Defend it until the countdown ends!');
  else feed('Warning! The '+CIVS[G.P[b.p].civ].name+' have raised a Wonder — destroy it!',true);
  snd('horn');updateTop();
}
function ejectGarrison(b){
  let n=0;
  while(b.gar&&b.gar.length){
    const u=b.gar.pop();
    const spot=nearFree(b.tx+Math.floor(b.size/2),b.ty+b.size,6)||{x:b.tx,y:b.ty+b.size};
    u.x=spot.x+.5+(n%3)*.3;u.y=spot.y+.5+((n/3)|0)*.3;
    u.hdg=dAtan2(u.y-(b.ty+b.size/2),u.x-(b.tx+b.size/2));u.spd=0;u.vx=0;u.vy=0;
    u.state='idle';u.path=null;u.target=null;n++;
    G.units.push(u);
  }
  return n;
}
function removeBld(i){
  const b=G.blds[i];
  if(b.built&&G.pstats)G.pstats[b.p].blost++;
  ejectGarrison(b);
  for(const r of G.relics)if(r.mon===b.id)r.mon=null; // relics tumble out of a razed monastery
  if(b.built&&!BLDS[b.type].farm){ // collapse into rubble under a dust burst
    // G5: a falling building rocks the ground (render-side, distance-attenuated)
    if(tileVis(b.tx,b.ty))shakeAt(b.tx+b.size/2,b.ty+b.size/2,b.size*3);
    // remember the structure so it can be seen collapsing before the pile shows
    G.rubble.push({tx:b.tx,ty:b.ty,size:b.size,p:b.p,t:45,max:45,v:(b.tx*7+b.ty*13)%2,
      type:b.type,tilt:Math.random()<.5?-1:1});
    if(G.rubble.length>40)G.rubble.shift();
    const cc=bldCenter(b);
    if(tileVis(cc.x,cc.y))snd('collapse',cc.x,cc.y);
    // dust rolls outward from the footprint as it comes down
    for(let fi=0;fi<14;fi++){
      const an=Math.random()*6.283,rr=b.size*(.4+Math.random()*.7);
      G.fx.push({x:cc.x+dCos(an)*rr,y:cc.y+dSin(an)*rr*.6,
        vx:dCos(an)*.9,vy:dSin(an)*.4-.25,
        life:1.3+Math.random()*.9,max:2.2,r:4+Math.random()*4,kind:'smoke',col:'163,148,116'});
    }
    for(let fi=0;fi<8;fi++)G.fx.push({x:cc.x+(Math.random()-.5)*b.size,y:cc.y+(Math.random()-.5)*b.size,
      vx:(Math.random()-.5)*.8,vy:-.5-Math.random()*.6,life:1.1+Math.random()*.6,max:1.7,
      r:3.5+Math.random()*3,kind:'smoke',col:'156,140,104'});
    for(let fi=0;fi<6;fi++)G.fx.push({x:cc.x,y:cc.y,vx:(Math.random()-.5)*3,vy:-1.5-Math.random()*1.5,
      life:.5,max:.5,r:1.6,kind:'chip',col:fi%2?'#caa66b':'#8d8478'});
  }
  for(let y=b.ty;y<b.ty+b.size;y++)for(let x=b.tx;x<b.tx+b.size;x++){
    // a razed dock returns to open water — the tiles stay land-blocked
    if(b.type==='dock'){G.map[y][x]=1;if(G.navBlock)delete G.navBlock[x+','+y];}
    else G.map[y][x]=0;
  }
  delete G.wallMap[b.tx+','+b.ty];delete G.gateMap[b.tx+','+b.ty];
  if(!b.built&&b.pendCost)refund(b.p,b.pendCost);
  if(b.p>0&&b.built)G.stats.razed++;
  G.sel=G.sel.filter(id=>id!==b.id);
  G.blds.splice(i,1);
  if(G.sel.length===0)refreshPanel();
}
function followPath(u,dt){
  const d=unitDef(u);
  if(!u.path||!u.path.length){u.spd=0;u.vx=0;u.vy=0;return true;}
  if(u.hdg===undefined)u.hdg=dAtan2(u.path[0].y-u.y,u.path[0].x-u.x); // old-save seed
  if(u.spd===undefined){u.spd=0;u.vx=0;u.vy=0;u.gaitPh=0;}
  // consume intermediate waypoints: within 0.34, or already passed (behind, within
  // 0.75 > cav turn radius so a missed corner always releases). Never the final one.
  while(u.path.length>1){
    const w0=u.path[0],ddx=w0.x-u.x,ddy=w0.y-u.y,dd=hyp(ddx,ddy);
    const behind=ddx*dCos(u.hdg)+ddy*dSin(u.hdg)<0;
    if(dd<=.34||(behind&&dd<.75))u.path.shift();else break;
  }
  const wp=u.path[0];
  const wbx=Math.floor(wp.x),wby=Math.floor(wp.y);
  const nav=!!d.ship;
  if(nav){
    if(!passableW(wbx,wby)){u.path=null;return true;} // a dock rose across the channel
  }else if(G.map[wby]&&G.map[wby][wbx]){
    const wb=G.wallMap[wbx+','+wby];
    if(wb&&!(allied(wb.p,u.p)&&BLDS[wb.type].gate&&wb.built)){
      if(allied(wb.p,u.p)){u.path=null;return true;}
      if(u.type==='villager'){u.state='idle';u.path=null;return false;}
      cmdAttack(u,wb,true);return false;
    }
  }
  const dx=wp.x-u.x,dy=wp.y-u.y,dist=hyp(dx,dy);
  const last=u.path.length===1;
  // FINAL waypoint keeps the exact snap, checked BEFORE moving — no overshoot,
  // zero final-position error, so gather 1.8 / farm 1.85 / deposit size*.5+1.7 /
  // melee radius checks behave exactly as before the rework
  if(last&&dist<=Math.max(u.spd*dt,.13)){
    u.x=wp.x;u.y=wp.y;u.path.shift();u.spd=0;u.vx=0;u.vy=0;u.formSpd=null;return true;
  }
  const m=motParams(u);
  const want=dAtan2(dy,dx);
  // stranded inside a building footprint placed after pathing (old code walked
  // through blocked tiles freely) — beeline to the free waypoint, guard bypassed
  const curOk=walkTile(u.x,u.y,u.p,nav);
  if(!curOk||(last&&dist<.45)){
    u.hdg=want; // pure pursuit: escapes footprints, kills terminal orbiting
  }else{
    const t=m.turn*dt,diff=wrapA(want-u.hdg);
    u.hdg=wrapA(u.hdg+Math.max(-t,Math.min(t,diff)));
  }
  // alignment-scaled speed: cavalry carves arcs instead of pivoting on the spot
  const align=dPowi(Math.max(0,dCos(wrapA(want-u.hdg))),m.k); // Math.pow is not IEEE-pinned; k is 1/2/3
  let vt=speedOf(u)*align;
  // movement-feel: a formation marches TOGETHER — commanded groups carry the
  // group's slowest speed (set by CMDS.move/amove, cleared on arrival/new orders)
  if(u.formSpd&&u.formSpd<vt)vt=u.formSpd*align;
  if(last)vt=Math.min(vt,Math.sqrt(2*m.dec*Math.max(0,dist-.02)),3.5*dist+.05);
  u.spd+=Math.max(-m.dec*dt,Math.min(m.acc*dt,vt-u.spd));
  if(u.spd<0)u.spd=0;
  // advance along heading; guard so arcs / cut corners never enter a blocked tile
  const stp=u.spd*dt,px0=u.x,py0=u.y;
  const nx=u.x+dCos(u.hdg)*stp,ny=u.y+dSin(u.hdg)*stp;
  if(!curOk||walkTile(nx,ny,u.p,nav)){u.x=nx;u.y=ny;}
  else if(walkTile(nx,u.y,u.p,nav)){u.x=nx;u.spd*=.7;}
  else if(walkTile(u.x,ny,u.p,nav)){u.y=ny;u.spd*=.7;}
  else u.spd=0; // pinned: pivot in place next frames
  u.vx=dCos(u.hdg)*u.spd;u.vy=dSin(u.hdg)*u.spd;
  // distance-driven gait phase: feet plant, no foot-sliding at any speed
  const moved=hyp(u.x-px0,u.y-py0);
  u.gaitPh=(u.gaitPh||0)+moved*(u.type==='elephant'?.55:d.cav?(u.spd>1.1?.62:.95):d.ram?.6:1.15);
  if(u.type==='ram')u.wheelRot=(u.wheelRot||0)+moved*8.1;
  // face compat: SCREEN-space heading sign (isoPt: screenX=(x-y)*IW),
  // 0.08 deadzone stops flip jitter on screen-vertical walks
  const sdx=dCos(u.hdg)-dSin(u.hdg);
  if(Math.abs(sdx)>.08)u.face=sdx>0?1:-1;
  return false;
}
/* Close the last of the gap on foot. The A* radii stay generous (tight ones
   deadlocked villagers twice — see HANDOFF gotcha 1), so instead of shrinking
   them we let an arrived unit creep the final stretch directly. walkTile is the
   limiter, so a unit presses up against a tree/wall and simply stops there. */
let sepGrid=null; // last step's unit buckets, shared by separation and creep
// is some OTHER unit already sitting at (x,y)? cheap 9-cell lookup
function crowdedAt(u,x,y){
  if(!sepGrid)return false;
  const cx=x|0,cy=y|0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const list=sepGrid.get((cx+dx)+','+(cy+dy));
    if(!list)continue;
    for(const o of list){
      if(o===u||o.hp<=0)continue;
      const ex=o.x-x,ey=o.y-y;
      if(ex*ex+ey*ey<0.115)return true;   // ~.34 tiles, separation's rest gap
    }
  }
  return false;
}
function creepToward(u,tx,ty,want,dt){
  // Stagger the resting distance per unit so a crowd rings the trunk in loose
  // bands instead of all converging on one point.
  want+=(u.id%4)*.17;
  const dx=tx-u.x,dy=ty-u.y,d=hyp(dx,dy);
  if(d<=want||d<1e-4)return;
  const step=Math.min(d-want,speedOf(u)*.55*dt);
  const nx=u.x+dx/d*step,ny=u.y+dy/d*step;
  const nav=!!UNITS[u.type].ship;
  // Never creep INTO someone. Without this, creep fought separation every frame
  // — separation's push is often blocked by the very tree they're gathering, so
  // the crowd compressed into a stack and jittered.
  if(crowdedAt(u,nx,ny))return;
  if(walkTile(nx,ny,u.p,nav)){u.x=nx;u.y=ny;}
  else if(walkTile(nx,u.y,u.p,nav))u.x=nx;
  else if(walkTile(u.x,ny,u.p,nav))u.y=ny;
}
function targetEnt(t){return t.bld?G.blds.find(b=>b.id===t.id):G.units.find(x=>x.id===t.id);}
function nearestEnemy(p,x,y,r,unitsOnly){
  let best=null,bd=r;
  // Wildlife is never a target of opportunity — soldiers and towers would
  // otherwise abandon a battle to shoot the neighbour's sheep. Hunting is
  // always an explicit order.
  for(const u of G.units){if(allied(u.p,p)||u.hp<=0||isAnimal(u))continue;
    const d=hyp(u.x-x,u.y-y);if(d<bd){bd=d;best={ent:u,bld:false,ex:u.x,ey:u.y};}}
  if(!unitsOnly)for(const b of G.blds){if(allied(b.p,p))continue;
    const c=bldCenter(b),d=hyp(c.x-x,c.y-y)-b.size*.5;
    if(d<bd){bd=d;best={ent:b,bld:true,ex:c.x,ey:c.y};}}
  return best;
}
function missChance(p){return hasUni(p,'bal')?.08:.28;} // Ballistics: hit moving targets
function dealDamage(hit,amt,fromP,ranged){
  // `ranged` is true for arrows, 'siege' for stones/bolts/cannonballs (which
  // ignore the anti-arrow cap on rams and Huskarl/Eagle arrow resistance)
  if(ranged===true&&!hit.bld&&hit.ent.type==='ram')amt=Math.min(amt,2);
  if(ranged===true&&!hit.bld&&UNITS[hit.ent.type]&&UNITS[hit.ent.type].arrowRes)
    amt=Math.max(1,Math.round(amt*UNITS[hit.ent.type].arrowRes)); // Huskarl .5, Eagle .7
  if(!hit.bld&&UNITS[hit.ent.type])
    amt=Math.max(1,amt-bsArmorOf(hit.ent)); // blacksmith armor: flat reduction
  const wasAlive=hit.ent.hp>0;
  hit.ent.hp-=amt;hit.ent.flash=.16;
  if(wasAlive&&hit.ent.hp<=0&&fromP!==undefined&&fromP!==GAIA&&G.pstats&&hit.ent.p!==fromP){
    if(hit.bld)G.pstats[fromP].razed++;
    else if(!isAnimal(hit.ent))G.pstats[fromP].kills++;
  }
  const hx=hit.bld?bldCenter(hit.ent).x:hit.ent.x,hy=hit.bld?bldCenter(hit.ent).y:hit.ent.y;
  if(fromP!==localP&&hit.ent.p===localP){ // minimap attack ping (separate from the toast throttle)
    const pgs=G.pings||(G.pings=[]);
    const lp=pgs[pgs.length-1];
    if(!lp||G.t-lp.t>2||hyp(hx-lp.x,hy-lp.y)>10){
      pgs.push({x:hx,y:hy,t:G.t});if(pgs.length>6)pgs.shift();}
  }
  if(tileVis(hx,hy)){
    snd(ranged==='siege'?'crash':ranged?'hit':'sword',hx,hy);
    // G5: heavy ordnance thumps the camera (render-side, distance-attenuated)
    if(ranged==='siege')shakeAt(hx,hy,amt>=20?4.5:2.5);
  }
  musCombat(fromP,hit.ent.p,hx,hy);   // the score (and follow-camera) hear the fight
  G.fx.push({x:hx+(Math.random()-.5)*.5,y:hy+(Math.random()-.5)*.5,vx:0,vy:-.6,
    life:.28,max:.28,r:3,kind:'spark'});
  if(fromP!==localP&&hit.ent.p===localP&&G.t-G.lastRaidToast>18){G.lastRaidToast=G.t;
    if(fromP===GAIA)feed('A wild boar has turned on your hunters!',true);
    else{feed('Warning! You are being attacked by the '+CIVS[G.P[fromP].civ].name+'!',true);snd('horn');buzz([60,40,60]);}}
}
function updateUnit(u,dt){
  const d=unitDef(u);u.cd-=dt;
  switch(u.state){
    /* ---- wildlife ---- */
    case 'graze':{
      // amble around a home point, pause, amble again
      u.grazeT=(u.grazeT||0)-dt;
      if(u.grazeT<=0){
        u.grazeT=2.5+SR()*4;
        const h=u.home||(u.home={x:u.x,y:u.y});
        const a=SR()*6.283,r=SR()*2.2;
        const tx=Math.max(1,Math.min(MAP-2,Math.round(h.x+dCos(a)*r)));
        const ty=Math.max(1,Math.min(MAP-2,Math.round(h.y+dSin(a)*r)));
        if(passable(tx,ty))u.path=uPath(u,tx,ty)||[];
      }
      // Sheep belong to whoever walks up to them (manual: they are "converted"
      // simply by approach) and then trail their keeper. The Celts keep theirs.
      if(d.herd){
        u.scanT=(u.scanT||0)-dt;
        if(u.scanT<=0){
          u.scanT=1;
          let best=null,bd=7;
          for(const o of G.units){
            if(o.hp<=0||o.p===GAIA||isAnimal(o))continue;
            const dd=hyp(o.x-u.x,o.y-u.y);
            if(dd<bd){bd=dd;best=o;}
          }
          if(best){
            if(best.p!==u.p&&!(u.p!==GAIA&&civOf(u.p).sheepLock))u.p=best.p;
            if(best.p===u.p)u.home={x:best.x,y:best.y}; // drift after the keeper
          }
        }
      }
      followPath(u,dt);
      break;}
    case 'flee':{
      u.fleeT=(u.fleeT||0)-dt;
      if(followPath(u,dt)||u.fleeT<=0){
        u.state='graze';u.grazeT=1+SR()*2;u.home={x:u.x,y:u.y};}
      break;}
    case 'idle':{
      if(isAnimal(u)){ // every road back to idle returns an animal to its pasture
        u.state='graze';u.grazeT=SR()*2;
        if(!u.home)u.home={x:u.x,y:u.y};
        break;}
      if(u.type==='ram'){
        let bb=null,bd=6;
        for(const b2 of G.blds){if(b2.p===u.p)continue;
          const c2=bldCenter(b2),dd=hyp(c2.x-u.x,c2.y-u.y)-b2.size*.5;
          if(dd<bd){bd=dd;bb=b2;}}
        if(bb)cmdAttack(u,bb,true);
      }else if(d.monk){
        // monks drift toward wounded allies and heal them; AI monks also preach
        u.scanT=(u.scanT||0)-dt;
        if(u.scanT<=0){u.scanT=.8;
          // AI monks run the relic circuit (outside missions, so The Relic War stays fair)
          if(u.p>0&&!mission&&!d.noRelic){
            const mon=G.blds.find(b2=>b2.p===u.p&&b2.type==='monastery'&&b2.built);
            if(mon){
              if(u.relic){const c2=bldCenter(mon);
                u.state='toMon';u.monB=mon.id;u.path=uPath(u,c2.x,c2.y,u.p)||[];break;}
              let rr=null,rd=26;
              for(const r2 of G.relics){if(r2.held||r2.mon)continue;
                const dd=hyp(r2.x+.5-u.x,r2.y+.5-u.y);
                if(dd<rd){rd=dd;rr=r2;}}
              if(rr){u.state='toRelic';u.relicT=rr.id;
                u.path=uPath(u,rr.x,rr.y,u.p)||[];break;}
            }
          }
          let best=null,bd=7;
          for(const f of G.units){
            if(!allied(f.p,u.p)||f.id===u.id||f.hp<=0||f.hp>=f.maxhp||isAnimal(f))continue;
            const dd=hyp(f.x-u.x,f.y-u.y);
            if(dd<bd){bd=dd;best=f;}}
          if(best){u.state='toHeal';u.target={id:best.id,bld:false};
            u.path=uPath(u,best.x,best.y,u.p)||[];}
          else if(u.p>0&&monkReady(u)){
            let foe=null,fd=7.5;
            for(const f of G.units){
              if(allied(f.p,u.p)||f.hp<=0||!canConvert(u,f,false))continue;
              const dd=hyp(f.x-u.x,f.y-u.y);
              if(dd<fd){fd=dd;foe=f;}}
            if(foe)cmdConvert(u,foe,false);
          }
        }
      }else if(u.type==='cog'||u.type==='tradecart'){
        // idle trader: run a route between our dock/market and the nearest
        // foreign one — the cart is the land twin of the cog, same states
        u.scanT=(u.scanT||0)-dt;
        if(u.scanT<=0){u.scanT=2;
          const bt=u.type==='cog'?'dock':'market';
          const home=G.blds.find(b=>b.p===u.p&&b.type===bt&&b.built);
          let far=null,fd=1e9;
          for(const b of G.blds){if(b.p===u.p||b.type!==bt||!b.built)continue;
            const c=bldCenter(b),dd=hyp(c.x-u.x,c.y-u.y);
            if(dd<fd){fd=dd;far=b;}}
          if(home&&far){u.state='tradeOut';u.tradeA=home.id;u.tradeB=far.id;
            const c=bldCenter(far);u.path=uPath(u,c.x,c.y)||[];}
        }
      }else if(u.type!=='villager'&&!d.passive&&!d.fisher&&(u.stance|0)!==3){
        // stances: stand-ground only acquires what it can hit from where it
        // stands; defensive remembers its post so it can walk back afterwards.
        const stc=u.stance|0;
        const e=nearestEnemy(u.p,u.x,u.y,stc===2?Math.max(rangeOf(u),1.4):5,false);
        if(e){
          if(stc===1&&!u.post)u.post={x:u.x,y:u.y};
          cmdAttack(u,e.ent,e.bld);u.autoTgt=1;
        }
      }
      break;}
    case 'tradeOut':{
      const far=G.blds.find(b=>b.id===u.tradeB&&b.built);
      if(!far){u.state='idle';break;}
      const done=followPath(u,dt);const c=bldCenter(far);
      if(hyp(c.x-u.x,c.y-u.y)<far.size*.5+1.9){
        u.state='tradeBack';u.tradeDist=0;
        const home=G.blds.find(b=>b.id===u.tradeA&&b.built);
        if(home){const hc=bldCenter(home);u.tradeDist=hyp(hc.x-c.x,hc.y-c.y);
          u.path=uPath(u,hc.x,hc.y)||[];}
        else u.state='idle';
      }else if(done){u.path=uPath(u,c.x,c.y)||[];if(!u.path.length)u.state='idle';}
      break;}
    case 'tradeBack':{
      const home=G.blds.find(b=>b.id===u.tradeA&&b.built);
      if(!home){u.state='idle';break;}
      const done=followPath(u,dt);const c=bldCenter(home);
      if(hyp(c.x-u.x,c.y-u.y)<home.size*.5+1.9){
        let gold=Math.round(8+(u.tradeDist||0)*1.2); // manual: profit scales with distance
        if(ecoTier(u.p,'caravan'))gold=Math.round(gold*1.3);   // Caravan
        if(teamHas(u.p,'tradeGold'))gold=Math.round(gold*1.33); // Spanish team bonus
        G.P[u.p].g+=gold;
        if(u.p===localP){updateTop();
          G.fx.push({x:u.x,y:u.y-.6,vx:0,vy:-.8,life:.5,max:.5,r:2,kind:'chip',col:'#ffd75e'});}
        u.state='idle';u.scanT=.5; // brief rest, then sail again
      }else if(done){u.path=uPath(u,c.x,c.y)||[];if(!u.path.length)u.state='idle';}
      break;}
    case 'toConv':{
      const t=targetEnt(u.target);
      if(!t||t.hp<=0||allied(t.p,u.p)){u.state='idle';u.target=null;break;}
      const done=followPath(u,dt);
      const c=u.target.bld?bldCenter(t):t;
      if(hyp(c.x-u.x,c.y-u.y)<convRange(u.p)){u.state='convert';u.convT=0;u.path=null;}
      else if(done){u.path=uPath(u,c.x,c.y,u.p)||[];if(!u.path.length)u.state='idle';}
      break;}
    case 'convert':{
      const t=targetEnt(u.target);
      if(!t||t.hp<=0||allied(t.p,u.p)){u.state='idle';u.target=null;break;}
      const c=u.target.bld?bldCenter(t):t;
      if(hyp(c.x-u.x,c.y-u.y)>convRange(u.p)+1){u.state='toConv';
        u.path=uPath(u,c.x,c.y,u.p)||[];break;}
      slewHdg(u,c.x,c.y,dt);
      u.convT=(u.convT||0)+dt;
      // golden rings pulse over the wavering target
      u.convFx=(u.convFx||0)-dt;
      if(u.convFx<=0&&tileVis(c.x,c.y)){u.convFx=.5;
        G.fx.push({x:c.x,y:c.y-.8,vx:0,vy:-.9,life:.5,max:.5,r:2.2,kind:'chip',col:'#f0e29a'});}
      if(u.convT>=convTimeFor(u,t,u.target.bld)){
        finishConvert(u,t,u.target.bld);
        u.state='idle';u.target=null;u.convT=0;
      }
      break;}
    case 'toHeal':{
      const t=targetEnt(u.target);
      if(!t||t.hp<=0||t.hp>=t.maxhp){u.state='idle';u.target=null;break;}
      const done=followPath(u,dt);
      if(hyp(t.x-u.x,t.y-u.y)<2.2*(civOf(u.p).healRange||1)){u.state='heal';u.path=null;}
      else if(done){u.path=uPath(u,t.x,t.y,u.p)||[];if(!u.path.length)u.state='idle';}
      break;}
    case 'heal':{
      const t=targetEnt(u.target);
      if(!t||t.hp<=0||t.hp>=t.maxhp){u.state='idle';u.target=null;break;}
      if(hyp(t.x-u.x,t.y-u.y)>2.6*(civOf(u.p).healRange||1)){u.state='toHeal';
        u.path=uPath(u,t.x,t.y,u.p)||[];break;}
      slewHdg(u,t.x,t.y,dt);
      t.hp=Math.min(t.maxhp,t.hp+(teamHas(u.p,'healFast')?9:6)*dt); // Byzantine TB
      break;}
    case 'toRelic':{
      const r=G.relics.find(x=>x.id===u.relicT);
      if(!r||r.held||r.mon){u.state='idle';u.relicT=null;break;}
      const done=followPath(u,dt);
      if(hyp(r.x+.5-u.x,r.y+.5-u.y)<1.2){
        r.held=u.id;u.relic=r.id;u.relicT=null;u.state='idle';
        if(u.p===localP)toast('Relic recovered — bring it to a Monastery');
      }else if(done){u.path=uPath(u,r.x,r.y,u.p)||[];if(!u.path.length)u.state='idle';}
      break;}
    case 'toMon':{
      const b=G.blds.find(x=>x.id===u.monB);
      if(!b||!b.built||!u.relic){u.state='idle';u.monB=null;break;}
      const done=followPath(u,dt);const c=bldCenter(b);
      if(hyp(c.x-u.x,c.y-u.y)<b.size*.5+1.7){
        const r=G.relics.find(x=>x.id===u.relic);
        if(r){r.mon=b.id;r.held=null;r.x=b.tx;r.y=b.ty;}
        u.relic=null;u.monB=null;u.state='idle';
        if(b.p===localP){toast('Relic enshrined — it generates gold');snd('done');}
      }else if(done){u.path=uPath(u,c.x,c.y,u.p)||[];if(!u.path.length)u.state='idle';}
      break;}
    case 'move':if(followPath(u,dt)){
      if(u.wq&&u.wq.length){ // next queued waypoint — path directly, keep the queue
        const w=u.wq.shift();
        u.path=uPath(u,w[0],w[1],u.p)||[];
        if(!u.path.length){u.wq=null;u.state='idle';}
      }else{u.wq=null;u.state='idle';}}
      break;
    case 'amove':{
      u.scanT=(u.scanT||0)-dt;
      if(u.scanT<=0){u.scanT=.4;
        const e=nearestEnemy(u.p,u.x,u.y,4.5,false);
        if(e&&!(u.type==='ram'&&!e.bld)){
          const am=u.am;cmdAttack(u,e.ent,e.bld);u.am=am;u.autoTgt=1;break;}
      }
      if(followPath(u,dt)){u.state='idle';u.am=null;}
      break;}
    case 'patrol':{
      if(!u.pat){u.state='idle';break;}
      if((u.stance|0)!==3&&!UNITS[u.type].monk){
        u.scanT=(u.scanT||0)-dt;
        if(u.scanT<=0){u.scanT=.4;
          const e=nearestEnemy(u.p,u.x,u.y,4.5,false);
          if(e&&!(u.type==='ram'&&!e.bld)){
            cmdAttack(u,e.ent,e.bld);u.autoTgt=1;break;} // u.pat survives — attack resumes it
        }
      }
      if(followPath(u,dt)){ // reached one end of the beat — turn around
        u.pat.leg=u.pat.leg?0:1;
        const px2=u.pat.leg?u.pat.bx:u.pat.ax,py2=u.pat.leg?u.pat.by:u.pat.ay;
        u.path=uPath(u,px2,py2,u.p)||[];
        if(!u.path.length){u.state='idle';u.pat=null;}
      }
      break;}
    case 'toGar':{
      const b=G.blds.find(x=>x.id===u.garB);
      if(!b||!b.built||b.gar.length>=bldGarCap(b)){u.state='idle';u.garB=null;break;}
      const done=followPath(u,dt);const c=bldCenter(b);
      if(hyp(c.x-u.x,c.y-u.y)<b.size*.5+1.7){u._gar=b;u.state='idle';u.garB=null;}
      else if(done){u.path=uPath(u,c.x,c.y,u.p)||[];if(!u.path.length){u.state='idle';u.garB=null;}}
      break;}
    case 'toGarU':{ // climbing into a Battering Ram / boarding a Transport
      const ram=G.units.find(x=>x.id===u.garU&&x.hp>0);
      if(!ram||!ram.gar||ram.gar.length>=UNITS[ram.type].garCap){u.state='idle';u.garU=null;break;}
      const done=followPath(u,dt);
      const reach=UNITS[ram.type].ship?2.1:1.2; // ships board from the bank
      if(hyp(ram.x-u.x,ram.y-u.y)<reach){u._garU=ram;u.state='idle';u.garU=null;}
      else if(done){u.path=uPath(u,ram.x,ram.y,u.p)||[];
        if(!u.path.length){u.state='idle';u.garU=null;}}
      break;}
    case 'toRes':{
      const r=G.res[u.resKey];
      if(!r){u.state='idle';autoNext(u);break;}
      const done=followPath(u,dt);
      if(hyp(r.x+.5-u.x,r.y+.5-u.y)<1.8){u.state='gather';u.gatherT=0;}
      else if(done){u.path=uPath(u,r.x,r.y,u.p)||[];if(!u.path.length)u.state='idle';}
      break;}
    case 'gather':{
      const r=G.res[u.resKey];
      if(!r){autoNext(u);break;}
      slewHdg(u,r.x+.5,r.y+.5,dt);
      creepToward(u,r.x+.5,r.y+.5,.95,dt); // stand right at the trunk/vein
      u.gatherT+=dt;
      if(u.gatherT>=1){u.gatherT=0;
        const cv=civOf(u.p);
        const meat=r.sub==='meat';
        const rate=(r.type==='fish'?1.35:1.1)*TB()
          *(r.type==='wood'&&cv.woodMult?cv.woodMult:1)*(r.type==='gold'&&cv.goldMult?cv.goldMult:1)
          *(meat&&cv.huntFast?cv.huntFast:1)                    // Mongols butcher fast
          *(r.type==='wood'?WOOD_RATE[ecoTier(u.p,'wood')]:1)   // axe/saw line
          *(r.type==='gold'?GOLD_RATE[ecoTier(u.p,'gold')]:1);  // mining line
        const take=Math.min(rate,r.amt);
        r.amt-=take/(cv.resLast||1);u.carry+=take;u.carryType=r.type; // Mayans: resources last longer
        if(tileVis(r.x,r.y))snd(r.type==='gold'?'mine':'chop');
        for(let ci=0;ci<2;ci++)G.fx.push({x:r.x+.5,y:r.y+.3,vx:(Math.random()-.5)*2,
          vy:-1-Math.random(),life:.45,max:.45,r:1.4,kind:'chip',
          col:r.type==='wood'?'#caa66b':r.type==='food'?'#c0392b':r.type==='fish'?'#bcd8e4':'#ffd75e'});
        if(r.amt<=0){
          if(r.type!=='fish')G.map[r.y][r.x]=0; // spent fisheries stay open water
          delete G.res[u.resKey];miniResDirty=true;resVer++;
          if(r.type==='wood')stampCleared(r.x,r.y);}
        const cap=carryCap(u)+(meat&&cv.huntCarry?cv.huntCarry:0); // Goths shoulder more meat
        if(u.carry>=cap||!G.res[u.resKey]){
          const b=dropoffFor(u);if(!b){u.state='idle';break;}
          u.state='return';const c=bldCenter(b);u.path=uPath(u,c.x,c.y,u.p)||[];}}
      break;}
    case 'toFarm':{
      const b=G.blds.find(x=>x.id===u.farm);
      if(!b){u.state='idle';break;}
      const done=followPath(u,dt);const c=bldCenter(b);
      if(hyp(c.x-u.x,c.y-u.y)<1.85){u.state='farming';u.gatherT=0;}
      else if(done){u.path=uPath(u,c.x,c.y,u.p)||[];if(!u.path.length)u.state='idle';}
      break;}
    case 'farming':{
      const b=G.blds.find(x=>x.id===u.farm);
      if(!b){u.state='idle';break;}
      {const fc=bldCenter(b);slewHdg(u,fc.x,fc.y,dt);creepToward(u,fc.x,fc.y,.62,dt);}
      u.gatherT+=dt;
      if(u.gatherT>=1.25/((civOf(u.p).farmFast||1)*TB())){u.gatherT=0;u.carry+=1;u.carryType='food';
        // farms exhaust (manual); replant automatically while wood allows
        if(b.food===undefined)b.food=farmFoodOf(u.p);
        b.food-=1;
        if(b.food<=0){
          const rc=bldCostOf(u.p,'farm');
          if(canAfford(u.p,rc)){pay(u.p,rc);b.food=farmFoodOf(u.p);
            if(u.p===localP){updateTop();feed('Farm replanted');}}
          else{b.hp=0; // the field lies fallow
            if(u.p===localP)feed('A farm has gone fallow — no wood to replant',true);}
        }
        if(u.carry>=carryCap(u)){const dp=dropoffFor(u);if(!dp){u.state='idle';break;}
          u.state='return';const c=bldCenter(dp);u.path=uPath(u,c.x,c.y,u.p)||[];}}
      break;}
    case 'return':{
      const done=followPath(u,dt);
      const b=dropoffFor(u);
      if(b){const c=bldCenter(b);
        if(hyp(c.x-u.x,c.y-u.y)<b.size*.5+1.7){
          if(u.carryType){
            G.P[u.p][u.carryType[0]]+=u.carry;
            if(G.pstats)G.pstats[u.p].gath+=u.carry;
            if(u.p===localP&&tileVis(u.x,u.y)) // floating tally over the drop-off
              G.fx.push({x:u.x,y:u.y-.6,vx:0,vy:-1.1,life:1,max:1,r:0,kind:'text',
                txt:'+'+Math.round(u.carry),col:RES_COL[u.carryType]||'#f0e29a'});
          }
          u.carry=0;updateTop();
          if(u.farm){u.state='toFarm';const cc=bldCenter(G.blds.find(x=>x.id===u.farm)||b);
            if(G.blds.find(x=>x.id===u.farm)){u.path=uPath(u,cc.x,cc.y,u.p)||[];}else u.state='idle';}
          else if(u.resKey&&G.res[u.resKey]){u.state='toRes';const r=G.res[u.resKey];
            u.path=uPath(u,r.x,r.y,u.p)||[];}
          else autoNext(u);
        } else if(done){const c2=bldCenter(b);u.path=uPath(u,c2.x,c2.y,u.p)||[];if(!u.path.length)u.state='idle';}
      } else u.state='idle';
      break;}
    case 'toBuild':{
      const b=targetEnt(u.target);
      if(!b||b.built){u.state='idle';if(b&&b.built)autoNext(u);break;}
      const done=followPath(u,dt);const c=bldCenter(b);
      if(hyp(c.x-u.x,c.y-u.y)<b.size*.5+1.7)u.state='building';
      else if(done){u.path=uPath(u,c.x,c.y,u.p)||[];if(!u.path.length)u.state='idle';}
      break;}
    case 'building':{
      const b=targetEnt(u.target);
      if(!b){u.state='idle';break;}
      {const bc=bldCenter(b);slewHdg(u,bc.x,bc.y,dt);
       creepToward(u,bc.x,bc.y,b.size*.5+.55,dt);} // hands on the scaffolding
      if(b.built){u.state='idle';
        if(b.type==='farm')cmdFarm(u,b);
        break;}
      const def=BLDS[b.type];
      // Turbo speeds construction except castles, towers and wonders (WHATSNEW)
      const tbB=(turboSel&&b.type!=='castle'&&b.type!=='tower'&&b.type!=='wonder')?2.5:1;
      const bRate=dt*(civOf(u.p).buildFast||1)*(hasUni(u.p,'tread')?1.2:1)*tbB; // Spanish / Treadmill Crane
      b.prog+=bRate;b.hp=Math.min(b.maxhp,b.hp+b.maxhp*bRate/def.bt);
      if(b.prog>=def.bt){b.built=true;b.hp=b.maxhp;b.pendCost=null;
        if(!def.thin&&b.type!=='farm'&&b.type!=='dock')stampWorn(b);
        if(b.p===localP&&!def.thin){feed('— '+def.name+' Built —');snd('done');buzz(12);refreshPanel();}
        if(b.type==='wonder')wonderRaised(b);
        if(b.type==='farm')cmdFarm(u,b);
        else{
          let site=null,sd=8;
          for(const s2 of G.blds){if(s2.p!==u.p||s2.built)continue;
            const c2=bldCenter(s2),dd=hyp(c2.x-u.x,c2.y-u.y);
            if(dd<sd){sd=dd;site=s2;}}
          if(site)cmdBuild(u,site);
          else if(b.type==='camp'){ // smarter villagers (manual Ch. II): a finished
            // Storage Camp sends its builder straight to the nearest resource
            let bk=null,bd2=6;
            for(const k2 in G.res){const r2=G.res[k2];
              const dd=hyp(r2.x+.5-u.x,r2.y+.5-u.y);
              if(dd<bd2){bd2=dd;bk=k2;}}
            if(bk)cmdGather(u,bk);else u.state='idle';
          }
          else u.state='idle';
        }
        updateTop();}
      break;}
    case 'attack':{
      const t=targetEnt(u.target);
      if(!t||t.hp<=0){
        u.state='idle';u.target=null;u.autoTgt=0;
        if(u.am){u.state='amove';u.scanT=.4;
          u.path=uPath(u,u.am.x,u.am.y,u.p)||[];break;}
        if(u.pat){ // resume the patrol beat where it was heading
          u.state='patrol';u.scanT=.4;
          const px2=u.pat.leg?u.pat.bx:u.pat.ax,py2=u.pat.leg?u.pat.by:u.pat.ay;
          u.path=uPath(u,px2,py2,u.p)||[];
          if(!u.path.length){u.state='idle';u.pat=null;}
          break;}
        if(u.post){ // defensive stance walks back to its post
          const px2=u.post.x,py2=u.post.y;u.post=null;
          cmdMove(u,px2,py2);break;}
        if(u.wave){const wt=G.blds.find(b=>b.id===u.wave);
          if(wt&&wt.hp>0)cmdAttack(u,wt,true);else u.wave=null;}
        break;}
      const c=u.target.bld?bldCenter(t):t;
      const rad=u.target.bld?t.size*.5:.3;
      const dist=hyp(c.x-u.x,c.y-u.y)-rad;
      const uRng=rangeOf(u);
      // engagement radius: ranged units keep their range; melee close right up
      const rng=u.target.bld?Math.max(uRng,1.25):Math.max(uRng,.62);
      // stand-ground never chases; defensive breaks off at the end of its leash
      if(dist>rng&&u.autoTgt&&(u.stance|0)===2){
        u.state='idle';u.target=null;u.path=null;u.autoTgt=0;break;}
      if(u.autoTgt&&(u.stance|0)===1&&u.post
        &&hyp(u.x-u.post.x,u.y-u.post.y)>9){
        const px2=u.post.x,py2=u.post.y;u.post=null;u.target=null;u.autoTgt=0;
        cmdMove(u,px2,py2);break;}
      if(dist<=rng){
        u.path=null;u.spd=0;u.vx=0;u.vy=0;
        slewHdg(u,c.x,c.y,dt); // face the victim so the windup aims right
        if(uRng<=1){ // melee: press in to sword's length instead of hovering
          const want=u.target.bld?rad+.5:.44;
          if(!u.target.bld&&!isAnimal(t)){
            // fan to an id-keyed slot on the victim's ring so a mob surrounds
            // instead of queueing — deterministic (id + target id, no RNG)
            const a=((u.id*2654435761^t.id)>>>0)%8/8*6.2832;
            creepToward(u,c.x+dCos(a)*want*.9,c.y+dSin(a)*want*.9,want*.35,dt);
          }else creepToward(u,c.x,c.y,want,dt);
        }
        if(d.treb&&!u.setup){ // a trebuchet unpacks before its first shot
          u.setup=true;u.cd=Math.max(u.cd,hasUt(u.p,'kataparuto')?1.5:3);}
        if(u.cd<=0){u.cd=rofOf(u);
          let dmg=atkOf(u);
          if(u.target.bld){
            dmg+=statFor(u.type,u.p).vsBld; // elephants, Tarkans, bombards
            if(d.petard)dmg=60;             // demolition charge
            if(d.siege&&hasUni(u.p,'se'))dmg=Math.round(dmg*1.2); // Siege Engineers
            if(d.petard&&hasUni(u.p,'se'))dmg=Math.round(dmg*1.4);
            if(d.ranged&&!d.cav&&!d.siege&&!d.gun&&!d.ship&&teamHas(u.p,'archVsBld'))dmg+=1; // Saracen TB
          }else{
            const td=UNITS[t.type];
            if(d.ram)dmg=2;
            else if(d.petard)dmg=25;
            else if(d.treb)dmg=12; // trebuchets are wretched against troops
            else if(td){
              if(d.vsCav&&td.cav)dmg+=d.vsCav;
              if(d.vsRanged&&td.ranged)dmg+=d.vsRanged;
              if(t.type==='spearman'&&d.ranged&&!d.gun&&!d.siege&&!d.ship)dmg+=1; // 1.0B: archers +1 vs spear line
              if(t.type==='spearman'&&d.cav&&d.ranged&&G.P[u.p].pt)dmg+=3; // 1.0B Parthian: cav archers savage spears
              if(d.vsInf&&INF.has(t.type))dmg+=d.vsInf;      // Jaguar, Cataphract
              if(d.vsUnique&&UU_SET.has(t.type))dmg+=d.vsUnique; // Samurai
              if(td.fierce&&civOf(u.p).vsBoar)dmg+=civOf(u.p).vsBoar; // Goths hunt boar hard
              if(d.vsShip&&td.ship)dmg+=d.vsShip;            // Fire Ship
              if(u.type==='knight'&&td.ranged&&teamHas(u.p,'knightVsArcher'))dmg+=2; // Persian TB
              const eu=elevTile(u.x,u.y),et=elevTile(t.x,t.y);
              if(eu>et)dmg=Math.round(dmg*1.25);
              else if(eu<et)dmg=Math.max(1,Math.round(dmg*.8));}
          }
          if(d.demo){ // Demolition Ship: one great blast, everything nearby caught in it
            const bx=c.x,by=c.y,blast=atkOf(u);
            dealDamage({ent:t,bld:u.target.bld},blast,u.p,false);
            for(const o of G.units){
              if(allied(o.p,u.p)||o.hp<=0||o.id===t.id)continue;
              if(hyp(o.x-bx,o.y-by)<1.9)dealDamage({ent:o,bld:false},Math.round(blast*.6),u.p,false);
            }
            u.hp=0;
            for(let fi=0;fi<6;fi++)G.fx.push({x:u.x,y:u.y-.3,vx:(Math.random()-.5)*2,
              vy:-.6-Math.random(),life:.6,max:.6,r:5+Math.random()*4,kind:'smoke',col:'#e8b45a'});
            snd('hit');break;
          }
          const rangedKind=d.range>1?((d.siege||d.gun)?'siege':true):false;
          dealDamage({ent:t,bld:u.target.bld},dmg,u.p,rangedKind);
          if(!u.target.bld&&isAnimal(t))animalHit(t,u); // it charges, or it bolts
          // heavy melee shoves its victim back a touch — sells the weight of the blow
          if(!u.target.bld&&!rangedKind&&dmg>=8&&t.hp>0&&!UNITS[t.type].ship){
            const kx=t.x-u.x,ky=t.y-u.y,kd=hyp(kx,ky)||1;
            const push=Math.min(.16,.012*dmg);
            const nx2=t.x+kx/kd*push,ny2=t.y+ky/kd*push;
            if(walkTile(nx2,ny2,t.p)){t.x=nx2;t.y=ny2;}
            // G5: debris thrown ALONG the strike vector — impact you can read
            if(tileVis(t.x,t.y))for(let ci=0;ci<3;ci++){
              const sp2=1.4+Math.random()*1.8;
              G.fx.push({x:t.x,y:t.y-.3,
                vx:kx/kd*sp2+(Math.random()-.5)*.8,vy:-.8-Math.random()*.9,
                life:.34,max:.34,r:1.2,kind:'chip',
                col:ci===0?'#d8dde2':TEAMS[t.p].main});
            }
          }
          if(d.petard){ // hoisted by its own petard — the charge consumes the unit
            u.hp=0;
            G.fx.push({x:u.x,y:u.y-.3,vx:0,vy:-.4,life:.5,max:.5,r:9,kind:'smoke',col:'#e8b45a'});
            snd('hit');break;
          }
          if(d.blast){ // mangonel line: the stone shatters across everyone near the impact
            for(const o of G.units){
              if(allied(o.p,u.p)||o.hp<=0||o.id===t.id)continue;
              if(hyp(o.x-c.x,o.y-c.y)<d.blast)
                dealDamage({ent:o,bld:false},Math.max(2,Math.round(dmg*.6)),u.p,'siege');
            }
          }
          if(d.pierce&&!u.target.bld){ // scorpion bolts pass through the ranks
            const L=hyp(c.x-u.x,c.y-u.y)||1,nx=(c.x-u.x)/L,ny=(c.y-u.y)/L;
            for(const o of G.units){
              if(allied(o.p,u.p)||o.hp<=0||o.id===t.id)continue;
              const px2=o.x-u.x,py2=o.y-u.y,along=px2*nx+py2*ny;
              if(along<0||along>L+1.5)continue;
              const off=Math.abs(px2*ny-py2*nx);
              if(off<.8)dealDamage({ent:o,bld:false},Math.max(1,Math.round(dmg*.5)),u.p,'siege');
            }
          }
          if(u.type==='cataphract'&&hasUt(u.p,'logistica')&&!u.target.bld){
            // Logistica: trample damage to enemies pressed around the target
            for(const o of G.units){
              if(allied(o.p,u.p)||o.hp<=0||o.id===t.id)continue;
              if(hyp(o.x-c.x,o.y-c.y)<1.4)dealDamage({ent:o,bld:false},5,u.p,false);
            }
          }
          if(d.range>1){
            // the engine's own report, fired from where it stands
            if(tileVis(u.x,u.y)){
              if(d.gun)snd(d.siege?'cannon':'gun',u.x,u.y);
              else if(d.treb)snd('treb',u.x,u.y);
              else if(d.blast)snd('sling',u.x,u.y);
              else if(d.pierce)snd('twang',u.x,u.y);
              else snd('arrow',u.x,u.y);
            }
            const kind=d.gun?'ball':(d.treb||d.blast)?'stone':d.pierce?'bolt':null;
            const noMiss=ecoTier(u.p,'thumb')&&!d.siege&&!d.gun; // Thumb Ring: true flight
            const ms=!kind&&!noMiss&&!u.target.bld&&Math.random()<missChance(u.p);
            G.proj.push({x0:u.x,y0:u.y-.4,
              x1:c.x+(ms?(Math.random()-.5)*.9:0),y1:c.y+(ms?(Math.random()-.5)*.9:0),t:0,
              dur:Math.max(.14,hyp(c.x-u.x,c.y-u.y)*(kind==='ball'?.045:kind==='stone'?.11:.07)),
              miss:ms,kind,tid:(!kind&&!u.target.bld)?t.id:null}); // arrows remember their mark
            if(kind==='ball')G.fx.push({x:u.x,y:u.y-.5,vx:0,vy:-.3,life:.3,max:.3,r:3.5,kind:'smoke',col:'200,196,186'});
          }}
      }else{
        u.setup=null; // rolling toward the target packs the trebuchet
        if(!u.path||!u.path.length)u.path=uPath(u,c.x,c.y,u.p)||[];
        followPath(u,dt);
      }
      break;}
  }
}
function autoNext(u){
  if(UNITS[u.type].fisher){ // fishing ships steam to the next school
    const k=nearestRes(u,'fish');
    if(k){cmdGather(u,k);return;}
    u.state='idle';u.resKey=null;return;
  }
  if(u.type!=='villager'){u.state='idle';return;}
  const wanted=u.carryType||(u.resKey?null:null);
  if(u.carry>0){const b=dropoffFor(u);
    if(b){u.state='return';const c=bldCenter(b);u.path=uPath(u,c.x,c.y,u.p)||[];u.resKey=null;return;}}
  const type=wanted;
  if(type){
    if(type==='food'){const f=freeFarm(u);if(f){cmdFarm(u,f);return;}}
    const k=nearestRes(u,type);if(k){cmdGather(u,k);return;}
  }
  u.state='idle';u.resKey=null;u.farm=null;
}
