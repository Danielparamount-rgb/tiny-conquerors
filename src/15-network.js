/* ===================== lockstep networking (steps 3-5) =====================
   Peers exchange COMMANDS, never state. Every machine runs the identical
   deterministic simulation, so if they agree on which commands happened on
   which turn they agree on everything.

   A turn is one 0.05s sim tick. Orders you give now are scheduled NET_LAG turns
   ahead; that gap is the budget for the round trip, and it is why the game does
   not stutter every time a packet is late. A turn may only execute once every
   peer's command list for it has arrived — so a peer that falls behind stalls
   everyone rather than quietly playing a different game.

   Every second each peer posts stateHash(); the relay shouts if two disagree.
   A desync is a bug, not a hiccup, so the match halts loudly instead of
   drifting for ten minutes. */
const NET_LAG=5;              // 250ms of scheduling slack — the FLOOR (AoE's classic sweet spot)
/* Adaptive scheduling horizon (the "1500 Archers" idea, adapted): the turn
   length is fixed at 50ms, so the knob is how many turns ahead THIS peer
   schedules its own orders. That is a purely local choice — the lockstep
   contract (a turn runs when every list has arrived) is untouched, so peers
   may run different horizons. A phone on a slow cell link raises its own
   horizon so its orders still arrive before the others need them, trading its
   OWN command latency for nobody stalling. Drifts one turn at a time on a
   jitter-weighted RTT (design for the tails, not the mean), never jumps. */
let netLagDyn=NET_LAG;        // [NET_LAG..12] turns (250..600ms)
let netRttAvg=-1,netRttMax=0,netPingSentAt=0,netPingLast=0,netLagSaid=false,netLagCalm=0;
function netLagTick(now){
  if(!netSock||netSock.readyState!==1||netReplaying)return;
  if(now-netPingLast<5000)return;
  netPingLast=now;netPingSentAt=performance.now();
  netSend({t:'ping'});
}
function netLagSample(rtt){
  netRttAvg=netRttAvg<0?rtt:netRttAvg*.7+rtt*.3;
  netRttMax=Math.max(netRttMax*.85,rtt);          // decaying peak ≈ the tail that matters
  const need=Math.min(12,Math.max(NET_LAG,Math.ceil((netRttMax+120)/50)));
  if(need>netLagDyn){netLagDyn++;netLagCalm=0;}    // one turn per 5s sample, never a jump
  else if(need<netLagDyn&&++netLagCalm>=3){netLagCalm=0;netLagDyn--;} // descend after 15s calm per step
  else if(need>=netLagDyn)netLagCalm=0;
  if(netLagDyn>=8&&!netLagSaid){netLagSaid=true;
    feed('Slow connection — your orders take a moment longer so nobody stalls');}
}
let netSock=null,netRoom='',netHost=false,netName='';
let netTurn=0;                // the next turn to execute
let netIn=new Map();          // turn -> {seat: cmds}
let netSent=-1;               // highest turn we have shipped commands for
let netStall=0,netStallSeat=-1,netStallSaid=false;
let netLobby={players:[],cfg:null,host:0};
let netPlayers=[];            // seat -> {seat,name,civ,team} for the running match
let netGone=new Set();        // seats that dropped — we stall on them forever otherwise
let netAiAt=new Map();        // seat -> the turn the computer takes their banner
let netHumanAt=new Map();     // seat -> the turn a returning player takes it back
let netSendFrom=0;            // first turn we answer for; null while an AI holds our seat
let netReplay=null;           // the catch-up in progress, if any
let netReplaying=false;       // suppresses the feed chatter while thousands of turns fly past
let netLeftName='';           // who dropped, for the message when the stall runs out
/* Rolling hash of every command list actually APPLIED, folded turn by turn.
   Shipped beside stateHash: if the input hashes diverge the network layer
   delivered different orders; if they match while the state hashes diverge the
   simulations computed differently. That split is the single most useful fact
   a desync report can carry. */
let netInHash=2166136261>>>0;
function netFoldCmds(arr){
  const s=JSON.stringify(arr);   // JSON round-trips key order + float text identically on every engine
  let h=netInHash;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
  netInHash=h>>>0;
}
let netPongAt=0,netProbeT=null,netRejoinT=null,netRejoinN=99; // 99 = no recovery in progress
function gameVer(){return (typeof window!=='undefined'&&window.GAMEVER)||'dev';}
function netUrl(){
  const h=location.hostname;
  if(h==='localhost'||h==='127.0.0.1')return 'ws://localhost:8080';
  return 'wss://tiny-conquerors-relay.onrender.com';
}
function netAvailable(){
  // The artifact sandbox blocks every outbound request, so there is nothing to
  // connect to there. Say so plainly rather than spinning on a dead socket.
  return location.protocol==='http:'||location.protocol==='https:';
}
function netSend(o){if(netSock&&netSock.readyState===1)netSock.send(JSON.stringify(o));}
function netClose(){
  if(netSock){try{netSock.onclose=null;netSock.close();}catch(e){}}
  netSock=null;
}
function netReset(){
  netClose();netRoom='';netHost=false;
  netTurn=0;netIn=new Map();netSent=-1;netStall=0;netStallSeat=-1;
  netLobby={players:[],cfg:null,host:0};netPlayers=[];
  netGone=new Set();netAiAt=new Map();netHumanAt=new Map();netLeftName='';
  netSendFrom=0;netReplay=null;netReplaying=false;
  netInHash=2166136261>>>0;
  clearTimeout(netProbeT);clearTimeout(netRejoinT);netRejoinT=null;netRejoinN=99;
  netLagDyn=NET_LAG;netRttAvg=-1;netRttMax=0;netPingSentAt=0;netPingLast=0;netLagSaid=false;netLagCalm=0;
  const ov=document.getElementById('netCatch');if(ov)ov.style.display='none';
}
function netConnect(then){
  if(!netAvailable()){mpStatus('Multiplayer needs the web app — open tiny-conquerors.onrender.com');return;}
  if(netSock&&netSock.readyState===1)return then&&then();
  mpStatus('Connecting…');
  let s;
  try{s=new WebSocket(netUrl());}catch(e){mpStatus('Could not reach the relay');return;}
  netSock=s;
  // Every handler ignores a socket that is no longer THE socket — the
  // auto-rejoin loop can have a stale connection attempt still dying in the
  // background, and its close must not null out its replacement.
  s.onopen=()=>{if(netSock!==s)return;mpStatus('');then&&then();};
  s.onerror=()=>{
    if(netSock!==s)return;
    // Two honest possibilities, and the player can't tell them apart from here:
    // the free relay is cold-starting, or this is the artifact preview, whose
    // sandbox blocks every outbound connection.
    mpStatus('Could not reach the relay. If this is the shared preview link, use the web app at tiny-conquerors.onrender.com — otherwise the relay is waking up, try again in half a minute.');
  };
  s.onclose=()=>{
    if(netSock!==s)return;
    netSock=null;
    if(!netMode)return mpStatus('Disconnected');
    if(netRejoinT)return;   // auto-rejoin already knocking — let it keep trying
    // If we were the last person in the room anyway, losing the relay costs us
    // nothing — carry on offline against the computers instead of stopping.
    if(netAlone())return netGoOffline('The relay is gone; the battle goes on against the computer');
    // Any mid-match connection loss now tries to REJOIN first (the same
    // journal-replay path a manual re-entry uses); the halt screen is the
    // fallback when the retries run dry, not the first response.
    netRecover();
  };
  s.onmessage=e=>{
    if(netSock!==s)return;
    let m;try{m=JSON.parse(e.data);}catch(err){return;}
    netOn(m);
  };
}
function netOn(m){
  switch(m.t){
    case 'joined':
      netRoom=m.code;netHost=m.host;localP=m.seat;
      mpShowRoom();break;
    case 'lobby':
      netLobby=m;netHost=(m.host===localP);mpRenderLobby();break;
    case 'left':
      netGone.add(m.seat);
      mpStatus(m.name+' left the room');
      if(netMode&&netPlayers.some(p=>p.seat===m.seat))netLeftName=m.name;
      break;
    case 'ai':
      // the relay has named the turn; every peer flips this seat on it
      netGone.add(m.seat);
      netAiAt.set(m.seat,m.turn);
      break;
    case 'human':
      netHumanAt.set(m.seat,m.turn);
      if(m.seat===localP){
        // Start answering for our seat from that turn — and start NOW, not when
        // we reach it, or the others would arrive at the changeover turn with
        // nothing from us and stall.
        netSendFrom=m.turn;netTopUp();
      }
      break;
    case 'back':
      if(netMode)feed(m.name+' is rejoining — catching up');
      break;
    case 'rejoin':
      netRejoin(m);break;
    case 'err':
      mpStatus(m.msg);break;
    case 'chat':
      if(G)feed(m.name+': '+m.msg);break;
    case 'start':
      netBegin(m);break;
    case 'cmds':{
      let bag=netIn.get(m.turn);
      if(!bag){bag={};netIn.set(m.turn,bag);}
      bag[m.seat]=m.cmds;
      break;}
    case 'pong':
      netPongAt=performance.now();
      if(netPingSentAt){netLagSample(netPongAt-netPingSentAt);netPingSentAt=0;}
      break;
    case 'desync':{
      /* The hash wire format is "<state>.<inputs>" — split it and say WHICH
         side disagreed. Inputs differing = the network layer delivered
         different orders; states differing on identical inputs = the
         simulations computed differently (device math, sim bug). */
      let why='This is a bug in the game, not your connection. Nothing you did caused it.';
      try{
        const hs=Object.values(m.hashes||{}).map(s=>String(s).split('.'));
        if(hs.length>1&&hs.every(x=>x.length===2)){
          const st=new Set(hs.map(x=>x[0])),inp=new Set(hs.map(x=>x[1]));
          if(inp.size>1)why='The players did not receive the same orders — a network-layer bug, not your connection.';
          else if(st.size>1)why='The players received identical orders but computed different worlds — a simulation bug (possibly device math). Please report which phones were playing.';
        }
      }catch(e){}
      netHalt('The battle has drifted apart',
        'Turn '+m.turn+' — the players stopped agreeing on the state of the world.',why);
      break;}
  }
}
/* ---- starting a match from a lobby ---- */
function netBegin(m){
  const players=m.players||[];
  netPlayers=players;
  humanSlots=players.map(p=>p.seat);
  const cfg=m.cfg||{};
  const ai=Math.max(0,Math.min(8-players.length,cfg.ai|0));
  NP=players.length+ai;
  playersSel=NP;
  mapSel=cfg.map|0;diffSel=cfg.diff==null?1:cfg.diff|0;turboSel=cfg.turbo|0;
  teamSel=cfg.team|0;regicideSel=cfg.rg|0;   // the lobby decides the mode — BOTH appliers must read it
  // Civs, teams and handicaps come from the lobby, not from this machine's
  // start screen, so every peer builds the same players.
  netCivs=[];netTeams=null;netHcaps=[];
  for(const p of players){netCivs[p.seat]=p.civ;netHcaps[p.seat]=(p.hc||100)/100;}
  civSel=netCivs[localP]!=null?netCivs[localP]:0;
  if((cfg.team|0)===1){
    netTeams=[];
    const half=Math.ceil(NP/2);
    for(let q=0;q<NP;q++)netTeams[q]=q<half?0:1;
  }else if((cfg.team|0)===2){ // Co-op vs AI: every human on one side, the computers on the other
    netTeams=[];
    for(let q=0;q<NP;q++)netTeams[q]=humanSlots.includes(q)?0:1;
  }
  mission=null;
  netMode=true;
  try{dailyRun=null;}catch(e){}   // a lockstep match is never the daily
  netTurn=0;netIn=new Map();netSent=-1;netStall=0;
  netSendFrom=0;netHumanAt=new Map();
  netInHash=2166136261>>>0;
  clearTimeout(netRejoinT);netRejoinT=null;netRejoinN=99;
  netLagDyn=NET_LAG;netRttAvg=-1;netRttMax=0;netPingSentAt=0;netPingLast=0;netLagSaid=false;netLagCalm=0;
  cmdQ=[];
  pendingSeed=m.seed>>>0;
  document.getElementById('mpOverlay').style.display='none';
  document.getElementById('startOverlay').style.display='none';
  initAudio();if(AC&&AC.state==='suspended')AC.resume();
  begin();
  netTopUp();      // open the command window before the first turn runs
  const names=players.map(p=>p.name).join(', ');
  toast('Battle begun — '+names+(ai?' and '+ai+' computer opponent'+(ai>1?'s':''):''));
  feed('Multiplayer battle begun');
}
/* ---- rejoining a battle already in progress ----
   No state is shipped. The relay hands over the command journal and we replay
   the match from turn 0, which is the same determinism everything else rests
   on. (Shipping a saved game instead does NOT work: it reloads to an identical
   hash and then diverges the moment it is stepped, because saving drops unit
   paths and reloading rewinds the simulation RNG.) Replay runs a few hundred
   times faster than real time, so a long absence costs a few seconds. */
function netRejoin(m){
  const players=m.players||[];
  const cfg=m.cfg||{};
  netPlayers=players;
  const ai=Math.max(0,Math.min(8-players.length,cfg.ai|0));
  NP=players.length+ai;playersSel=NP;
  mapSel=cfg.map|0;diffSel=cfg.diff==null?1:cfg.diff|0;
  turboSel=cfg.turbo|0;teamSel=cfg.team|0;regicideSel=cfg.rg|0;
  netCivs=[];netHcaps=[];
  for(const p of players){netCivs[p.seat]=p.civ;netHcaps[p.seat]=(p.hc||100)/100;}
  localP=m.seat;
  civSel=netCivs[localP]!=null?netCivs[localP]:0;
  humanSlots=players.map(p=>p.seat);   // as the match STARTED; the journal edits it from there
  netTeams=null;
  if((cfg.team|0)===1){
    netTeams=[];const half=Math.ceil(NP/2);
    for(let q=0;q<NP;q++)netTeams[q]=q<half?0:1;
  }else if((cfg.team|0)===2){ // Co-op vs AI — same rule as the start applier
    netTeams=[];
    for(let q=0;q<NP;q++)netTeams[q]=humanSlots.includes(q)?0:1;
  }
  mission=null;netMode=true;
  try{dailyRun=null;}catch(e){}   // a lockstep match is never the daily
  netTurn=0;netIn=new Map();netSent=-1;netStall=0;netStallSeat=-1;
  netInHash=2166136261>>>0;                 // the replay re-folds the same stream
  clearTimeout(netRejoinT);netRejoinT=null;netRejoinN=99;  // recovery succeeded — stop knocking
  netLagDyn=NET_LAG;netRttAvg=-1;netRttMax=0;netPingSentAt=0;netPingLast=0;netLagSaid=false;netLagCalm=0;
  // Deliberately NOT seeded from the relay's current aiSeats: the journal's own
  // handovers rebuild this, and a seat that left, came back and left again would
  // otherwise end up mislabelled.
  netGone=new Set();
  netAiAt=new Map();netHumanAt=new Map();
  netSendFrom=null;                    // a spectator until the relay hands the seat back
  cmdQ=[];
  pendingSeed=m.seed>>>0;
  document.getElementById('mpOverlay').style.display='none';
  document.getElementById('startOverlay').style.display='none';
  initAudio();if(AC&&AC.state==='suspended')AC.resume();
  begin();
  /* Sort the journal into "replay this" and "this belongs to the live stream".
     The cut is the highest turn EVERY present seat has already sent for, so the
     journal is complete through it — inclusive. Everything above is the live
     stream's job, with one exception handled just below. */
  const cut=Math.max(0,m.cut|0);
  const cmds=new Map(),ev=new Map();
  for(const e of (m.journal||[])){
    if(e.cmds){
      if(e.turn<=cut){let b=cmds.get(e.turn);if(!b){b={};cmds.set(e.turn,b);}b[e.seat]=e.cmds;}
      else netStore(e.seat,e.turn,e.cmds);   // hand the tail straight to the live buffer
    }else{
      if(e.turn<=cut){let a=ev.get(e.turn);if(!a){a=[];ev.set(e.turn,a);}a.push(e);}
      else if(e.ai!==undefined)netAiAt.set(e.ai,e.turn);
      else if(e.hu!==undefined)netHumanAt.set(e.hu,e.turn);
    }
  }
  /* The exception: a seat that had run ahead of the cut already sent those turns
     before we connected, so they will never be broadcast to us — and the empty
     ones were never journalled at all. Without this the first such turn stalls
     the rejoin forever, waiting on a message nobody is going to send. */
  const upTo=m.sentUpTo||{};
  for(const p of netPlayers){
    const hi=upTo[p.seat];
    if(hi===undefined)continue;
    for(let t=cut+1;t<=hi;t++){
      const bag=netIn.get(t);
      if(!bag||bag[p.seat]===undefined)netStore(p.seat,t,[]);
    }
  }
  netReplay={cmds,ev,cut,target:m.turn|0,t0:performance.now()};
  netReplaying=true;
  document.getElementById('netCatch').style.display='flex';
  netCatchProgress(0);
  netCatchUp();
}
function netCatchProgress(frac){
  const el=document.getElementById('netCatchBar');
  if(el)el.style.width=Math.round(Math.max(0,Math.min(1,frac))*100)+'%';
  const t=document.getElementById('netCatchTxt');
  if(t&&netReplay)t.textContent='Turn '+netTurn+' of '+netReplay.cut
    +' · '+Math.round(G?G.t/60:0)+' minutes of battle so far';
}
function netCatchUp(){
  if(!netReplay)return;
  const R=netReplay,t0=performance.now();
  // time-sliced so the page keeps painting and the socket keeps draining
  while(netTurn<=R.cut&&performance.now()-t0<24){
    const evs=R.ev.get(netTurn);
    if(evs)for(let s=0;s<NP;s++)for(const e of evs){
      if(e.ai===s)netSeatToAI(s);
      if(e.hu===s)netSeatToHuman(s);
    }
    const bag=R.cmds.get(netTurn);
    const arr=[];
    for(const p of netPlayers)arr[p.seat]=(bag&&bag[p.seat])||[];
    netFoldCmds(arr);
    applyTick(arr);
    step(.05);
    netTurn++;
  }
  netCatchProgress(R.cut?netTurn/(R.cut+1):1);
  if(netTurn<=R.cut){setTimeout(netCatchUp,0);return;}
  // The journal is spent; whatever arrived live while we were replaying is next.
  let guard=0;
  while(guard++<20000&&netRunTurn());
  netReplaying=false;netReplay=null;
  document.getElementById('netCatch').style.display='none';
  const secs=((performance.now()-R.t0)/1000).toFixed(1);
  feed('Caught up in '+secs+'s — asking for your banner back');
  netSend({t:'resume'});
}
/* ---- the turn machinery ---- */
function netSeatCmds(turn){
  const bag=netIn.get(turn);
  const arr=[];
  for(const p of netPlayers){
    if(bag&&bag[p.seat]){arr[p.seat]=bag[p.seat];continue;}
    // A seat the relay has declared gone will never speak again, and WebSocket
    // delivery is ordered: everything it DID send reached us before the notice
    // that it left. So every peer fills the same blanks with the same nothing,
    // and none of them has to guess.
    if(netGone.has(p.seat)){arr[p.seat]=[];continue;}
    // Same guarantee, turn-scoped, for a REJOINER: a seat with an AI-takeover
    // scheduled on a FUTURE turn is a seat that dropped — everything it ever
    // sent is already in the journal/live buffer, so a missing list before the
    // flip is genuinely empty. Live peers cover this window via netGone; a
    // rejoiner's netGone was reset and only refills when the replay reaches the
    // flip turn, which left the rejoiner deadlocked on its OWN seat's silent
    // gap (last-sent-turn .. takeover-turn). Real lists always win (checked
    // above), so this can never overwrite anything.
    const flip=netAiAt.get(p.seat);
    if(flip!==undefined&&flip>turn){arr[p.seat]=[];continue;}
    return null;                // still genuinely waiting on a live player
  }
  return arr;
}
function netWaitingOn(turn){
  const bag=netIn.get(turn)||{};
  for(const p of netPlayers){
    if(bag[p.seat]||netGone.has(p.seat))continue;
    const flip=netAiAt.get(p.seat);
    if(flip!==undefined&&flip>turn)continue;   // silent-by-construction (see netSeatCmds)
    return p;
  }
  return null;
}
/* The computer picks up a dropped player's banner. This runs on an agreed turn
   on every machine, so the AI's first decision is the same everywhere. */
function netSeatToAI(seat){
  if(!G||G.ais[seat])return;
  G.ais[seat]={wave:0,nextAtk:G.t+90,tick:.1*seat,attacking:false};
  humanSlots=humanSlots.filter(s=>s!==seat);
  // Keeping netGone in step here is what lets a REPLAY rebuild it: the live path
  // adds a seat the moment the 'left' notice arrives (which is what covers the
  // gap before the takeover turn), but a replay sees only journal handovers.
  netGone.add(seat);
  if(netReplaying)return;      // replaying history — don't narrate it
  const who=netSeatName(seat);
  feed(who+' has left — the computer takes their banner',true);
  if(allied(seat,localP))toast(who+' left; the computer fights on for them');
  refreshPanel();
}
/* The other direction: a player who dropped has caught up and wants the reins
   back. Same discipline as the handover — an agreed turn, applied everywhere. */
function netSeatToHuman(seat){
  if(!G||!G.ais[seat])return;  // already somebody's
  G.ais[seat]=null;
  if(!humanSlots.includes(seat))humanSlots.push(seat);
  netGone.delete(seat);
  if(netReplaying)return;
  const who=netSeatName(seat);
  feed(who+' has returned to the field');
  if(seat===localP)toast('You have your banner back');
  refreshPanel();
}
function netSeatName(seat){
  return (netPlayers.find(p=>p.seat===seat)||{}).name||('Player '+(seat+1));
}
// Are we the only person still here? Then the relay has nothing left to relay.
function netAlone(){
  for(const p of netPlayers)if(p.seat!==localP&&!netGone.has(p.seat))return false;
  return true;
}
function netGoOffline(reason){
  if(!netMode)return;
  // Apply anything we had already ordered but not yet reached, so the last
  // quarter-second of the player's intent isn't silently thrown away.
  const mine=[];
  for(const [turn,bag] of netIn)if(turn>=netTurn&&bag[localP])mine.push([turn,bag[localP]]);
  netMode=false;netClose();
  for(let t=netTurn;mine.length&&t<netTurn+netLagDyn+2;t++){
    const hit=mine.find(x=>x[0]===t);
    if(hit)for(const c of hit[1])applyCmd(c);
  }
  netIn=new Map();
  // Going offline usually beats the relay's handover turn — netRunTurn will
  // never come round again to honour it. Nobody is left to disagree with, so
  // every abandoned seat takes its AI now; otherwise they sit there as dead
  // towns that never lift a finger.
  for(let s=0;s<NP;s++)if(s!==localP&&netGone.has(s))netSeatToAI(s);
  if(reason)feed(reason);
}
function netStore(seat,turn,cmds){
  let bag=netIn.get(turn);
  if(!bag){bag={};netIn.set(turn,bag);}
  bag[seat]=cmds;
}
function netTopUp(){
  // keep the outbound window full: every turn up to netTurn+netLagDyn has been
  // told what we intend to do, even if the answer is "nothing".
  // netSendFrom is the first turn this machine ANSWERS FOR. While the computer
  // holds our seat it is null and we say nothing at all — sending then would
  // race the other peers, some using our list and some the empty one the seat's
  // absence implies.
  if(netSendFrom===null)return;
  if(netSent<netSendFrom-1)netSent=netSendFrom-1;
  const end=Math.max(netTurn,netSendFrom)+netLagDyn;
  while(netSent<end){
    const turn=netSent+1;
    const cmds=takeCmds();
    netStore(localP,turn,cmds);
    netSend({t:'cmds',turn,cmds});
    netSent=turn;
  }
}
function netStepReady(){return !!netSeatCmds(netTurn);}
function netRunTurn(){
  // Handovers resolve BEFORE we work out whose orders this turn even needs —
  // they change the answer. Doing it the other way round let one peer use a
  // returning player's list for the changeover turn while another, not yet
  // holding that message, used the empty one their absence implied.
  // Walked in seat order rather than Map order for the same reason.
  for(let s=0;s<NP;s++){
    if(netAiAt.get(s)===netTurn)netSeatToAI(s);
    if(netHumanAt.get(s)===netTurn)netSeatToHuman(s);
  }
  const arr=netSeatCmds(netTurn);
  if(!arr)return false;
  netFoldCmds(arr);   // BEFORE applyTick — apply stamps c.p onto the objects
  applyTick(arr);
  netIn.delete(netTurn);
  step(.05);
  netTurn++;
  netTopUp();
  // "<state>.<inputs>" — the relay compares the whole string, so it catches
  // either half diverging with zero relay changes; the desync handler splits
  // it back apart to say which half it was.
  if(netTurn%20===0)netSend({t:'hash',turn:netTurn,h:stateHash()+'.'+netInHash.toString(16)});
  // Being the last one left is NOT a reason to hang up. An earlier version did
  // drop to offline here, which quietly made reconnect impossible in a two
  // player game — the very case where someone's phone dropping matters most.
  // Staying in the room costs nothing (the lockstep loop trivially satisfies
  // itself) and keeps the door open for them to come back.
  return true;
}
function netHalt(title,sub,body){
  netMode=false;netClose();
  clearTimeout(netProbeT);clearTimeout(netRejoinT);netRejoinT=null;netRejoinN=99;
  if(G)G.paused=true;
  document.getElementById('netHaltTitle').textContent=title;
  document.getElementById('netHaltSub').textContent=sub||'';
  document.getElementById('netHaltBody').textContent=body||'';
  document.getElementById('netHalt').style.display='flex';
}
/* ---- foreground recovery (phones) ----
   iOS kills a backgrounded page's WebSocket without firing close — the object
   still reports readyState 1 while send() goes nowhere (a zombie). So on every
   return to the foreground the wire is VERIFIED with a ping; no pong in 2.5s
   means dead, and dead means rejoin — the same relay journal-replay path a
   manual re-entry uses, automated. */
function netForeground(){
  if(!netMode||netReplaying||netRejoinT)return;
  if(!netSock||netSock.readyState!==1)return netRecover();
  const sent=performance.now();
  netSend({t:'ping'});
  clearTimeout(netProbeT);
  netProbeT=setTimeout(()=>{if(netMode&&!netReplaying&&netPongAt<sent)netRecover();},2500);
}
function netRecover(){
  if(!netMode)return;
  netClose();
  if(netAlone())return netGoOffline('Connection lost — the battle goes on against the computer');
  toast('Connection lost — reconnecting…');
  netRejoinN=0;
  netAutoRejoin();
}
/* The relay frees our seat only when its ping sweep notices the dead socket
   (~15-20s), so early knocks get "every seat is taken" — keep knocking.
   Success arrives as a 'rejoin' message, which routes into netRejoin() and
   clears the retry timer there. */
function netAutoRejoin(){
  if(!netMode||!netRoom||netRejoinN>20){                    // ~80s of trying
    if(netMode&&netRoom){clearTimeout(netRejoinT);netRejoinT=null;
      netHalt('Connection lost','Could not reach the battle again.',
        'The relay stopped answering for over a minute. If the others are still fighting, rejoin with the room code '+netRoom+'.');}
    return;
  }
  netRejoinN++;
  netConnect(()=>{netSend({t:'join',code:netRoom,
    name:netName||localStorage.getItem('tq_name')||'Player',v:gameVer()});});
  clearTimeout(netRejoinT);
  netRejoinT=setTimeout(()=>{if(netMode&&!netReplaying)netAutoRejoin();},4000);
}
function dropoffFor(u){let best=null,bd=1e9;
  const fisher=UNITS[u.type].fisher;
  for(const b of G.blds)if(b.p===u.p&&b.built&&BLDS[b.type].drop){
    if(fisher&&b.type!=='dock')continue; // fishing ships land their catch at the Dock
    const c=bldCenter(b),d=hyp(c.x-u.x,c.y-u.y);if(d<bd){bd=d;best=b;}}
  return best;}
function nearestRes(u,type){let best=null,bd=1e9;
  for(const k in G.res){const r=G.res[k];if(r.type!==type)continue;
    const d=hyp(r.x+.5-u.x,r.y+.5-u.y);if(d<bd){bd=d;best=k;}}
  return bd<15?best:null;}
function freeFarm(u){let best=null,bd=1e9;
  for(const b of G.blds){if(b.p!==u.p||b.type!=='farm'||!b.built)continue;
    const occ=G.units.find(o=>o.farm===b.id&&o.id!==u.id&&o.hp>0);if(occ)continue;
    const c=bldCenter(b),d=hyp(c.x-u.x,c.y-u.y);if(d<bd){bd=d;best=b;}}
  return best;}

