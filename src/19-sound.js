/* ================= sound (synthesized, no assets) ================= */
let AC=null,masterG=null,sndMuted=false,birdTimer=null;
const sndLast={};
function initAudio(){
  if(AC)return;
  try{
    AC=new (window.AudioContext||window.webkitAudioContext)();
    const comp=AC.createDynamicsCompressor();
    comp.threshold.value=-18;comp.knee.value=18;comp.ratio.value=5;
    comp.attack.value=.004;comp.release.value=.18;
    comp.connect(AC.destination);
    masterG=AC.createGain();
    masterG.gain.value=.55*(OPT.vol===undefined?1:OPT.vol);
    masterG.connect(comp);
    // sparse countryside ambience — the AoE2 map never feels silent
    birdTimer=setInterval(()=>{if(!sndMuted&&G&&!G.paused&&!G.over&&Math.random()<.55)sBird();},9000);
  }catch(e){}
}
/* Positional mix: snd(kind,x,y) attenuates and pans by where the event sits on
   screen, so a skirmish across the map murmurs while the fight at your feet is
   loud. sVolMul/sPan are set by snd() for the duration of one call. */
let sVolMul=1,sPan=0;
function sEnv(vol,dur,att){const g=AC.createGain();const t=AC.currentTime;
  const v=Math.max(.0002,vol*sVolMul);
  if(att){g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(v,t+att);}
  else g.gain.setValueAtTime(v,t);
  g.gain.exponentialRampToValueAtTime(.001,t+dur);
  if(sPan&&AC.createStereoPanner){
    const p=AC.createStereoPanner();p.pan.value=Math.max(-1,Math.min(1,sPan));
    g.connect(p);p.connect(masterG);
  }else g.connect(masterG);
  return g;}
function sBoom(f0,dur,vol){ // sub-bass thump for gunpowder and collapsing masonry
  if(!AC)return;
  const o=AC.createOscillator();o.type='sine';
  o.frequency.setValueAtTime(f0,AC.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(24,f0*.35),AC.currentTime+dur);
  o.connect(sEnv(vol,dur,.006));o.start();o.stop(AC.currentTime+dur+.05);
  const o2=AC.createOscillator();o2.type='triangle';
  o2.frequency.setValueAtTime(f0*1.5,AC.currentTime);
  o2.frequency.exponentialRampToValueAtTime(Math.max(30,f0*.5),AC.currentTime+dur*.6);
  o2.connect(sEnv(vol*.5,dur*.6,.004));o2.start();o2.stop(AC.currentTime+dur+.05);}
function sCreak(dur,vol){ // rope under load — timber and cordage, not a tone
  if(!AC)return;
  const o=AC.createOscillator();o.type='sawtooth';
  o.frequency.setValueAtTime(58,AC.currentTime);
  o.frequency.linearRampToValueAtTime(104,AC.currentTime+dur);
  const bp=AC.createBiquadFilter();bp.type='bandpass';bp.Q.value=7;
  bp.frequency.setValueAtTime(430,AC.currentTime);
  bp.frequency.linearRampToValueAtTime(880,AC.currentTime+dur);
  o.connect(bp);bp.connect(sEnv(vol,dur,.03));
  o.start();o.stop(AC.currentTime+dur+.02);}
function sChant(base,dur,vol){ // stacked fifths through a vowel formant — plainsong
  if(!AC)return;
  for(const [m,g2] of [[1,1],[1.5,.6],[2,.45]]){
    const o=AC.createOscillator();o.type='sawtooth';
    o.frequency.setValueAtTime(base*m,AC.currentTime);
    o.frequency.linearRampToValueAtTime(base*m*1.03,AC.currentTime+dur);
    const fm=AC.createBiquadFilter();fm.type='bandpass';fm.Q.value=3.2;
    fm.frequency.setValueAtTime(700,AC.currentTime);
    fm.frequency.linearRampToValueAtTime(950,AC.currentTime+dur*.7);
    o.connect(fm);fm.connect(sEnv(vol*g2,dur,.09));
    o.start();o.stop(AC.currentTime+dur+.05);
  }}
function sTone(freq,dur,vol,type,slide,att){
  if(!AC)return;
  const o=AC.createOscillator();o.type=type||'square';
  o.frequency.setValueAtTime(freq,AC.currentTime);
  if(slide)o.frequency.exponentialRampToValueAtTime(slide,AC.currentTime+dur);
  o.connect(sEnv(vol,dur,att));o.start();o.stop(AC.currentTime+dur+.02);}
function sNoise(dur,vol,fc,q,type){
  if(!AC)return;
  const len=(AC.sampleRate*dur)|0;
  const buf=AC.createBuffer(1,len,AC.sampleRate);
  const d=buf.getChannelData(0);
  for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
  const n=AC.createBufferSource();n.buffer=buf;
  const f=AC.createBiquadFilter();f.type=type||'bandpass';f.frequency.value=fc;
  if(q)f.Q.value=q;
  n.connect(f);f.connect(sEnv(vol,dur));n.start();}
function sKnock(f0,dur,vol){ // woody knock: pitch-dropping sine + snap transient
  if(!AC)return;
  const o=AC.createOscillator();o.type='sine';
  o.frequency.setValueAtTime(f0,AC.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(40,f0*.45),AC.currentTime+dur);
  o.connect(sEnv(vol,dur));o.start();o.stop(AC.currentTime+dur+.02);
  sNoise(.018,vol*.7,f0*4,1.2);
}
function sMetal(base,dur,vol){ // inharmonic partial stack — real clang, not a beep
  if(!AC)return;
  const parts=[1,1.83,2.62,3.86,5.1];
  for(let i=0;i<parts.length;i++){
    const o=AC.createOscillator();o.type='sine';
    const f=base*parts[i]*(1+(Math.random()-.5)*.015);
    o.frequency.setValueAtTime(f,AC.currentTime);
    o.connect(sEnv(vol*Math.pow(.62,i),dur*(1-.12*i)));
    o.start();o.stop(AC.currentTime+dur+.02);
  }
  sNoise(.02,vol*.9,5200,1,'highpass');
}
function sWhoosh(dur,vol,f0,f1){ // air: bandpassed noise with a frequency sweep
  if(!AC)return;
  const len=(AC.sampleRate*dur)|0;
  const buf=AC.createBuffer(1,len,AC.sampleRate);
  const d=buf.getChannelData(0);
  for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
  const n=AC.createBufferSource();n.buffer=buf;
  const f=AC.createBiquadFilter();f.type='bandpass';f.Q.value=1.6;
  f.frequency.setValueAtTime(f0,AC.currentTime);
  f.frequency.exponentialRampToValueAtTime(f1,AC.currentTime+dur);
  n.connect(f);f.connect(sEnv(vol,dur,.02));n.start();}
function sBrass(f,dur,vol,att){ // detuned saw stack through a warming lowpass — horn/fanfare
  if(!AC)return;
  const lp=AC.createBiquadFilter();lp.type='lowpass';
  lp.frequency.setValueAtTime(f*3,AC.currentTime);
  lp.frequency.linearRampToValueAtTime(f*6,AC.currentTime+dur*.4);
  lp.connect(sEnv(vol,dur,att||.06));
  for(const det of [0,-.7,.9]){
    const o=AC.createOscillator();o.type='sawtooth';
    o.frequency.setValueAtTime(f+det,AC.currentTime);
    const v=AC.createGain();v.gain.value=.34;
    o.connect(v);v.connect(lp);o.start();o.stop(AC.currentTime+dur+.05);
  }
}
function sVoice(f0,dur,vol){ // tiny formant grunt — the villager's "hup" acknowledgment
  if(!AC)return;
  const o=AC.createOscillator();o.type='sawtooth';
  o.frequency.setValueAtTime(f0,AC.currentTime);
  o.frequency.exponentialRampToValueAtTime(f0*.75,AC.currentTime+dur);
  const fm=AC.createBiquadFilter();fm.type='bandpass';fm.Q.value=2.5;
  fm.frequency.setValueAtTime(620,AC.currentTime);
  fm.frequency.exponentialRampToValueAtTime(380,AC.currentTime+dur);
  o.connect(fm);fm.connect(sEnv(vol,dur,.015));
  o.start();o.stop(AC.currentTime+dur+.02);
}
function sBird(){
  if(!AC)return;
  const n=2+(Math.random()*3|0),b=2200+Math.random()*1400;
  for(let i=0;i<n;i++)setTimeout(()=>{
    sTone(b+Math.random()*500,.06+Math.random()*.05,.012,'sine',b*.82);
  },i*(90+Math.random()*120));
}
function snd(kind,wx,wy){
  if(sndMuted||!AC)return;
  if(AC.state==='suspended'){AC.resume();return;}
  const now=performance.now();
  const gap={chop:220,mine:240,farmt:400,sword:110,hit:130,arrow:150,click:70,ack:340,
    place:250,horn:2600,done:350,train:280,age:600,win:1500,lose:1500,
    gun:90,cannon:220,treb:400,sling:260,twang:150,crash:150,collapse:500,convert:700}[kind]||120;
  if(sndLast[kind]&&now-sndLast[kind]<gap)return;
  sndLast[kind]=now;
  // distance mix — silent well off screen, panned toward its side of the view
  sVolMul=1;sPan=0;
  if(wx!==undefined&&G&&vw){
    // isoE is pre-camera (draw() applies the camera via ctx transform), so
    // convert to real screen pixels before measuring distance from the view
    const p=isoE(wx,wy);
    const sx=(p.x-G.cam.x)*G.cam.z,sy=(p.y-G.cam.y)*G.cam.z;
    const dx=(sx-vw/2)/(vw/2),dy=(sy-vh/2)/(vh/2);
    const d=Math.hypot(dx,dy);
    if(d>2.6){sVolMul=1;sPan=0;return;}          // too far off screen to hear
    sVolMul=Math.max(.16,1-d*.42);
    sPan=Math.max(-.85,Math.min(.85,dx*.8));
  }
  switch(kind){
    case 'chop': // axe bite: crack + woody body, slight per-hit variance
      sNoise(.045,.11,2400+Math.random()*700,1.4);
      sKnock(170+Math.random()*40,.09,.1);break;
    case 'mine': // pick on stone: bright tink + gravel
      sMetal(2100+Math.random()*500,.12,.05);
      sNoise(.06,.05,700,1,'lowpass');break;
    case 'farmt':sNoise(.09,.05,1500,.8);break; // scythe rustle
    case 'sword': // steel on steel
      sMetal(430+Math.random()*160,.22,.075);
      sWhoosh(.07,.04,3000,1200);break;
    case 'hit': // arrow/blunt impact: dull thud
      sKnock(120,.1,.09);sNoise(.04,.05,900,1);break;
    case 'arrow':sWhoosh(.13,.05,3600,700);break;
    case 'click':sKnock(760,.05,.07);break; // wooden tock, not a beep
    case 'ack':sVoice(150+Math.random()*40,.13,.09);break; // "hup" — order acknowledged
    case 'sel':sVoice(210+Math.random()*50,.09,.06);break; // shorter, higher "hm?" on select
    case 'place':sKnock(95,.16,.12);sNoise(.09,.05,500,1,'lowpass');break;
    case 'done': // hammer finish + warm chime
      sKnock(420,.06,.07);
      setTimeout(()=>sKnock(500,.06,.06),110);
      setTimeout(()=>{sTone(659,.3,.045,'sine');sTone(988,.34,.03,'sine');},240);break;
    case 'train':sTone(523,.12,.04,'sine');setTimeout(()=>sTone(784,.16,.04,'sine'),110);break;
    case 'age': // brass fanfare + timpani
      sKnock(82,.4,.16);
      [392,523,659,784].forEach((f,i)=>setTimeout(()=>sBrass(f,.32,.07),i*160));
      setTimeout(()=>sBrass(784,.7,.08),640);break;
    case 'horn': // low war horn, two blasts with a minor-third wobble
      sBrass(174,.9,.14,.1);
      setTimeout(()=>sBrass(146,.35,.1,.05),350);
      setTimeout(()=>sBrass(174,.8,.12,.08),900);break;
    case 'win':
      sKnock(90,.5,.15);
      [523,659,784,1046].forEach((f,i)=>setTimeout(()=>sBrass(f,.4,.08),i*180));
      setTimeout(()=>{sTone(2093,.8,.03,'sine');sBrass(1046,.9,.07);},760);break;
    case 'lose':
      [349,311,262,196].forEach((f,i)=>setTimeout(()=>sBrass(f,.55,.08,.09),i*260));
      setTimeout(()=>sKnock(60,.8,.14),1100);break;
    /* ---- siege & gunpowder (added with the artillery, tq-v20) ---- */
    case 'gun': // handgonne: sharp crack over a short powder thump
      sBoom(150,.16,.13);
      sNoise(.05,.13,1900,.7);
      sNoise(.16,.05,600,.9,'lowpass');break;
    case 'cannon': // bombard: deep report, long powder roar, ringing barrel
      sBoom(74,.5,.22);
      sNoise(.09,.18,900,.6);
      sNoise(.42,.08,340,.8,'lowpass');
      setTimeout(()=>sMetal(240,.3,.03),40);break;
    case 'treb': // counterweight drops, ropes groan, beam cracks over
      sCreak(.34,.19);
      setTimeout(()=>{sKnock(70,.3,.17);sWhoosh(.3,.1,300,1500);},300);break;
    case 'sling': // mangonel arm slams its stop and slings
      sKnock(110,.16,.13);
      sWhoosh(.22,.08,500,2100);break;
    case 'twang': // scorpion bolt: taut cord release
      sTone(280,.09,.1,'sawtooth',150);
      sNoise(.06,.09,1500,2);break;
    case 'crash': // stone landing — rubble, not the dull thud of an arrow
      sKnock(85,.2,.13);
      sNoise(.2,.09,700,.7);
      sNoise(.3,.045,2600,.5,'highpass');break;
    case 'collapse': // a building coming down: rumble, timber, settling debris
      sBoom(52,.75,.2);
      sNoise(.6,.12,420,.5,'lowpass');
      setTimeout(()=>{sKnock(90,.28,.11);sNoise(.35,.07,2200,.6,'highpass');},170);
      setTimeout(()=>sNoise(.5,.05,1500,.5,'highpass'),420);break;
    case 'convert': // plainsong swell — the monk's own voice, not the age fanfare
      sChant(196,.55,.09);
      setTimeout(()=>sChant(262,.6,.085),260);
      setTimeout(()=>{sChant(294,.75,.085);sTone(1568,.5,.022,'sine');},520);break;
  }
  sVolMul=1;sPan=0;
}

/* ================= adaptive score (graphics campaign follow-on) =============
   The one thing this game's ancestors were most loved for and this game never
   had: MUSIC. Fully generative — synthesized like every other sound here, so
   it ships zero bytes and needs no license. Three layers on one clock:

     peace    a slow dorian lute line over a soft pad, while you build
     tension  a low pulse + darker drone when enemies press your town
     battle   drums and horn stabs while YOUR people are actually fighting

   The layers crossfade with setTargetAtTime (nothing pops), the melody is a
   seeded-nowhere random walk (each machine hears its own variation — audio is
   cosmetic, peers may differ), and everything routes through its own gain so
   the Settings slider and the mute button rule it like any other sound.
   State detection is READ-ONLY: musCombat() is pinged from dealDamage, the
   rest is a once-a-second glance at visible enemies. The sim never knows. */
let MUS={on:null,gains:{},t0:0,beat:0,next:0,lastCombat:-99,mode:'peace',horn:0};
function musCombat(p1,p2,wx,wy){ // called from dealDamage — local player involved?
  if(p1===localP||p2===localP){
    MUS.lastCombat=performance.now();
    if(wx!==undefined){MUS.fx=wx;MUS.fy=wy;}   // the follow-fight camera reads this
  }
}
function musNode(){
  if(MUS.on!==null||!AC||!masterG)return;
  MUS.on=true;
  for(const k of ['peace','tension','battle']){
    const g=AC.createGain();g.gain.value=0;g.connect(masterG);
    MUS.gains[k]=g;
  }
}
function mTone(dst,f,dur,vol,type,cut){
  const t=AC.currentTime;
  const osc=AC.createOscillator();osc.type=type||'triangle';osc.frequency.value=f;
  const o2=AC.createOscillator();o2.type='sine';o2.frequency.value=f*1.006;
  const fl=AC.createBiquadFilter();fl.type='lowpass';fl.frequency.value=cut||1800;
  const g=AC.createGain();
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(vol,t+.02);
  g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  osc.connect(fl);o2.connect(fl);fl.connect(g);g.connect(dst);
  osc.start(t);o2.start(t);osc.stop(t+dur+.05);o2.stop(t+dur+.05);
}
function mThump(dst,f,dur,vol){
  const t=AC.currentTime;
  const o=AC.createOscillator();o.type='sine';
  o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(Math.max(30,f*.5),t+dur);
  const g=AC.createGain();
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(vol,t+.008);
  g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  o.connect(g);g.connect(dst);o.start(t);o.stop(t+dur+.05);
}
/* D dorian, two octaves — the mode of every campfire ballad */
const MUS_SCALE=[146.83,164.81,174.61,196,220,246.94,261.63,293.66,329.63,349.23,392,440];
let musStep=7; // melody random-walk position
function musTick(){
  if(!AC||!masterG||!G||G.paused||G.over||sndMuted||OPT.music===false){return;}
  musNode();
  if(!MUS.on)return;
  const now=performance.now();
  // ---- state (the enemy scan runs at most once a second — this is a per-frame call)
  const fighting=now-MUS.lastCombat<6000;
  let pressed=MUS.pressed||false;
  if(now-(MUS.scanT||0)>1000){MUS.scanT=now;pressed=false;
  if(!fighting&&G.t>60){ // enemies visible near home? once a second is plenty
    for(const u of G.units){
      if(allied(u.p,localP)||u.p===GAIA||u.hp<=0)continue;
      const d2=UNITS[u.type];if(u.type==='villager'||d2.fisher||d2.passive)continue;
      if(!tileVis(u.x,u.y))continue;
      for(const b of G.blds){if(b.p!==localP)continue;
        if(Math.hypot(u.x-b.tx,u.y-b.ty)<13){pressed=true;break;}}
      if(pressed)break;
    }
  }
  MUS.pressed=pressed;}
  MUS.mode=fighting?'battle':pressed?'tension':'peace';
  const want={peace:MUS.mode==='peace'?.05:.012,
              tension:MUS.mode==='tension'?.055:MUS.mode==='battle'?.03:0,
              battle:MUS.mode==='battle'?.065:0};
  for(const k in want)MUS.gains[k].gain.setTargetAtTime(want[k],AC.currentTime,2.2);
  // ---- one musical beat (~76bpm half-notes for peace, quarters for war)
  if(now<MUS.next)return;
  MUS.beat++;
  MUS.next=now+789;                       // 76bpm quarter note
  const B=MUS.beat;
  // peace: a lute note every other beat, wandering the mode; a pad every 8
  if(B%2===0){
    musStep=Math.max(0,Math.min(MUS_SCALE.length-1,
      musStep+(Math.random()<.5?-1:1)*(Math.random()<.25?2:1)));
    if(Math.random()<.8)mTone(MUS.gains.peace,MUS_SCALE[musStep],1.7,.5,'triangle',1500);
  }
  if(B%8===0){
    const root=MUS_SCALE[(B/8)%2?0:3];
    mTone(MUS.gains.peace,root/2,4.5,.30,'sine',700);
    mTone(MUS.gains.peace,root*1.5/2,4.5,.20,'sine',700);
  }
  // tension: a heartbeat pulse + a low drone
  if(B%2===0)mThump(MUS.gains.tension,72,.32,.8);
  if(B%16===0)mTone(MUS.gains.tension,73.4,8,.35,'sawtooth',300);
  // battle: driving drums, horn stabs every few bars
  mThump(MUS.gains.battle,64,.24,B%4===0?1:.55);
  if(B%4===2)mThump(MUS.gains.battle,180,.12,.4);
  if(MUS.mode==='battle'&&B%8===4&&Math.random()<.7){
    const hf=MUS_SCALE[[0,2,4][MUS.horn++%3]]*2;
    mTone(MUS.gains.battle,hf,.9,.5,'sawtooth',900);
    mTone(MUS.gains.battle,hf*1.5,.9,.3,'sawtooth',900);
  }
}
