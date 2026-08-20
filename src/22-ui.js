/* ================= UI panel ================= */
const btnRow=document.getElementById('btnRow'),cardName=document.getElementById('cardName'),
  cardPort=document.getElementById('cardPort'),hpFill=document.getElementById('hpFill'),
  hpTxt=document.getElementById('hpTxt'),statRows=document.getElementById('statRows'),
  civLine=document.getElementById('civLine'),selGrid=document.getElementById('selGrid'),
  scrollHint=document.getElementById('scrollHint');
const ICO={atk:'<svg viewBox="0 0 16 16"><path d="M2 14l8-8 1-3 3-1-1 3-3 1-8 8z" fill="#d8dbdf"/><path d="M4 10l2 2-2.4 1.6L2 14z" fill="#8a6a1a"/></svg>',
  rng:'<svg viewBox="0 0 16 16"><path d="M3 13L13 3m0 0h-4m4 0v4" stroke="#d8dbdf" stroke-width="1.6" fill="none"/></svg>',
  spd:'<svg viewBox="0 0 16 16"><path d="M3 12h6l3-3-2-5-4 2v4z" fill="#c9b587"/></svg>',
  gar:'<svg viewBox="0 0 16 16"><path d="M8 2l6 4v8H2V6z" fill="none" stroke="#c9b587" stroke-width="1.4"/></svg>',
  crown:'<svg viewBox="0 0 16 16"><path d="M2 11l1-6 3 3 2-5 2 5 3-3 1 6z" fill="#f0d878" stroke="#8a6a1a" stroke-width=".8"/><rect x="2" y="11" width="12" height="2.5" fill="#c9a227" stroke="#8a6a1a" stroke-width=".6"/></svg>'};
function setCard(name,port,hp,maxhp,stats){
  cardName.textContent=name;cardPort.src=port||portraitFor('crest',0,localP);
  if(hp!=null){hpFill.style.width=(100*hp/maxhp)+'%';
    hpFill.style.background=hp/maxhp>.4?'linear-gradient(#7fce5a,#3f7d26)':'linear-gradient(#e06a52,#a03325)';
    hpTxt.textContent=Math.ceil(hp)+'/'+maxhp;}
  else{hpFill.style.width='0%';hpTxt.textContent='';}
  statRows.innerHTML=(stats||[]).map(([i,v])=>'<span>'+ICO[i]+v+'</span>').join('');
}
const hint=s=>{scrollHint.innerHTML=s||'';};
function setCiv(){civLine.innerHTML='<b>'+CIVS[G.P[localP].civ||0].name+'</b><span>'+AGES[G.P[localP].age]+'</span>';}
function mkBtn(html,cls,fn,dis,icon){
  const b=document.createElement('button');
  b.className='cmd'+(cls?' '+cls:'')+((icon||/<i>/.test(html))?'':' txt');
  if(icon){const im=new Image();im.src=icon;b.appendChild(im);
    b.insertAdjacentHTML('beforeend',html.replace(/<i>[^]*?<\/i>/,''));}
  else b.innerHTML=html;
  if(dis)b.disabled=true;else b.onclick=()=>{snd('click');fn();};
  btnRow.appendChild(b);
  // hover writes the command onto the parchment, AoE2-style (mouse only)
  const tip=html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  b.setAttribute('aria-label',tip);   // screen readers get the same words
  b.onmouseenter=()=>{if(!mouseSeen)return;
    b._prev=scrollHint.innerHTML;
    scrollHint.innerHTML='<b style="color:#2a1f12">'+tip+'</b>'+(b.disabled?' <i style="color:#8a2f27">(unavailable)</i>':'');};
  b.onmouseleave=()=>{if(b._prev!=null){scrollHint.innerHTML=b._prev;b._prev=null;}};
  return b;
}
function refreshPanel(){
  if(!G)return;
  updateDeselBtn();
  btnRow.innerHTML='';selGrid.innerHTML='';setCiv();
  if(G.placing){
    const d=BLDS[G.placing];
    setCard('Place '+d.name,portraitFor('b',G.placing,localP),null);
    if(G.placing==='wall'||G.placing==='swall'){
      hint(!G.wallA?'Tap where the wall starts':
        (G.pendLine?'Confirm, or tap a new end point':'Tap where the wall ends'));
      if(G.pendLine){
        const segs=G.pendLine.filter(s2=>canPlaceType(G.placing,s2.tx,s2.ty));
        const lc=bldCostOf(localP,G.placing); // Mayan walls are half price — say so
        mkBtn('<b>✓ Build '+segs.length+' sections</b><span class="cost">'+costStr(lc)+' each</span>','go',()=>{
          const afford=Math.floor(Math.min(...['f','w','g'].map(r2=>lc[r2]?G.P[localP][r2]/lc[r2]:Infinity)));
          if(afford<segs.length)toast('Out of resources — placing '+Math.max(0,afford)+' sections');
          issue('placeLine',{t:G.placing,tiles:segs.map(s2=>[s2.tx,s2.ty]),
            u:G.sel.map(id=>G.units.find(u=>u.id===id)).filter(u=>u&&u.type==='villager').map(u=>u.id)});
          G.placing=null;G.wallA=null;G.pendLine=null;
          updateTop();refreshPanel();
        },!segs.length);
        mkBtn('<b>↺ Restart line</b>',null,()=>{G.wallA=null;G.pendLine=null;refreshPanel();});
      }
      mkBtn('<b>✕ Cancel</b>','warn',()=>{G.placing=null;G.wallA=null;G.pendLine=null;refreshPanel();});
      return;
    }
    hint('Tap the map to choose a spot');
    if(G.pend){
      const ok=canPlaceType(G.placing,G.pend.tx,G.pend.ty);
      mkBtn('<b>✓ Build here</b>','go',()=>{
        if(!canPlaceType(G.placing,G.pend.tx,G.pend.ty)){toast('Blocked — pick open ground');return;}
        if(!canAfford(localP,bldCostOf(localP,G.placing))){toast('Not enough resources');return;}
        issue('place',{t:G.placing,tx:G.pend.tx,ty:G.pend.ty,
          u:G.sel.map(id=>G.units.find(u=>u.id===id)).filter(u=>u&&u.type==='villager').map(u=>u.id)});
        G.placing=null;G.pend=null;updateTop();refreshPanel();
      },!ok);
    }
    mkBtn('<b>✕ Cancel</b>','warn',()=>{G.placing=null;G.pend=null;refreshPanel();});
    return;
  }
  const ents=G.sel.map(id=>G.units.find(u=>u.id===id)||G.blds.find(b=>b.id===id)).filter(Boolean);
  if(ents.length)G.inspect=null;
  if(!ents.length){
    if(G.inspect){
      const insp=G.inspect;
      if(insp.res){
        const r=G.res[insp.res];
        if(r){
          const RN={wood:'Tree',gold:'Gold Mine',food:'Berry Bush',fish:'Fishery'};
          setCard(r.sub==='meat'?'Carcass':(RN[r.type]||r.type),portraitFor('res',r.sub||r.type,0),null);
          hint('<b>'+Math.ceil(r.amt)+'</b> '+(r.type==='food'?'food':r.type)+' left · '
            +(mouseSeen?'right-click':'tap')+' with villagers to '+(r.sub==='meat'?'butcher':'gather'));
          mkBtn('<b>Deselect</b>',null,()=>{G.inspect=null;refreshPanel();});
          return;
        }
        G.inspect=null;
      }else{
        const eu=G.units.find(u=>u.id===insp.id);
        const t=eu||G.blds.find(b=>b.id===insp.id);
        if(t&&t.hp>0){
          const nm=eu?unitName(t.type,t.p):BLDS[t.type].name;
          setCard(nm,portraitFor(eu?'u':'b',t.type,t.p),t.hp,t.maxhp);
          hint(eu&&isAnimal(t)
            ?(UNITS[t.type].meat+' food · '+(mouseSeen?'right-click':'tap')+' it with villagers to hunt'
              +(UNITS[t.type].fierce?' — it will fight back':''))
            :allied(t.p,localP)?'An ally\'s '+nm:'An enemy '+nm);
          mkBtn('<b>Deselect</b>',null,()=>{G.inspect=null;refreshPanel();});
          return;
        }
        G.inspect=null;
      }
    }
    setCard('Tiny Conquerors',portraitFor('crest',0,localP),null);
    hint('Tap a villager or building');
    mkBtn('<b>Idle villager</b><span class="cost">.</span>',null,cycleIdleVill,false,portraitFor('u','villager',localP));
    mkBtn('<b>Select army</b><span class="cost">,</span>',null,()=>{
      const a=G.units.filter(u=>u.p===localP&&u.type!=='villager'&&!isAnimal(u));
      if(a.length){G.sel=a.map(u=>u.id);centerOn(a[0].x,a[0].y);refreshPanel();}
      else toast('You have no soldiers yet');},false,portraitFor('u','militia',localP));
    mkBtn('<b>Town Hall</b><span class="cost">H</span>',null,selTC,false,portraitFor('b','tc',localP));
    return;
  }
  const first=ents[0];
  if(first.tx!==undefined){ // building
    const b=first,d=BLDS[b.type];
    if(!b.built){
      setCard(d.name,portraitFor('b',b.type,localP),b.hp,b.maxhp);
      hint('Under construction — '+(mouseSeen?'right-click':'tap')+' it with villagers selected to help build');
      const db=mkBtn('<b>Demolish</b>','warn',()=>{
        if(!db._arm){db._arm=1;db.innerHTML='<b>Demolish — sure?</b>';
          setTimeout(()=>{if(db.isConnected){db._arm=0;db.innerHTML='<b>Demolish</b>';}},2500);return;}
        issue('del',{ids:[b.id]});});
      return;}
    setCard(d.name,portraitFor('b',b.type,localP),b.hp,b.maxhp,
      [...(d.atk?[['atk',d.atk]]:[]),...(d.garCap?[['gar',b.gar.length+'/'+d.garCap]]:[])]);
    hint(d.trains&&d.trains.length||b.type==='castle'?'Train from the buttons on the left':'');
    if(b.gar.length)
      mkBtn('<b>⇱ Ungarrison '+b.gar.length+'</b>',null,()=>{issue('ungar',{id:b.id});});
    if(b.type==='market'){
      // Saracens trade at almost no fee (manual: 5% market fee)
      const sar=civOf(localP).mktRate,sell=sar?95:70,buy=sar?105:80;
      const trade=(give,get)=>{
        const need=give==='g'?buy:100;
        if(G.P[localP][give]<need){toast('Not enough '+(give==='f'?'food':give==='w'?'wood':'gold'));return;}
        issue('trade',{give,get});};
      mkBtn('<i>🍖</i><b>Sell 100 Food</b><span class="cost">→ '+sell+'G</span>',null,()=>trade('f','g'),G.P[localP].f<100);
      mkBtn('<i>🪵</i><b>Sell 100 Wood</b><span class="cost">→ '+sell+'G</span>',null,()=>trade('w','g'),G.P[localP].w<100);
      mkBtn('<i>🍖</i><b>Buy 100 Food</b><span class="cost">'+buy+'G →</span>',null,()=>trade('g','f'),G.P[localP].g<buy);
      mkBtn('<i>🪵</i><b>Buy 100 Wood</b><span class="cost">'+buy+'G →</span>',null,()=>trade('g','w'),G.P[localP].g<buy);
      // Diplomacy: tribute 100 of a resource to a living ally (25% carrying fee)
      const allies=[];
      for(let p2=0;p2<NP;p2++)
        if(p2!==localP&&allied(p2,localP)&&G.blds.some(bb=>bb.p===p2&&bb.type==='tc'))allies.push(p2);
      for(const al of allies.slice(0,2)){
        const nm=(netPlayers.find(pp=>pp.seat===al)||{}).name||CIVS[G.P[al].civ].name;
        const RIC={f:'🍖',w:'🪵',g:'🪙'};
        for(const rk of ['f','w','g']){
          const sb=mkBtn('<i>'+RIC[rk]+'</i><b>100 → '+nm+'</b><span class="cost">costs 125</span>','txt',
            ()=>{if(G.P[localP][rk]<125){toast('Sending 100 costs 125 — the caravan takes a fee');return;}
              issue('tribute',{give:rk,to:al});},G.P[localP][rk]<125);
          sb.style.height='30px';sb.style.fontSize='9.5px';sb.style.gridColumn='auto';
        }
      }
    }
    if(b.type==='monastery'){
      const dep=G.relics.filter(r=>r.mon===b.id).length;
      if(dep)hint('✨ '+dep+' relic'+(dep>1?'s':'')+' enshrined (+'+(dep*33)+' gold/min)');
    }
    if(b.type==='blacksmith'){
      const bs=bsOf(localP);
      hint('Research upgrades — each line has three tiers, gated by age');
      for(const line of ['atk','arw','ia','aa','ca']){
        const tier=bs[line];
        if(tier>=3)continue;
        const T=BS_TECHS[line],cost=T.costs[tier],needAge=tier+1;
        const locked=G.P[localP].age<needAge;
        mkBtn('<i>'+T.icon+'</i><b>'+T.names[tier]+'</b><span class="cost">'+costStr(cost)+'</span>','txt',
          ()=>{if(G.P[localP].age<needAge){toast('Requires the '+AGES[needAge]);return;}
            if(!canAfford(localP,cost)){toast('Not enough resources');return;}
            issue('tech',{kind:'bs',id:line});},
          locked||!canAfford(localP,cost));
      }
      if(['atk','arw','ia','aa','ca'].every(l=>bs[l]>=3))
        hint('The forge is quiet — every upgrade is complete');
    }
    if(b.type==='university'){
      const un=uniOf(localP);
      hint('Research the sciences of war and works');
      for(const id of UNI_ORDER){
        if(un[id])continue;
        const T=UNI_TECHS[id];
        if(T.req&&!un[T.req])continue; // Architecture needs Masonry, Bombard Tower needs Chemistry
        const locked=G.P[localP].age<T.age;
        mkBtn('<i>'+T.icon+'</i><b>'+T.name+'</b><span class="cost">'+costStr(T.cost)+'</span>','txt',
          ()=>{if(G.P[localP].age<T.age){toast('Requires the '+AGES[T.age]);return;}
            if(!canAfford(localP,T.cost)){toast('Not enough resources');return;}
            issue('tech',{kind:'uni',id});},
          locked||!canAfford(localP,T.cost));
      }
      if(UNI_ORDER.every(id=>un[id]))hint('Every science is mastered');
    }
    if(b.type==='range'&&!G.P[localP].pt){
      const cost={f:200,g:250},locked=G.P[localP].age<3;
      mkBtn('<i>🐴</i><b>Parthian Tactics</b><span class="cost">'+costStr(cost)+'</span>','txt',
        ()=>{if(G.P[localP].age<3){toast('Requires the '+AGES[3]);return;}
          if(!canAfford(localP,cost)){toast('Not enough resources');return;}
          issue('tech',{kind:'pt'});},
        locked||!canAfford(localP,cost));
    }
    // economy & line technologies researched at this building (manual pp. 47-49)
    for(const id in ECO_TECHS){
      const T=ECO_TECHS[id];
      if(T.bld!==b.type)continue;
      const tier=ecoTier(localP,id);
      if(tier>=ecoMax(id))continue;
      const nm=T.names?T.names[tier]:T.name;
      const cost=T.costs?T.costs[tier]:T.cost;
      const needAge=T.ages?T.ages[tier]:T.age;
      const locked=G.P[localP].age<needAge;
      mkBtn('<i>'+T.icon+'</i><b>'+nm+'</b><span class="cost">'+costStr(cost)+'</span>','txt',
        ()=>{if(G.P[localP].age<needAge){toast('Requires the '+AGES[needAge]);return;}
          if(!canAfford(localP,cost)){toast('Not enough resources');return;}
          issue('tech',{kind:'eco',id});},
        locked||!canAfford(localP,cost));
    }
    if(b.type==='dock'){ // Fish Trap: seed a fresh fishery in the waters beside the dock
      const ftCost={w:100};
      mkBtn('<i>🐟</i><b>Fish Trap</b><span class="cost">100W</span>','txt',()=>{
        if(!canAfford(localP,ftCost)){toast('Not enough wood');return;}
        issue('fishtrap',{id:b.id});
      },!canAfford(localP,ftCost));
    }
    const trainsList=trainsFor(b,localP);
    for(const ut of trainsList){
      const u=UNITS[ut];
      const uc=unitCostOf(localP,ut);
      const locked=u.age!==undefined&&G.P[localP].age<u.age;
      const afford=canAfford(localP,uc)&&popUsed(localP)<popCap(localP);
      // shift-click queues five at once; long-press does the same on a phone
      const tb2=mkBtn('<b>'+unitName(ut,localP)+'</b><span class="cost">'+costStr(uc)+'</span>',null,
        ()=>{const n5=shiftDown?5:1;for(let q5=0;q5<n5;q5++)tryTrainKey(b,ut);},
        locked||!afford,portraitFor('u',ut,localP));
      if(!tb2.disabled){
        tb2.addEventListener('pointerdown',()=>{
          tb2._lp=setTimeout(()=>{for(let q5=0;q5<4;q5++)tryTrainKey(b,ut);buzz(12);},480);});
        const lpEnd=()=>clearTimeout(tb2._lp);
        tb2.addEventListener('pointerup',lpEnd);
        tb2.addEventListener('pointerleave',lpEnd);
        tb2.addEventListener('pointercancel',lpEnd);
      }
    }
    if(b.type==='castle'){
      const nu=nextUtFor(localP);
      if(nu){
        const T=UTECHS[nu],locked=G.P[localP].age<T.age;
        mkBtn('<i>'+ICO.crown+'</i><b>'+T.name+'</b><span class="cost">'+costStr(T.cost)+'</span>','txt',
          ()=>{if(G.P[localP].age<T.age){toast('Requires the '+AGES[T.age]);return;}
            if(!canAfford(localP,T.cost)){toast('Not enough resources');return;}
            issue('tech',{kind:'ut',id:nu});},
          locked||!canAfford(localP,T.cost));
        hint(T.name+': '+T.desc+(locked?' (requires the '+AGES[T.age]+')':''));
      }
    }
    if(b.type==='tc'&&G.P[localP].age<3){
      const nc=ageCostOf(localP,G.P[localP].age+1);
      const busy=G.P[localP].aging;
      mkBtn('<i>'+ICO.crown+'</i><b>Advance to '+AGES[G.P[localP].age+1]+'</b><span class="cost">'+costStr(nc)+' · A</span>','go',
        ()=>tryAgeKey(b),busy||!canAfford(localP,nc));
    }
    if(b.queue.length){
      const label=b.queue[0]==='AGE'?'Advancing…':'Training '+unitName(b.queue[0],localP)+' ×'+b.queue.filter(q=>q===b.queue[0]).length;
      const w=document.createElement('div');w.style.cssText='grid-column:1/-1;font-size:11.5px;color:#bfae86;';
      w.textContent=label;btnRow.appendChild(w);
    }
    return;
  }
  // units
  const vills=ents.filter(u=>u.type==='villager');
  const beasts=ents.filter(u=>isAnimal(u));
  const mil=ents.filter(u=>u.type!=='villager'&&!isAnimal(u));
  const u0=ents[0],ud=UNITS[u0.type];
  if(ents.length===1){
    // high ground must READ: +25% damage is the terrain's whole meaning
    const onHill=G.elev&&G.elev[(u0.y|0)*MAP+(u0.x|0)];
    setCard(unitName(u0.type,localP)+(onHill?' ⛰':''),portraitFor('u',u0.type,localP),u0.hp,u0.maxhp,
      [['atk',onHill?atkOf(u0)+'↑':atkOf(u0)],...(ud.range>1?[['rng',rangeOf(u0)]]:[]),['spd',speedOf(u0).toFixed(1)],
       ...(ud.garCap?[['gar',(u0.gar?u0.gar.length:0)+'/'+ud.garCap]]:[])]);
    if(onHill)hint('⛰ Holding the high ground — +25% damage dealt, less taken');
    if(ud.garCap&&u0.gar&&u0.gar.length)
      mkBtn('<b>⇱ '+(ud.ship?'Unload':'Ungarrison')+' '+u0.gar.length+'</b>',null,()=>{
        // transports set their passengers down on the nearest dry land
        if(ud.ship&&!nearFree(Math.floor(u0.x),Math.floor(u0.y),4)){
          toast('No landing ground — steer closer to shore');return;}
        issue('unload',{id:u0.id});});
  }else{
    const names={};for(const u of ents){const nm=unitName(u.type,localP);names[nm]=(names[nm]||0)+1;}
    setCard(ents.length+' units',portraitFor('u',u0.type,localP),null);
    hint(Object.entries(names).map(([n,c])=>c>1?c+' '+n+'s':n).join(', '));
    for(const u of ents.slice(0,24)){ // AoE2 portrait row — tap a tile to pick that unit
      const t2=document.createElement('button');t2.className='ptile';t2.dataset.id=u.id;
      t2.innerHTML='<img src="'+portraitFor('u',u.type,localP)+'"><i style="width:'+(100*u.hp/u.maxhp)+'%"></i>';
      t2.onclick=()=>{snd('click');G.sel=[u.id];refreshPanel();};
      selGrid.appendChild(t2);}
    if(ents.length>24)selGrid.insertAdjacentHTML('beforeend','<span class="more">+'+(ents.length-24)+'</span>');
  }
  if(beasts.length&&!vills.length&&!mil.length){
    // a herded flock: walk it home, then send villagers to slaughter it
    hint('Your flock — '+(mouseSeen?'right-click':'tap')+' ground to drive them along. '
      +beasts.reduce((s,b2)=>s+(UNITS[b2.type].meat||0),0)+' food on the hoof.');
    mkBtn('<b>Stop</b>',null,()=>{issue('stop',{u:beasts.map(b2=>b2.id)});});
    return;
  }
  if(vills.length&&!mil.length){
    if(ents.length===1)hint(mouseSeen
      ?'Right-click resources to gather · right-click ground to move'
      :'Tap resources to gather · tap ground to move');
    // AoE2-style build tabs: Economy / Military / Defense. Twenty buildings never
    // fit a phone's button grid, and the original split them the same way.
    const tabBtn=(id,label,icon)=>{
      const b=mkBtn('<i>'+icon+'</i><b>'+label+'</b>',buildTab===id?'go':'txt',
        ()=>{buildTab=id;refreshPanel();});
      b.style.gridColumn='auto';b.style.height='30px';b.style.fontSize='10.5px';
      return b;};
    tabBtn('eco','Economy','🌾');tabBtn('mil','Military','⚔️');tabBtn('def','Defense','🗼');
    for(const bt of BUILD_TABS[buildTab]){
      if(bt==='stable'&&civOf(localP).noStable)continue; // Aztecs/Mayans field no cavalry
      if(bt==='house'&&civOf(localP).noHouse)continue;   // Huns need no Houses
      const d=BLDS[bt];
      const bc=bldCostOf(localP,bt);
      const locked=d.age!==undefined&&G.P[localP].age<d.age;
      mkBtn('<b>'+d.name+'</b><span class="cost">'+costStr(bc)+'</span>',null,
        ()=>startBuildKey(bt),locked||!canAfford(localP,bc),portraitFor('b',bt,localP));
    }
  }else{
    // the high-ground notice set above must survive this default hint
    if(ents.length===1&&!(G.elev&&G.elev[(u0.y|0)*MAP+(u0.x|0)]))
      hint(G.pmode?'Tap the far end of the patrol beat'
      :G.amode?'Tap the map — they will fight their way there':mouseSeen
      ?'Right-click an enemy to attack · right-click ground to move'
      :'Tap an enemy to attack · tap ground to move');
    mkBtn('<i>'+ICO.atk+'</i><b>Attack-move</b>',G.amode?'go':'txt',()=>{
      G.amode=!G.amode;G.pmode=false;refreshPanel();
      if(G.amode)toast('Now tap the destination');});
    mkBtn('<i>⇄</i><b>Patrol</b>',G.pmode?'go':'txt',()=>{
      G.pmode=!G.pmode;G.amode=false;refreshPanel();
      if(G.pmode)toast('Now tap the far end of the beat');});
    const FRM=[['⬛','Box'],['—','Line'],['⋯','Loose'],['‖','Column']];
    mkBtn('<i>'+FRM[formSel][0]+'</i><b>'+FRM[formSel][1]+'</b>','txt',()=>{
      formSel=(formSel+1)%4;refreshPanel();
      toast('Formation: '+FRM[formSel][1]+' — applies to the next move order');});
    // stance row — four small buttons, the shared stance highlighted
    const milIds=mil.map(u=>u.id);
    const st0=mil.length?(mil[0].stance|0):0;
    const sameSt=mil.every(u=>(u.stance|0)===st0);
    const SN=[['⚔','Aggressive'],['🛡','Defensive'],['⚓','Stand ground'],['✋','No attack']];
    SN.forEach(([ic,nm],i)=>{
      const sb=mkBtn('<i>'+ic+'</i><b>'+nm+'</b>',(sameSt&&st0===i)?'go':'txt',
        ()=>{issue('stance',{u:milIds,s:i});toast('Stance: '+nm);});
      sb.style.gridColumn='auto';sb.style.height='30px';sb.style.fontSize='9.5px';
    });
  }
  mkBtn('<b>Stop</b>',null,()=>{
    issue('stop',{u:ents.filter(e=>e.x!==undefined).map(e=>e.id)});G.amode=false;G.pmode=false;});
  // (Deselect lives on the always-visible ✕ button beside the zoom controls)
}
function updateCard(){ // light HP patcher — no DOM rebuild mid-press
  if(G.placing)return; // placement card shows no HP; don't overwrite it
  const ents=G.sel.map(id=>G.units.find(u=>u.id===id)||G.blds.find(b=>b.id===id)).filter(Boolean);
  if(!ents.length)return;
  const tiles=selGrid.querySelectorAll('.ptile');
  if(tiles.length&&ents.length!==tiles.length&&ents.length<=24){refreshPanel();return;}
  const e0=ents[0];
  if(e0.maxhp&&ents.length===1){
    hpFill.style.width=(100*e0.hp/e0.maxhp)+'%';
    hpFill.style.background=e0.hp/e0.maxhp>.4?'linear-gradient(#7fce5a,#3f7d26)':'linear-gradient(#e06a52,#a03325)';
    hpTxt.textContent=Math.ceil(e0.hp)+'/'+e0.maxhp;
  }
  for(const t2 of tiles){
    const u=ents.find(e=>e.id==t2.dataset.id);
    if(u)t2.lastElementChild.style.width=(100*u.hp/u.maxhp)+'%';
  }
}
function updateInspect(){ // patch the inspect card in place — never rebuild (taps would be swallowed)
  const insp=G.inspect;
  if(!insp)return;
  if(insp.res){
    const r=G.res[insp.res];
    if(!r){G.inspect=null;refreshPanel();return;}
    hint('<b>'+Math.ceil(r.amt)+'</b> '+(r.type==='food'?'food':r.type)+' left · '
      +(mouseSeen?'right-click':'tap')+' with villagers to '+(r.sub==='meat'?'butcher':'gather'));
  }else{
    const eu=G.units.find(u=>u.id===insp.id);
    const t=eu||G.blds.find(b=>b.id===insp.id);
    if(!t||t.hp<=0){G.inspect=null;refreshPanel();return;}
    // only reveal current HP while we can actually see it (no scouting through fog)
    const vis=eu?tileVis(t.x,t.y):tileVis(t.tx+t.size/2,t.ty+t.size/2);
    if(vis){
      hpFill.style.width=(100*t.hp/t.maxhp)+'%';
      hpFill.style.background=t.hp/t.maxhp>.4?'linear-gradient(#7fce5a,#3f7d26)':'linear-gradient(#e06a52,#a03325)';
      hpTxt.textContent=Math.ceil(t.hp)+'/'+t.maxhp;
    }
  }
}
function centerOn(x,y){const p=isoPt(x,y);
  G.cam.x=p.x-vw/G.cam.z/2;G.cam.y=p.y-vh/G.cam.z/2;clampCam();}
function updateTop(){
  if(!G)return;
  document.getElementById('rFood').textContent=Math.floor(G.P[localP].f);
  document.getElementById('rWood').textContent=Math.floor(G.P[localP].w);
  document.getElementById('rGold').textContent=Math.floor(G.P[localP].g);
  document.getElementById('rPop').textContent=popUsed(localP)+'/'+popCap(localP);
  let age=AGES[G.P[localP].age];
  if(mission&&mission.win.type==='survive'&&!G.over){
    const left=Math.max(0,mission.win.time-G.t);
    age+=' · '+Math.floor(left/60)+':'+('0'+Math.floor(left%60)).slice(-2);
  }
  const cds=[];
  if(G.wonderT){const l=Math.max(0,G.wonderT.end-G.t);
    cds.push((allied(G.wonderT.p,localP)?'🏯 ':'⚠️🏯 ')+Math.floor(l/60)+':'+('0'+Math.floor(l%60)).slice(-2));}
  if(G.relicT){const l=Math.max(0,G.relicT.end-G.t);
    cds.push((G.relicT.team===G.teams[0]?'✨ ':'⚠️✨ ')+Math.floor(l/60)+':'+('0'+Math.floor(l%60)).slice(-2));}
  if(cds.length)age+=' · '+cds.join(' ');
  document.getElementById('ageLbl').textContent=age;
}
/* ================= hotkeys ================= */
const BUILD_KEYS={house:'e',farm:'f',camp:'c',barracks:'b',range:'a',stable:'l',siege:'g',castle:'v',tower:'t',wall:'w',gate:'o',swall:'x',sgate:'p',market:'k',monastery:'m',blacksmith:'s',dock:'d',university:'u',wonder:'n'};
const BLD_ICONS={tc:'🏛️',house:'🏠',farm:'🌾',camp:'📦',wall:'🪵',gate:'🚪',swall:'🧱',sgate:'⛩️',
  market:'⚖️',barracks:'⚔️',range:'🏹',stable:'🐎',siege:'⚙️',monastery:'⛪',castle:'🏰',tower:'🗼',blacksmith:'🔨',dock:'⚓',university:'🎓',wonder:'🏯'};
const UNIT_ICONS={villager:'🧑‍🌾',militia:'⚔️',spearman:'🔱',archer:'🏹',skirmisher:'🎯',
  scout:'🐎',knight:'🛡️',ram:'🐏',longbow:'🏹',axeman:'🪓',berserker:'🪓',mangudai:'🏹',
  teuton:'⚔️',woad:'🪓',cataphract:'🛡️',mameluke:'🐪',monk:'📿',huskarl:'🛡️',
  chukonu:'🏹',elephant:'🐘',janissary:'💥',samurai:'⚔️',jaguar:'🐆',eagle:'🦅',
  plumed:'🏹',warwagon:'🛞',conquistador:'💥',tarkan:'🔥',petard:'💣',missionary:'📿',
  fishing:'🎣',cog:'⛵',transport:'🛶',galley:'⚓',fireship:'🔥',demo:'💥',longboat:'🐉',turtle:'🐢',
  scorpion:'🎯',mangonel:'🪨',treb:'🏗️',bombard:'💣',handcannon:'💥',cannongalleon:'💥',
  tradecart:'🛒',king:'👑'};
const TRAIN_KEYS_BY_BLD={tc:{c:'villager'},barracks:{m:'militia',s:'spearman',e:'eagle',h:'huskarl'},
  range:{a:'archer',k:'skirmisher',h:'handcannon'},stable:{s:'scout',k:'knight'},
  siege:{r:'ram',s:'scorpion',m:'mangonel',b:'bombard'},
  market:{t:'tradecart'},
  monastery:{m:'monk',i:'missionary'},castle:{d:'petard',t:'treb'},
  dock:{f:'fishing',c:'cog',t:'transport',g:'galley',i:'fireship',e:'demo',u:'longboat',r:'turtle',n:'cannongalleon'}};
function keyFor(bldType,ut){
  if(bldType==='castle')return 'U';
  const km=TRAIN_KEYS_BY_BLD[bldType]||{};
  for(const k in km)if(km[k]===ut)return k.toUpperCase();
  return '';
}
/* villager build menu, split the way the original did — one screenful each */
const BUILD_TABS={
  eco:['house','farm','camp','market','dock','university','monastery','wonder'],
  mil:['barracks','range','stable','siege','blacksmith','castle'],
  def:['wall','gate','swall','sgate','tower'],
};
let buildTab='eco';
let idleVillIdx=0,idleMilIdx=0;
function cycleIdleVill(){
  const vs=G.units.filter(u=>u.p===localP&&u.type==='villager'&&u.state==='idle');
  if(!vs.length){toast('No idle villagers');return;}
  const v=vs[idleVillIdx++%vs.length];
  G.sel=[v.id];centerOn(v.x,v.y);refreshPanel();
}
function cycleIdleMil(){
  const ms=G.units.filter(u=>u.p===localP&&u.type!=='villager'&&!isAnimal(u)&&u.state==='idle');
  if(!ms.length){toast('No idle soldiers');return;}
  const m=ms[idleMilIdx++%ms.length];
  G.sel=[m.id];centerOn(m.x,m.y);refreshPanel();
}
function selTC(){
  const tc=G.blds.find(b=>b.p===localP&&b.type==='tc');
  if(!tc)return;
  G.sel=[tc.id];const c=bldCenter(tc);centerOn(c.x,c.y);refreshPanel();
}
function tryTrainKey(b,ut){
  if(!b||!b.built)return;
  if(!trainsFor(b,localP).includes(ut))return; // tech-tree gate (eagles, huskarls, missionaries)
  const u=UNITS[ut];
  const uc=unitCostOf(localP,ut);
  if(u.age!==undefined&&G.P[localP].age<u.age){toast('Requires the '+AGES[u.age]);return;}
  if(!canAfford(localP,uc)){toast('Not enough resources');return;}
  if(popUsed(localP)>=popCap(localP)){toast(civOf(localP).noHouse?'Population full':'Build more houses — population full');return;}
  issue('train',{id:b.id,ut});
}
function tryAgeKey(b){
  if(G.P[localP].age>=3||G.P[localP].aging)return;
  const nc=ageCostOf(localP,G.P[localP].age+1);
  if(!canAfford(localP,nc)){toast('Not enough resources');return;}
  issue('age',{id:b.id});
}
function startBuildKey(bt){
  const d=BLDS[bt];
  if(bt==='stable'&&civOf(localP).noStable){toast(civOf(localP).name+' field no cavalry');return;}
  if(bt==='house'&&civOf(localP).noHouse){toast('The Huns need no houses');return;}
  if(d.age!==undefined&&G.P[localP].age<d.age){toast('Requires the '+AGES[d.age]);return;}
  if(!canAfford(localP,bldCostOf(localP,bt))){toast('Not enough resources');return;}
  G.placing=bt;G.pend=null;G.wallA=null;G.pendLine=null;refreshPanel();
  toast((bt==='wall'||bt==='swall')?'Tap where the wall starts':'Tap the map to place the '+d.name);
}
window.addEventListener('keydown',e=>{
  if(!G||G.over)return;
  if(document.getElementById('startOverlay').style.display!=='none')return;
  const menuOpen=document.getElementById('menuOverlay').style.display==='flex';
  const k=e.key.toLowerCase();
  if(e.key==='Escape'){
    e.preventDefault();
    if(menuOpen){G.paused=false;document.getElementById('menuOverlay').style.display='none';}
    else if(G.placing){G.placing=null;G.pend=null;G.wallA=null;G.pendLine=null;refreshPanel();}
    else{G.sel=[];G.inspect=null;refreshPanel();}
    return;}
  if(menuOpen)return;
  // 48/z in world units IS a constant 48 screen px (screen = world*z), so these
  // are exact restatements that also work at any 3D camera angle.
  // arrows mark key-held state; panFeel (called from draw) pans per FRAME —
  // continuous era scroll instead of key-repeat jumps (play-feel pass)
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'||e.key==='ArrowUp'||e.key==='ArrowDown'){
    PANKEYS.add(e.key);e.preventDefault();return;}
  if(k==='+'||k==='='){zoomAt(Math.min(2.2,G.cam.z*1.2),vw/2,vh/2);return;}
  if(k==='-'){zoomAt(Math.max(.45,G.cam.z/1.2),vw/2,vh/2);return;}
  if(e.key===' '){
    e.preventDefault();
    const ent=G.sel.map(id=>G.units.find(u=>u.id===id)||G.blds.find(b=>b.id===id)).filter(Boolean)[0];
    if(ent){const c=ent.tx!==undefined?bldCenter(ent):ent;centerOn(c.x,c.y);}
    return;}
  if(e.key==='Delete'){
    // deletion is forever — ask twice (a stray Del has ended armies before)
    if(G.sel.length&&(!G._delArm||performance.now()-G._delArm>2500)){
      G._delArm=performance.now();
      toast('Press Delete again to confirm — this destroys '+G.sel.length+' of your own');
      return;}
    G._delArm=0;
    issue('del',{ids:G.sel.slice()});
    G.sel=[];refreshPanel();return;}
  if(k==='h'){selTC();return;}
  if(k==='.'){cycleIdleVill();return;}
  if(k===','){cycleIdleMil();return;}
  if(/^[1-9]$/.test(e.key)){
    e.preventDefault();
    if(!G.groups)G.groups={};
    if(e.ctrlKey||e.metaKey){
      if(G.sel.length){G.groups[e.key]=G.sel.slice();
        toast('Control group '+e.key+' set ('+G.sel.length+')');}
      return;}
    const ids=(G.groups[e.key]||[]).filter(id=>G.units.find(u=>u.id===id)||G.blds.find(b=>b.id===id));
    if(!ids.length)return;
    const again=G.sel.length===ids.length&&G.sel.every((id,ix)=>id===ids[ix]);
    G.sel=ids;refreshPanel();
    if(again){const e0=G.units.find(u=>u.id===ids[0])||G.blds.find(b=>b.id===ids[0]);
      if(e0){const c=e0.tx!==undefined?bldCenter(e0):e0;centerOn(c.x,c.y);}}
    return;}
  const selB=G.sel.map(id=>G.blds.find(b=>b.id===id)).filter(Boolean);
  const selV=G.sel.map(id=>G.units.find(u=>u.id===id)).filter(u=>u&&u.type==='villager');
  if(selB.length){
    const b=selB[0];
    const km=TRAIN_KEYS_BY_BLD[b.type];
    if(km&&km[k]){tryTrainKey(b,km[k]);return;}
    if(b.type==='castle'&&k==='u'){tryTrainKey(b,CIVS[G.P[localP].civ].uu);return;}
    if(b.type==='tc'&&k==='a'){tryAgeKey(b);return;}
  }
  if(selV.length){
    for(const bt in BUILD_KEYS)if(BUILD_KEYS[bt]===k){startBuildKey(bt);return;}
  }
  /* Camera reset, LAST so the contextual train/build keys win: bare 'r' is Ram
     at a siege workshop and Turtle Ship at a dock. Gated on use3D, so 2D is
     untouched. */
  if(use3D&&k==='r'){R3.yaw=R3.homeYaw;R3.setPitch(R3.homePitch);toast('Camera reset');return;}
});
