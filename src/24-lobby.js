/* ================= multiplayer lobby ================= */
let mpCfg={map:0,diff:1,turbo:0,ai:0,team:0,rg:0};
let mpCiv=0;
const mpEl=id=>document.getElementById(id);
function mpStatus(s){mpEl('mpStatus').textContent=s||'';}
function mpShow(){
  netReset();resetNet();
  netPrewarm();   // wake the free-tier relay while the player types their name
  mpEl('mpConnect').style.display='';
  mpEl('mpRoom').style.display='none';
  mpEl('mpName').value=localStorage.getItem('tq_name')||'';
  mpEl('mpCode').value='';
  mpHc=100;mpEl('mpHcName').textContent='None';   // a boost is per-room, never sticky
  document.querySelectorAll('#mpHcPick button[data-hc]').forEach(x=>x.classList.toggle('sel',x.getAttribute('data-hc')==='100'));
  mpStatus(netAvailable()?'':'Multiplayer needs the web app at tiny-conquerors.onrender.com — the preview sandbox blocks connections.');
  if(MATH_DRIFT)mpStatus('⚠ This device computes numbers differently from the tested build — a match may fall out of step. Playable, but expect possible desyncs.');
  mpEl('mpOverlay').style.display='flex';
}
function mpShowRoom(){
  mpEl('mpConnect').style.display='none';
  mpEl('mpRoom').style.display='';
  mpEl('mpRoomCode').textContent=netRoom;
  mpEl('mpSub').textContent='Read the code out — anyone can join with it';
  mpRenderLobby();
}
function mpRenderLobby(){
  const ps=netLobby.players||[];
  mpEl('mpPlayers').innerHTML=ps.map(p=>{
    const me=p.seat===localP;
    return '<div style="padding:3px 0;color:'+TEAMS[p.seat].dark+'">'
      +'<b>'+(p.seat+1)+'.</b> '+p.name+(me?' <i>(you)</i>':'')
      +(p.seat===netLobby.host?' 👑':'')
      +' — '+CIVS[p.civ]?.name
      +(p.hc>100?' <b>⬆+'+(p.hc-100)+'%</b>':'')   // the evener is public by design
      +'</div>';
  }).join('')||'<div>Waiting for players…</div>';
  mpEl('mpHostCtl').style.display=netHost?'':'none';
  mpEl('mpWait').style.display=netHost?'none':'';
  mpEl('mpCivName').textContent=CIVS[mpCiv].name;
  if(netLobby.cfg&&!netHost){
    const c=netLobby.cfg;
    mpEl('mpWait').textContent='Waiting for the host to begin — '+MAPS[c.map|0].name
      +(c.ai?' · '+c.ai+' computer opponent'+(c.ai>1?'s':''):'')
      +((c.turbo|0)===2?' · 🔥 Blitz':c.turbo?' · Turbo':'')
      +(c.rg?' · 👑 Regicide':'')
      +((c.team|0)===2?' · 🤝 Co-op vs AI':'');
  }
}
(function(){
  const grid=mpEl('mpCivGrid');
  CIVS.forEach((cv,i)=>{
    const b=document.createElement('button');
    b.textContent=cv.name;
    if(i===0)b.classList.add('sel');
    b.onclick=()=>{
      mpCiv=i;
      grid.querySelectorAll('button').forEach(x=>x.classList.remove('sel'));
      b.classList.add('sel');
      mpEl('mpCivName').textContent=cv.name;
      mpEl('mpCivPick').open=false;
      netSend({t:'seat',civ:i});
    };
    grid.appendChild(b);
  });
})();
/* The evener: a self-declared, publicly visible economy boost (AoE2:DE's
   handicap idea) so friends of different skill can still fight each other. */
let mpHc=100;
document.querySelectorAll('#mpHcPick button[data-hc]').forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll('#mpHcPick button[data-hc]').forEach(x=>x.classList.remove('sel'));
    b.classList.add('sel');
    mpHc=+b.getAttribute('data-hc');
    mpEl('mpHcName').textContent=mpHc>100?'+'+(mpHc-100)+'%':'None';
    mpEl('mpHcPick').open=false;
    netSend({t:'seat',hc:mpHc});
  };
});
function mpHostBtnRow(sel,key,after){
  document.querySelectorAll('#mpHostCtl button['+sel+']').forEach(b=>{
    b.onclick=()=>{
      document.querySelectorAll('#mpHostCtl button['+sel+']').forEach(x=>x.classList.remove('sel'));
      b.classList.add('sel');
      mpCfg[key]=+b.getAttribute(sel);
      netSend({t:'cfg',cfg:mpCfg});
      if(after)after();
    };
  });
}
mpHostBtnRow('data-mm','map');mpHostBtnRow('data-ma','ai');
mpHostBtnRow('data-md','diff');mpHostBtnRow('data-mt','team');mpHostBtnRow('data-mb','turbo');
mpHostBtnRow('data-mr','rg');
mpEl('mpBtn').onclick=()=>{initAudio();mpShow();};
mpEl('mpBack').onclick=()=>{netReset();resetNet();mpEl('mpOverlay').style.display='none';};
mpEl('mpHost').onclick=()=>{
  const name=(mpEl('mpName').value||'Player').trim();
  localStorage.setItem('tq_name',name);netName=name;
  // v: the build stamp — the relay refuses mixed-version rooms (the service
  // worker updates politely, so peers on different builds are ROUTINE, and a
  // mixed room is a guaranteed desync).
  netConnect(()=>{netSend({t:'host',name,v:gameVer()});netSend({t:'seat',civ:mpCiv});netSend({t:'cfg',cfg:mpCfg});});
};
mpEl('mpJoin').onclick=()=>{
  const name=(mpEl('mpName').value||'Player').trim();
  const code=(mpEl('mpCode').value||'').toUpperCase().trim();
  if(code.length!==4){mpStatus('A room code is four letters');return;}
  localStorage.setItem('tq_name',name);netName=name;
  netConnect(()=>{netSend({t:'join',code,name,v:gameVer()});netSend({t:'seat',civ:mpCiv});});
};
mpEl('mpInvite').onclick=()=>{
  const url=location.origin+location.pathname+'?room='+netRoom;
  const done=()=>mpStatus('Invite link copied — send it to a friend');
  if(navigator.clipboard&&navigator.clipboard.writeText)
    navigator.clipboard.writeText(url).then(done,()=>mpStatus(url));
  else mpStatus(url);
};
mpEl('mpStart').onclick=()=>{
  if(!netHost)return;
  const ps=netLobby.players||[];
  if(ps.length+ (mpCfg.ai|0) < 2){mpStatus('You need at least one opponent — a friend or a computer');return;}
  if((mpCfg.team|0)===2&&!(mpCfg.ai|0)){mpStatus('Co-op vs AI needs at least one computer opponent');return;}
  netSend({t:'cfg',cfg:mpCfg});
  netSend({t:'start',seed:(Math.random()*4294967296)>>>0});
};
mpEl('netHaltBtn').onclick=()=>{
  mpEl('netHalt').style.display='none';
  netReset();resetNet();
  G=null;
  mpEl('startOverlay').style.display='flex';
  updateContBtn();
};
/* Campaign progress: a SET of completed mission ids ('tq_camp2'), migrated
   from the old linear counter. Arcs unlock independently — an arc opener
   (arcStart) is always playable; within an arc, finishing a mission opens
   the next. */
function campDone(){
  try{
    let d=JSON.parse(localStorage.getItem('tq_camp2')||'null');
    if(!d){ // migrate the pre-arc linear counter
      const old=+(localStorage.getItem('tq_camp')||0);
      d=[];for(let i=0;i<old;i++)d.push(i);
      localStorage.setItem('tq_camp2',JSON.stringify(d));
    }
    return new Set(d);
  }catch(e){return new Set();}
}
function campMark(id){
  try{
    const d=campDone();d.add(id);
    localStorage.setItem('tq_camp2',JSON.stringify([...d]));
  }catch(e){}
}
function showCampaign(){
  const done=campDone();
  const list=document.getElementById('campList');list.innerHTML='';
  let lastArc=null,arcIdx=0;
  MISSIONS.forEach(mn=>{
    const arc=mn.arc||'The Squire\'s Road';
    if(arc!==lastArc){
      lastArc=arc;arcIdx=0;
      const h=document.createElement('p');
      h.style.cssText='margin:14px 0 4px;font-family:Georgia,serif;letter-spacing:.08em;color:#8a6a1a;font-weight:700;text-align:left';
      h.textContent='⚜ '+arc;
      list.appendChild(h);
    }
    arcIdx++;
    const isDone=done.has(mn.id);
    const locked=!(mn.arcStart||mn.id===0||done.has(mn.id-1));
    const btn=document.createElement('button');
    btn.className='bigbtn';
    btn.innerHTML='<b>'+arcIdx+'. '+mn.name+(isDone?' ✓':locked?' 🔒':'')+'</b><small>'+mn.blurb+'</small>';
    if(locked)btn.disabled=true;
    else btn.onclick=()=>{
      initAudio();if(AC&&AC.state==='suspended')AC.resume();
      resetNet();
      mission=mn;mapSel=mn.map;diffSel=mn.diff;
      if(mn.civ!==undefined)civSel=mn.civ;   // the arcs cast you as their lord
      document.getElementById('campOverlay').style.display='none';
      document.getElementById('startOverlay').style.display='none';
      begin();
    };
    list.appendChild(btn);
  });
  document.getElementById('campOverlay').style.display='flex';
}
document.getElementById('sndBtn').onclick=()=>{
  initAudio();
  sndMuted=!sndMuted;
  document.getElementById('sndBtn').textContent=sndMuted?'🔇':'🔊';
  if(!sndMuted)snd('click');
};
document.getElementById('againBtn').onclick=()=>{
  if(REC.play){exitReplay();return;}
  document.getElementById('endOverlay').style.display='none';
  document.getElementById('startOverlay').style.display='flex';
  updateContBtn();
};
// Rematch: the same settings, the same seats — one tap back into the fray.
// (A fresh seed: the same map WOULD be the same battle, move for move.)
document.getElementById('rematchBtn').onclick=()=>{
  document.getElementById('endOverlay').style.display='none';
  resetNet();
  document.getElementById('startOverlay').style.display='none';
  begin();
  toast('Rematch — same rules, fresh battlefield');
};
document.getElementById('saveRepBtn').onclick=()=>{
  const btn=document.getElementById('saveRepBtn');
  if(replaySave(REC.last)){btn.textContent='✓ Replay saved';REC.last=null;}
  else btn.textContent='Could not save (storage full?)';
};
// replay browser
function renderReplayList(){
  const el=document.getElementById('replayList');
  const list=replayList();
  el.innerHTML='';
  if(!list.length){el.innerHTML='<p class="sub" style="text-align:center">No replays yet — finish a solo battle and press “Save replay”.</p>';return;}
  list.forEach((r,i)=>{
    const row=document.createElement('div');
    row.style.cssText='display:flex;gap:6px;align-items:center;margin:6px 0';
    const nm=document.createElement('span');
    nm.style.cssText='flex:1;font-size:12.5px';nm.textContent=r.name||('Replay '+(i+1));
    const pb=document.createElement('button');pb.className='bigbtn';pb.style.cssText='width:auto;padding:8px 14px;margin:0';
    pb.textContent='▶ Watch';pb.onclick=()=>playReplay(r);
    const db=document.createElement('button');db.className='bigbtn alt';db.style.cssText='width:auto;padding:8px 10px;margin:0';
    db.textContent='🗑';db.setAttribute('aria-label','Delete replay');
    db.onclick=()=>{const l2=replayList();l2.splice(i,1);
      try{localStorage.setItem('tq_replays',JSON.stringify(l2));}catch(e){}
      renderReplayList();};
    row.appendChild(nm);row.appendChild(pb);row.appendChild(db);
    el.appendChild(row);
  });
}
document.getElementById('replayBack').onclick=()=>{
  document.getElementById('replayOverlay').style.display='none';
  document.getElementById('startOverlay').style.display='flex';
};
document.querySelectorAll('#repBar .repSpd').forEach(b=>{
  b.onclick=()=>{REC.speed=+b.dataset.s;
    document.querySelectorAll('#repBar .repSpd').forEach(x=>x.classList.toggle('sel',x===b));};
});
document.getElementById('repExit').onclick=exitReplay;
document.getElementById('menuBtn').onclick=()=>{
  if(!G||G.over)return;
  // In a match the clock belongs to everyone: pausing here would stall every
  // other player, so the menu opens over a running battle instead.
  if(!netMode)G.paused=true;
  document.getElementById('menuOverlay').style.display='flex';
  const sb=document.getElementById('saveBtn');
  sb.style.display=netMode?'none':'';
  document.getElementById('restartBtn').textContent=netMode?'Leave the battle':'Restart Battle';
};
document.getElementById('resumeBtn').onclick=()=>{
  G.paused=false;document.getElementById('menuOverlay').style.display='none';
};
document.getElementById('menuSetBtn').onclick=()=>{
  buildSettings();
  document.getElementById('menuOverlay').style.display='none';
  document.getElementById('setOverlay').style.display='flex';
};
document.getElementById('restartBtn').onclick=()=>{
  document.getElementById('menuOverlay').style.display='none';
  document.getElementById('startOverlay').style.display='flex';
  netReset();resetNet();
  G=null;updateContBtn();
};
/* ================= main loop ================= */
let last=0,acc=0,fpsAlt=false;
function begin(){
  resize();newGame();
  if(mission&&mission.setup)mission.setup();
  recBegin();                     // solo matches record themselves for replay
  if(typeof tm==='function')tm('game_start',{mode:netMode?'mp':mission?'camp':REC.play?'replay':'solo',
    map:mapSel,np:NP,pace:turboSel,rg:regicideSel});
  feedEl.innerHTML='';ovT=-1;
  updateTop();refreshPanel();
  if(mission)toast('Mission: '+mission.name+' — '+mission.obj);
  else{
    const allies=[],foes=[];
    for(let p=0;p<NP;p++){if(p===localP)continue;
      (allied(p,localP)?allies:foes).push(CIVS[G.P[p].civ].name);}
    toast('You lead the '+CIVS[G.P[localP].civ].name
      +(allies.length?' beside the '+allies.join(', '):'')
      +' — against the '+foes.join(', ')+'!');
  }
  wakeAcquire();   // battles are watched hands-off; a dimming screen kills iOS sockets
  last=performance.now();
}
/* ============ mobile resilience (the iOS survival kit) ============ */
/* Screen wake lock: an RTS is WATCHED — long stretches with no touch dim the
   screen, and on iOS a dimmed screen suspends the page and kills the socket.
   Auto-released by the OS on backgrounding; the visibilitychange handler in
   the fog/save module re-acquires it on every return. */
let wakeLockS=null;
function wakeAcquire(){
  try{
    if(!('wakeLock' in navigator)||wakeLockS||document.hidden||!G||G.over)return;
    navigator.wakeLock.request('screen').then(w=>{
      wakeLockS=w;
      w.addEventListener('release',()=>{wakeLockS=null;});
    }).catch(()=>{});
  }catch(e){}
}
/* iOS suspends the AudioContext across interruptions (calls, Siri, screen
   lock) and does not always resume it — any tap after that revives it. */
document.addEventListener('pointerup',()=>{
  try{if(typeof AC!=='undefined'&&AC&&AC.state!=='running')AC.resume().catch(()=>{});}catch(e){}
},{passive:true});
/* Warm the free-tier relay: it sleeps after 15 idle minutes and takes ~50s to
   wake, which used to land on the FIRST Host press. A fire-and-forget fetch at
   page load and again when the lobby opens hides the cold start behind the
   player's own setup time. no-cors: /healthz has no CORS headers, but the
   request still reaches (and wakes) the server. */
function netHttpUrl(){
  const h=location.hostname;
  if(h==='localhost'||h==='127.0.0.1')return 'http://localhost:8080';
  return 'https://tiny-conquerors-relay.onrender.com';
}
function netPrewarm(){
  if(!netAvailable())return;
  try{fetch(netHttpUrl()+'/healthz',{mode:'no-cors',cache:'no-store'}).catch(()=>{});}catch(e){}
}
netPrewarm();
/* Join-by-URL: ?room=CODE deep-links straight into the join flow — phones
   share via messaging apps, and a tappable link beats reading a code aloud. */
addEventListener('load',()=>{
  try{
    const c=(new URLSearchParams(location.search).get('room')||'')
      .toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
    if(c.length===4&&netAvailable()){
      mpShow();
      mpEl('mpCode').value=c;
      mpStatus('Invited to room '+c+' — enter your name and press Join');
    }
  }catch(e){}
});
/* Add-to-Home-Screen hint, iOS only, second visit onward, dismissible once.
   Installing is not vanity there: it exempts the game from Safari's 7-day
   storage eviction (saves!), removes the URL bar, and disarms the left-edge
   back-swipe that can yank a player out of a battle. Appended INSIDE .scroll —
   startOverlay.lastElementChild must stay the build stamp (bench sniffer). */
(function(){
  try{
    const ua=navigator.userAgent||'';
    const iOS=/iP(hone|ad|od)/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const standalone=navigator.standalone===true||(matchMedia&&matchMedia('(display-mode: standalone)').matches);
    if(!iOS||standalone||localStorage.getItem('tq_a2hs'))return;
    const visits=(+localStorage.getItem('tq_visits')||0)+1;
    localStorage.setItem('tq_visits',String(visits));
    if(visits<2)return;   // suggest to a RETURNING visitor — first-timers just want to play
    addEventListener('load',()=>{
      const ov=document.getElementById('startOverlay');if(!ov)return;
      const scroll=ov.querySelector('.scroll');if(!scroll)return;
      const d=document.createElement('div');
      d.style.cssText='margin:10px auto 0;background:#efe2bd;border:2px solid #6b5330;border-radius:10px;padding:9px 12px;font-size:12.5px;color:#241a10;text-align:left;display:flex;gap:8px;align-items:center';
      d.innerHTML='<span style="font-size:20px">📲</span><span style="flex:1">Add to your Home Screen to play fullscreen and keep your saves safe: tap <b>Share</b> → <b>Add to Home Screen</b></span>'
        +'<button style="border:none;background:none;font-size:16px;padding:6px;cursor:pointer" aria-label="Dismiss">✕</button>';
      d.querySelector('button').onclick=()=>{try{localStorage.setItem('tq_a2hs','1');}catch(e){}d.remove();};
      scroll.appendChild(d);
    });
  }catch(e){}
})();
