/* ================= state ================= */
let G=null, diffSel=0, civSel=0, mapSel=0, playersSel=2, teamSel=0, turboSel=0, regicideSel=0, NP=2, uid=1;
let mapRealSel=0; // mapSel with 'Surprise me' (5) resolved to a real generator
/* Nature owns the wildlife. Player slots run 0..7, so 8 is always free; giving
   the animals a real player index means they path, take damage, die and draw
   through exactly the same code as everything else. G.P/G.teams/G.ais are
   padded out to this index in newGame so nothing ever indexes a hole. */
const GAIA=8;
function isAnimal(u){return !!(u&&UNITS[u.type]&&UNITS[u.type].animal);}
/* Which slot THIS machine is playing. The simulation is player-indexed and
   identical on every peer; only the view differs — the panel, the resource bar,
   the fog, the warnings and the win test all read localP rather than a
   hardcoded 0. Solo play leaves it at 0, so nothing changes there. */
let localP=0;
let humanSlots=[0];   // slots with a person behind them; the rest get an AI
let netCivs=null;     // per-slot civ choices from a lobby, or null for "roll for the AI"
let netTeams=null;    // per-slot team ids from a lobby, or null to use teamSel
/* Per-slot handicap multipliers from a lobby (1 = none). The AoE2:DE "even the
   odds between friends" tool: visible, consensual, self-declared in the lobby.
   Boosts starting resources, gathering, farming and construction. */
let netHcaps=null;
/* ---------- deterministic simulation RNG (multiplayer foundation) ----------
   Every random draw that changes GAME STATE must come from SR()/SRi(), seeded
   once per match. Two machines given the same seed and the same command stream
   then produce byte-identical games — the lockstep model real RTS netcode uses.
   Cosmetic randomness (particles, corpse poses, sound variation) deliberately
   stays on Math.random(): it never touches G, so it may differ between peers. */
let gameSeed=0,simR=null;
function seedSim(s){gameSeed=s>>>0;simR=mulberry(gameSeed);}
function SR(){return simR?simR():Math.random();}      // [0,1)
function SRi(n){return Math.floor(SR()*n);}            // integer [0,n)
// Turbo pace (CD WHATSNEW): work rates x2.5 (military training, construction,
// gathering, carry), trade x2 — economy unit training stays normal.
function TB(){return turboSel?2.5:1;}

function genMapArena(){
  // every lord walled in stone from the first minute — boom, then break out.
  // The AI needs no teaching: its waves target the NEAREST enemy building,
  // which for a walled foe is the ring itself, so it batters its way in.
  G.map=Array.from({length:MAP},()=>Array(MAP).fill(0));
  G.water={};G.ford={};
  G.elev=new Uint8Array(MAP*MAP);
  const rng=(n)=>SRi(n);
  const placeRes=(type,cx,cy,n)=>{let placed=0,tries=0;
    while(placed<n&&tries++<220){const x=cx+rng(5)-2,y=cy+rng(5)-2;
      if(x<1||y<1||x>=MAP-1||y>=MAP-1)continue;const k=x+','+y;
      if(G.map[y][x]||G.res[k])continue;
      G.res[k]={type,amt:RES_META[type].amt,x,y};G.map[y][x]=1;placed++;}};
  // a few low hills in the open field
  for(let hb=0,nH=Math.round(5*MAP*MAP/4096);hb<nH;hb++){
    const hx=6+rng(MAP-12),hy=6+rng(MAP-12),hr=3+rng(2);
    if(START.some(([bx,by])=>hyp(hx-bx,hy-by)<14))continue;
    for(let y=hy-hr;y<=hy+hr;y++)for(let x=hx-hr;x<=hx+hr;x++){
      if(x<1||y<1||x>=MAP-1||y>=MAP-1)continue;
      if(hyp(x-hx,y-hy)<=hr-.2+((x*7+y*13)%2)*.5)G.elev[y*MAP+x]=1;
    }
  }
  // the walls, gate facing the centre of the world
  const R=9;
  for(let p=0;p<NP;p++){
    const [bx,by]=START[p];
    const gateOnX=Math.abs(MAP/2-bx)>=Math.abs(MAP/2-by);
    const gx=Math.sign(MAP/2-bx)||1,gy=Math.sign(MAP/2-by)||1;
    for(let d=-R;d<=R;d++){
      const ring=[[bx+d,by-R,'n'],[bx+d,by+R,'s'],[bx-R,by+d,'w'],[bx+R,by+d,'e']];
      for(const [wx,wy,side] of ring){
        if(wx<1||wy<1||wx>=MAP-1||wy>=MAP-1)continue;
        if(G.map[wy][wx])continue;                    // ring corners come round twice
        const gateSide=gateOnX?(side===(gx>0?'e':'w')):(side===(gy>0?'s':'n'));
        addBld(p,(gateSide&&Math.abs(d)<=1)?'sgate':'swall',wx,wy,true);
      }
    }
    // everything a boom needs, INSIDE the ring
    const dx=Math.sign(MAP/2-bx)||1,dy=Math.sign(MAP/2-by)||1;
    placeRes('food',bx+4*dx,by-4*dy,6);
    placeRes('gold',bx-5*dx,by+4*dy,5);
    placeRes('wood',bx-5*dx,by-5*dy,9);
    placeRes('wood',bx+5*dx,by+5*dy,9);
  }
  // the centre prize — the reason to leave home
  placeRes('gold',MAP*.5|0,MAP*.5|0,8);
  placeRes('food',MAP*.5|0,MAP*.42|0,5);
  placeRes('gold',MAP*.3|0,MAP*.3|0,4);placeRes('gold',MAP*.7|0,MAP*.7|0,4);
  // sparse neutral woods in no-man's-land
  for(let b=0,nF=Math.round(6*MAP*MAP/4096);b<nF;b++){
    const cx=3+rng(MAP-6),cy=3+rng(MAP-6);
    if(START.some(([sx2,sy2])=>hyp(cx-sx2,cy-sy2)<R+4))continue;
    placeForest(cx,cy,14+rng(24),11);
  }
}
function genMapHighlands(){
  // rolling open hills, scattered woods, NO water — the high ground is the map
  G.map=Array.from({length:MAP},()=>Array(MAP).fill(0));
  G.water={};G.ford={};
  G.elev=new Uint8Array(MAP*MAP);
  const rng=(n)=>SRi(n);
  for(let hb=0,nH=Math.round(16*MAP*MAP/4096);hb<nH;hb++){
    const hx=5+rng(MAP-10),hy=5+rng(MAP-10),hr=3+rng(4);
    if(START.some(([bx,by])=>hyp(hx-bx,hy-by)<9))continue;
    for(let y=hy-hr;y<=hy+hr;y++)for(let x=hx-hr;x<=hx+hr;x++){
      if(x<1||y<1||x>=MAP-1||y>=MAP-1)continue;
      if(hyp(x-hx,y-hy)<=hr-.2+((x*7+y*13)%2)*.5)G.elev[y*MAP+x]=1;
    }
  }
  const placeRes=(type,cx,cy,n)=>{let placed=0,tries=0;
    while(placed<n&&tries++<220){const x=cx+rng(5)-2,y=cy+rng(5)-2;
      if(x<1||y<1||x>=MAP-1||y>=MAP-1)continue;const k=x+','+y;
      if(G.map[y][x]||G.res[k])continue;
      G.res[k]={type,amt:RES_META[type].amt,x,y};G.map[y][x]=1;placed++;}};
  for(let b=0,nF=Math.round(11*MAP*MAP/4096);b<nF;b++){
    const cx=3+rng(MAP-6),cy=3+rng(MAP-6);
    placeForest(cx,cy,18+rng(34),11);
  }
  for(const [bx,by] of START){
    const dx=Math.sign(MAP/2-bx)||1,dy=Math.sign(MAP/2-by)||1;
    placeRes('food',bx+5*dx,by-4*dy,6);
    placeRes('food',bx-3*dx,by+6*dy,4);
    placeRes('gold',bx+8*dx,by+8*dy,5);
    placeRes('wood',bx+dx,by+9*dy,9);placeRes('wood',bx+9*dx,by+dy,9);
  }
  placeRes('gold',MAP*.5|0,MAP*.5|0,6);
  placeRes('gold',MAP*.22|0,MAP*.72|0,4);placeRes('gold',MAP*.78|0,MAP*.28|0,4);
  placeRes('food',MAP*.38|0,MAP*.3|0,5);placeRes('food',MAP*.62|0,MAP*.7|0,5);
}
const MAPS=[
  {name:'River Crossing',blurb:'A river divides the land — armies must cross at the sandy fords.'},
  {name:'Black Forest',blurb:'Endless dark woodland. Narrow trails link the clearings — wall a chokepoint, turtle up, and strike when ready. Wood is everywhere; gold is contested.'},
  {name:'Hallowed Ground',blurb:'Open steppe strewn with holy relics — every lord starts with a Monastery and a Monk. Claim the relics for gold, or hoard them all and win outright.'},
  {name:'Arena',blurb:'Every lord begins behind a ring of stone. Boom in safety, then batter your way out — the centre holds the gold worth fighting for.'},
  {name:'Highlands',blurb:'Rolling open hills and scattered woods. No water, no walls to hide behind — high ground is the only fortress here.'},
  {name:'Surprise me',blurb:'The battlefield is drawn from the match seed — nobody knows until the fog lifts.'}];
let mission=null;
/* Mission setups run in begin(), right after newGame() — the map exists, the
   Town Halls stand, nothing has moved yet. These two helpers keep the setups
   short; both spiral outward from a point until the ground allows it. */
function missionBld(p,type,bx,by,rMin,rMax,done){
  for(let r=rMin;r<rMax;r++)for(let a=0;a<16;a++){
    const tx=Math.round(bx+dCos(a/16*6.283)*r),ty=Math.round(by+dSin(a/16*6.283)*r);
    if(type==='dock'?canPlaceDock(tx,ty):canPlace(tx,ty,BLDS[type].size,0,!!BLDS[type].thin))
      return addBld(p,type,tx,ty,done!==false);
  }
  return null;
}
function missionSquad(p,type,n,bx,by){
  const out=[];
  for(let i=0;i<n;i++){
    const s=nearFree(bx+(i%3),by+((i/3)|0),5)||{x:bx,y:by};
    out.push(addUnit(p,type,s.x,s.y));
  }
  return out;
}
const MISSIONS=[
  {id:0,name:'First Blood',map:0,diff:0,
   blurb:'A rival squire underestimates you. Raise your village and burn his Town Hall.',
   win:{type:'raze'},
   setup(){missionSquad(localP,'militia',4,START[localP][0]+3,START[localP][1]+4);},
   obj:'Destroy the enemy Town Hall. Send a villager at the sheep first — meat beats berries.'},
  {id:1,name:'Hold the Fords',map:0,diff:2,
   blurb:'A warlord marches on the river crossings. Hold out for ten minutes.',
   win:{type:'survive',time:600},
   setup(){G.P[localP].age=1;G.P[localP].w+=100;
     for(let i=0;i<3;i++)addUnit(localP,'spearman',START[localP][0]+3+i,START[localP][1]+4);
     for(let i=0;i<2;i++)addUnit(localP,'archer',START[localP][0]+3+i,START[localP][1]+5);},
   obj:'Survive for 10 minutes. Wall the fords!'},
  {id:2,name:'The Black Forest Gambit',map:1,diff:2,
   blurb:'Deep in the dark woods a Castle-Age tyrant hoards the gold. Cut through and end him.',
   win:{type:'raze'},
   setup(){G.P[1].age=2;
     for(let i=0;i<3;i++)addUnit(1,'militia',START[1][0]-2+i,START[1][1]+4);
     addUnit(1,'knight',START[1][0],START[1][1]+5);},
   obj:'Destroy the enemy Town Hall. He is far ahead of you — turtle wisely.'},
  {id:3,name:'The Relic War',map:0,diff:1,
   blurb:'Holy relics lie scattered across the land. Your monks must claim three before the enemy claims you.',
   win:{type:'relics',n:3},
   setup(){G.P[localP].age=2;G.P[localP].w+=200;G.P[localP].g+=100;
     const [bx,by]=START[localP];
     let placed=false;
     for(let r=3;r<9&&!placed;r++)for(let a=0;a<12&&!placed;a++){
       const tx=Math.round(bx+dCos(a/12*6.283)*r),ty=Math.round(by+dSin(a/12*6.283)*r);
       if(canPlace(tx,ty,2,0)){addBld(localP,'monastery',tx,ty,true);placed=true;}}
     addUnit(localP,'monk',bx+1,by+4);},
   obj:'Enshrine 3 relics in your Monastery. Monks pick them up — tap a relic, then tap the Monastery.'},
  {id:4,name:'Two Fronts',map:0,diff:2,foes:2,vsWorld:true,
   blurb:'Two warlords have sworn an alliance to divide your lands between them. Disappoint them both.',
   win:{type:'raze'},
   setup(){G.P[localP].w+=150;},
   obj:'Destroy BOTH enemy Town Halls. They share vision — watch every ford.'},
  /* ---- the later campaign, written for the systems the first five never saw:
     siege engines, the navy, and the Wonder ---- */
  {id:5,name:'The Iron Harvest',map:0,diff:2,
   blurb:'A tyrant sits behind stone and calls it peace. Bring the engines and teach him otherwise.',
   win:{type:'raze'},
   setup(){
     const st=G.P[localP];st.age=2;st.w+=500;st.g+=350;st.f+=250;
     const [bx,by]=START[localP];
     missionBld(localP,'siege',bx,by,3,9);
     missionBld(localP,'blacksmith',bx,by,3,10);
     addUnit(localP,'ram',bx+2,by+4);
     missionSquad(localP,'spearman',3,bx,by+5);
     // the enemy is dug in: Castle Age, a castle, and a stone curtain with one gate
     G.P[1].age=2;G.P[1].w+=400;G.P[1].g+=300;
     const [ex,ey]=START[1];
     missionBld(1,'castle',ex,ey,3,7);
     for(let a=0;a<40;a++){
       if(a>=17&&a<=20)continue;                 // leave a gate's worth of gap
       const wx=Math.round(ex+1+dCos(a/40*6.283)*7),wy=Math.round(ey+1+dSin(a/40*6.283)*7);
       if(canPlace(wx,wy,1,0,true))addBld(1,'swall',wx,wy,true);
     }
     missionSquad(1,'archer',4,ex,ey+3);
   },
   obj:'Raze the enemy Town Hall. Rams and mangonels chew through stone; swords do not.'},
  {id:6,name:'Lords of the Narrow Sea',map:0,diff:1,
   blurb:'The fords have flooded. Whoever rules the water rules the war.',
   win:{type:'raze'},
   setup(){
     // drown the crossings — this war has to be fought over water
     for(const k in G.ford){
       const ci=k.indexOf(','),x=+k.slice(0,ci),y=+k.slice(ci+1);
       G.water[k]=1;G.map[y][x]=1;
     }
     G.ford={};
     refreshTerrain();updateFog();
     const st=G.P[localP];st.age=1;st.w+=450;st.g+=200;
     const [bx,by]=START[localP];
     // the shore is ~30 tiles off — a radius scan from the Town Hall never finds
     // it, so walk the water list for the nearest tile the way the AI does
     let near=null,nd=1e9;
     for(const w of (G.waterList||[])){
       const dd=hyp(w.x-bx,w.y-by);
       if(dd<nd){nd=dd;near=w;}
     }
     let dk=null;
     if(near)for(let r=0;r<9&&!dk;r++)for(let dy=-r;dy<=r&&!dk;dy++)for(let dx=-r;dx<=r&&!dk;dx++){
       if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
       if(canPlaceDock(near.x+dx,near.y+dy))dk=addBld(localP,'dock',near.x+dx,near.y+dy,true);
     }
     if(dk){
       for(const t of['transport','transport','galley','fishing']){
         const s=nearFree(dk.tx+1,dk.ty+1,7,true);
         if(s)addUnit(localP,t,s.x,s.y);
       }
       const c=bldCenter(dk);centerOn(c.x,c.y);
     }
     missionSquad(localP,'militia',4,bx+2,by+4);
     G.P[1].age=1;G.P[1].w+=350;
   },
   obj:'No ford remains. Ferry an army across in Transports — or sink his fleet and starve him.'},
  {id:7,name:'The Wonder of the Age',map:2,diff:2,foes:2,vsWorld:true,
   blurb:'Let them come. Raise the wonder of the age, and hold it while the world burns.',
   win:{type:'wonder'},
   setup(){
     const st=G.P[localP];st.age=3;st.f+=900;st.w+=1400;st.g+=1200;
     const [bx,by]=START[localP];
     missionBld(localP,'castle',bx,by,3,8);
     missionBld(localP,'blacksmith',bx,by,3,10);
     missionBld(localP,'university',bx,by,3,11);
     missionSquad(localP,'knight',4,bx+2,by+4);
     missionSquad(localP,'archer',4,bx-2,by+4);
     missionSquad(localP,'monk',1,bx,by+3);
     for(let p=0;p<NP;p++){if(p===localP)continue;
       G.P[p].age=3;G.P[p].w+=600;G.P[p].g+=500;}
   },
   obj:'Build a Wonder and hold it until the countdown ends. Both warlords will come for it.'},
  /* ---- THE CAMPAIGN ARCS (2026-08-19): three historical threads, four
     missions each, every mission built on a system the skirmish already has.
     Arc openers carry arcStart so the arcs unlock independently. ---- */
  // ATTILA THE HUN — the Scourge of God (civ 15: no houses, all horse)
  {id:8,arc:'Attila the Hun',arcStart:true,civ:15,name:'The Scourge Rides',map:4,diff:1,
   blurb:'The steppe is yours by birthright. Take the rest of it by horse.',
   win:{type:'raze'},
   setup(){const st=G.P[localP];st.age=1;st.f+=200;
     missionSquad(localP,'scout',6,START[localP][0]+3,START[localP][1]+4);
     G.P[1].age=1;},
   obj:'Raze the enemy Town Hall. Huns need no houses — every stick of wood is an army.'},
  {id:9,arc:'Attila the Hun',civ:15,name:'Tribute or Torch',map:0,diff:1,
   blurb:'Rome pays gold to those it fears. Make yourself worth fearing.',
   win:{type:'wealth',n:2000},
   setup(){const st=G.P[localP];st.age=1;st.w+=150;
     missionBld(localP,'market',START[localP][0],START[localP][1],3,9);
     missionSquad(localP,'scout',3,START[localP][0]+3,START[localP][1]+4);},
   obj:'Amass 2000 gold — trade for it, mine it, or burn it out of them. Trade Carts earn more the farther they travel.'},
  {id:10,arc:'Attila the Hun',civ:15,name:'The Walls Must Fall',map:3,diff:2,
   blurb:'They believe stone can keep out the Scourge of God. Correct them.',
   win:{type:'raze'},
   setup(){const st=G.P[localP];st.age=2;st.w+=400;st.g+=300;st.f+=200;
     missionBld(localP,'siege',START[localP][0],START[localP][1],3,8);
     addUnit(localP,'ram',START[localP][0]+2,START[localP][1]+4);
     addUnit(localP,'ram',START[localP][0]+3,START[localP][1]+4);
     G.P[1].age=2;G.P[1].w+=300;G.P[1].g+=200;
     missionBld(1,'castle',START[1][0],START[1][1],3,7);},
   obj:'The Arena is his fortress — and his cage. Breach the ring and raze the Town Hall. Rams eat stone; cavalry eats what runs out.'},
  {id:11,arc:'Attila the Hun',civ:15,name:'The Catalaunian Fields',map:4,diff:2,foes:2,vsWorld:true,
   blurb:'Rome and the Visigoths stand together at last — against you. History remembers who walked away.',
   win:{type:'survive',time:900},
   setup(){const st=G.P[localP];st.age=2;st.f+=400;st.w+=500;st.g+=300;
     missionSquad(localP,'scout',4,START[localP][0]+3,START[localP][1]+4);
     missionSquad(localP,'tarkan',3,START[localP][0]-2,START[localP][1]+4);
     for(let p=0;p<NP;p++){if(p===localP)continue;G.P[p].age=2;G.P[p].w+=300;G.P[p].g+=200;}},
   obj:'Survive for 15 minutes against the allied world. The high ground is worth a second army.'},
  // EL CID — the Lord of Valencia (civ 17, Spanish)
  {id:12,arc:'El Cid',arcStart:true,civ:17,name:'Into Exile',map:2,diff:1,
   blurb:'Banished by the king you served. Ride for the far hills with the men who still follow.',
   win:{type:'escort',ut:'king'},
   setup(){
     const [bx,by]=START[localP];
     addUnit(localP,'king',bx+2,by+4);
     missionSquad(localP,'knight',3,bx+3,by+4);
     missionSquad(localP,'spearman',3,bx+1,by+5);
     const st=G.P[localP];st.age=2;st.f+=200;
     // the road out: the corner farthest from home, past whoever holds the middle
     const cx=bx<MAP/2?MAP-6:6,cy=by<MAP/2?MAP-6:6;
     G.mEscort={x:cx,y:cy,r:3};
     G.P[1].age=2;},
   obj:'Bring El Cid (your King) alive to the far corner of the land — the minimap pulse marks the road. If he falls, all falls.'},
  {id:13,arc:'El Cid',civ:17,name:'A Sword for Hire',map:0,diff:2,
   blurb:'An exile eats by his blade. A warlord pays for a town razed — and asks no questions.',
   win:{type:'raze'},
   setup(){const st=G.P[localP];st.age=2;st.f+=300;st.w+=300;st.g+=350;
     missionBld(localP,'castle',START[localP][0],START[localP][1],3,8);
     missionSquad(localP,'conquistador',3,START[localP][0]+3,START[localP][1]+4);
     G.P[1].age=2;G.P[1].w+=350;G.P[1].g+=250;},
   obj:'Raze the enemy Town Hall. Your Castle trains Conquistadors — mounted guns that reload on the move.'},
  {id:14,arc:'El Cid',civ:17,name:'The Siege of Valencia',map:0,diff:2,foes:2,vsWorld:true,
   blurb:'You took a city of your own at last. Now every banner in the south marches to take it back.',
   win:{type:'survive',time:720},
   setup(){
     const [bx,by]=START[localP];const st=G.P[localP];
     st.age=2;st.f+=400;st.w+=600;st.g+=300;
     missionBld(localP,'castle',bx,by,3,7);
     missionBld(localP,'tower',bx,by,5,9);
     missionBld(localP,'tower',bx,by,5,10);
     missionSquad(localP,'spearman',4,bx+2,by+4);
     missionSquad(localP,'archer',4,bx-2,by+4);
     for(let p=0;p<NP;p++){if(p===localP)continue;G.P[p].age=2;G.P[p].w+=300;G.P[p].g+=250;}},
   obj:'Hold Valencia for 12 minutes. Spanish builders work a third faster — use every quiet second to add stone.'},
  {id:15,arc:'El Cid',civ:17,name:'The Last Ride',map:4,diff:2,
   blurb:'The legend says they strapped the dead Campeador into his saddle and the enemy broke at the sight. Write the legend.',
   win:{type:'raze'},   // the regicide check fires first — this line is the fallback
   setup(){
     G.regicide=1;
     for(let p=0;p<NP;p++)addUnit(p,'king',START[p][0]+3,START[p][1]+2);
     const st=G.P[localP];st.age=2;st.f+=300;st.w+=300;st.g+=300;
     missionSquad(localP,'knight',4,START[localP][0]+3,START[localP][1]+4);
     G.P[1].age=2;G.P[1].w+=300;G.P[1].g+=300;},
   obj:'Regicide: kill the enemy king, and keep El Cid alive — garrison him if you must. The kingdom follows the crown.'},
  // MONTEZUMA — the Fifth Sun (civ 13, Aztecs)
  {id:16,arc:'Montezuma',arcStart:true,civ:13,name:'The Flower War',map:2,diff:1,
   blurb:'The gods do not want land. The gods want captives. The Flower War provides.',
   win:{type:'kills',n:30},
   setup(){const st=G.P[localP];st.age=1;st.f+=250;
     missionSquad(localP,'eagle',4,START[localP][0]+3,START[localP][1]+4);
     G.P[1].age=1;},
   obj:'Slay 30 enemy soldiers. Eagle Warriors run like the wind — strike, withdraw, strike again. Lose your Town Hall and all is lost.'},
  {id:17,arc:'Montezuma',civ:13,name:'Gold of the Gods',map:2,diff:2,
   blurb:'The old shrines hold what the temples need. Send the priests, and guard their road.',
   win:{type:'relics',n:4},
   setup(){const st=G.P[localP];st.age=2;st.w+=250;st.g+=150;
     const [bx,by]=START[localP];
     missionBld(localP,'monastery',bx,by,3,9);
     addUnit(localP,'monk',bx+1,by+4);addUnit(localP,'monk',bx+2,by+4);
     G.P[1].age=2;},
   obj:'Enshrine 4 relics. Aztec monks are hardier than most — but an escort of Jaguars is hardier still.'},
  {id:18,arc:'Montezuma',civ:13,name:'La Noche Triste',map:0,diff:2,foes:2,vsWorld:true,
   blurb:'The strangers and their allies come across the causeways in the dark. The lake will remember this night.',
   win:{type:'survive',time:600},
   setup(){const st=G.P[localP];st.age=2;st.f+=350;st.w+=400;st.g+=250;
     missionSquad(localP,'jaguar',3,START[localP][0]+3,START[localP][1]+4);
     missionSquad(localP,'eagle',3,START[localP][0]-2,START[localP][1]+4);
     for(let p=0;p<NP;p++){if(p===localP)continue;G.P[p].age=2;G.P[p].w+=350;G.P[p].g+=250;}},
   obj:'Survive the night — 10 minutes. Wall the fords; they must come to you across the water.'},
  {id:19,arc:'Montezuma',civ:13,name:'The Fifth Sun',map:1,diff:2,foes:2,
   blurb:'Every age of the world has ended in fire. Raise the great temple, and hold the sky up yourself.',
   win:{type:'wonder'},
   setup(){
     const st=G.P[localP];st.age=3;st.f+=900;st.w+=1500;st.g+=1200;
     const [bx,by]=START[localP];
     missionBld(localP,'castle',bx,by,3,8);
     missionBld(localP,'university',bx,by,3,10);
     missionSquad(localP,'jaguar',4,bx+2,by+4);
     missionSquad(localP,'eagle',4,bx-2,by+4);
     for(let p=0;p<NP;p++){if(p===localP)continue;G.P[p].age=3;G.P[p].w+=700;G.P[p].g+=600;}},
   obj:'Build the Wonder in the deep forest and defend it to the end of the countdown. The trails are few — own them.'},
];
/* Fingerprint of everything that IS the game state. Two peers running the same
   seed and the same commands must agree on this every tick; the first tick they
   disagree is the desync, and comparing hashes is how a match detects it early
   rather than drifting silently. Deliberately excludes cosmetics (fx, corpses,
   rubble, camera, selection) — those are allowed to differ between machines. */
function stateHash(){
  if(!G)return '0';
  const r=n=>Math.round(n*1e6)/1e6;
  const U=G.units.map(u=>[u.id,u.p,u.type,r(u.x),r(u.y),r(u.hp),u.state,r(u.cd)].join(',')).join('|');
  const B=G.blds.map(b=>[b.id,b.p,b.type,b.tx,b.ty,r(b.hp),b.built?1:0,b.queue.join('+')].join(',')).join('|');
  const R=Object.keys(G.res).sort().map(k=>k+':'+r(G.res[k].amt)).join('|');
  const P=G.P.map(s=>[r(s.f),r(s.w),r(s.g),s.age,s.civ,(s.uts||[]).join('+'),
    JSON.stringify(s.eco||{}),JSON.stringify(s.uni||{}),s.pt?1:0].join(',')
    +(s.hcap&&s.hcap!==1?',hc'+s.hcap:'')).join('|');   // absent at 1x — old baselines unmoved
  const A=G.ais.map(a=>a?[a.wave,r(a.nextAtk),a.tgtId||0].join(','):'-').join('|');
  const str=U+'#'+B+'#'+R+'#'+P+'#'+A+'#'+r(G.t)+'#'+uid;
  let h=2166136261;
  for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}
  return (h>>>0).toString(16);
}
let pendingSeed=0; // set by a replay or an incoming multiplayer match; 0 = fresh
function newGame(){
  // Seed FIRST: map generation and civ assignment both draw from it, so the
  // whole match is reproducible from this one number.
  seedSim(pendingSeed||((Math.random()*4294967296)>>>0));
  pendingSeed=0;
  // Entity ids MUST restart every match: commands reference units by id, and
  // unit behaviour reads it (creep stagger), so a stale counter desyncs peers.
  uid=1;
  cmdQ=[];   // nothing carries over from the last match
  NP=mission?(1+(mission.foes||1)):playersSel;
  // Roomier battlefields. Ceiling is 128: the terrain canvas is MAP*TILE*TREZT
  // square, and 144 would be 3744px — close to the 4096px canvas limit phones
  // enforce, with 160 (4160px) over it outright.
  // Black Forest fills every tile that isn't a carved clearing, so it carries
  // ~8x the trees of an open map — it stays one size down to keep zoomed-out
  // frames fast (12k trees at 128 dropped the whole map view to ~22fps).
  // 'Surprise me' resolves HERE, from the match seed — lockstep peers, replays
  // and reloads all resolve the same battlefield from the same number
  mapRealSel=mapSel===5?SRi(5):mapSel;
  setMapSize(mapRealSel===1?(NP<=4?96:112):(NP<=2?96:NP<=4?112:128));
  START=genStarts(NP);
  // team assignment: FFA / two teams / everyone against you.
  // "you" is localP, not slot 0 — in a match you may be sitting in any seat.
  let teams;
  if(netTeams)teams=netTeams.slice();          // a lobby decided it
  else if(mission)teams=mission.vsWorld?Array.from({length:NP},(_,i)=>i===localP?0:1)
                                       :Array.from({length:NP},(_,i)=>i);
  else if(teamSel===1){const half=Math.ceil(NP/2);
    teams=Array.from({length:NP},(_,i)=>i<half?0:1);}
  else if(teamSel===2)teams=Array.from({length:NP},(_,i)=>i===localP?0:1);
  else teams=Array.from({length:NP},(_,i)=>i);
  const mkP=c=>{const cv=CIVS[c]; // manual start bonuses/penalties
    return{f:200+(cv.startF||0),w:200+(cv.startW||0),g:100,age:0,ageT:0,aging:false,civ:c,uts:[],
      bs:{atk:0,arw:0,ia:0,aa:0,ca:0},pt:false,uni:{},
      eco:Object.assign({},cv.freeTech||{}), // 1.0B: Aztec free Loom, Byzantine free Town Watch
      mon:{}};};
  // Player slots. A slot listed in humanSlots gets no AI — solo play is just the
  // default humanSlots=[0]. Civ choice: mine comes from the start screen, other
  // people's from the lobby (netCivs), and the rest are rolled from the seeded
  // RNG so every peer rolls the same ones. The draw order below is unchanged
  // from the single-player version, so old seeds still reproduce old games.
  const P=[],used=[],ais=[];
  for(let p=0;p<NP;p++){
    let c;
    if(p===localP)c=civSel;
    else if(netCivs&&netCivs[p]!=null)c=netCivs[p];
    else{do{c=SRi(CIVS.length);}while(used.includes(c));}
    used.push(c);
    P.push(mkP(c));
    // Lobby handicap: hcap stays ABSENT at 1x so the field adds nothing to
    // stateHash and every pre-handicap baseline/save hashes unchanged.
    if(netHcaps&&netHcaps[p]&&netHcaps[p]!==1){
      const hc=P[p].hcap=netHcaps[p];
      P[p].f*=hc;P[p].w*=hc;P[p].g*=hc;   // the boost starts at the start
    }
    ais.push(humanSlots.includes(p)?null
      :{wave:0,nextAtk:DIFF[diffSel].firstWave+(p-1)*40,tick:.3*(p-1),attacking:false});
  }
  // Pad every per-player array out to GAIA with inert entries. Holes in these
  // arrays are the real hazard: stateHash maps over G.P, and a hole there is an
  // undefined that throws rather than a value that hashes.
  for(let q=NP;q<=GAIA;q++){
    P[q]=mkP(0);ais[q]=null;
    teams[q]=q===GAIA?99:50+q;   // nature allies with nobody, and neither do the unused slots
  }
  G={t:0,over:false,paused:false,units:[],blds:[],res:{},proj:[],fx:[],corpses:[],
     rubble:[],stuck:[],pings:[],navBlock:{},
     wallMap:{},gateMap:{},wallA:null,pendLine:null,
     P,ais,teams,relics:[],groups:{},
     sel:[],placing:null,pend:null,amode:false,cam:{x:0,y:0,z:1},
     stats:{trained:0,razed:0},lastRaidToast:-99,
     // per-player tallies + score timeline for the post-game summary.
     // Deterministic (every peer counts the same events), never hashed.
     pstats:Array.from({length:GAIA+1},()=>({tr:0,lost:0,kills:0,razed:0,blost:0,gath:0})),
     tl:[],tlT:10,
     ageAt:Array.from({length:GAIA+1},()=>[0,0,0,0])};
  G.vis=new Uint8Array(MAP*MAP);G.visT=0;
  // Regicide is a match property fixed at start: kings spawn in the start
  // loop and the win check switches to king survival. Skirmish-only; the
  // network start path forces regicideSel=0 so peers can never disagree.
  G.regicide=(regicideSel&&!mission)?1:0;
  genMap();
  for(let p=0;p<NP;p++){
    const [bx,by]=START[p];
    addBld(p,'tc',bx,by,true);
    const nv=3+(CIVS[G.P[p].civ].startVills||0);
    for(let i=0;i<nv;i++)addUnit(p,'villager',bx-1+i%3,by+3+(i/3|0));
    if(G.regicide)addUnit(p,'king',bx+3,by+2);   // Regicide: every lord starts with a King
    if(mapRealSel===2&&!mission){ // Hallowed Ground: every lord starts with the cloth
      let placed=null;
      for(let r=3;r<9&&!placed;r++)for(let a=0;a<12&&!placed;a++){
        const tx=Math.round(bx+dCos(a/12*6.283)*r),ty=Math.round(by+dSin(a/12*6.283)*r);
        if(canPlace(tx,ty,2,0))placed={tx,ty};}
      if(placed)addBld(p,'monastery',placed.tx,placed.ty,true);
      addUnit(p,'monk',bx+2,by+3);
    }
  }
  centerOn(START[localP][0]+1,START[localP][1]+1);
  updateFog();
  refreshTerrain();
}
/* Render-side version counters. NONE of these are read by step(), stateHash()
   or saveGame — they are not simulation state. They exist so the 3D renderer
   can tell what changed without rescanning the world every frame.
     terrainVer — the terrain canvas was repainted (R3 uses it as ground texture)
     elevVer    — G.elev was regenerated, so the ground mesh must be rebuilt
     fogVer     — the fog canvas was repainted
   Declared HERE rather than beside refreshTerrain because genMap/setMapSize
   below bump them, and `let` in the temporal dead zone would throw. */
let terrainVer=0,elevVer=0,fogVer=0;
// resVer: ANY change of G.res membership. resGen: new game / load / map resize
// (a full rebuild rather than an incremental one). Render-side only.
let resVer=0,resGen=0;
function genMap(){
  miniResDirty=true;elevVer++;resVer++;resGen++;
  if(mapRealSel===1)genMapForest();
  else if(mapRealSel===2)genMapHallowed();
  else if(mapRealSel===3)genMapArena();
  else if(mapRealSel===4)genMapHighlands();
  else genMapRiver();
  // Belt and braces: no generator may leave anything inside a Town Hall's
  // footprint or hard against it. Cheaper than auditing every placement path.
  for(const [bx,by] of START)
    for(let y=by-1;y<by+3;y++)for(let x=bx-1;x<bx+3;x++){
      const k=x+','+y;
      if(G.res[k]){delete G.res[k];if(G.map[y]&&G.map[y][x])G.map[y][x]=0;}
    }
  placeRelics();
  placeAnimals();
}
/* Wildlife (manual Ch. II, "Food"). Sheep sit close enough to walk a villager
   onto in the first minute; boar are a deliberate trek out and bite back; deer
   roam the wilds and bolt when shot at. Everything here draws from SR() so two
   peers seeded alike get the same herds in the same places. */
function placeAnimals(){
  const openAt=(x,y)=>{
    if(x<2||y<2||x>=MAP-2||y>=MAP-2)return false;
    if(!passable(x,y))return false;
    const k=x+','+y;
    if(G.water[k]||G.ford[k]||G.res[k])return false;
    for(const [bx,by] of START)if(Math.abs(x-bx)<4&&Math.abs(y-by)<4)return false;
    return true;
  };
  const spot=(cx,cy,rMin,rMax)=>{
    for(let n=0;n<40;n++){
      const a=SR()*6.283,r=rMin+SR()*(rMax-rMin);
      const x=Math.round(cx+dCos(a)*r),y=Math.round(cy+dSin(a)*r);
      if(openAt(x,y))return{x,y};
    }
    return null;
  };
  const herd=(cx,cy,type,n)=>{
    for(let i=0;i<n;i++){
      const s=spot(cx,cy,0,2.2);
      if(!s)continue;
      const u=addUnit(GAIA,type,s.x,s.y);
      u.home={x:s.x+.5,y:s.y+.5};u.state='graze';u.grazeT=SR()*4;
    }
  };
  const tight=mapSel===1; // Black Forest: everything has to live in the clearings
  for(const [bx,by] of START){
    const sh=spot(bx,by,tight?4:6,tight?6.5:9);
    if(sh)herd(sh.x,sh.y,'sheep',4);
    for(let i=0;i<2;i++){
      const bo=spot(bx,by,tight?6:11,tight?7.5:15);
      if(bo)herd(bo.x,bo.y,'boar',1);
    }
  }
  const herds=Math.round(MAP*MAP/1400);   // ~6 herds at 96 tiles, ~12 at 128
  for(let i=0;i<herds;i++){
    const c=spot(MAP/2,MAP/2,MAP*.12,MAP*.46);
    if(c)herd(c.x,c.y,'deer',3+SRi(2));
  }
}
/* A slain animal leaves meat — an ordinary food resource, so villagers butcher
   a carcass with the same code that picks berries, and the AI's food search
   finds it without knowing wildlife exists. */
function dropCarcass(u){
  const meat=UNITS[u.type].meat||100;
  let x=Math.max(1,Math.min(MAP-2,u.x|0)),y=Math.max(1,Math.min(MAP-2,u.y|0));
  let k=x+','+y;
  if(G.map[y][x]||G.res[k]){            // fell on a blocked tile — lay it beside
    const f=nearFree(x,y,3);
    if(!f)return null;
    x=f.x;y=f.y;k=x+','+y;
    if(G.res[k])return null;
  }
  G.res[k]={type:'food',sub:'meat',x,y,amt:meat};
  G.map[y][x]=1;                        // a carcass occupies its tile like any other pile
  miniResDirty=true;resVer++;
  // whoever was hunting it walks straight over to butcher the kill
  for(const o of G.units){
    if(o.hp<=0||o.type!=='villager')continue;
    if(o.target&&!o.target.bld&&o.target.id===u.id)cmdGather(o,k);
  }
  return k;
}
/* An animal's answer to being struck: boar charge, deer bolt, sheep just die. */
function animalHit(t,from){
  const d=UNITS[t.type];
  if(!d||!d.animal||t.hp<=0||!from||from.hp<=0)return;
  if(d.fierce){
    const cur=t.target&&targetEnt(t.target);
    if(cur!==from)cmdAttack(t,from,false);
  }else if(d.skittish){
    const dx=t.x-from.x,dy=t.y-from.y,dd=hyp(dx,dy)||1;
    const fx=Math.max(2,Math.min(MAP-3,Math.round(t.x+dx/dd*10)));
    const fy=Math.max(2,Math.min(MAP-3,Math.round(t.y+dy/dd*10)));
    t.state='flee';t.fleeT=6;t.home={x:fx+.5,y:fy+.5};
    t.path=uPath(t,fx,fy)||[];
  }
}
function placeRelics(){
  G.relics=[];
  let spots;
  if(mapRealSel===2){ // Hallowed Ground: relics everywhere (HALLOWED.RMS concept)
    spots=[];
    let guard=0;
    while(spots.length<8&&guard++<300){
      const x=4+SRi(MAP-8),y=4+SRi(MAP-8);
      if(START.some(([bx,by])=>hyp(x-bx,y-by)<8))continue;
      if(spots.some(([sx,sy])=>hyp(x-sx,y-sy)<7))continue;
      spots.push([x,y]);
    }
  }else spots=mapRealSel===1
    ?[[32,32],[13,13],[MAP-14,MAP-14],[32,44]]
    :[[MAP*.3|0,MAP*.55|0],[MAP*.7|0,MAP*.45|0],[MAP*.2|0,MAP*.15|0],[MAP*.85|0,MAP*.8|0]];
  let rid=1;
  for(const [sx,sy] of spots){
    let placed=null;
    for(let r=0;r<9&&!placed;r++)for(let dy=-r;dy<=r&&!placed;dy++)for(let dx=-r;dx<=r&&!placed;dx++){
      const x=sx+dx,y=sy+dy;
      if(x<1||y<1||x>=MAP-1||y>=MAP-1)continue;
      if(!G.map[y][x]&&!G.ford[x+','+y]&&!G.water[x+','+y])placed={x,y};
    }
    if(placed)G.relics.push({id:rid++,x:placed.x,y:placed.y,held:null,mon:null});
  }
}
function genMapForest(){
  G.map=Array.from({length:MAP},()=>Array(MAP).fill(0));
  G.water={};G.ford={};
  G.elev=new Uint8Array(MAP*MAP);
  const rng=(n)=>SRi(n);
  const C=MAP/2;
  // carve open ground out of what will otherwise be solid forest
  const open=new Uint8Array(MAP*MAP);
  const carve=(cx,cy,r)=>{
    for(let y=Math.floor(cy-r-1);y<=cy+r+1;y++)for(let x=Math.floor(cx-r-1);x<=cx+r+1;x++){
      if(x<1||y<1||x>=MAP-1||y>=MAP-1)continue;
      if(hyp(x-cx,y-cy)<=r+((x*7+y*13)%3)*.35)open[y*MAP+x]=1;
    }};
  for(const[bx,by] of START)carve(bx+1,by+1,8);
  carve(C,C,6.5);
  carve(12,12,4.5);carve(MAP-13,MAP-13,4.5);
  const trail=(x0,y0,x1,y1,w)=>{
    let x=x0,y=y0,guard=0;
    while(hyp(x1-x,y1-y)>1.5&&guard++<400){
      carve(Math.round(x),Math.round(y),w);
      const a=dAtan2(y1-y,x1-x)+(SR()-.5)*.9;
      x+=dCos(a)*1.3;y+=dSin(a)*1.3;
    }};
  // a spoke trail from every base to the contested center, plus two pocket trails
  for(const [bx,by] of START)trail(bx+1,by+1,C,C,2);
  trail(12,12,C,C,1.6);
  trail(MAP-13,MAP-13,C,C,1.6);
  for(let y=1;y<MAP-1;y++)for(let x=1;x<MAP-1;x++){
    if(open[y*MAP+x])continue;
    const k=x+','+y;
    G.res[k]={type:'wood',amt:RES_META.wood.amt,x,y};G.map[y][x]=1;
  }
  const placeRes=(type,cx,cy,n)=>{let placed=0,tries=0;
    while(placed<n&&tries++<220){const x=cx+rng(5)-2,y=cy+rng(5)-2;
      if(x<2||y<2||x>=MAP-2||y>=MAP-2)continue;const k=x+','+y;
      if(G.map[y][x]||G.res[k])continue;
      G.res[k]={type,amt:RES_META[type].amt,x,y};G.map[y][x]=1;placed++;}};
  for(const [bx,by] of START){
    const dx=Math.sign(C-bx),dy=Math.sign(C-by);
    placeRes('food',bx+4*dx,by-3*dy,6);
    placeRes('food',bx-2*dx,by+4*dy,4);
    placeRes('gold',bx+2*dx,by+6*dy,5);
  }
  // contested center: a low hill with the richest gold, plus corner pockets
  for(let y=C-4;y<=C+4;y++)for(let x=C-4;x<=C+4;x++){
    if(open[y*MAP+x]&&hyp(x-C,y-C)<=2.8)G.elev[y*MAP+x]=1;}
  placeRes('gold',C,C,6);placeRes('food',C-3,C+3,4);
  placeRes('gold',12,12,4);placeRes('gold',MAP-13,MAP-13,4);
}
/* Grow one dense, organic forest from a seed tile. Frontier tiles are consumed
   in random order, so the mass comes out ragged and lobed rather than circular,
   and it FILLS — a forest you must path around, not a scatter of lone trees. */
function placeForest(cx,cy,n,minStart){
  const open=[[cx,cy]],seen=new Set();
  let placed=0,guard=0;
  const near=(x,y)=>START.some(([bx,by])=>hyp(x-bx,y-by)<(minStart||10));
  while(open.length&&placed<n&&guard++<n*14){
    const i=SRi(open.length);
    const spot=open.splice(i,1)[0],x=spot[0],y=spot[1],k=x+','+y;
    if(seen.has(k))continue;
    seen.add(k);
    if(x<1||y<1||x>=MAP-1||y>=MAP-1)continue;
    if(G.map[y][x]||G.res[k]||G.ford[k]||G.water[k]||near(x,y))continue;
    G.res[k]={type:'wood',amt:RES_META.wood.amt,x,y};G.map[y][x]=1;placed++;
    for(const d of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]])
      if(SR()<.74)open.push([x+d[0],y+d[1]]);
  }
  return placed;
}
function genMapRiver(){
  G.map=Array.from({length:MAP},()=>Array(MAP).fill(0)); // 0 grass 1 blocked
  G.water={};G.ford={};
  const rng=(n)=>SRi(n);
  // meandering river NW->SE with three sandy fords — four tiles wide so a
  // navy has room to maneuver and docks find a 2x2 berth
  for(let x=0;x<MAP;x++){
    const cy=Math.round(MAP*.34+(x/MAP)*MAP*.32+dSin(x*.33)*2.6);
    const isFord=[.2,.5,.8].some(f=>Math.abs(x-MAP*f)<2);
    for(let dy=-1;dy<=2;dy++){
      const y=cy+dy;if(y<1||y>=MAP-1)continue;
      const k=x+','+y;
      if(isFord)G.ford[k]=1;
      else{G.map[y][x]=1;G.water[k]=1;}
    }
    // schools of fish along the channel
    if(x%6===3&&!isFord){
      const fy=cy+((x>>1)%2);
      const fk=x+','+fy;
      if(G.water[fk]&&!G.res[fk])G.res[fk]={type:'fish',amt:RES_META.fish.amt,x,y:fy};
    }
  }
  // hills — walkable plateaus that grant a high-ground combat bonus
  G.elev=new Uint8Array(MAP*MAP);
  for(let hb=0,nH=Math.round(6*MAP*MAP/4096);hb<nH;hb++){
    const hx=6+rng(MAP-12),hy=6+rng(MAP-12),hr=3+rng(3);
    let bad=false;
    for(const[bx,by] of START)if(hyp(hx-bx,hy-by)<10)bad=true;
    if(bad)continue;
    for(let y=hy-hr;y<=hy+hr;y++)for(let x=hx-hr;x<=hx+hr;x++){
      if(x<1||y<1||x>=MAP-1||y>=MAP-1)continue;
      const k=x+','+y;
      if(G.water[k]||G.ford[k])continue;
      if(hyp(x-hx,y-hy)<=hr-.2+((x*7+y*13)%2)*.5)G.elev[y*MAP+x]=1;
    }
  }
  const nearFord=(x,y)=>{for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)
    if(G.ford[(x+dx)+','+(y+dy)])return true;return false;};
  const placeRes=(type,cx,cy,n)=>{let placed=0,tries=0;
    while(placed<n&&tries++<220){const x=cx+rng(5)-2,y=cy+rng(5)-2;
      if(x<1||y<1||x>=MAP-1||y>=MAP-1)continue;const k=x+','+y;
      if(G.map[y][x]||G.res[k]||G.ford[k]||nearFord(x,y))continue;
      G.res[k]={type,amt:RES_META[type].amt,x,y};G.map[y][x]=1;placed++;}};
  // forests: proper dense woods, scaled to the board (was 48 scattered handfuls
  // that checked only the first two starts — they landed on player 3-8's base)
  for(let b=0,nF=Math.round(11*MAP*MAP/4096);b<nF;b++){
    const cx=3+rng(MAP-6),cy=3+rng(MAP-6);
    if(G.water[cx+','+cy]||G.ford[cx+','+cy])continue;
    placeForest(cx,cy,26+rng(52),10);
  }
  // per-player berries, gold, nearby woods
  for(const [bx,by] of START){
    // ||1: a start sitting exactly on the centre axis gives sign()===0, which
    // collapsed its whole woodline onto the Town Hall (4 of 8 starts on a ring)
    const dx=Math.sign(MAP/2-bx)||1,dy=Math.sign(MAP/2-by)||1;
    placeRes('food',bx+5*dx,by-4*dy,6);
    placeRes('food',bx-3*dx,by+6*dy,4);
    placeRes('gold',bx+8*dx,by+8*dy,5);
    placeRes('wood',bx+dx,by+9*dy,8); placeRes('wood',bx+9*dx,by+dy,8);
  }
  placeRes('gold',MAP*.36|0,MAP*.36|0,5);placeRes('gold',MAP*.64|0,MAP*.64|0,5);
  placeRes('gold',MAP*.2|0,MAP*.75|0,4);placeRes('gold',MAP*.8|0,MAP*.25|0,4);
  placeRes('food',MAP*.45|0,MAP*.28|0,5);placeRes('food',MAP*.55|0,MAP*.72|0,5);
}
function genMapHallowed(){
  // open steppe with forest clumps, small fishable ponds and hills — an original
  // generator built to the proportions in the CD's HALLOWED.RMS sample script
  G.map=Array.from({length:MAP},()=>Array(MAP).fill(0));
  G.water={};G.ford={};
  const rng=(n)=>SRi(n);
  // ponds (the script's little oases), never near a start; fish in each
  for(let p2=0,nP=Math.round(8*MAP*MAP/4096);p2<nP;p2++){
    const px=6+rng(MAP-12),py=6+rng(MAP-12),pr=2+rng(2);
    if(START.some(([bx,by])=>hyp(px-bx,py-by)<12))continue;
    for(let y=py-pr;y<=py+pr;y++)for(let x=px-pr;x<=px+pr;x++){
      if(x<2||y<2||x>=MAP-2||y>=MAP-2)continue;
      if(hyp(x-px,y-py)<=pr-.3+((x*7+y*13)%2)*.6){
        G.map[y][x]=1;G.water[x+','+y]=1;}
    }
    const fk=px+','+py;
    if(G.water[fk]&&!G.res[fk])G.res[fk]={type:'fish',amt:RES_META.fish.amt,x:px,y:py};
  }
  // walkable hill plateaus
  G.elev=new Uint8Array(MAP*MAP);
  for(let hb=0,nH=Math.round(7*MAP*MAP/4096);hb<nH;hb++){
    const hx=6+rng(MAP-12),hy=6+rng(MAP-12),hr=3+rng(3);
    if(START.some(([bx,by])=>hyp(hx-bx,hy-by)<10))continue;
    for(let y=hy-hr;y<=hy+hr;y++)for(let x=hx-hr;x<=hx+hr;x++){
      if(x<1||y<1||x>=MAP-1||y>=MAP-1)continue;
      if(G.water[x+','+y])continue;
      if(hyp(x-hx,y-hy)<=hr-.2+((x*7+y*13)%2)*.5)G.elev[y*MAP+x]=1;
    }
  }
  const placeRes=(type,cx,cy,n)=>{let placed=0,tries=0;
    while(placed<n&&tries++<220){const x=cx+rng(5)-2,y=cy+rng(5)-2;
      if(x<1||y<1||x>=MAP-1||y>=MAP-1)continue;const k=x+','+y;
      if(G.map[y][x]||G.res[k])continue;
      G.res[k]={type,amt:RES_META[type].amt,x,y};G.map[y][x]=1;placed++;}};
  // forest clumps — fewer and smaller than the river map; this is open steppe
  for(let b=0,nF=Math.round(8*MAP*MAP/4096);b<nF;b++){
    const cx=3+rng(MAP-6),cy=3+rng(MAP-6);
    if(G.water[cx+','+cy])continue;
    placeForest(cx,cy,16+rng(30),11);
  }
  // per-player berries, gold and woodlots
  for(const [bx,by] of START){
    const dx=Math.sign(MAP/2-bx)||1,dy=Math.sign(MAP/2-by)||1;
    placeRes('food',bx+5*dx,by-4*dy,6);
    placeRes('food',bx-3*dx,by+6*dy,4);
    placeRes('gold',bx+8*dx,by+8*dy,5);
    placeRes('wood',bx+dx,by+9*dy,8);placeRes('wood',bx+9*dx,by+dy,8);
  }
  placeRes('gold',MAP*.5|0,MAP*.5|0,6);
  placeRes('gold',MAP*.25|0,MAP*.7|0,4);placeRes('gold',MAP*.75|0,MAP*.3|0,4);
  placeRes('food',MAP*.4|0,MAP*.3|0,5);placeRes('food',MAP*.6|0,MAP*.7|0,5);
}
