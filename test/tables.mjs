/* Stock Market 1968 tables on the relay: host / join by code, revisioned state,
   stale detection, chat, presence, and re-seeding a table after a restart.
   Spawns relay/server.js on a spare port; needs relay/node_modules (npm install in relay/). */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, '..', 'relay', 'server.js');
let pass = 0, fail = 0;
const ck = (id, ok, detail) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + id + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
  ok ? pass++ : fail++;
};

function startRelay(port){
  const p = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((res, rej) => {
    p.stdout.on('data', d => { if (String(d).includes('listening')) res(p); });
    p.on('exit', c => rej(new Error('relay exited ' + c)));
    setTimeout(() => rej(new Error('relay did not start')), 8000);
  });
}

/* a tiny client: queue of received frames + typed waits */
function client(port){
  const ws = new WebSocket('ws://127.0.0.1:' + port);
  const inbox = [];
  const waiters = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    const w = waiters.findIndex(x => x.t === m.t);
    if (w >= 0){ const x = waiters.splice(w, 1)[0]; x.res(m); }
    else inbox.push(m);
  });
  const api = {
    ws,
    open: new Promise(r => ws.addEventListener('open', r)),
    send: o => ws.send(JSON.stringify(o)),
    take(t, ms = 3000){
      const i = inbox.findIndex(m => m.t === t);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((res, rej) => {
        const w = {t, res};
        waiters.push(w);
        setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0){ waiters.splice(k, 1); rej(new Error('timeout waiting for ' + t)); } }, ms);
      });
    },
    async none(t, ms = 500){
      try{ await api.take(t, ms); return false; }catch(e){ return true; }
    },
    close: () => ws.close(),
  };
  return api;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const PORT = 18080 + Math.floor(Math.random() * 1000);
  const relay = await startRelay(PORT);
  try{
    // T1: host a table, get a 4-letter code
    const a = client(PORT); await a.open;
    a.send({t:'tbHost', name:'Daniel', tok:'tokA'});
    const j1 = await a.take('tbJoined');
    ck('T1 host gets a code and an empty table', /^[A-Z0-9]{4}$/.test(j1.code) && j1.rev === 0 && j1.state === null && j1.members.length === 1, {code: j1.code, rev: j1.rev});
    const code = j1.code;

    // T2: join by code (lower-case, with a stray space) — presence reaches the host
    const b = client(PORT); await b.open;
    b.send({t:'tbJoin', code: ' ' + code.toLowerCase(), name:'Bernard', tok:'tokB'});
    const j2 = await b.take('tbJoined');
    const mem = await a.take('tbMembers');
    ck('T2 join by code; host sees two members online', j2.code === code && mem.members.length === 2 && mem.members.every(m => m.on), mem.members);

    // T3: no such table
    const c = client(PORT); await c.open;
    c.send({t:'tbJoin', code:'ZZZZ', name:'Nobody', tok:'tokC'});
    const e3 = await c.take('err');
    ck('T3 unknown code is refused with code nosuch', e3.code === 'nosuch' && e3.table === 'ZZZZ', e3);

    // T4: publish rev 1 — ack for the sender, state for the other
    a.send({t:'tbState', rev: 1, state: {phase:'lobby', seats:[{name:'Daniel', token:'tokA'}]}});
    const ack = await a.take('tbAck');
    const s4 = await b.take('tbState');
    ck('T4 revision 1 lands: ack + fan-out with the sender token', ack.rev === 1 && s4.rev === 1 && s4.by === 'tokA' && s4.state.phase === 'lobby', {ack, by: s4.by});

    // T5: a stale publish (rev 1 again) is rejected with the current state
    b.send({t:'tbState', rev: 1, state: {phase:'bogus'}});
    const st5 = await b.take('tbStale');
    const quiet = await a.none('tbState', 400);
    ck('T5 stale revision is bounced with the live state, nothing broadcast', st5.rev === 1 && st5.state.phase === 'lobby' && quiet, st5.rev);

    // T6: chat fans out to everyone (sender included) and is kept for late joiners
    b.send({t:'tbChat', n:'Bernard', c:'#2e5f8f', x:'  hello table  '});
    const c6a = await a.take('tbChat'), c6b = await b.take('tbChat');
    ck('T6 chat reaches both, trimmed, with colour and time', c6a.x === 'hello table' && c6b.x === 'hello table' && c6a.c === '#2e5f8f' && typeof c6a.tm === 'number', c6a);

    // T7: rejoining after a drop keeps the member and delivers the chat history + latest state
    b.close(); await wait(150);
    const mem7 = await a.take('tbMembers');
    const b2 = client(PORT); await b2.open;
    b2.send({t:'tbJoin', code, name:'Bernard', tok:'tokB'});
    const j7 = await b2.take('tbJoined');
    ck('T7 drop shows offline; rejoin brings rev, state and chat back', mem7.members.find(m => m.tok === 'tokB').on === false && j7.rev === 1 && j7.state.phase === 'lobby' && j7.chat.length === 1 && j7.members.length === 2, {rev: j7.rev, chat: j7.chat.length});

    // T8: notify is accepted silently when push is not configured; only members can be targeted
    b2.send({t:'tbState', rev: 2, state: {phase:'playing'}, notify: [{tok:'tokA', title:'Your throw', body:'Bernard finished'}]});
    const ack8 = await b2.take('tbAck');
    const s8 = await a.take('tbState');
    ck('T8 publish with notify still acks and fans out (push off)', ack8.rev === 2 && s8.rev === 2 && j1.push === false, {rev: ack8.rev, push: j1.push});

    // T9: push subscription is remembered (ok:false without VAPID keys)
    a.send({t:'tbPush', sub:{endpoint:'https://push.example/abc', keys:{p256dh:'x', auth:'y'}}});
    const p9 = await a.take('tbPushOk');
    ck('T9 push subscribe answers with the deployment’s push readiness', p9.ok === false, p9);

    // T10: state too large is refused
    b2.send({t:'tbState', rev: 3, state: {blob: 'x'.repeat(210 * 1024)}});
    const e10 = await b2.take('err', 4000).catch(() => null);
    ck('T10 oversized state is refused', !!e10 && (e10.code === 'big' || e10.msg === 'bad message'), e10 && e10.code);

    // T11: hosting with an EXISTING code just sits down (two re-seeders race)
    const d = client(PORT); await d.open;
    d.send({t:'tbHost', name:'Harriet', tok:'tokD', code, state:{phase:'stale'}, rev: 9});
    const j11 = await d.take('tbJoined');
    ck('T11 host with a live code joins it instead of replacing it', j11.code === code && j11.rev === 2 && j11.state.phase === 'playing', {rev: j11.rev});

    // T12: relay restart — the table is gone; the first phone back re-seeds under the same code
    relay.kill(); await wait(200);
    const PORT2 = PORT + 1;
    const relay2 = await startRelay(PORT2);
    try{
      const e = client(PORT2); await e.open;
      e.send({t:'tbJoin', code, name:'Daniel', tok:'tokA'});
      const e12 = await e.take('err');
      e.send({t:'tbHost', name:'Daniel', tok:'tokA', code, state:{phase:'playing', rev:'mine'}, rev: 2});
      const j12 = await e.take('tbJoined');
      const f = client(PORT2); await f.open;
      f.send({t:'tbJoin', code, name:'Bernard', tok:'tokB'});
      const j12b = await f.take('tbJoined');
      ck('T12 after a restart the table re-seeds under its old code with its last state', e12.code === 'nosuch' && j12.code === code && j12.rev === 2 && j12b.state.rev === 'mine', {code: j12.code, rev: j12.rev});
      e.close(); f.close();
    } finally { relay2.kill(); }
    a.close(); c.close(); d.close(); b2.close();
  } finally { try{ relay.kill(); }catch(e){} }

  console.log('\n' + pass + ' passed, ' + fail + ' failed.');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS FAIL:', e); process.exit(1); });
