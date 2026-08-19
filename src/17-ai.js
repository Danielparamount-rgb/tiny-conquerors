/* ================= AI ================= */
function aiJoinDefense(u){
  const ai=G.ais[u.p];
  if(ai&&ai.attacking){const tb=G.blds.find(b=>b.id===ai.tgtId);
    if(tb){u.wave=tb.id;cmdAttack(u,tb,true);}}
}
/* AI PERSONALITIES (roadmap #7). Each computer lord gets a temperament,
   derived by pure hash from (gameSeed, seat) — NO RNG stream is consumed, so
   old seeds still reproduce old games tick for tick. Every effect gates on
   G.t>150 or Feudal, the same discipline that kept the smarter-ai pass off
   the determinism baselines:
     0 the Swift    smaller waves, far more often — the rusher
     1 the Patient  a deeper economy, then huge late waves — the boomer
     2 the Stone    walls early, adds towers, hits rarely but heavy — the turtle
     3 the Restless standard tempo, a touch more frequent — the raider */
const PERS_NAMES=['the Swift','the Patient','the Stone','the Restless'];
function aiPers(p){return hash2((gameSeed^(p*2654435761))>>>0,(gameSeed>>>16)^(p*13+5))%4;}
function aiThink(p,ai){
  const cfg=DIFF[diffSel],st=G.P[p];
  const pers=aiPers(p),persOn=G.t>150;
  const tc=G.blds.find(b=>b.p===p&&b.type==='tc');if(!tc)return;
  const vills=G.units.filter(u=>u.p===p&&u.type==='villager'&&u.hp>0);
  const army=G.units.filter(u=>u.p===p&&u.type!=='villager'&&u.hp>0&&!isAnimal(u));
  if(ai.attacking&&army.length===0)ai.attacking=false;
  const myBld=t=>G.blds.filter(b=>b.p===p&&b.type===t);
  // houses
  if(popCap(p)-popUsed(p)<4&&popCap(p)<POP_MAX&&!G.blds.some(b=>b.p===p&&!b.built&&b.type==='house')
     &&st.w>=25)aiPlace('house',undefined,undefined,p);
  // villagers
  let vTarget=cfg.vT[st.age];
  if(persOn&&pers===1)vTarget+=st.age>=1?5:2;   // the Patient booms harder
  if(vills.length+tc.queue.filter(q=>q==='villager').length<vTarget
     &&tc.queue.length<2&&st.f>=50&&popUsed(p)<popCap(p))
    {pay(p,UNITS.villager.cost);tc.queue.push('villager');}
  // age up
  if(!st.aging&&st.age<3){
    const need=ageCostOf(p,st.age+1);
    const gate=[0,120,330,620][st.age+1]-cfg.trickle*40;
    if(G.t>gate&&canAfford(p,need)&&vills.length>=vTarget-1){
      pay(p,need);st.aging=true;tc.queue.push('AGE');}}
  // military buildings
  if(G.t>75&&!myBld('barracks').length&&!G.blds.some(b=>b.p===p&&!b.built&&b.type==='barracks')&&st.w>=150)aiPlace('barracks',undefined,undefined,p);
  if(st.age>=1&&!myBld('range').length&&!G.blds.some(b=>b.p===p&&!b.built&&b.type==='range')&&st.w>=150)aiPlace('range',undefined,undefined,p);
  if(st.age>=1&&!CIVS[st.civ].noStable&&!myBld('stable').length&&!G.blds.some(b=>b.p===p&&!b.built&&b.type==='stable')&&st.w>=150)aiPlace('stable',undefined,undefined,p);
  if(st.age>=1&&!myBld('blacksmith').length&&!G.blds.some(b=>b.p===p&&!b.built&&b.type==='blacksmith')&&st.w>=250)aiPlace('blacksmith',undefined,undefined,p);
  // the Stone raises watch towers behind its wall (two, Feudal on, gated late)
  if(persOn&&pers===2&&st.age>=1&&(ai.perst||0)<2&&st.w>=180&&st.g>=100&&G.t>=(ai.persNext||0)){
    ai.persNext=G.t+40;
    const nT=myBld('tower').length;
    if(nT<2){aiPlace('tower',undefined,undefined,p);ai.perst=nT+1;}
  }
  // a dock on the stretch of river nearest the base (checked on a cooldown —
  // canPlaceDock flood-fills, so don't hammer it every think tick)
  if(st.age>=1&&st.w>=220&&G.t>=(ai.dockNext||0)
     &&!myBld('dock').length&&!G.blds.some(b=>b.p===p&&!b.built&&b.type==='dock')){
    ai.dockNext=G.t+25;
    let bestW=null,bd2=1e9;
    for(const w of (G.waterList||[])){
      const dd=hyp(w.x-tc.tx,w.y-tc.ty);
      if(dd<bd2){bd2=dd;bestW=w;}}
    if(bestW){
      let spot=null;
      for(let dy=-4;dy<=4&&!spot;dy++)for(let dx=-4;dx<=4&&!spot;dx++)
        if(canPlaceDock(bestW.x+dx,bestW.y+dy))spot={x:bestW.x+dx,y:bestW.y+dy};
      if(spot){const bc=bldCostOf(p,'dock');
        if(canAfford(p,bc)){pay(p,bc);const b=addBld(p,'dock',spot.x,spot.y,false);b.pendCost=bc;}}
    }
  }
  // fish traps: when nearby schools run dry and the wood is there, restock —
  // the trap handler validates and pays for itself, so success is read off
  // the wood ledger (a failed placement must not burn the counter)
  if((ai.trapN||0)<2&&st.w>=260&&G.t>=(ai.trapNext||0)){
    const dk=myBld('dock').find(b=>b.built);
    if(dk){
      ai.trapNext=G.t+40;
      const fishNear=Object.values(G.res).some(r=>r.type==='fish'&&hyp(r.x-dk.tx,r.y-dk.ty)<7);
      if(!fishNear){const w0=st.w;CMDS.fishtrap({id:dk.id,p});
        if(st.w<w0)ai.trapN=(ai.trapN||0)+1;}
    }
  }
  if(st.age>=2&&!myBld('siege').length&&!G.blds.some(b=>b.p===p&&!b.built&&b.type==='siege')&&st.w>=200)aiPlace('siege',undefined,undefined,p);
  if(st.age>=2&&!myBld('university').length&&!G.blds.some(b=>b.p===p&&!b.built&&b.type==='university')&&st.w>=300)aiPlace('university',undefined,undefined,p);
  if(st.age>=2&&!myBld('monastery').length&&!G.blds.some(b=>b.p===p&&!b.built&&b.type==='monastery')&&st.w>=250&&st.g>=180)aiPlace('monastery',undefined,undefined,p);
  if(st.age>=2&&!myBld('market').length&&!G.blds.some(b=>b.p===p&&!b.built&&b.type==='market')&&st.w>=280)aiPlace('market',undefined,undefined,p);
  if(st.age>=2&&!myBld('castle').length&&!G.blds.some(b=>b.p===p&&!b.built&&b.type==='castle')&&st.w>=350&&st.g>=200)aiPlace('castle',undefined,undefined,p);
  /* a palisade ARC across the open approach toward the map centre — where
     ring-start enemies come from. Deliberately never a full ring: an arc
     cannot trap our own economy, pathing always routes around its ends,
     and gaps where trees or water refuse a segment are simply left. */
  if(st.age>=1&&!ai.walled&&st.w>=200&&G.t>150){
    ai.walled=1;
    const dir=dAtan2(MAP/2-(tc.ty+1),MAP/2-(tc.tx+1));
    const seen={};
    for(let k2=-4;k2<=4;k2++){
      const a=dir+k2*.16;
      const wx=Math.round(tc.tx+1+dCos(a)*8),wy=Math.round(tc.ty+1+dSin(a)*8);
      const key=wx+','+wy;
      if(seen[key])continue;seen[key]=1;
      const type=k2===0?'gate':'wall';    // one gate in the middle of the line
      if(!canPlace(wx,wy,1,0))continue;
      const bc=bldCostOf(p,type);
      if(!canAfford(p,bc))break;
      pay(p,bc);
      const b=addBld(p,type,wx,wy,false);b.pendCost=bc;
    }
  }
  // a rich Imperial AI reaches for a Wonder (manual strategic number 37)
  if(!mission&&st.age>=3&&!G.wonderT&&st.f>1500&&st.w>1400&&st.g>1300
     &&!myBld('wonder').length&&!G.blds.some(b=>b.p===p&&!b.built&&b.type==='wonder'))
    aiPlace('wonder',undefined,undefined,p);
  // storage camp near far-off resources
  if(st.w>=75&&!G.blds.some(b=>b.p===p&&!b.built&&b.type==='camp')&&myBld('camp').length<3){
    const far=vills.find(v=>{
      if(!v.resKey||!G.res[v.resKey])return false;
      const r=G.res[v.resKey];let bd=99;
      for(const b of G.blds)if(b.p===p&&b.built&&BLDS[b.type].drop){
        const c=bldCenter(b);bd=Math.min(bd,hyp(c.x-r.x,c.y-r.y));}
      return bd>7;});
    if(far){const r=G.res[far.resKey];aiPlace('camp',r.x,r.y,p);}
  }
  // hunt: in the Dark Age the meat walking past the Town Hall is the best food
  // on the map. Sheep first — they don't bite — then boar once there are hands
  // enough to bring one down without losing the hunter.
  {
    let onHunt=0;
    for(const v of vills)if(v.target&&!v.target.bld){
      const tgt=G.units.find(x=>x.id===v.target.id);
      if(!tgt||!isAnimal(tgt))continue;
      // a gored villager breaks off and goes back to work — the meat is not
      // worth the man, and an AI that traded one villager per boar fell a
      // third of an army behind by the four-minute mark
      if(v.hp<v.maxhp*.45&&UNITS[tgt.type].fierce){autoNext(v);continue;}
      onHunt++;
    }
    if(onHunt<4&&G.t>=(ai.huntNext||0)){
      ai.huntNext=G.t+8;
      let best=null,bs2=1e9;
      for(const a of G.units){
        if(a.hp<=0||!isAnimal(a))continue;
        if(UNITS[a.type].fierce&&vills.length<8)continue; // boar wait for a real crew
        const dd=hyp(a.x-(tc.tx+1),a.y-(tc.ty+1));
        if(dd>(st.age===0?16:11))continue;
        const score=dd/((UNITS[a.type].meat||100)/100); // near and fat wins
        if(score<bs2){bs2=score;best=a;}
      }
      if(best){
        const want=UNITS[best.type].fierce?6:2; // swarm a boar; it dies before it kills
        let sent=0;
        for(const v of vills){
          if(sent>=want)break;
          if(v.state==='toBuild'||v.state==='building')continue;   // builders keep building
          if(v.target&&!v.target.bld)continue;                     // already on a kill
          if(v.hp<v.maxhp*.6)continue;                             // the walking wounded stay home
          if(hyp(v.x-best.x,v.y-best.y)>18)continue;
          cmdAttack(v,best,false);sent++;
        }
      }
    }
  }
  // farms if food scarce
  const foodLeft=Object.values(G.res).some(r=>r.type==='food'&&hyp(r.x-tc.tx,r.y-tc.ty)<14);
  if(!foodLeft&&myBld('farm').length<Math.ceil(vills.length/2)&&st.w>=60
     &&G.blds.filter(b=>b.p===p&&!b.built&&b.type==='farm').length<2)aiPlace('farm',undefined,undefined,p);
  // research the unique technology once the castle stands and coffers allow
  if(st.age>=UT_AGE_REQ(p)&&myBld('castle').some(b=>b.built)){
    const ut=nextUtFor(p);
    if(ut&&canAfford(p,UTECHS[ut].cost)&&st.f>UTECHS[ut].cost.f*1.4){
      pay(p,UTECHS[ut].cost);st.uts.push(ut);applyUt(p,ut);}
  }
  // blacksmith upgrades: buy the cheapest available tier when comfortably rich
  if(myBld('blacksmith').some(b=>b.built)){
    const bs=bsOf(p);let best=null,bc2=1e9;
    for(const line of ['atk','arw','ia','aa','ca']){
      const tier=bs[line];
      if(tier>=3||st.age<tier+1)continue;
      const cost=BS_TECHS[line].costs[tier],tot=(cost.f||0)+(cost.g||0);
      if(tot<bc2){bc2=tot;best=line;}}
    if(best){const cost=BS_TECHS[best].costs[bs[best]];
      if(canAfford(p,cost)&&st.f>(cost.f||0)+250&&st.g>(cost.g||0)+120){pay(p,cost);bs[best]++;}}
    if(!st.pt&&st.age>=3&&myBld('range').some(b=>b.built)
       &&st.f>450&&st.g>500){pay(p,{f:200,g:250});st.pt=true;}
  }
  // economy techs: cheapest available first, bought when comfortable
  {let bestE=null,bcE=1e9;
   for(const id in ECO_TECHS){const T=ECO_TECHS[id];
     const tier=ecoTier(p,id);if(tier>=ecoMax(id))continue;
     const needAge=T.ages?T.ages[tier]:T.age;if(st.age<needAge)continue;
     if(!myBld(T.bld).some(b=>b.built))continue;
     const cost=T.costs?T.costs[tier]:T.cost;
     const tot=(cost.f||0)+(cost.w||0)+(cost.g||0);
     if(tot<bcE){bcE=tot;bestE=id;}}
   if(bestE){const T=ECO_TECHS[bestE],tier=ecoTier(p,bestE);
     const cost=T.costs?T.costs[tier]:T.cost;
     if(canAfford(p,cost)&&st.f>(cost.f||0)+200&&st.w>(cost.w||0)+150&&st.g>(cost.g||0)+80){
       pay(p,cost);ecoOf(p)[bestE]=tier+1;applyEco(p,bestE);}}
  }
  // university sciences: chemistry first (it unlocks gunpowder), then the rest
  if(myBld('university').some(b=>b.built)){
    const un=uniOf(p);
    const want=['chem','bal','mas','se','arch','tread','heat','btower']
      .find(id=>!un[id]&&(!UNI_TECHS[id].req||un[UNI_TECHS[id].req])&&st.age>=UNI_TECHS[id].age);
    if(want){const cost=UNI_TECHS[want].cost;
      if(canAfford(p,cost)&&st.f>(cost.f||0)+200&&st.w>(cost.w||0)+150&&st.g>(cost.g||0)+100){
        pay(p,cost);un[want]=1;applyUni(p,want);}}
  }
  // train military (mixed composition) — but bank resources when an age-up is due
  const nextAge=ageCostOf(p,st.age+1);
  const ageGate=st.age<3?[0,120,330,620][st.age+1]-cfg.trickle*40:1e9;
  const saveForAge=!st.aging&&st.age<3&&G.t>ageGate&&vills.length>=cfg.vT[st.age]-1
    &&(st.f<(nextAge.f||0)+150||st.g<(nextAge.g||0)+80);
  const ramCount=G.units.filter(u=>u.p===p&&u.type==='ram').length;
  const nOf=tt=>G.units.filter(u=>u.p===p&&u.type===tt&&u.hp>0).length;
  for(const b of G.blds){
    // banking for an age-up halts MILITARY spending — but the market only
    // trains trade carts, which are what earns the gold being banked for
    if(saveForAge&&b.type!=='market')continue;
    if(b.p!==p||!b.built)continue;const def=BLDS[b.type];
    if(!def.trains||b.type==='tc')continue;
    const baseTrains=trainsFor(b,p);
    const fisherCount=G.units.filter(u=>u.p===p&&UNITS[u.type].fisher).length;
    const warshipCount=G.units.filter(u=>u.p===p&&UNITS[u.type].ship&&!UNITS[u.type].passive&&!UNITS[u.type].fisher).length;
    const opts=baseTrains.filter(tt=>{const ud=UNITS[tt];
      if(ud.age!==undefined&&st.age<ud.age)return false;
      if(tt==='ram'&&ramCount>=3)return false;
      if((tt==='scorpion'||tt==='mangonel'||tt==='bombard')&&nOf(tt)>=2)return false;
      if(tt==='treb'&&nOf(tt)>=2)return false;   // SAMPLEAI keeps a small treb park
      if(tt==='monk'&&nOf('monk')>=[1,2,4][diffSel])return false; // monks scale with difficulty
      if(tt==='petard'||tt==='missionary')return false; // AI keeps it simple
      if(tt==='transport'||tt==='fireship'||tt==='demo')return false;
      // traders need a trade PARTNER; without one the unit would idle forever
      if(tt==='cog'&&(nOf('cog')>=1||!G.blds.some(b2=>b2.p!==p&&b2.type==='dock'&&b2.built)))return false;
      if(tt==='tradecart'&&(nOf('tradecart')>=2||!G.blds.some(b2=>b2.p!==p&&b2.type==='market'&&b2.built)))return false;
      if(tt==='fishing'&&fisherCount>=2)return false;
      if(ud.ship&&!ud.fisher&&warshipCount>=3)return false;
      return true;});
    if(!opts.length)continue;
    ai.trainSeq=(ai.trainSeq||0)+1;
    const ut=opts[ai.trainSeq%opts.length];
    const uc=unitCostOf(p,ut);
    if(b.queue.length<1&&canAfford(p,uc)&&popUsed(p)<popCap(p))
      {pay(p,uc);b.queue.push(ut);}
  }
  // CPSB-style town defense: when raiders reach the town the villagers duck
  // into the Town Hall (adding to its arrows); back to work once it's quiet
  const tcC={x:tc.tx+1,y:tc.ty+1};
  const danger=G.units.some(e=>!allied(e.p,p)&&e.hp>0
    &&e.type!=='villager'&&!UNITS[e.type].passive&&!UNITS[e.type].fisher&&!isAnimal(e)
    &&hyp(e.x-tcC.x,e.y-tcC.y)<8); // a boar in the fields is not an invasion
  if(danger){
    ai.lastDanger=G.t;
    for(const v of vills){
      if(v.state==='toGar'||v._gar)continue;
      if(tc.gar.length>=bldGarCap(tc))break;
      if(hyp(v.x-tcC.x,v.y-tcC.y)<8)cmdGarrison(v,tc);
    }
  }else if(ai.lastDanger&&G.t-ai.lastDanger>10){
    ai.lastDanger=null;
    if(tc.gar&&tc.gar.some(g=>g.type==='villager'))ejectGarrison(tc);
  }
  // Regicide: the King belongs behind stone — castle first, Town Hall failing
  // that. If his shelter falls (or the quiet-eject dumps him out with the
  // villagers) he simply walks back in on the next think.
  if(G.regicide){
    const king=G.units.find(u=>u.p===p&&UNITS[u.type].king&&u.hp>0);
    if(king&&king.state==='idle'&&!king._gar){
      const keep=myBld('castle').find(b=>b.built)||tc;
      if(keep.gar.length<bldGarCap(keep))cmdGarrison(king,keep);
    }
  }
  // villager jobs
  for(const v of vills){
    if(v.state!=='idle')continue;
    const gathering=t=>vills.filter(x=>{
      if(x.farm&&t==='food')return true;
      if(x.resKey&&G.res[x.resKey])return G.res[x.resKey].type===t;
      return x.carryType===t&&x.carry>0;}).length;
    const nF=gathering('food'),nW=gathering('wood'),nG=gathering('gold');
    // gatherer split by age, straight from the CD's SAMPLEAI.PER
    // (Dark 60F/40W, Feudal 35F/25W/40G, Castle+ 30F/30W/40G)
    const AIG=[[.6,.4],[.35,.25],[.3,.3],[.3,.3]][st.age];
    const wantF=Math.ceil(vills.length*AIG[0]),wantW=Math.ceil(vills.length*AIG[1]);
    let want='gold';
    if(nF<wantF)want='food';else if(nW<wantW)want='wood';
    if(want==='food'){const f=freeFarm(v);
      if(f){cmdFarm(v,f);continue;}
      const k=nearestRes(v,'food');if(k){cmdGather(v,k);continue;}want='wood';}
    let k=nearestRes(v,want);
    if(!k)k=nearestRes(v,'wood')||nearestRes(v,'gold')||nearestRes(v,'food');
    if(k)cmdGather(v,k);
  }
  // builders for unbuilt sites
  const site=G.blds.find(b=>b.p===p&&!b.built);
  if(site&&!vills.some(v=>v.state==='building'||v.state==='toBuild')){
    const v=vills.find(v=>v.state!=='building'&&v.state!=='toBuild');
    if(v)cmdBuild(v,site);}
  // idle fishing ships go to the nearest school
  for(const sh of G.units){
    if(sh.p!==p||!UNITS[sh.type].fisher||sh.hp<=0||sh.state!=='idle')continue;
    const k=nearestRes(sh,'fish');
    if(k)cmdGather(sh,k);
  }
  // attack waves
  if(G.t>=ai.nextAtk){
    // temperament shapes the drumbeat — but only after the opening (persOn)
    const wMul=persOn?[.6,1.35,1.55,.85][pers]:1;
    const nMul=persOn?[.7,1.45,1.25,1][pers]:1;
    const need=Math.min(Math.max(3,Math.round((4+ai.wave*cfg.waveGrow)*nMul)),24);
    if(army.length>=need){
      const tgt=nearestEnemyBld(tc,p);
      if(tgt){
        ai.wave++;ai.nextAtk=G.t+cfg.waveEvery*wMul;ai.attacking=true;ai.tgtId=tgt.ent.id;
        for(const a of army){a.wave=tgt.ent.id;cmdAttack(a,tgt.ent,tgt.bld);}
        if(tgt.ent.p===localP){feed('Warning! An enemy army marches on your town!',true);snd('horn');
          const wc=tgt.bld?bldCenter(tgt.ent):tgt.ent;
          const pgs=G.pings||(G.pings=[]);pgs.push({x:wc.x,y:wc.y,t:G.t});if(pgs.length>6)pgs.shift();}
        else if(allied(tgt.ent.p,localP))feed('Your ally is under attack!',true);
      }
    } else ai.nextAtk=G.t+25;
  }
  // idle military regroup / rejoin the current offensive
  for(const a of army){
    if(a.state!=='idle')continue;
    if(ai.attacking){
      const tb=G.blds.find(b=>b.id===ai.tgtId);
      if(tb){a.wave=tb.id;cmdAttack(a,tb,true);}
      else ai.attacking=false;
    }
  }
}
function nearestEnemyBld(fromB,p){
  // a rising enemy Wonder outranks every other target
  if(G.wonderT&&!allied(G.wonderT.p,p)){
    const wb=G.blds.find(b=>b.id===G.wonderT.id&&b.hp>0);
    if(wb)return{ent:wb,bld:true};
  }
  const c=bldCenter(fromB);let best=null,bd=1e9;
  for(const b of G.blds){if(allied(b.p,p))continue;
    const bc=bldCenter(b),d=hyp(bc.x-c.x,bc.y-c.y);
    if(d<bd){bd=d;best={ent:b,bld:true};}}
  return best;
}
function aiPlace(type,ncx,ncy,p){
  if(p===undefined)p=1;
  const tc=G.blds.find(b=>b.p===p&&b.type==='tc');if(!tc)return;
  const ox=ncx!==undefined?ncx:tc.tx,oy=ncy!==undefined?ncy:tc.ty;
  const def=BLDS[type];
  for(let r=2;r<12;r++){
    for(let a=0;a<16;a++){
      const ang=a/16*Math.PI*2;
      const tx=Math.round(ox+dCos(ang)*r),ty=Math.round(oy+dSin(ang)*r);
      if(canPlace(tx,ty,def.size,1)){
        const bc=bldCostOf(p,type);
        if(!canAfford(p,bc))return;
        pay(p,bc);
        const b=addBld(p,type,tx,ty,false);b.pendCost=bc;
        return;}
    }
  }
}
function canPlace(tx,ty,size,margin,allowFord){
  if(tx<0||ty<0||tx+size>MAP||ty+size>MAP)return false;
  const m=margin||0;
  for(let y=ty-m;y<ty+size+m;y++)for(let x=tx-m;x<tx+size+m;x++){
    if(x<0||y<0||x>=MAP||y>=MAP)continue;
    if(G.map[y][x])return false;
    if(G.ford[x+','+y]&&!allowFord)return false;}
  return true;
}
function canPlaceDock(tx,ty){
  // 2x2 of open deep water (not fords — a dock there would dam the crossing),
  // hugging at least one land tile so villagers can reach it to build
  let touchLand=false;
  for(let y=ty;y<ty+2;y++)for(let x=tx;x<tx+2;x++){
    if(x<0||y<0||x>=MAP||y>=MAP)return false;
    const k=x+','+y;
    if(!G.water[k]||(G.navBlock&&G.navBlock[k]))return false;
    if(G.res[k])return false;
  }
  for(let y=ty-1;y<ty+3;y++)for(let x=tx-1;x<tx+3;x++){
    if(x<0||y<0||x>=MAP||y>=MAP)continue;
    const k=x+','+y;
    if(!G.water[k]&&!G.ford[k])touchLand=true;
  }
  if(!touchLand)return false;
  // and it must not dam the channel: every open-water tile ringing the berth
  // must stay mutually connected once the footprint is taken (local flood fill)
  const inFoot=(x,y)=>x>=tx&&x<tx+2&&y>=ty&&y<ty+2;
  const ring=[];
  for(let y=ty-1;y<ty+3;y++)for(let x=tx-1;x<tx+3;x++)
    if(!inFoot(x,y)&&passableW(x,y))ring.push([x,y]);
  if(!ring.length)return false;
  const seen=new Set([ring[0][0]+','+ring[0][1]]);
  const stack=[ring[0]];let guard=0;
  while(stack.length&&guard++<500){
    const[x,y]=stack.pop();
    for(const[dx,dy] of[[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,ny=y+dy,k=nx+','+ny;
      if(seen.has(k)||inFoot(nx,ny))continue;
      if(Math.abs(nx-tx)>9||Math.abs(ny-ty)>9)continue;
      if(!passableW(nx,ny))continue;
      seen.add(k);stack.push([nx,ny]);
    }
  }
  return ring.every(([x,y])=>seen.has(x+','+y));
}
function canPlaceType(type,tx,ty){
  if(type==='dock')return canPlaceDock(tx,ty);
  return canPlace(tx,ty,BLDS[type].size,0,!!BLDS[type].thin);
}
