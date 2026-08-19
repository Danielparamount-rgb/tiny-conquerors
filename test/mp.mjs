/* Two-peer lockstep smoke test over a LOCAL relay (npm run test:mp).
   Needs port 8080 free — kill a stale relay first:
   Get-NetTCPConnection -LocalPort 8080 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }
   1. Version gate: mismatched build versions are refused at join.
   2. Matched versions play 600 lockstep turns with live commands crossing the
      wire; state hash AND input-stream hash identical on both peers.
*/
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer';

const root = 'C:/Users/deove/.claude/tiny-conquerors';
const game = readFileSync(root + '/tiny-conquerors.html', 'utf8');

const relay = spawn(process.execPath, ['server.js'], {cwd: root + '/relay'});
await new Promise((res, rej) => {
  relay.stdout.on('data', d => { if (String(d).includes('listening')) res(); });
  relay.on('exit', c => rej(new Error('relay exited ' + c)));
  setTimeout(() => rej(new Error('relay never started (port 8080 busy?)')), 8000);
});

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/test.html')) {
    res.writeHead(200, {'content-type': 'text/html'});
    res.end('<!doctype html><html><head><meta charset="utf-8"></head><body>' + game + '</body></html>');
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, 'localhost', r));
const port = server.address().port;

const browser = await puppeteer.launch({args: ['--no-sandbox']});
const A = await browser.newPage(), B = await browser.newPage();
const errs = {A: [], B: []};
for (const [name, p] of [['A', A], ['B', B]]) {
  p.on('pageerror', e => errs[name].push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs[name].push(m.text()); });
  await p.goto(`http://localhost:${port}/test.html`, {waitUntil: 'load'});
  await p.waitForFunction('typeof newGame === "function"', {timeout: 15000});
}

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};

// --- host on A ---
const code = await A.evaluate(() => new Promise((res, rej) => {
  window.GAMEVER = 'tq-test-A';
  netName = 'Alice';
  netConnect(() => { netSend({t: 'host', name: 'Alice', v: gameVer()}); });
  const t0 = setInterval(() => { if (netRoom) { clearInterval(t0); res(netRoom); } }, 50);
  setTimeout(() => rej(new Error('host timeout')), 8000);
}));
check('host got a room code', /^[A-Z2-9]{4}$/.test(code), code);

// --- version gate: B joins with a DIFFERENT version ---
const gateMsg = await B.evaluate((code) => new Promise((res) => {
  window.GAMEVER = 'tq-test-B';
  netName = 'Bob';
  const orig = window.mpStatus;
  window.mpStatus = s => { window.__lastStatus = s; orig(s); };
  netConnect(() => { netSend({t: 'join', code, name: 'Bob', v: gameVer()}); });
  setTimeout(() => res(window.__lastStatus || ''), 2000);
}), code);
check('version gate refuses mismatched build', /Different game versions/.test(gateMsg), gateMsg.slice(0, 80));

// --- matched version joins ---
const joined = await B.evaluate((code) => new Promise((res, rej) => {
  window.GAMEVER = 'tq-test-A';
  netReset(); resetNet(); netName = 'Bob';
  netConnect(() => { netSend({t: 'join', code, name: 'Bob', v: gameVer()}); });
  const t0 = setInterval(() => { if (netRoom) { clearInterval(t0); res(true); } }, 50);
  setTimeout(() => rej(new Error('join timeout')), 8000);
}), code);
check('matched build joins', joined === true);

// --- B declares a +50% handicap (the evener) — it must reach BOTH sims ---
await B.evaluate(() => netSend({t: 'seat', hc: 150}));
await new Promise(r => setTimeout(r, 300));

// --- start the match from A ---
await A.evaluate(() => {
  netSend({t: 'cfg', cfg: {map: 0, diff: 1, turbo: 0, ai: 0, team: 0, rg: 0}});
  netSend({t: 'start', seed: 424242});
});
try {
  for (const p of [A, B]) await p.waitForFunction('netMode === true && G !== null', {timeout: 10000});
} catch (e) {
  for (const [name, p] of [['A', A], ['B', B]]) {
    const st = await p.evaluate(() => ({
      netMode, hasG: !!G, room: netRoom, seat: localP, sock: netSock ? netSock.readyState : -1,
      status: (document.getElementById('mpStatus') || {}).textContent,
    }));
    console.log('DIAG', name, JSON.stringify(st), 'errors:', errs[name].slice(0, 4).join(' | '));
  }
  await browser.close(); server.close(); relay.kill();
  process.exit(1);
}

// --- pump 600 turns on both, injecting real commands on each peer mid-run ---
const TARGET = 600;
let ordered = {A: false, B: false};
for (let round = 0; round < 400; round++) {
  const [ta, tb] = await Promise.all([A, B].map(p => p.evaluate((TARGET) => {
    let g = 0;
    while (g++ < 60 && netTurn < TARGET && netRunTurn());
    return netTurn;
  }, TARGET)));
  if (ta >= 120 && !ordered.A) {
    ordered.A = true;
    await A.evaluate(() => {
      const v = G.units.find(u => u.p === localP && u.type === 'villager');
      if (v) issue('move', {u: [v.id], x: v.x + 3, y: v.y + 3});
    });
  }
  if (tb >= 200 && !ordered.B) {
    ordered.B = true;
    await B.evaluate(() => {
      const v = G.units.find(u => u.p === localP && u.type === 'villager');
      if (v) issue('move', {u: [v.id], x: v.x - 3, y: v.y + 2});
    });
  }
  if (ta >= TARGET && tb >= TARGET) break;
  await new Promise(r => setTimeout(r, 15));
}

const [ra, rb] = await Promise.all([A, B].map(p => p.evaluate(() => ({
  t: netTurn, h: stateHash(), ih: (netInHash >>> 0).toString(16),
  hc0: G.P[0].hcap || 1, hc1: G.P[1].hcap || 1,
  halted: document.getElementById('netHalt').style.display === 'flex',
}))));
check('both peers reached the target turn', ra.t >= TARGET && rb.t >= TARGET, `A ${ra.t} B ${rb.t}`);
check('state hashes identical', ra.h === rb.h, `A ${ra.h} B ${rb.h}`);
check('input-stream hashes identical', ra.ih === rb.ih, `A ${ra.ih} B ${rb.ih}`);
check('handicap applied identically on both peers',
  ra.hc0 === 1 && ra.hc1 === 1.5 && rb.hc0 === 1 && rb.hc1 === 1.5,
  `A ${ra.hc0}/${ra.hc1} B ${rb.hc0}/${rb.hc1}`);
check('commands actually crossed the wire', ordered.A && ordered.B && ra.ih !== '80000000');
check('no desync halt fired', !ra.halted && !rb.halted);

await browser.close(); server.close(); relay.kill();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nMP checks passed.');
process.exit(failed ? 1 : 0);
