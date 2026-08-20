/* ================= menus ================= */
document.querySelectorAll('.diff button[data-d]').forEach(b=>{
  b.onclick=()=>{document.querySelectorAll('.diff button[data-d]').forEach(x=>x.classList.remove('sel'));
    b.classList.add('sel');diffSel=+b.dataset.d;};
});
document.querySelectorAll('.diff button[data-n]').forEach(b=>{
  b.onclick=()=>{document.querySelectorAll('.diff button[data-n]').forEach(x=>x.classList.remove('sel'));
    b.classList.add('sel');playersSel=+b.dataset.n;};
});
document.querySelectorAll('.diff button[data-rg]').forEach(b=>{
  b.onclick=()=>{document.querySelectorAll('.diff button[data-rg]').forEach(x=>x.classList.remove('sel'));
    b.classList.add('sel');regicideSel=+b.dataset.rg;};
});
document.querySelectorAll('.diff button[data-tb]').forEach(b=>{
  b.onclick=()=>{document.querySelectorAll('.diff button[data-tb]').forEach(x=>x.classList.remove('sel'));
    b.classList.add('sel');turboSel=+b.dataset.tb;};
});
document.querySelectorAll('.diff button[data-t]').forEach(b=>{
  b.onclick=()=>{document.querySelectorAll('.diff button[data-t]').forEach(x=>x.classList.remove('sel'));
    b.classList.add('sel');teamSel=+b.dataset.t;};
});
document.querySelectorAll('.diff button[data-m]').forEach(b=>{
  b.onclick=()=>{document.querySelectorAll('.diff button[data-m]').forEach(x=>x.classList.remove('sel'));
    b.classList.add('sel');mapSel=+b.dataset.m;
    document.getElementById('mapBlurb').textContent=MAPS[mapSel].blurb;};
});
(function(){
  const grid=document.getElementById('civGrid'),blurb=document.getElementById('civBlurb');
  CIVS.forEach((cv,i)=>{
    const b=document.createElement('button');
    b.textContent=cv.name;
    if(i===0)b.classList.add('sel');
    b.onclick=()=>{civSel=i;blurb.textContent=cv.blurb;
      grid.querySelectorAll('button').forEach(x=>x.classList.remove('sel'));
      b.classList.add('sel');
      document.getElementById('civPickName').textContent=cv.name;
      document.getElementById('civPick').open=false; // picked — fold it away again
    };
    grid.appendChild(b);
  });
  blurb.textContent=CIVS[0].blurb;
})();
document.getElementById('startBtn').onclick=()=>{
  initAudio();
  if(AC&&AC.state==='suspended')AC.resume();
  resetNet();
  mission=null;REC.play=null;dailyRun=null;
  // a typed seed reproduces a friend's exact map — determinism does the rest
  const si=document.getElementById('seedIn');
  if(si&&si.value.trim()){
    let sv=si.value.trim(),n=0;
    if(/^\d+$/.test(sv))n=(+sv)>>>0;
    else{n=2166136261;for(let i=0;i<sv.length;i++){n^=sv.charCodeAt(i);n=Math.imul(n,16777619);}n>>>=0;}
    pendingSeed=n||1;
    toast('Playing seed '+pendingSeed);
  }
  document.getElementById('startOverlay').style.display='none';
  begin();
  TUT.begin();     // first battle ever? walk them in
};
/* Quick Battle: the research-backed session fit — a standard match is several
   times the 5-minute median phone session, so give the phone break its own
   button. One foe, open River map, Blitz pace; the player's civ and difficulty
   choices still apply. */
document.getElementById('quickBtn').onclick=()=>{
  initAudio();
  if(AC&&AC.state==='suspended')AC.resume();
  resetNet();
  mission=null;REC.play=null;dailyRun=null;
  playersSel=2;mapSel=0;teamSel=0;turboSel=2;regicideSel=0;
  document.getElementById('startOverlay').style.display='none';
  begin();
  TUT.begin();
  toast('⚡ Quick Battle — one foe, Blitz pace. Raze their Town Hall!');
};
/* ---- daily challenge: one seed per calendar day, the SAME for everyone.
   Fixed rules (4 lords, free-for-all, Knight, standard pace, the date picks
   your civ and the battlefield) so times are comparable — determinism means
   every player on earth fights the identical battle today. */
let dailyRun=null;
function dailySeed(){
  const d=new Date();
  const key=d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate();
  let n=2166136261^key;n=Math.imul(n,16777619);n^=n>>>13;n=Math.imul(n,16777619);
  return {seed:n>>>0,key};
}
document.getElementById('dailyBtn').onclick=()=>{
  initAudio();
  if(AC&&AC.state==='suspended')AC.resume();
  resetNet();
  mission=null;REC.play=null;
  const D=dailySeed();
  dailyRun=D.key;
  pendingSeed=D.seed;
  mapSel=D.seed%3;playersSel=4;teamSel=0;diffSel=1;turboSel=0;regicideSel=0;
  civSel=D.seed%CIVS.length;
  document.getElementById('startOverlay').style.display='none';
  begin();
  toast('📅 Daily Challenge — everyone fights this exact battle today. Civ: '+CIVS[civSel].name);
};
{const db=document.getElementById('dailyBlurb');
 if(db){db.style.display='';
   db.textContent='Daily: one shared battle for every player, everywhere. Beat your friends’ time.';}}
/* The share artifact does the marketing (the Wordle lesson): one tap, tells a
   story, spoiler-free, and the link IS the challenge — ?daily= / ?seed= land
   the friend one press from fighting the identical battle. */
document.getElementById('shareSeedBtn').onclick=()=>{
  const btn=document.getElementById('shareSeedBtn');
  const m=Math.floor(G.t/60),s2=Math.floor(G.t%60);
  const won=document.getElementById('endTitle').textContent==='Victory!';
  const site='https://tiny-conquerors.onrender.com';
  const time=m+'m '+(s2<10?'0':'')+s2+'s';
  let txt;
  if(dailyRun){
    const k=String(dailyRun);
    const nice=(+k.slice(6,8))+'.'+(+k.slice(4,6))+'.'+k.slice(0,4);
    txt='⚔️ Tiny Conquerors Daily — '+nice+'\n'
      +(won?'🏆 Victory in '+time:'💀 Fell after '+time)+'\n'
      +'Everyone fights the same battle today. Beat me:\n'
      +site+'/?daily='+k;
  }else{
    txt='⚔️ Tiny Conquerors — '+(won?'🏆 victory':'💀 defeat')+' in '+time
      +' on seed '+gameSeed+'\n'
      +'Fight the exact same battle:\n'
      +site+'/?seed='+gameSeed;
  }
  const done=ok=>{btn.textContent=ok?'✓ Copied — paste it anywhere':'Copy failed';
    setTimeout(()=>{if(btn.isConnected)btn.textContent='📋  Share this map';},2200);};
  try{navigator.clipboard.writeText(txt).then(()=>done(true),()=>done(false));}
  catch(e){done(false);}
};
/* ---- Daily Challenge leaderboard (relay-backed, in-memory, friendly) ----
   Everyone on earth fights the same battle today; this shows who fought it
   fastest. Wins only — times are comparable, defeats are not. Fire-and-forget:
   offline, the artifact sandbox, or a sleeping relay just leave the board
   hidden, never an error in the player's face. */
function dailyFmt(ms){const s=Math.round(ms/1000);return Math.floor(s/60)+'m '+String(s%60).padStart(2,'0')+'s';}
function dailySubmit(day,ms){
  if(!netAvailable())return Promise.resolve();
  const name=(localStorage.getItem('tq_name')||'A Conqueror').trim()||'A Conqueror';
  try{
    return fetch(netHttpUrl()+'/daily',{method:'POST',body:JSON.stringify({day,name,ms})}).catch(()=>{});
  }catch(e){return Promise.resolve();}
}
function dailyBoardRender(day,myMs){
  const el=document.getElementById('dailyBoard');
  if(!el||!netAvailable())return;
  const me=(localStorage.getItem('tq_name')||'A Conqueror').trim()||'A Conqueror';
  const go=()=>fetch(netHttpUrl()+'/daily?day='+day).then(r=>r.json()).then(rows=>{
    if(!Array.isArray(rows)||!rows.length)return;
    let html='<b>📅 Today\'s fastest conquerors</b><br>';
    rows.slice(0,8).forEach((r,i)=>{
      const mine=r.n===me;
      html+=(i+1)+'. '+(mine?'<b>':'')+r.n.replace(/[<>&]/g,'')+' — '+dailyFmt(r.ms)+(mine?' ◀ you</b>':'')+'<br>';
    });
    const rank=rows.findIndex(r=>r.n===me);
    if(rank>=8)html+='…<br>'+(rank+1)+'. <b>'+me.replace(/[<>&]/g,'')+' — '+dailyFmt(rows[rank].ms)+' ◀ you</b><br>';
    el.innerHTML=html;el.style.display='';
  }).catch(()=>{});
  // submit first so our own time is on the board we then read
  (myMs?dailySubmit(day,myMs):Promise.resolve()).then(go,go);
}
/* ---- progress backup (the Wordle lesson: localStorage dies with cleared
   browser data and never crosses devices — a copy-paste code fixes both) ---- */
const PROG_KEYS=['tq_save','tq_camp2','tq_daily','tq_profile','tq_opts','tq_name','tq_tut','tq_seenver','tq_replays'];
function progressExport(){
  const o={};
  for(const k of PROG_KEYS){const v=localStorage.getItem(k);if(v!=null)o[k]=v;}
  return 'TQ1.'+btoa(unescape(encodeURIComponent(JSON.stringify(o))));
}
function progressImport(code){
  try{
    code=String(code||'').replace(/\s+/g,'');
    if(!code.startsWith('TQ1.'))return 'That is not a Tiny Conquerors progress code.';
    const o=JSON.parse(decodeURIComponent(escape(atob(code.slice(4)))));
    if(!o||typeof o!=='object')return 'That code did not decode.';
    let n=0;
    for(const k of PROG_KEYS)if(typeof o[k]==='string'){localStorage.setItem(k,o[k]);n++;}
    return n?null:'The code held nothing to restore.';
  }catch(e){return 'That code did not decode.';}
}
function showImport(){
  let ov=document.getElementById('impOv');
  if(!ov){
    ov=document.createElement('div');ov.id='impOv';ov.className='overlay';ov.style.display='none';
    ov.innerHTML='<div class="scroll" style="max-width:420px">'
      +'<h1 style="font-size:20px">Restore progress</h1>'
      +'<p class="sub">Paste a progress code from another device. This OVERWRITES this device\'s saves and records.</p>'
      +'<textarea id="impTxt" aria-label="Progress code" style="width:100%;height:110px;padding:8px;border-radius:8px;border:2px solid #6b5330;background:#efe2bd;color:#241a10;font:12px monospace"></textarea>'
      +'<p class="sub" id="impMsg" style="color:#8a2f27;min-height:16px;margin:6px 0"></p>'
      +'<button class="bigbtn" id="impGo">Restore &amp; reload</button>'
      +'<button class="bigbtn alt" id="impBack">Cancel</button></div>';
    document.body.appendChild(ov);
    ov.querySelector('#impBack').onclick=()=>{ov.style.display='none';};
    ov.querySelector('#impGo').onclick=()=>{
      const err=progressImport(ov.querySelector('#impTxt').value);
      if(err)ov.querySelector('#impMsg').textContent=err;
      else location.reload();   // options and caches apply at boot
    };
  }
  ov.querySelector('#impTxt').value='';ov.querySelector('#impMsg').textContent='';
  ov.style.display='flex';
}
const loadFrom=key=>{
  initAudio();
  if(AC&&AC.state==='suspended')AC.resume();
  resetNet();
  resize();
  if(loadGame(key)){
    document.getElementById('startOverlay').style.display='none';
    last=performance.now();
    toast('Welcome back, my liege — the realm is as you left it');
  }else{
    toast('That save could not be read');
    localStorage.removeItem(key);updateContBtn();
  }
};
document.getElementById('contBtn').onclick=()=>loadFrom('tq_save');
document.getElementById('recoverBtn').onclick=()=>loadFrom('tq_autosave');
document.getElementById('saveBtn').onclick=()=>{
  const btn=document.getElementById('saveBtn');
  if(saveGame()){btn.textContent='✓ Saved';updateContBtn();}
  else btn.textContent='Save failed';
  setTimeout(()=>btn.textContent='💾 Save Game',1600);
};
document.getElementById('campBtn').onclick=()=>{showCampaign();};
document.getElementById('campBack').onclick=()=>{
  document.getElementById('campOverlay').style.display='none';
};
/* ================= settings ================= */
/* Classic '99 toggle: regenerate the world's paintwork in the chosen look.
   Both directions work mid-game — refreshTerrain repaints from scratch, so
   leaving Classic restores the modern ground cleanly. Render-side only. */
function apply99(){
  document.body.classList.toggle('r99',!!OPT.r99);
  // Phase B: the per-page-load PROCEDURAL sprite caches bake ONE look in —
  // flush them all so lazy rebuilds come back in the chosen look (gotcha 3 by
  // flush; the USPR/BSPR sheet caches carry a '/99' key dimension instead).
  try{
    for(const o of [ISPR,RES_SPR,RUB_SPR,CORPSE_SPR])for(const k in o)delete o[k];
    RELIC_SPR=null;
  }catch(e){}
  if(G){
    try{
      refreshTerrain();
      fogDirty=true;
      wxWasClear=false;   // the weather glass repaints (grade back on, or off)
      if(OPT.r99)G.cam.z=R99.zoomSnap(G.cam.z);
      clampCam();
    }catch(e){}
  }
}
apply99();
function applyBodyOpts(){
  document.body.classList.toggle('lefty',!!OPT.lefty);
  document.body.classList.toggle('bigui',!!OPT.bigui);
  document.body.classList.toggle('bigtext',!!OPT.bigtext);
  document.body.classList.toggle('bigmap',!!OPT.bigmap);
}
applyBodyOpts();
function buildSettings(){
  const el=document.getElementById('setList');
  el.innerHTML='';
  const row=(label,ctl)=>{
    const r=document.createElement('div');r.className='setRow';
    const s=document.createElement('span');s.textContent=label;
    r.appendChild(s);r.appendChild(ctl);el.appendChild(r);return r;};
  const toggle=(key,def,onchg)=>{
    const b=document.createElement('button');b.className='bigbtn alt';
    b.style.cssText='width:auto;padding:7px 16px;margin:0';
    const cur=()=>OPT[key]===undefined?def:!!OPT[key];
    const paint=()=>{b.textContent=cur()?'On':'Off';b.style.color=cur()?'#c9a227':'';};
    paint();
    b.onclick=()=>{OPT[key]=!cur();saveOpts();paint();snd('click');if(onchg)onchg();};
    return b;};
  // volume
  const vr=document.createElement('input');vr.type='range';vr.min=0;vr.max=100;
  vr.value=Math.round((OPT.vol===undefined?1:OPT.vol)*100);
  vr.setAttribute('aria-label','Sound volume');
  vr.oninput=()=>{OPT.vol=vr.value/100;saveOpts();
    if(masterG)masterG.gain.value=.55*OPT.vol;};
  vr.onchange=()=>{initAudio();snd('click');};
  row('🔊 Sound volume',vr);
  row('🎵 Adaptive music',toggle('music',true));
  row('📳 Haptic feedback (phones)',toggle('haptics',true));
  row('🧭 Battle coach tips',toggle('coach',true));
  row('🎯 Slow time while placing / aiming (solo)',toggle('cmdSlow',true));
  row('🎥 Camera follows your battles',toggle('followFight',false));
  row('🌤 Reduce motion (no weather / sway)',toggle('reduceMotion',false));
  row('🔋 Battery saver (30 fps)',toggle('fps30',false));
  row('🫲 Left-handed layout',toggle('lefty',false,applyBodyOpts));
  row('🕹 Classic \'99 graphics (Phases A-C — evolving)',toggle('r99',false,apply99));
  row('🔍 Larger buttons',toggle('bigui',false,applyBodyOpts));
  row('🔠 Larger text',toggle('bigtext',false,applyBodyOpts));
  row('🗺 Larger minimap (phones)',toggle('bigmap',false,applyBodyOpts));
  // progress backup: copy a code out, paste a code in
  const ex=document.createElement('button');ex.className='bigbtn alt';
  ex.style.cssText='width:auto;padding:7px 12px;margin:0';ex.textContent='📤 Copy code';
  ex.onclick=()=>{
    const done=ok=>{ex.textContent=ok?'✓ Copied':'Copy failed';
      setTimeout(()=>{if(ex.isConnected)ex.textContent='📤 Copy code';},1800);};
    try{navigator.clipboard.writeText(progressExport()).then(()=>done(true),()=>done(false));}
    catch(e){done(false);}
  };
  row('💾 Back up progress (saves, records)',ex);
  const im=document.createElement('button');im.className='bigbtn alt';
  im.style.cssText='width:auto;padding:7px 12px;margin:0';im.textContent='📥 Paste code';
  im.onclick=()=>{document.getElementById('setOverlay').style.display='none';showImport();};
  row('♻ Restore progress from a code',im);
  row('✨ HD unit sprites (large download)',toggle('hdSprites',true,()=>{
    if(G&&!G.over)toast('Applies when you leave the battle');
    else{toast('Reloading with the new art…');setTimeout(()=>location.reload(),600);}
  }));
  row('🎨 Colourblind-safe team colours',toggle('cbPal',false,()=>{
    if(G&&!G.over)toast('Applies when you leave the battle');
    else{toast('Reloading with the new colours…');setTimeout(()=>location.reload(),600);}
  }));
  row('📈 Share anonymous play stats',toggle('telemetry',false));
  row('🩹 Send crash reports',toggle('crashRep',true));
  const note=document.createElement('p');note.className='sub';
  note.style.cssText='margin:10px 0 0;text-align:center';
  note.textContent='Crash reports carry the build number and the error only — never your games or your name.';
  el.appendChild(note);
}
document.getElementById('setBtn').onclick=()=>{
  buildSettings();
  document.getElementById('startOverlay').style.display='none';
  document.getElementById('setOverlay').style.display='flex';
};
document.getElementById('setBack').onclick=()=>{
  document.getElementById('setOverlay').style.display='none';
  if(!G||G.over)document.getElementById('startOverlay').style.display='flex';
  else if(!netMode)G.paused=true,document.getElementById('menuOverlay').style.display='flex';
};
document.getElementById('replaysBtn').onclick=()=>{
  renderReplayList();
  document.getElementById('startOverlay').style.display='none';
  document.getElementById('replayOverlay').style.display='flex';
};
/* my record */
function renderRecord(){
  const el=document.getElementById('recordBody');if(!el)return;
  let pr={};try{pr=JSON.parse(localStorage.getItem('tq_profile')||'{}');}catch(e){}
  if(!pr.games){el.innerHTML='<p>No battles fought yet.</p>';return;}
  let fav='',favG=0;
  for(const c in (pr.byCiv||{}))if(pr.byCiv[c].g>favG){favG=pr.byCiv[c].g;fav=c;}
  const hrs=Math.floor((pr.time||0)/3600),mins=Math.round(((pr.time||0)%3600)/60);
  el.innerHTML='<p><b>'+pr.games+'</b> battles · <b>'+(pr.wins||0)+'</b> victories ('
    +Math.round(100*(pr.wins||0)/pr.games)+'%)<br>'
    +'Time at war: <b>'+hrs+'h '+mins+'m</b>'
    +(pr.mp?'<br>Multiplayer battles: <b>'+pr.mp+'</b>':'')
    +(fav?'<br>Favourite civilization: <b>'+fav+'</b> ('+pr.byCiv[fav].w+'/'+pr.byCiv[fav].g+' won)':'')
    +'</p>';
}
document.getElementById('record').addEventListener('toggle',e=>{if(e.target.open)renderRecord();});
/* what's new */
const CHANGELOG=[
  ['big-qol','Rally points, shift-queue waypoints, unit stances (aggressive / defensive / stand ground / no attack), patrol, formations, a post-game summary with score graphs, replays, quick chat + team pings in multiplayer, tribute at the Market, Co-op vs AI, a 🔥 Blitz pace, a settings panel (volume, colourblind colours, battery saver, left-handed layout), autosave when your phone hides the game, a first-battle tutorial, and a battle coach.'],
  ['tq-v61','Regicide in the multiplayer lobby.'],
  ['tq-v60','Smarter AI: defensive palisade arcs, fish traps, market trade, king protection.'],
  ['tq-v59','The 3D forest floor art finished — the cosmetics list fully paid.'],
];
function renderWhatsNew(){
  const el=document.getElementById('whatsnewBody');if(!el)return;
  el.innerHTML=CHANGELOG.map(c=>'<p><b>'+c[0]+'</b> — '+c[1]+'</p>').join('');
  localStorage.setItem('tq_seenver',CHANGELOG[0][0]);
  const d=document.getElementById('newDot');if(d)d.style.display='none';
}
document.getElementById('whatsnew').addEventListener('toggle',e=>{if(e.target.open)renderWhatsNew();});
if(localStorage.getItem('tq_seenver')!==CHANGELOG[0][0]){
  const d=document.getElementById('newDot');if(d)d.style.display='';
}
/* ================= crash reports + opt-in telemetry ================= */
const tmUrl=()=>'https://tiny-conquerors-relay.onrender.com/report';
function buildVer(){
  try{const st=document.getElementById('startOverlay').lastElementChild;
    const m=/build (tq-v\d+)/.exec(st&&st.textContent||'');return m?m[1]:'dev';}catch(e){return 'dev';}
}
let errSent=0;
function sendReport(body){
  if(location.protocol!=='https:'&&location.hostname!=='localhost')return;
  if(location.hostname==='localhost')return;   // don't mail dev-loop noise home
  try{fetch(tmUrl(),{method:'POST',body});}catch(e){}
}
window.addEventListener('error',e=>{
  if(OPT.crashRep===false||errSent>=3)return;errSent++;
  sendReport('ERR '+buildVer()+' | '+(e.message||'?')+' @'+(e.filename||'').split('/').pop()+':'+(e.lineno||0)
    +' | '+String(e.error&&e.error.stack||'').slice(0,800));
});
window.addEventListener('unhandledrejection',e=>{
  if(OPT.crashRep===false||errSent>=3)return;errSent++;
  sendReport('ERR '+buildVer()+' | unhandled rejection: '+String(e.reason).slice(0,400));
});
function tm(ev,data){
  if(!OPT.telemetry)return;
  sendReport('TM '+buildVer()+' | '+ev+' '+JSON.stringify(data||{}));
}
/* ================= first-battle tutorial ================= */
const TUT={
  step:0,active:false,
  steps:[
    {txt:'Welcome, my liege! Tap one of your villagers to select them.',
     done:()=>G.sel.some(id=>{const u=G.units.find(x=>x.id===id);return u&&u.type==='villager';})},
    {txt:'Now tap a berry bush, sheep or tree — the villager will gather food or wood.',
     done:()=>G.units.some(u=>u.p===localP&&u.type==='villager'&&['toRes','gather','return','toFarm','farming'].includes(u.state))},
    {txt:'Put everyone to work. Tip: double-tap the 🧑‍🌾 button to grab every idle villager.',
     done:()=>G.units.filter(u=>u.p===localP&&u.type==='villager'&&['toRes','gather','return','toFarm','farming','toBuild','building'].includes(u.state)).length>=3},
    {txt:'Tap your Town Hall and train more villagers — your economy is your army\'s spine.',
     done:()=>{const tc=G.blds.find(b=>b.p===localP&&b.type==='tc');
       return (tc&&tc.queue.length>0)||G.units.filter(u=>u.p===localP&&u.type==='villager').length>4;}},
    {txt:'Build a House (select a villager → Economy tab) so your population can grow.',
     done:()=>G.blds.some(b=>b.p===localP&&b.type==='house')},
    {txt:'Raise a Barracks from the Military tab — the realm needs soldiers.',
     done:()=>G.blds.some(b=>b.p===localP&&b.type==='barracks'&&b.built)},
    {txt:'Train Militia at the Barracks. Tap open ground with the Barracks selected to plant a rally flag.',
     done:()=>G.units.some(u=>u.p===localP&&u.type==='militia')||G.blds.some(b=>b.p===localP&&b.rally)},
    {txt:'When you have 500 food, advance to the Feudal Age at the Town Hall. Good luck, Conqueror!',
     done:()=>G.P[localP].age>=1||G.P[localP].aging},
  ],
  begin(){
    if(localStorage.getItem('tq_tut')==='done')return;
    if(mission||netMode||REC.play)return;
    this.step=0;this.active=true;this.show();
    tm('tut_start',{});   // funnel head — step-level drop-off is the FTUE number that matters
  },
  bar(){return document.getElementById('tutBar');},
  show(){
    let b=this.bar();
    if(!b){
      b=document.createElement('div');b.id='tutBar';
      b.style.cssText='position:fixed;left:50%;transform:translateX(-50%);top:52px;z-index:8;max-width:min(92vw,470px);'
        +'padding:9px 12px;background:rgba(36,26,16,.95);border:2px solid #c9a227;border-radius:10px;'
        +'color:#f0e2bd;font-size:13px;display:flex;gap:10px;align-items:center;box-shadow:0 4px 14px rgba(0,0,0,.5)';
      const tx=document.createElement('span');tx.id='tutTxt';tx.style.flex='1';
      const sk=document.createElement('button');
      sk.textContent='Skip';sk.setAttribute('aria-label','Skip tutorial');
      sk.style.cssText='padding:5px 10px;border-radius:7px;border:1px solid #6a6355;background:rgba(30,26,20,.8);color:#cbb98a;font:inherit;font-size:11px';
      sk.onclick=()=>{TUT.finish(true);};
      b.appendChild(tx);b.appendChild(sk);
      document.body.appendChild(b);
    }
    b.style.display='flex';
    document.getElementById('tutTxt').textContent=(this.step+1)+'/'+this.steps.length+' — '+this.steps[this.step].txt;
  },
  finish(skipped){
    this.active=false;
    localStorage.setItem('tq_tut','done');
    const b=this.bar();if(b)b.style.display='none';
    toast('Tutorial complete — the rest is conquest');buzz(20);
    tm(skipped?'tut_skip':'tut_done',{at:this.step});
  },
  tick(){
    if(!this.active||!G||G.over){const b=this.bar();if(b&&!this.active)b.style.display='none';return;}
    try{
      if(this.steps[this.step].done()){
        this.step++;
        tm('tut_step',{n:this.step});   // reached step N — the funnel is these events
        if(this.step>=this.steps.length)this.finish();
        else{this.show();snd('done');}
      }
    }catch(e){}
  }
};
/* ================= battle coach =================
   Reads the player's economy once a second and offers ONE gentle nudge at a
   time. Advice, not automation — it never touches the sim. */
const COACH={lastT:-999,tick(){
  if(OPT.coach===false||!G||G.over||G.paused||REC.play)return;
  if(TUT.active)return;                          // one teacher at a time
  if(G.t<120||G.t-this.lastT<45)return;
  const st=G.P[localP];
  const vills=G.units.filter(u=>u.p===localP&&u.type==='villager'&&u.hp>0);
  const idle=vills.filter(u=>u.state==='idle').length;
  const tc=G.blds.find(b=>b.p===localP&&b.type==='tc'&&b.built);
  let msg=null;
  if(idle>=4)msg=idle+' villagers stand idle — the . key or 🧑‍🌾 button finds them';
  else if(popUsed(localP)>=popCap(localP)&&!G.blds.some(b=>b.p===localP&&b.type==='house'&&!b.built))
    msg='You are housed — build more Houses to keep growing';
  else if(tc&&!tc.queue.length&&st.f>=100&&vills.length<26&&popUsed(localP)<popCap(localP))
    msg='Your Town Hall is idle — more villagers win wars';
  else if(st.f>900&&st.age<3&&!st.aging)msg='You are floating '+Math.floor(st.f)+' food — spend it: villagers, soldiers, or the next Age';
  else if(st.w>900)msg='You are floating '+Math.floor(st.w)+' wood — farms, buildings, archers';
  if(msg){this.lastT=G.t;toast('🧭 '+msg);}
}};
