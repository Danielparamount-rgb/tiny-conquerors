/* ================= constants ================= */
/* ---------- deterministic math (cross-engine lockstep) ----------
   ECMAScript pins basic IEEE-754 arithmetic (+ - * / %), Math.sqrt and
   Math.fround to exact bit-level results — but Math.sin/cos/atan2/pow/hypot
   are "implementation-approximated": V8 (Chrome/Android) and JavaScriptCore
   (iPhone Safari) genuinely return different bits. Any of them in the SIM
   path desyncs a cross-engine multiplayer match despite perfect seeding.
   So the sim uses ONLY these replacements, built from pinned ops. Render,
   sound and UI code may keep the native Math.* — cosmetics never touch G. */
const D_TAU=6.283185307179586,D_PI=3.141592653589793,D_HPI=1.5707963267948966;
function hyp(x,y){return Math.sqrt(x*x+y*y);}          // Math.hypot is NOT pinned; this is
function dSin(x){                                       // |err| < 1e-9 over all reals
  x-=D_TAU*Math.floor(x/D_TAU);                         // [0,TAU)
  if(x>D_PI)x-=D_TAU;                                   // (-PI,PI]
  if(x>D_HPI)x=D_PI-x;else if(x<-D_HPI)x=-D_PI-x;       // fold to [-PI/2,PI/2]
  const z=x*x;                                          // Taylor to x^13 (pinned literals)
  return x*(1-z*(1/6-z*(1/120-z*(1/5040-z*(1/362880-z*(1/39916800-z/6227020800))))));
}
function dCos(x){return dSin(x+D_HPI);}
function dAtanU(z){                                     // atan on [0,1], |err| ~ 1e-7
  let o=0;
  if(z>0.41421356237309503){o=0.7853981633974483;z=(z-1)/(z+1);} // fold past tan(PI/8)
  const s=z*z;
  return o+z*(1-s*(1/3-s*(1/5-s*(1/7-s*(1/9-s*(1/11-s/13))))));
}
function dAtan2(y,x){
  const ax=x<0?-x:x,ay=y<0?-y:y;
  let a;
  if(ax>=ay)a=ax===0?0:dAtanU(ay/ax);
  else a=D_HPI-dAtanU(ax/ay);
  if(x<0)a=D_PI-a;
  return y<0?-a:a;
}
function dPowi(b,k){return k===1?b:k===2?b*b:b*b*b;}    // motParams k is only ever 1/2/3
/* Startup canary: hash a battery of the exact operations the sim leans on and
   compare against the value this build was tested with. A device that computes
   differently (exotic engine, FMA-fused JIT) would desync a lockstep match —
   warn in the multiplayer lobby instead of letting it drift mid-battle. */
function mathSelfTest(){
  const f=new Float64Array(1),iv=new Uint32Array(f.buffer);
  let h=2166136261>>>0;
  const mix=v=>{f[0]=v;h^=iv[0];h=Math.imul(h,16777619);h^=iv[1];h=Math.imul(h,16777619);};
  let x=0.123456789;
  for(let i=1;i<=256;i++){
    x=x*1.0000001+i*0.618033988749895;
    const a=x%12.566370614359172-6.283185307179586;
    mix(dSin(a));mix(dCos(a*0.7));mix(dAtan2(a,1.7-a*0.3));
    mix(hyp(a,i*0.011));mix(Math.sqrt(i+0.5));mix(dPowi(0.9999+a*1e-6,3));
  }
  return (h>>>0).toString(16);
}
const MATH_GOLD='fe27d213'; // computed on V8; the kit is pinned-ops only, so every conforming engine should match
let MATH_DRIFT=false;
try{MATH_DRIFT=mathSelfTest()!==MATH_GOLD;}catch(e){MATH_DRIFT=true;}
let MAP=64; const TILE=26;
let START=[[8,53],[53,9],[10,10]];
function genStarts(n){
  // ring placement: player 0 at the south-west, others spread evenly
  const c=MAP/2,r=MAP*.4,out=[];
  for(let i=0;i<n;i++){
    const a=Math.PI*.75+i*2*Math.PI/n;
    out.push([Math.max(3,Math.min(MAP-5,Math.round(c+dCos(a)*r))),
              Math.max(3,Math.min(MAP-5,Math.round(c+dSin(a)*r)))]);
  }
  return out;
}
const AGES=['Dark Age','Feudal Age','Castle Age','Imperial Age'];
const AGE_COST=[null,{f:500},{f:800,g:200},{f:1000,g:800}];
const AGE_TIME=[0,25,35,45];
/* Unit stats follow the AoE2:TC manual's Unit Attributes tables (Appendix pp. 42-44).
   `line` arrays index by age (upgrade lines: Militia->Champion etc.); unique units
   gain their manual Elite stats at the Imperial Age via `elite`. */
const UNITS={
  villager:{name:'Villager',hp:25,atk:3,range:.6,speed:1.35,cost:{f:50},train:7},
  militia:{name:'Militia',hp:40,atk:4,range:.6,speed:1.15,cost:{f:60,g:20},train:7,age:0,
    line:{name:['Militia','Man-at-Arms','Longswordsman','Champion'],hp:[40,45,55,70],atk:[4,6,9,13]}},
  spearman:{name:'Spearman',hp:45,atk:3,range:.6,speed:1.25,cost:{f:35,w:25},train:6,age:1,vsCav:10,
    line:{name:[,'Spearman','Pikeman','Halberdier'],hp:[,45,55,60],atk:[,3,4,6]}},
  archer:{name:'Archer',hp:30,atk:4,range:4,speed:1.25,cost:{w:25,g:45},train:7,age:1,ranged:true,
    line:{name:[,'Archer','Crossbowman','Arbalest'],hp:[,30,35,40],atk:[,4,5,6],rng:[,4,5,5]}},
  skirmisher:{name:'Skirmisher',hp:30,atk:2,range:4,speed:1.25,cost:{f:25,w:35},train:6,age:1,ranged:true,vsRanged:5,
    line:{name:[,'Skirmisher','Skirmisher','Elite Skirmisher'],hp:[,30,30,35],atk:[,2,2,3],rng:[,4,4,5]}},
  scout:{name:'Scout Cavalry',hp:45,atk:3,range:.7,speed:2.3,cost:{f:80},train:8,age:1,cav:true,
    line:{name:[,'Scout Cavalry','Light Cavalry','Hussar'],hp:[,45,60,75],atk:[,5,7,7]}}, // 1.0B: +2 atk in Feudal
  knight:{name:'Knight',hp:100,atk:10,range:.7,speed:2.0,cost:{f:60,g:75},train:10,age:2,cav:true,
    line:{name:[,,'Knight','Cavalier'],hp:[,,100,120],atk:[,,10,12]}},
  ram:{name:'Battering Ram',hp:175,atk:40,range:.7,speed:.85,cost:{w:160,g:75},train:14,age:2,ram:true,garCap:4,
    line:{name:[,,'Battering Ram','Capped Ram'],hp:[,,175,200],atk:[,,40,45]}},
  petard:{name:'Petard',hp:50,atk:25,range:.6,speed:1.25,cost:{f:80,g:20},train:6,age:2,petard:true},
  /* ---- siege engines (manual p. 44; CD TECHTREE) — ranges scaled ~.75 like the rest ---- */
  scorpion:{name:'Scorpion',hp:40,atk:12,range:5.5,speed:.9,cost:{w:75,g:75},train:12,age:2,ranged:true,siege:true,rof:3.6,pierce:1,
    line:{name:[,,'Scorpion','Heavy Scorpion'],hp:[,,40,50],atk:[,,12,16]}},
  mangonel:{name:'Mangonel',hp:50,atk:40,range:6,speed:.9,cost:{w:160,g:135},train:14,age:2,ranged:true,siege:true,rof:6,blast:1.6,
    line:{name:[,,'Mangonel','Onager'],hp:[,,50,60],atk:[,,40,50],rng:[,,6,6.5]}},
  treb:{name:'Trebuchet',hp:150,atk:200,range:12,speed:.6,cost:{w:200,g:200},train:18,age:3,ranged:true,siege:true,treb:true,rof:10},
  bombard:{name:'Bombard Cannon',hp:80,atk:40,range:9,speed:.8,cost:{w:225,g:225},train:16,age:3,ranged:true,siege:true,gun:true,rof:6.5,vsBld:200,chem:true}, // 1.0B: +80 vs buildings
  handcannon:{name:'Hand Cannoneer',hp:35,atk:17,range:6,speed:1.2,cost:{f:45,g:50},train:9,age:3,ranged:true,gun:true,rof:2.2,vsInf:10,chem:true},
  monk:{name:'Monk',hp:30,atk:0,range:2.2,speed:1.15,cost:{g:100},train:12,age:2,monk:true},
  missionary:{name:'Missionary',hp:30,atk:0,range:1.8,speed:1.55,cost:{g:100},train:11,age:2,monk:true,noRelic:true,cav:true},
  /* ---- unique units ---- */
  longbow:{name:'Longbowman',hp:35,atk:6,range:5,speed:1.25,cost:{w:35,g:40},train:8,age:2,ranged:true,
    elite:{name:'Elite Longbowman',hp:40,atk:7,rng:6}},
  axeman:{name:'Throwing Axeman',hp:50,atk:7,range:3,speed:1.15,cost:{f:55,g:25},train:8,age:2,ranged:true,
    elite:{name:'Elite Throwing Axeman',hp:60,atk:8}},
  berserker:{name:'Berserk',hp:48,atk:9,range:.6,speed:1.25,cost:{f:65,g:25},train:9,age:2,regen:true,
    elite:{name:'Elite Berserk',hp:60,atk:14}},
  mangudai:{name:'Mangudai',hp:60,atk:6,range:4,speed:2.1,cost:{w:55,g:65},train:10,age:2,cav:true,ranged:true,
    elite:{name:'Elite Mangudai',hp:60,atk:8}},
  teuton:{name:'Teutonic Knight',hp:70,atk:12,range:.6,speed:.9,cost:{f:85,g:40},train:9,age:2,
    elite:{name:'Elite Teutonic Knight',hp:100,atk:17}},
  woad:{name:'Woad Raider',hp:65,atk:8,range:.6,speed:1.8,cost:{f:65,g:25},train:8,age:2,
    elite:{name:'Elite Woad Raider',hp:80,atk:13}},
  cataphract:{name:'Cataphract',hp:110,atk:9,range:.7,speed:1.9,cost:{f:70,g:75},train:11,age:2,cav:true,vsInf:6,
    elite:{name:'Elite Cataphract',hp:150,atk:12}},
  mameluke:{name:'Mameluke',hp:65,atk:7,range:3,speed:2.0,cost:{f:55,g:85},train:11,age:2,cav:true,vsCav:9,ranged:true,
    elite:{name:'Elite Mameluke',hp:80,atk:10}},
  huskarl:{name:'Huskarl',hp:60,atk:10,range:.6,speed:1.3,cost:{f:80,g:40},train:9,age:2,arrowRes:.5,
    elite:{name:'Elite Huskarl',hp:70,atk:12}},
  chukonu:{name:'Chu Ko Nu',hp:45,atk:8,range:4,speed:1.25,cost:{w:40,g:35},train:8,age:2,ranged:true,rof:1.0,
    elite:{name:'Elite Chu Ko Nu',hp:50,atk:8}},
  elephant:{name:'War Elephant',hp:450,atk:15,range:.7,speed:1.0,cost:{f:200,g:75},train:16,age:2,cav:true,vsBld:5,
    elite:{name:'Elite War Elephant',hp:600,atk:20}},
  janissary:{name:'Janissary',hp:35,atk:17,range:6,speed:1.2,cost:{f:60,g:55},train:9,age:2,ranged:true,rof:2.0,
    elite:{name:'Elite Janissary',hp:40,atk:22}},
  samurai:{name:'Samurai',hp:60,atk:8,range:.6,speed:1.2,cost:{f:60,g:30},train:8,age:2,vsUnique:5,
    elite:{name:'Elite Samurai',hp:80,atk:12}},
  jaguar:{name:'Jaguar Warrior',hp:50,atk:10,range:.6,speed:1.25,cost:{f:60,g:30},train:9,age:2,vsInf:10,
    elite:{name:'Elite Jaguar Warrior',hp:75,atk:12}},
  eagle:{name:'Eagle Warrior',hp:50,atk:7,range:.6,speed:1.7,cost:{f:20,g:50},train:8,age:1,arrowRes:.7,
    elite:{name:'Elite Eagle Warrior',hp:60,atk:9}},
  plumed:{name:'Plumed Archer',hp:50,atk:5,range:4,speed:1.55,cost:{w:46,g:46},train:8,age:2,ranged:true,
    elite:{name:'Elite Plumed Archer',hp:65,atk:5,rng:5}},
  warwagon:{name:'War Wagon',hp:150,atk:9,range:4.5,speed:1.55,cost:{w:120,g:60},train:12,age:2,cav:true,ranged:true,
    elite:{name:'Elite War Wagon',hp:200,atk:9,rng:5.5}}, // 1.0B: dearer, shorter-ranged
  conquistador:{name:'Conquistador',hp:55,atk:16,range:5,speed:1.9,cost:{f:60,g:70},train:10,age:2,cav:true,ranged:true,rof:2.0,
    elite:{name:'Elite Conquistador',hp:70,atk:18}},
  tarkan:{name:'Tarkan',hp:90,atk:7,range:.7,speed:1.9,cost:{f:60,g:60},train:9,age:2,cav:true,vsBld:8,
    elite:{name:'Elite Tarkan',hp:150,atk:11,vsBld:10}},
  /* ---- ships (manual p. 44) — built at the Dock ---- */
  fishing:{name:'Fishing Ship',hp:60,atk:0,range:.6,speed:1.5,cost:{w:75},train:7,ship:true,fisher:true,passive:true},
  cog:{name:'Trade Cog',hp:80,atk:0,range:.6,speed:1.7,cost:{w:100,g:50},train:9,age:1,ship:true,passive:true},
  tradecart:{name:'Trade Cart',hp:70,atk:0,range:.6,speed:1.5,cost:{w:100,g:50},train:10,age:1,passive:true,trade:true},
  king:{name:'King',hp:75,atk:0,range:.6,speed:1.35,cost:{},train:1,age:0,passive:true,king:true},
  transport:{name:'Transport Ship',hp:100,atk:0,range:.6,speed:1.7,cost:{w:125},train:10,age:1,ship:true,passive:true,garCap:5},
  galley:{name:'Galley',hp:120,atk:6,range:4.5,speed:1.8,cost:{w:90,g:30},train:11,age:1,ship:true,ranged:true,
    line:{name:[,'Galley','War Galley','Galleon'],hp:[,120,135,165],atk:[,6,7,8],rng:[,4.5,5,5.5]}},
  fireship:{name:'Fire Ship',hp:100,atk:2,range:1.8,speed:1.9,cost:{w:75,g:45},train:10,age:2,ship:true,ranged:true,rof:.4,vsShip:3,
    elite:{name:'Fast Fire Ship',hp:120,atk:3}},
  demo:{name:'Demolition Ship',hp:50,atk:110,range:.8,speed:1.8,cost:{w:70,g:50},train:9,age:2,ship:true,demo:true,
    elite:{name:'Heavy Demolition Ship',hp:60,atk:140}},
  longboat:{name:'Longboat',hp:130,atk:7,range:5,speed:1.9,cost:{w:100,g:50},train:9,age:2,ship:true,ranged:true,
    elite:{name:'Elite Longboat',hp:160,atk:8,rng:5.5}},
  turtle:{name:'Turtle Ship',hp:200,atk:50,range:3,speed:1.2,cost:{w:200,g:200},train:14,age:2,ship:true,ranged:true,rof:2.6,arrowRes:.5,
    elite:{name:'Elite Turtle Ship',hp:300,atk:50}},
  cannongalleon:{name:'Cannon Galleon',hp:120,atk:35,range:7,speed:1.5,cost:{w:200,g:150},train:15,age:3,ship:true,ranged:true,gun:true,rof:6,vsBld:165,chem:true},
  /* ---- wildlife (manual Ch. II "Food"): not trainable, never bought. They live
     as units so they can walk, be shot at and die like anything else; the meat
     they leave behind is an ordinary food resource, so villagers gather from a
     carcass with the code that already gathers from a berry bush. ---- */
  sheep:{name:'Sheep',hp:7,atk:0,range:.6,speed:.62,cost:{},train:0,
    animal:true,herd:true,meat:100,passive:true},
  deer:{name:'Deer',hp:15,atk:0,range:.6,speed:1.75,cost:{},train:0,
    animal:true,skittish:true,meat:140,passive:true},
  boar:{name:'Wild Boar',hp:75,atk:8,range:.7,speed:1.5,cost:{},train:0,
    animal:true,fierce:true,meat:340,rof:2.2},
};
const INF=new Set(['militia','spearman','berserker','teuton','woad','axeman','huskarl','samurai','jaguar','eagle']);
const UU_SET=new Set(); // filled after CIVS below — samurai's manual bonus targets these
/* Civilization attributes follow the manual (Appendix pp. 27-29), adapted to this
   game's mechanics (no navy/blacksmith/stone). Order of the first 12 is FROZEN for
   save compatibility — new civs append at the end. `ut` = unique technology id. */
const CIVS=[
  {id:'britons',name:'Britons',uu:'longbow',ut:'yeomen',archerRange:1,
   blurb:'Foot archers +1 range. Unique: Longbowman. Tech: Yeomen (+1 archer range, stronger towers).'},
  {id:'franks',name:'Franks',uu:'axeman',ut:'bearded',cavHp:1.2,castleCost:.75,farmFast:1.2,
   blurb:'Knights +20% HP, castles -25% cost, farmers faster. Unique: Throwing Axeman. Tech: Bearded Axe (+1 axe range).'},
  {id:'vikings',name:'Vikings',uu:'berserker',ut:'berserkergang',infHpAge:[1,1.1,1.15,1.2],vilSpd:1.1,vilCarry:2,shipCost:.8,uuShip:'longboat',
   blurb:'Infantry HP grows each age; villagers haul faster; warships -20% cost. Unique: Berserk and the Longboat. Tech: Berserkergang.'},
  {id:'mongols',name:'Mongols',uu:'mangudai',ut:'drill',mangRof:.8,scoutHp:1.3,huntFast:1.5,
   blurb:'Hunters butcher 50% faster; Mangudai fire 20% faster; scout line +30% HP. Unique: Mangudai. Tech: Drill (rams move 50% faster).'},
  {id:'teutons',name:'Teutons',uu:'teuton',ut:'crenellations',garArrow:2,towerGar:2,healRange:2,
   blurb:'Towers hold twice the garrison and fire double arrows; monks heal from afar. Unique: Teutonic Knight. Tech: Crenellations (+3 castle range).'},
  {id:'celts',name:'Celts',uu:'woad',ut:'furor',woodMult:1.15,infSpd:1.15,siegeRof:.8,sheepLock:true,
   blurb:'Infantry 15% faster, lumberjacks faster, rams strike quicker; their flocks cannot be stolen. Unique: Woad Raider. Tech: Furor Celtica (+50% ram HP).'},
  {id:'byzantines',name:'Byzantines',uu:'cataphract',ut:'logistica',bldHpAge:[1.1,1.2,1.3,1.4],counterCost:.75,impDisc:.67,freeTech:{watch:1},
   blurb:'Buildings harden each age; spear and skirmish troops -25%; cheaper Imperial Age. Unique: Cataphract. Tech: Logistica (trample damage).'},
  {id:'saracens',name:'Saracens',uu:'mameluke',ut:'zealotry',mktRate:true,
   blurb:'Market trades at nearly no fee. Unique: Mameluke camel rider. Tech: Zealotry (+30 Mameluke HP).'},
  {id:'goths',name:'Goths',uu:'huskarl',ut:'anarchy',infCost:.75,infCostAge:1,popBonus:10,vsBoar:5,huntCarry:15,
   blurb:'Infantry -15% cost; hunters +5 attack against boar and carry +15 meat; +10 population in the Imperial Age. Unique: Huskarl, shrugs off arrows. Techs: Anarchy, then Perfusion.'},
  {id:'chinese',name:'Chinese',uu:'chukonu',ut:'rocketry',startVills:3,startF:-200,startW:-50,techDisc:[1,.9,.85,.8],farmFast:1.15,
   blurb:'Start with +3 villagers but less food; ages cost less. Unique: Chu Ko Nu, rapid-fire crossbow. Tech: Rocketry (+2 attack).'},
  {id:'persians',name:'Persians',uu:'elephant',ut:'mahouts',tcHp:2,startF:50,startW:50,
   blurb:'Town Hall has double HP; start with bonus food and wood. Unique: War Elephant. Tech: Mahouts (+30% elephant speed).'},
  {id:'turks',name:'Turks',uu:'janissary',ut:'artillery',goldMult:1.15,gunHp:1.25,
   blurb:'Gold miners 15% faster; Janissaries +25% HP. Unique: Janissary, long-range gunner. Tech: Artillery (+ range).'},
  /* ---- The Conquerors civilizations (+ Japanese from Age of Kings) ---- */
  {id:'japanese',name:'Japanese',uu:'samurai',ut:'kataparuto',campCost:.5,infRofAge:[1,.75,.75,.75],fishHp:2,
   blurb:'Storage Camps half price; infantry strike faster each age; hardy fishing ships. Unique: Samurai, slayer of unique units. Tech: Kataparuto.'},
  {id:'aztecs',name:'Aztecs',uu:'jaguar',ut:'garland',vilCarry:5,trainFast:.85,monkHp:15,noStable:true,eagles:true,freeTech:{loom:1},
   blurb:'Villagers carry +5; military trains 15% faster; no cavalry — fields Eagle Warriors. Unique: Jaguar Warrior. Tech: Garland Wars (+4 infantry attack).'},
  {id:'mayans',name:'Mayans',uu:'plumed',ut:'eldorado',startVills:1,startF:-50,resLast:1.2,archCost:.8,noStable:true,eagles:true,
   blurb:'Start +1 villager; resources last 20% longer; archers -20% cost; no cavalry — fields Eagle Warriors. Unique: Plumed Archer. Tech: El Dorado (+40 Eagle HP).'},
  {id:'huns',name:'Huns',uu:'tarkan',ut:'atheism',noHouse:true,startW:-100,
   blurb:'Need no Houses, but start -100 wood. Unique: Tarkan, scourge of buildings. Tech: Atheism (spies reveal your enemies).'},
  {id:'koreans',name:'Koreans',uu:'warwagon',ut:'shinkichon',vilLos:3,towerRangeAge:[0,0,1,2],towerCost:.75,uuShip:'turtle',
   blurb:'Villagers see farther; towers cheaper with growing range. Unique: War Wagon and the armored Turtle Ship. Tech: Shinkichon.'},
  {id:'spanish',name:'Spanish',uu:'conquistador',ut:'supremacy',buildFast:1.3,missionaries:true,gunRof:.85,
   blurb:'Builders work 30% faster; Monastery trains swift Missionaries. Unique: Conquistador, mounted gunner. Tech: Supremacy (fighting villagers).'},
];
for(const cv of CIVS)UU_SET.add(cv.uu);
/* Team bonuses (CD TECHTREE.PDF) — each civ grants its `tb` key to every ally. */
const TEAM_BONUS={britons:'rangeFast',franks:'knightLos',vikings:'dockCheap',mongols:'scoutLos',
  teutons:'convResist',celts:'siegeFast',byzantines:'healFast',saracens:'archVsBld',
  goths:'barracksFast',chinese:'farmFood',persians:'knightVsArcher',turks:'gunFast',
  japanese:'galleyLos',aztecs:'relicGold',mayans:'wallCheap',huns:'stableFast',
  koreans:'mangonelRng',spanish:'tradeGold'};
function teamHas(p,key){
  if(!G||!G.P)return false;
  for(let q=0;q<G.P.length;q++)
    if(allied(q,p)&&TEAM_BONUS[CIVS[G.P[q].civ||0].id]===key)return true;
  return false;
}
function civOf(p){return CIVS[G.P[p].civ||0];}
function allied(a,b){return a===b||(G&&G.teams&&G.teams[a]!=null&&G.teams[a]===G.teams[b]);}
/* stat resolution: line by age, elite at Imperial, else base (manual values) */
function statFor(type,p){
  const d=UNITS[type],age=G?G.P[p].age:0;
  let hp=d.hp,atk=d.atk,rng=d.range,name=d.name,vsBld=d.vsBld||0;
  if(d.line){
    const a=Math.max(d.age||0,Math.min(3,age));
    if(d.line.hp[a]!=null)hp=d.line.hp[a];
    if(d.line.atk[a]!=null)atk=d.line.atk[a];
    if(d.line.rng&&d.line.rng[a]!=null)rng=d.line.rng[a];
    if(d.line.name[a])name=d.line.name[a];
  }else if(d.elite&&age>=3){
    hp=d.elite.hp;atk=d.elite.atk;name=d.elite.name;
    if(d.elite.rng!=null)rng=d.elite.rng;
    if(d.elite.vsBld!=null)vsBld=d.elite.vsBld;
  }
  return{hp,atk,rng,name,vsBld};
}
function unitName(type,p){return G?statFor(type,p).name:UNITS[type].name;}
/* Unique technologies — manual pp. 21-25 & 47 (costs; stone converted to wood/gold).
   Researched at the Castle. Goths research Anarchy (Castle Age) then Perfusion. */
const UTECHS={
  garland:{name:'Garland Wars',cost:{f:450,g:750},desc:'+4 infantry attack',age:3},
  yeomen:{name:'Yeomen',cost:{w:750,g:450},desc:'+1 foot archer range; towers +2 attack',age:3},
  logistica:{name:'Logistica',cost:{f:1000,g:600},desc:'Cataphracts trample nearby foes',age:3},
  furor:{name:'Furor Celtica',cost:{f:750,g:450},desc:'Rams +50% HP',age:3},
  rocketry:{name:'Rocketry',cost:{w:750,g:750},desc:'Chu Ko Nu +2 attack',age:3},
  bearded:{name:'Bearded Axe',cost:{f:400,g:400},desc:'Throwing Axemen +1 range',age:3},
  anarchy:{name:'Anarchy',cost:{f:450,g:250},desc:'Train Huskarls at the Barracks',age:2},
  perfusion:{name:'Perfusion',cost:{w:400,g:600},desc:'Barracks work 50% faster',age:3},
  atheism:{name:'Atheism',cost:{f:500,g:500},desc:'Spies: see all that your enemies see',age:3},
  kataparuto:{name:'Kataparuto',cost:{w:750,g:400},desc:'Rams strike and train faster',age:3},
  shinkichon:{name:'Shinkichon',cost:{w:800,g:500},desc:'Towers and Castles +2 range',age:3},
  eldorado:{name:'El Dorado',cost:{f:750,g:450},desc:'Eagle Warriors +40 HP',age:3},
  drill:{name:'Drill',cost:{w:500,g:450},desc:'Rams move 50% faster',age:3},
  mahouts:{name:'Mahouts',cost:{f:300,g:300},desc:'War Elephants 30% faster',age:3},
  zealotry:{name:'Zealotry',cost:{f:750,g:800},desc:'Mamelukes +30 HP',age:3},
  supremacy:{name:'Supremacy',cost:{f:400,g:250},desc:'Villagers become fierce fighters',age:3},
  crenellations:{name:'Crenellations',cost:{f:600,g:400},desc:'Castles +3 range',age:3},
  artillery:{name:'Artillery',cost:{f:450,g:500},desc:'Janissaries and towers + range',age:3},
  berserkergang:{name:'Berserkergang',cost:{f:500,g:850},desc:'Berserks regenerate much faster',age:3},
};
function utListFor(p){const cv=civOf(p);
  return cv.id==='goths'?['anarchy','perfusion']:[cv.ut];}
function nextUtFor(p){return utListFor(p).find(id=>!hasUt(p,id))||null;}
function UT_AGE_REQ(p){const n=nextUtFor(p);return n?UTECHS[n].age:9;}
function applyUt(p,id){
  // retroactive boosts to units already in the field
  const bump=(cond,dHp,mul)=>{for(const u of G.units){if(u.p!==p||!cond(u))continue;
    if(mul){u.maxhp=Math.round(u.maxhp*mul);u.hp=Math.round(u.hp*mul);}
    else{u.maxhp+=dHp;u.hp+=dHp;}}};
  if(id==='furor')bump(u=>u.type==='ram',0,1.5);
  if(id==='eldorado')bump(u=>u.type==='eagle',40);
  if(id==='zealotry')bump(u=>u.type==='mameluke',30);
  if(id==='supremacy')bump(u=>u.type==='villager',40);
  if(id==='atheism'&&p===localP)updateFog();
  if(p===localP){snd('done');toast(UTECHS[id].name+' researched!');
    feed(UTECHS[id].name+' — researched');refreshPanel();}
}
function trainTimeOf(b,ut){
  let t=UNITS[ut].train;
  if(ut!=='villager'&&civOf(b.p).trainFast)t*=civOf(b.p).trainFast;
  if(b.type==='barracks'&&hasUt(b.p,'perfusion'))t*=.5;
  if(b.type==='siege'&&hasUt(b.p,'kataparuto'))t*=.67;
  // team bonuses: whole workshops hum when the right ally is at the table
  if(b.type==='range'&&teamHas(b.p,'rangeFast'))t*=.8;      // Britons
  if(b.type==='siege'&&teamHas(b.p,'siegeFast'))t*=.8;      // Celts
  if(b.type==='barracks'&&teamHas(b.p,'barracksFast'))t*=.8;// Goths
  if(b.type==='stable'&&teamHas(b.p,'stableFast'))t*=.8;    // Huns
  if(UNITS[ut].gun&&teamHas(b.p,'gunFast'))t*=.8;           // Turks
  if(UNITS[ut].ship&&ecoTier(b.p,'shipw'))t*=.85;           // 1.0B: Shipwright speeds the slips
  // Turbo: military trains 2.5x faster; economy units keep their pace (WHATSNEW)
  if(turboSel&&ut!=='villager'&&!UNITS[ut].fisher&&!UNITS[ut].passive)t/=2.5;
  // Blitz (~10-minute matches): EVERYTHING trains faster, villagers included
  if(turboSel===2)t*=.7;
  return t;
}
/* Blacksmith upgrade lines (manual pp. 46-47). Armor becomes flat damage
   reduction per hit — this game has no armor stat. Tiers gate on age II/III/IV. */
const BS_TECHS={
  atk:{names:['Forging','Iron Casting','Blast Furnace'],
       costs:[{f:150},{f:220,g:120},{f:275,g:225}],icon:'⚒️',
       desc:'+1/+1/+2 infantry & cavalry attack'},
  arw:{names:['Fletching','Bodkin Arrow','Bracer'],
       costs:[{f:100,g:50},{f:200,g:100},{f:300,g:200}],icon:'🏹',
       desc:'+1 attack & range for archers and towers'},
  ia:{names:['Scale Mail Armor','Chain Mail Armor','Plate Mail Armor'],
      costs:[{f:100},{f:200,g:100},{f:300,g:150}],icon:'🥋',
      desc:'Infantry take -1 damage per blow'},
  aa:{names:['Padded Archer Armor','Leather Archer Armor','Ring Archer Armor'],
      costs:[{f:100},{f:150,g:150},{f:250,g:250}],icon:'🧥',
      desc:'Archers take -1 damage per blow'},
  ca:{names:['Scale Barding Armor','Chain Barding Armor','Plate Barding Armor'],
      costs:[{f:150},{f:250,g:150},{f:350,g:200}],icon:'🐴',
      desc:'Cavalry take -1 damage per blow'},
};
const BS_ATK=[0,1,2,4],BS_ARW=[0,1,2,3];
/* University technologies (manual pp. 47-49; stone costs -> wood/gold). `req`
   gates on another university tech; effects are read via hasUni() hooks. */
const UNI_TECHS={
  mas:{name:'Masonry',cost:{w:175,g:75},age:2,icon:'🧱',desc:'Buildings +10% HP'},
  arch:{name:'Architecture',cost:{w:200,g:150},age:3,req:'mas',icon:'🏛️',desc:'Buildings +10% more HP'},
  tread:{name:'Treadmill Crane',cost:{w:200,g:100},age:2,icon:'🏗️',desc:'Villagers build 20% faster'},
  bal:{name:'Ballistics',cost:{w:300,g:175},age:2,icon:'🎯',desc:'Arrows lead moving targets'},
  heat:{name:'Heated Shot',cost:{f:350,g:100},age:2,icon:'🔥',desc:'Towers +50% attack vs. ships'},
  chem:{name:'Chemistry',cost:{f:300,g:200},age:3,icon:'⚗️',desc:'+1 missile attack; unlocks gunpowder'},
  se:{name:'Siege Engineers',cost:{f:500,w:600},age:3,icon:'⚙️',desc:'Siege +1 range, +20% vs. buildings'},
  btower:{name:'Bombard Tower',cost:{f:800,w:200,g:200},age:3,req:'chem',icon:'💣',desc:'Towers mount cannon'},
};
const UNI_ORDER=['mas','tread','bal','heat','arch','chem','se','btower'];
/* Economy & line technologies (manual pp. 47-49), researched at their home
   buildings. Tiered entries carry names/costs/ages arrays; flat entries max out
   at 1. State lives in G.P[p].eco as small counters. */
const ECO_TECHS={
  loom:{name:'Loom',bld:'tc',age:0,cost:{g:50},icon:'🧵',desc:'Villagers +15 HP, take -1 damage'},
  cart:{names:['Wheelbarrow','Hand Cart'],bld:'tc',ages:[1,2],costs:[{f:175,w:50},{f:300,w:200}],icon:'🛒',desc:'Villagers move faster, carry more'},
  watch:{names:['Town Watch','Town Patrol'],bld:'tc',ages:[1,2],costs:[{f:75},{f:300,g:200}],icon:'👁️',desc:'Buildings see farther'},
  wood:{names:['Double-Bit Axe','Bow Saw','Two-Man Saw'],bld:'camp',ages:[1,2,3],costs:[{f:100,w:50},{f:150,w:100},{f:300,w:200}],icon:'🪓',desc:'Lumberjacks work faster'},
  gold:{names:['Gold Mining','Gold Shaft Mining'],bld:'camp',ages:[1,2],costs:[{f:100,w:75},{f:200,w:150}],icon:'⛏️',desc:'Gold miners work faster'},
  farm:{names:['Horse Collar','Heavy Plow','Crop Rotation'],bld:'camp',ages:[1,2,3],costs:[{f:75,w:75},{f:125,w:125},{f:250,w:250}],icon:'🌾',desc:'Farms yield more before replanting'},
  caravan:{name:'Caravan',bld:'market',age:2,cost:{f:200,g:200},icon:'🐫',desc:'Trade Cogs earn +30% gold'},
  careen:{name:'Careening',bld:'dock',age:2,cost:{f:250,g:150},icon:'🛡️',desc:'Ships take -1 damage'},
  dry:{name:'Dry Dock',bld:'dock',age:3,cost:{f:600,g:400},icon:'⛵',desc:'Ships +15% speed'},
  shipw:{name:'Shipwright',bld:'dock',age:3,cost:{f:1000,g:300},icon:'🔨',desc:'Ships cost -20% wood'},
  bloodlines:{name:'Bloodlines',bld:'stable',age:1,cost:{f:150,g:100},icon:'🐎',desc:'Mounted units +20 HP'},
  husb:{name:'Husbandry',bld:'stable',age:2,cost:{f:250},icon:'🏇',desc:'Cavalry +10% speed'},
  track:{name:'Tracking',bld:'barracks',age:1,cost:{f:75},icon:'👣',desc:'Infantry see farther'},
  squires:{name:'Squires',bld:'barracks',age:2,cost:{f:200},icon:'🥾',desc:'Infantry march 10% faster'},
  thumb:{name:'Thumb Ring',bld:'range',age:2,cost:{f:300,w:250},icon:'💍',desc:'Archers fire faster and never miss'},
  /* monastery scriptorium (manual p. 48) */
  ferv:{name:'Fervor',bld:'monastery',age:2,cost:{g:140},icon:'🕊️',desc:'Monks walk 15% faster'},
  sanc:{name:'Sanctity',bld:'monastery',age:2,cost:{g:120},icon:'✨',desc:'Monks +50% HP'},
  red:{name:'Redemption',bld:'monastery',age:2,cost:{g:475},icon:'🕯️',desc:'Convert buildings and siege engines'},
  aton:{name:'Atonement',bld:'monastery',age:2,cost:{g:325},icon:'📿',desc:'Convert enemy Monks'},
  her:{name:'Heresy',bld:'monastery',age:2,cost:{g:1000},icon:'🔥',desc:'Your units die rather than turn'},
  herb:{name:'Herbal Medicine',bld:'monastery',age:2,cost:{g:350},icon:'🌿',desc:'Garrisoned units heal 4x faster'},
  illum:{name:'Illumination',bld:'monastery',age:3,cost:{g:120},icon:'💡',desc:'Monks recover faith 2x faster'},
  faith:{name:'Faith',bld:'monastery',age:3,cost:{f:750,g:1000},icon:'🙏',desc:'Your units resist conversion'},
  bp:{name:'Block Printing',bld:'monastery',age:3,cost:{g:200},icon:'📜',desc:'+2 conversion range'},
};
function ecoOf(p){const st=G.P[p];if(!st.eco)st.eco={};return st.eco;}
function ecoTier(p,id){return ecoOf(p)[id]||0;}
function ecoMax(id){const T=ECO_TECHS[id];return T.names?T.names.length:1;}
const WOOD_RATE=[1,1.2,1.44,1.58],GOLD_RATE=[1,1.15,1.32];
function farmFoodOf(p){
  return 175+[0,75,200,375][ecoTier(p,'farm')]+(teamHas(p,'farmFood')?45:0); // Chinese TB
}
function applyEco(p,id){
  const bump=(cond,dHp)=>{for(const u of G.units){if(u.p!==p||!cond(u))continue;
    u.maxhp+=dHp;u.hp+=dHp;}};
  if(id==='loom')bump(u=>u.type==='villager',15);
  if(id==='bloodlines')bump(u=>UNITS[u.type].cav&&!UNITS[u.type].monk,20);
  if(id==='sanc')for(const u of G.units)if(u.p===p&&UNITS[u.type].monk){
    u.maxhp=Math.round(u.maxhp*1.5);u.hp=Math.round(u.hp*1.5);}
  if(p===localP){snd('done');updateTop();refreshPanel();}
}
function applyUni(p,id){
  if(id==='mas'||id==='arch') // retroactive: standing walls thicken too
    for(const b of G.blds)if(b.p===p){b.maxhp=Math.round(b.maxhp*1.1);b.hp=Math.round(b.hp*1.1);}
  if(p===localP){snd('done');feed(UNI_TECHS[id].name+' — researched');updateTop();refreshPanel();}
}
function bsOf(p){const st=G.P[p];
  if(!st.bs)st.bs={atk:0,arw:0,ia:0,aa:0,ca:0};
  return st.bs;}
function bsArmorOf(u){ // flat damage reduction from armor research
  const st=G.P[u.p],bs=bsOf(u.p),d=UNITS[u.type];
  let a=0;
  if(INF.has(u.type))a=bs.ia;
  else if(d.cav&&d.ranged)a=bs.ca+(st.pt?2:0); // Parthian Tactics: mounted archers
  else if(d.cav)a=bs.ca;
  else if(d.ranged)a=bs.aa;
  if(u.type==='villager'&&ecoTier(u.p,'loom'))a+=1; // Loom
  if(d.ship&&ecoTier(u.p,'careen'))a+=1;            // Careening
  return a;
}
const BLDS={
  tc:{name:'Town Hall',hp:2200,size:2,cost:{w:300},bt:40,trains:['villager'],drop:true,atk:6,rng:5,garCap:10},
  house:{name:'House',hp:400,size:1,cost:{w:25},bt:8,pop:5},
  farm:{name:'Farm',hp:250,size:1,cost:{w:60},bt:6,farm:true},
  camp:{name:'Storage Camp',hp:600,size:1,cost:{w:75},bt:9,drop:true},
  barracks:{name:'Barracks',hp:1000,size:2,cost:{w:150},bt:16,trains:['militia','spearman']},
  range:{name:'Archery Range',hp:1000,size:2,cost:{w:150},bt:16,trains:['archer','skirmisher','handcannon'],age:1},
  stable:{name:'Stable',hp:1000,size:2,cost:{w:150},bt:16,trains:['scout','knight'],age:1},
  siege:{name:'Siege Works',hp:1200,size:2,cost:{w:200},bt:18,trains:['ram','scorpion','mangonel','bombard'],age:2},
  castle:{name:'Castle',hp:3200,size:2,cost:{w:350,g:200},bt:50,trains:[],atk:11,rng:7,age:2,garCap:10}, // 1.0B: castles build slower
  tower:{name:'Watch Tower',hp:700,size:1,cost:{w:100,g:75},bt:18,atk:7,rng:5,age:1,garCap:4},
  wall:{name:'Palisade Wall',hp:300,size:1,cost:{w:5},bt:4,thin:true},
  gate:{name:'Palisade Gate',hp:500,size:1,cost:{w:30},bt:8,thin:true,gate:true},
  swall:{name:'Stone Wall',hp:1500,size:1,cost:{w:5,g:10},bt:7,thin:true,age:2},
  sgate:{name:'Stone Gate',hp:2000,size:1,cost:{w:20,g:40},bt:11,thin:true,gate:true,age:2},
  market:{name:'Market',hp:800,size:2,cost:{w:150},bt:14,age:1,trains:['tradecart']},
  blacksmith:{name:'Blacksmith',hp:1000,size:2,cost:{w:150},bt:14,age:1},
  university:{name:'University',hp:1200,size:2,cost:{w:200},bt:16,age:2},
  wonder:{name:'Wonder',hp:4800,size:2,cost:{w:1000,g:1000},bt:100,age:3},
  dock:{name:'Dock',hp:1000,size:2,cost:{w:150},bt:14,drop:true,
    trains:['fishing','cog','transport','galley','fireship','demo','cannongalleon']},
  monastery:{name:'Monastery',hp:900,size:2,cost:{w:175,g:100},bt:18,trains:['monk'],age:2},
};
const RES_META={food:{amt:175},wood:{amt:100},gold:{amt:450},fish:{amt:350}};
const RES_COL={food:'#e6705e',wood:'#d8b070',gold:'#ffd75e',fish:'#bcd8e4'};
const POP_MAX=80;
const DIFF=[{trickle:0,firstWave:380,waveEvery:210,waveGrow:2,vT:[6,9,12,14]},
            {trickle:.8,firstWave:250,waveEvery:125,waveGrow:3,vT:[7,11,14,16]},
            {trickle:1.8,firstWave:195,waveEvery:100,waveGrow:4,vT:[8,13,16,18]}];

