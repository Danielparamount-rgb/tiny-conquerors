/* Four humans, Two-Teams mode, through the real lobby path and a LOCAL relay —
   the handoff's standing "nobody has played a 2v2 through it" gap.
   Asserts: teams built identically on every peer (seats 0+1 vs 2+3), allied()
   agrees, 600 lockstep turns with orders from ALL FOUR peers, and state +
   input hashes identical 4-way. Then one teammate drops mid-match and the
   three survivors agree on the AI-takeover world.
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
  setTimeout(() => rej(new Error('relay never started')), 8000);
});

const server = http.createServer((req, res) => {
  res.writeHead(200, {'content-type': 'text/html'});
  res.end('<!doctype html><html><head><meta charset="utf-8"></head><body>' + game + '</body></html>');
});
await new Promise(r => server.listen(0, 'localhost', r));
const port = server.address().port;

const browser = await puppeteer.launch({args: ['--no-sandbox']});
const names = ['Alice', 'Bob', 'Cara', 'Dan'];
const pages = [];
for (let i = 0; i < 4; i++) {
  const p = await browser.newPage();
  p.on('pageerror', e => console.log('PAGEERR', names[i], String(e).slice(0, 120)));
  await p.goto(`http://localhost:${port}/test.html`, {waitUntil: 'load'});
  await p.waitForFunction('typeof newGame === "function"', {timeout: 15000});
  pages.push(p);
}
const [A, B, C, D] = pages;

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};

const code = await A.evaluate((nm) => new Promise((res, rej) => {
  window.GAMEVER = 'tq-2v2';
  netName = nm;
  netConnect(() => { netSend({t: 'host', name: nm, v: gameVer()}); });
  const t0 = setInterval(() => { if (netRoom) { clearInterval(t0); res(netRoom); } }, 50);
  setTimeout(() => rej(new Error('host timeout')), 8000);
}), names[0]);

for (let i = 1; i < 4; i++) {
  const ok = await pages[i].evaluate((code, nm, civ) => new Promise((res, rej) => {
    window.GAMEVER = 'tq-2v2';
    netName = nm;
    netConnect(() => { netSend({t: 'join', code, name: nm, v: gameVer()}); netSend({t: 'seat', civ}); });
    const t0 = setInterval(() => { if (netRoom) { clearInterval(t0); res(true); } }, 50);
    setTimeout(() => rej(new Error('join timeout ' + nm)), 8000);
  }), code, names[i], i);
  check(`${names[i]} joined`, ok === true);
}

// host: Two teams (seats 0+1 vs 2+3), no AI fill
await A.evaluate(() => {
  netSend({t: 'cfg', cfg: {map: 0, diff: 1, turbo: 0, ai: 0, team: 1, rg: 0}});
  netSend({t: 'start', seed: 20260819});
});
for (const p of pages) await p.waitForFunction('netMode === true && G !== null', {timeout: 12000});

// teams + alliance shape, on every peer
const shapes = await Promise.all(pages.map(p => p.evaluate(() => ({
  teams: G.teams.slice(0, 4).join(','),
  a01: allied(0, 1), a23: allied(2, 3), a02: allied(0, 2), a13: allied(1, 3),
  np: NP, seat: localP,
}))));
check('teams identical on all four peers', new Set(shapes.map(s => s.teams)).size === 1, shapes[0].teams);
check('2v2 alliance shape (0+1 vs 2+3)',
  shapes.every(s => s.a01 && s.a23 && !s.a02 && !s.a13), JSON.stringify(shapes[0]));
check('each peer sits in its own seat', shapes.map(s => s.seat).join(',') === '0,1,2,3');

// pump to 600 with an order from EVERY peer along the way
const TARGET = 600;
const ordered = [false, false, false, false];
for (let round = 0; round < 500; round++) {
  const ts = await Promise.all(pages.map(p => p.evaluate(() => {
    let g = 0; while (g++ < 60 && netTurn < 600 && netRunTurn()); return netTurn;
  })));
  for (let i = 0; i < 4; i++) {
    if (!ordered[i] && ts[i] >= 100 + i * 60) {
      ordered[i] = true;
      await pages[i].evaluate((dx) => {
        const v = G.units.find(u => u.p === localP && u.type === 'villager');
        if (v) issue('move', {u: [v.id], x: v.x + dx, y: v.y + 2});
      }, (i % 2 ? -3 : 3));
    }
  }
  if (ts.every(t => t >= TARGET)) break;
  await new Promise(r => setTimeout(r, 15));
}
const mid = await Promise.all(pages.map(p => p.evaluate(() => ({
  t: netTurn, h: stateHash(), ih: (netInHash >>> 0).toString(16),
}))));
check('all four reached turn 600', mid.every(m => m.t >= TARGET), mid.map(m => m.t).join(','));
check('state hashes identical 4-way', new Set(mid.map(m => m.h)).size === 1, mid.map(m => m.h).join(','));
check('input hashes identical 4-way', new Set(mid.map(m => m.ih)).size === 1, mid.map(m => m.ih).join(','));
check('orders flowed from every seat', ordered.every(Boolean));

// teammate drop: Bob (seat 1) vanishes; survivors must agree past the takeover
await B.evaluate(() => { netSock.close(); });
await new Promise(r => setTimeout(r, 22000));   // relay ping sweep: 3 misses x 5s
const T2 = 1400;
for (let round = 0; round < 500; round++) {
  const ts = await Promise.all([A, C, D].map(p => p.evaluate((T2) => {
    let g = 0; while (g++ < 60 && netTurn < T2 && netRunTurn()); return netTurn;
  }, T2)));
  if (ts.every(t => t >= T2)) break;
  await new Promise(r => setTimeout(r, 15));
}
const end = await Promise.all([A, C, D].map(p => p.evaluate(() => ({
  t: netTurn, h: stateHash(), ih: (netInHash >>> 0).toString(16),
  aiHolds: !!G.ais[1], gone: netGone.has(1),
}))));
check('survivors reached turn 1400', end.every(m => m.t >= T2), end.map(m => m.t).join(','));
check('AI took the dropped teammate on all survivors', end.every(m => m.aiHolds && m.gone));
check('survivor state hashes identical past takeover', new Set(end.map(m => m.h)).size === 1, end.map(m => m.h).join(','));
check('survivor input hashes identical', new Set(end.map(m => m.ih)).size === 1);

await browser.close(); server.close(); relay.kill();
console.log(failed ? `\n${failed} check(s) FAILED` : '\n2v2 checks passed.');
process.exit(failed ? 1 : 0);
