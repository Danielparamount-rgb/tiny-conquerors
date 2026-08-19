/* ================= multiplayer lobby ================= */
let mpCfg={map:0,diff:1,turbo:0,ai:0,team:0,rg:0};
let mpCiv=0;
const mpEl=id=>document.getElementById(id);
function mpStatus(s){mpEl('mpStatus').textContent=s||'';}
function mpShow(){
  netReset();resetNet();
  mpEl('mpConnect').style.display='';
  mpEl('mpRoom').style.display='none';
  mpEl('mpName').value=localStorage.getItem('tq_name')||'';
  mpEl('mpCode').value='';
  mpStatus(netAvailable()?'':'Multiplayer needs the web app at tiny-conquerors.onrender.com — the preview sandbox blocks connections.');
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
      +' — '+CIVS[p.civ]?.name+'</div>';
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
  netConnect(()=>{netSend({t:'host',name});netSend({t:'seat',civ:mpCiv});netSend({t:'cfg',cfg:mpCfg});});
};
mpEl('mpJoin').onclick=()=>{
  const name=(mpEl('mpName').value||'Player').trim();
  const code=(mpEl('mpCode').value||'').toUpperCase().trim();
  if(code.length!==4){mpStatus('A room code is four letters');return;}
  localStorage.setItem('tq_name',name);netName=name;
  netConnect(()=>{netSend({t:'join',code,name});netSend({t:'seat',civ:mpCiv});});
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
function showCampaign(){
  const prog=+(localStorage.getItem('tq_camp')||0);
  const list=document.getElementById('campList');list.innerHTML='';
  MISSIONS.forEach(mn=>{
    const done=mn.id<prog,locked=mn.id>prog;
    const btn=document.createElement('button');
    btn.className='bigbtn';
    btn.innerHTML='<b>'+(mn.id+1)+'. '+mn.name+(done?' ✓':locked?' 🔒':'')+'</b><small>'+mn.blurb+'</small>';
    if(locked)btn.disabled=true;
    else btn.onclick=()=>{
      initAudio();if(AC&&AC.state==='suspended')AC.resume();
      resetNet();
      mission=mn;mapSel=mn.map;diffSel=mn.diff;
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
  last=performance.now();
}
