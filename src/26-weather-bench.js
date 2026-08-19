/* ================= weather ==================================================
   Rain and snow on the glass. The SCHEDULE is deterministic from the match
   seed and the game clock — two lockstep peers watch the same storm arrive —
   but nothing here ever writes to G, so the sim and the state hash are
   untouched. Each match has a climate (about a third are cold: snow instead
   of rain), weather comes in ~2-minute episodes with a soft ramp at both
   ends, and heavy rain occasionally throws lightning. Motion runs on the
   wall clock so drops keep falling while the game is paused.
   window.__wx = {kind:'rain'|'snow', inten:0..1} overrides for testing. */
const wxC=document.getElementById('wx'),wxCtx=wxC.getContext('2d');
let wxWasClear=true;
/* ---- storm audio -----------------------------------------------------------
   One looping noise bed shaped per climate (rain = bright patter, snow = a
   low wind), its gain chasing the visual intensity, plus thunder scheduled
   off the SAME half-second lightning slots the flash uses — so the sound and
   the sky always agree, on every peer. All render/audio side; the sim never
   hears weather. */
let wxAudio=null,wxThunderSlot=-1;
function updateWeatherAudio(wx){
  if(!AC||!masterG)return;
  if(!wxAudio){
    const len=2*AC.sampleRate|0,buf=AC.createBuffer(1,len,AC.sampleRate);
    const ch=buf.getChannelData(0);
    for(let i=0;i<len;i++)ch[i]=Math.random()*2-1;
    const src=AC.createBufferSource();src.buffer=buf;src.loop=true;
    const filt=AC.createBiquadFilter();filt.type='bandpass';
    filt.frequency.value=3200;filt.Q.value=.55;
    const gain=AC.createGain();gain.gain.value=0;
    src.connect(filt);filt.connect(gain);gain.connect(masterG);
    src.start();
    wxAudio={gain,filt};
  }
  const target=(sndMuted||!G||G.over)?0:
    (wx.kind==='rain'?.11:.045)*wx.inten;
  wxAudio.filt.frequency.setTargetAtTime(wx.kind==='rain'?3200:480,AC.currentTime,.5);
  wxAudio.gain.gain.setTargetAtTime(target,AC.currentTime,.45);
}
function sThunder(){
  if(!AC||sndMuted)return;
  const t0=AC.currentTime+.25+Math.random()*.7;   // the light arrives first
  const len=2.6*AC.sampleRate|0,buf=AC.createBuffer(1,len,AC.sampleRate);
  const ch=buf.getChannelData(0);
  for(let i=0;i<len;i++){const e=Math.exp(-i/len*4.5);ch[i]=(Math.random()*2-1)*e;}
  const src=AC.createBufferSource();src.buffer=buf;      // the long rumble
  const lp=AC.createBiquadFilter();lp.type='lowpass';lp.frequency.value=140;lp.Q.value=.7;
  const g=AC.createGain();g.gain.setValueAtTime(.0001,t0);
  g.gain.exponentialRampToValueAtTime(.30,t0+.06);
  g.gain.exponentialRampToValueAtTime(.001,t0+2.5);
  src.connect(lp);lp.connect(g);g.connect(masterG);
  src.start(t0);src.stop(t0+2.7);
  const len2=.5*AC.sampleRate|0,b2=AC.createBuffer(1,len2,AC.sampleRate);
  const c2=b2.getChannelData(0);
  for(let i=0;i<len2;i++){const e=Math.exp(-i/len2*9);c2[i]=(Math.random()*2-1)*e;}
  const s2=AC.createBufferSource();s2.buffer=b2;         // the crack on top
  const bp=AC.createBiquadFilter();bp.type='bandpass';bp.frequency.value=900;bp.Q.value=.8;
  const g2=AC.createGain();g2.gain.setValueAtTime(.0001,t0);
  g2.gain.exponentialRampToValueAtTime(.14,t0+.02);
  g2.gain.exponentialRampToValueAtTime(.001,t0+.5);
  s2.connect(bp);bp.connect(g2);g2.connect(masterG);
  s2.start(t0);s2.stop(t0+.6);
}
function weatherNow(){
  if(window.__wx)return window.__wx;
  if(!G||typeof gameSeed==='undefined')return {kind:'rain',inten:0};
  const kind=hash2(gameSeed,7)%3===0?'snow':'rain';
  const EP=120;                                  // episode length, seconds
  const w=Math.floor(G.t/EP);
  const on=hash2(gameSeed*13,w*29)%10<3;         // ~30% of episodes have weather
  if(!on)return {kind,inten:0};
  const tt=G.t-w*EP;
  const ramp=Math.min(1,tt/18,(EP-tt)/18);       // ease in and out over 18s
  const heavy=.55+((hash2(gameSeed*7,w*11)%40)/100);   // .55...95 per episode
  return {kind,inten:Math.max(0,ramp)*heavy};
}
/* Snow COVER — how white the world currently is, 0..1. Accumulates through a
   snow episode and melts over ~7 minutes afterwards, derived entirely from
   the same seed schedule weatherNow() reads, so it needs no state and every
   peer agrees. Quantised to wxSnowLvl (0/1/2) for the sprite caches.
   window.__wxCov overrides for testing. */
let wxSnowLvl=0;
function snowCover(){
  if(window.__wxCov!=null)return window.__wxCov;
  if(!G||typeof gameSeed==='undefined')return 0;
  if(hash2(gameSeed,7)%3!==0)return 0;             // warm climate: never settles
  const EP=120,w0=Math.floor(G.t/EP);
  let acc=0;
  for(let k=0;k<=5;k++){
    const w=w0-k;if(w<0)break;
    if(hash2(gameSeed*13,w*29)%10>=3)continue;      // that episode was dry
    const heavy=.55+((hash2(gameSeed*7,w*11)%40)/100);
    const amt=k===0?Math.min(1,(G.t-w*EP)/60)*heavy:heavy;
    const melt=k===0?1:Math.max(0,1-(G.t-(w+1)*EP)/420);
    acc+=amt*melt;
  }
  return Math.min(1,acc);
}
function drawWeather(){
  if(OPT.reduceMotion){ // settings: a calm sky for motion-sensitive players
    if(!wxWasClear){wxCtx.clearRect(0,0,wxC.width,wxC.height);wxWasClear=true;}
    return;
  }
  const wx=weatherNow();
  updateWeatherAudio(wx);
  const cov=snowCover();
  wxSnowLvl=cov>.6?2:cov>.22?1:0;
  if(wx.inten<=0.01&&cov<=0.02){
    if(!wxWasClear){wxCtx.clearRect(0,0,wxC.width,wxC.height);wxWasClear=true;}
    return;
  }
  wxWasClear=false;
  if(wxC.width!==vw||wxC.height!==vh){wxC.width=vw;wxC.height=vh;}
  const g=wxCtx,t=performance.now()*.001,inten=wx.inten;
  g.clearRect(0,0,vw,vh);
  if(cov>0.02){ // winter light — the world pales as the snow lies
    g.fillStyle='rgba(230,238,248,'+(0.10*cov).toFixed(3)+')';
    g.fillRect(0,0,vw,vh);
  }
  if(inten<=0.01)return;   // lying snow but no fresh fall
  if(wx.kind==='rain'){
    // overcast wash — the light drops before the rain reads
    g.fillStyle='rgba(30,38,52,'+(0.10*inten).toFixed(3)+')';
    g.fillRect(0,0,vw,vh);
    const n=Math.round(150*inten);
    g.strokeStyle='rgba(190,210,230,.30)';g.lineWidth=1;
    g.beginPath();
    for(let i=0;i<n;i++){
      const h=hash2(i*73,i*131);
      const spd=560+(h%180),len=11+(h>>>4)%8;
      const x=((h%1700)+(t*90))%(vw+40)-20;      // slight sideways drive
      const y=((h>>>7)%1900+t*spd)%(vh+30)-15;
      g.moveTo(x,y);g.lineTo(x-3,y+len);
    }
    g.stroke();
    // nearer, faster sheets at higher intensity
    if(inten>.5){
      g.strokeStyle='rgba(210,226,240,.20)';g.lineWidth=1.6;
      g.beginPath();
      for(let i=0;i<n*.3;i++){
        const h=hash2(i*211,i*57);
        const x=((h%1700)+(t*130))%(vw+40)-20;
        const y=((h>>>6)%1900+t*760)%(vh+40)-20;
        g.moveTo(x,y);g.lineTo(x-5,y+19);
      }
      g.stroke();
    }
    /* lightning: a two-pulse sky flash a few times a minute in a downpour.
       Scheduled from the game clock + seed so both peers see the same bolt. */
    if(inten>.72&&G){
      const sec=Math.floor(G.t*2);               // half-second slots
      if(hash2(gameSeed*31,sec)%44===0){
        if(wxThunderSlot!==sec){wxThunderSlot=sec;sThunder();}   // one rumble per bolt
        const ph=(G.t*2)%1;
        const a=ph<.12?(.55-ph*3):(ph>.2&&ph<.3?(.35-(ph-.2)*2.4):0);
        if(a>0){g.fillStyle='rgba(240,244,255,'+a.toFixed(3)+')';g.fillRect(0,0,vw,vh);}
      }
    }
  }else{
    // snow: cold wash, lazy flakes swaying as they fall
    g.fillStyle='rgba(200,214,232,'+(0.08*inten).toFixed(3)+')';
    g.fillRect(0,0,vw,vh);
    const n=Math.round(130*inten);
    g.fillStyle='rgba(244,248,252,.62)';
    for(let i=0;i<n;i++){
      const h=hash2(i*97,i*61);
      const spd=42+(h%30),r=1+((h>>>5)%20)/10;
      const y=((h>>>7)%1900+t*spd)%(vh+16)-8;
      const x=(((h%1700)+Math.sin(t*(.5+(h%10)/18)+h)*22)%(vw+16)+(vw+16))%(vw+16)-8;
      g.beginPath();g.arc(x,y,r,0,7);g.fill();
    }
  }
}
/* The box-select rubber band is painted by the 2D draw(), which is hidden in
   3D — the drag worked but showed nothing. A fixed-position div tracks selBox
   in client coords (which is what selBox stores) whenever the 3D view is up. */
let selRectEl=null;
function syncSelRect(){
  const show=use3D&&selBox;
  if(!selRectEl){
    if(!show)return;
    selRectEl=document.createElement('div');
    selRectEl.style.cssText='position:fixed;border:1.5px dashed rgba(255,224,130,.95);'
      +'background:rgba(255,224,130,.08);pointer-events:none;z-index:5;display:none;';
    document.body.appendChild(selRectEl);
  }
  if(show){
    selRectEl.style.display='block';
    selRectEl.style.left=Math.min(selBox.x0,selBox.x1)+'px';
    selRectEl.style.top=Math.min(selBox.y0,selBox.y1)+'px';
    selRectEl.style.width=Math.abs(selBox.x1-selBox.x0)+'px';
    selRectEl.style.height=Math.abs(selBox.y1-selBox.y0)+'px';
  }else selRectEl.style.display='none';
}
// dock the minimap + zoom buttons into the panel on wide screens, overlay on phones
const miniDock=document.getElementById('miniDock'),mmq=matchMedia('(min-width:760px)');
function placeMini(){
  const zb=document.getElementById('zoomBtns'),vwrap=document.getElementById('viewwrap');
  if(mmq.matches){miniDock.appendChild(zb);miniDock.appendChild(mini);
    mini.classList.add('docked');zb.classList.add('docked');}
  else{vwrap.appendChild(mini);vwrap.appendChild(zb);
    mini.classList.remove('docked');zb.classList.remove('docked');}
  resize();
}
mmq.addEventListener('change',placeMini);
window.addEventListener('resize',()=>{ // belt-and-braces: some engines miss the mq change event
  if(mmq.matches!==mini.classList.contains('docked'))placeMini();
});
resize();
placeMini();
updateContBtn();
requestAnimationFrame(frame);

/* ================= device benchmark — open /?bench=1 =======================
   Answers the one question a desktop cannot: what does this game cost on THE
   PHONE IN YOUR HAND. Runs two scenes (a normal start and a revealed 8-player
   Black Forest, the known worst case), measures sim step / 2D draw / 3D draw
   (with a readPixels sync so the GPU is in the number, same method as every
   desktop figure in HANDOFF.md) plus the real displayed fps in both renderers,
   then shows the card AND posts it to the relay's report mailbox so the
   numbers can be read from the workshop without retyping them.
   Opt-in by URL, so it can never touch a normal game. */
(function(){
  if(!/[?&]bench=1\b/.test(location.search))return;
  const card=document.createElement('div');
  card.style.cssText='position:fixed;inset:0;z-index:30;background:rgba(10,8,4,.93);'
    +'display:flex;align-items:center;justify-content:center;padding:14px;';
  const inner=document.createElement('div');
  inner.style.cssText='max-width:430px;width:100%;background:linear-gradient(#f2e6c4,#e0cf9f);'
    +'color:#2a1f12;border-radius:12px;border:3px solid #5a554b;padding:18px;'
    +'font:13px/1.5 "Segoe UI",system-ui,sans-serif;white-space:pre-wrap;';
  card.appendChild(inner);
  const say=t=>{inner.textContent=t;};
  const now=()=>performance.now();
  const med=a=>{const s=[...a].sort((x,y)=>x-y);return +s[s.length>>1].toFixed(2);};
  // two-frame settle, but never a hang: a backgrounded tab gets no rAF at all
  const raf2=()=>Promise.race([
    new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),
    new Promise(r=>setTimeout(r,700))]);
  const syncPx=gl=>{const b=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);};
  // displayed frame rate over ~2s; hidden tabs get no rAF, so time out to 0
  const fpsSample=ms=>new Promise(res=>{
    let n=0,start=0,dead=false;
    const to=setTimeout(()=>{dead=true;res(0);},ms+2500);
    const cb=t=>{if(dead)return;
      if(!start)start=t;else n++;
      if(t-start>=ms){clearTimeout(to);res(Math.round(n*1000/(t-start)));return;}
      requestAnimationFrame(cb);};
    requestAnimationFrame(cb);
  });
  async function phase(label,setup){
    say('Benchmarking — '+label+'\n\nSetting the scene…');
    setup();
    await raf2();
    const stepT=[];for(let i=0;i<40;i++){const t0=now();step(0.05);stepT.push(now()-t0);}
    if(use3D)toggle3D();
    await raf2();
    const d2=[];for(let i=0;i<12;i++){const t0=now();draw();d2.push(now()-t0);}
    say('Benchmarking — '+label+'\n\nMeasuring the classic view…');
    const fps2=await fpsSample(1800);
    toggle3D();
    if(!use3D)return null;                     // no WebGL on this device
    await raf2();
    const gl=R3.gl,d3=[];
    for(let i=0;i<12;i++){const t0=now();R3.draw();syncPx(gl);d3.push(now()-t0);}
    say('Benchmarking — '+label+'\n\nMeasuring the 3D view…');
    const fps3=await fpsSample(1800);
    toggle3D();
    return {scene:label,stepMs:med(stepT),draw2Ms:med(d2),draw3Ms:med(d3),
      fps2D:fps2||'n/a',fps3D:fps3||'n/a',units:G.units.length,blds:G.blds.length,
      trees:R3.iAll?R3.iAll[0]+R3.iAll[1]:0,map:MAP};
  }
  const relayHttp=()=>(location.hostname==='localhost'||location.hostname==='127.0.0.1')
    ?'http://localhost:8080':'https://tiny-conquerors-relay.onrender.com';
  async function run(){
    document.getElementById('startOverlay').style.display='none';
    document.body.appendChild(card);
    say('Benchmarking this device\n\nAbout 20 seconds — keep the screen on.');
    mission=null;if(typeof resetNet==='function')resetNet();
    if(!R3.init()){say('This device has no WebGL — there is no 3D to profile.');return;}
    const gl=R3.gl;
    let renderer='?';
    try{const ext=gl.getExtension('WEBGL_debug_renderer_info');
      renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):String(gl.getParameter(gl.RENDERER));}catch(e){}
    // the build stamp div exists on the PWA build; test pages just say local.
    // Anchored match — a loose /build / here once matched "build a Monastery"
    // in the how-to text and mailed the entire start screen as the version.
    const stampEl=document.getElementById('startOverlay').lastElementChild;
    const stampTx=stampEl?stampEl.textContent.trim():'';
    const report={kind:'bench',
      build:/^build tq-v\d+$/.test(stampTx)?stampTx:'local',
      ua:navigator.userAgent,dpr:devicePixelRatio,
      screen:screen.width+'x'+screen.height,view:vw+'x'+vh,
      gl2:!!R3.gl2,renderer,aniso:R3.anisoMax||0,phases:[]};
    const p1=await phase('a normal start (2 players, River)',()=>{
      diffSel=1;civSel=0;turboSel=0;teamSel=0;mapSel=0;playersSel=2;
      pendingSeed=4242;newGame();
      for(let i=0;i<60;i++)step(0.05);
    });
    if(p1)report.phases.push(p1);
    const p2=await phase('the worst case (8 players, Black Forest, revealed)',()=>{
      diffSel=1;civSel=0;turboSel=0;teamSel=1;mapSel=1;playersSel=8;
      pendingSeed=31337;newGame();
      for(let i=0;i<300;i++)step(0.05);
      G.vis.fill(2);fogDirty=true;renderFogCanvas();
      const p=isoPt(MAP/2,MAP/2);
      G.cam.z=1;G.cam.x=p.x-vw/G.cam.z/2;G.cam.y=p.y-vh/G.cam.z/2;
    });
    if(p2)report.phases.push(p2);
    let sent='not sent';
    try{
      const r=await fetch(relayHttp()+'/report',{method:'POST',body:JSON.stringify(report)});
      sent=r.ok?'sent to the workshop ✓':'upload failed ('+r.status+') — screenshot this';
    }catch(e){sent='upload failed — screenshot this';}
    const L=[],f=x=>typeof x==='number'?x+'ms':x;
    L.push('Device profile — '+renderer);
    L.push((report.gl2?'WebGL2':'WebGL1')+' · '+report.view+' css px · dpr '+report.dpr);
    L.push('');
    for(const p of report.phases){
      L.push('■ '+p.scene);
      L.push('   sim step '+f(p.stepMs)+' · '+p.units+' units · '+p.trees+' trees');
      L.push('   2D draw '+f(p.draw2Ms)+'  →  '+p.fps2D+' fps on screen');
      L.push('   3D draw '+f(p.draw3Ms)+'  →  '+p.fps3D+' fps on screen');
      L.push('');
    }
    L.push(sent);
    say(L.join('\n'));
    const btn=document.createElement('button');
    btn.textContent='Done — back to the game';
    btn.style.cssText='margin-top:12px;width:100%;padding:11px;border-radius:9px;font-size:15px;'
      +'border:2px solid #120d07;background:linear-gradient(#66492a,#2c2013);color:#e8d9b0;';
    btn.onclick=()=>location.replace(location.pathname);
    inner.appendChild(btn);
  }
  addEventListener('load',()=>setTimeout(run,500));
})();
</script>
