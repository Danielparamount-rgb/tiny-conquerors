/* Determinism + smoke test for Tiny Conquerors.
 *
 * Runs headless Chrome over the repo's own files and asserts:
 *   1. The page boots with zero console errors.
 *   2. The four canonical determinism baselines still hash EXACTLY
 *      (multiplayer is lockstep — a one-tick divergence ends a real match).
 *   3. Each scenario re-run from the same seed reproduces the same hash
 *      (catches fresh nondeterminism even when a baseline legitimately moves).
 *   4. Save → load round-trips to the identical hash.
 *
 * If a baseline moves BECAUSE OF A DELIBERATE SIM CHANGE, update BASELINES
 * below in the same commit and say so in the commit message — that is the
 * whole audit trail. If it moves and you didn't mean it to, you have broken
 * the simulation: do not update the constant, fix the code.
 */
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Baselines as of tq-v73 (diffSel 1, civSel 0, turboSel 0, no mission).
// The tq-v28 hashes (cb7551c0/1df24e5e/c39be881/172444aa) survived every
// change from the wildlife pass until the DELIBERATE cross-engine math sweep
// (tq-v73): the sim now uses pinned-ops dSin/dCos/dAtan2/hyp/dPowi instead of
// the implementation-approximated Math.sin/cos/atan2/pow/hypot, so V8 and
// JavaScriptCore (iPhone) peers compute identical bits. Last-ulp differences
// cascaded into new — equally deterministic — baselines; m2-2p happened not
// to cross any discrete threshold and kept its old hash.
const BASELINES = [
  {name: 'm0-2p',       seed: 4242,  steps: 1500, map: 0, np: 2, team: 0, hash: '6825c2e'},
  {name: 'm1-2p',       seed: 4242,  steps: 1500, map: 1, np: 2, team: 0, hash: '6fdc60a7'},
  {name: 'm2-2p',       seed: 4242,  steps: 1500, map: 2, np: 2, team: 0, hash: 'c39be881'},
  {name: 'm1-8p-2team', seed: 31337, steps: 1500, map: 1, np: 8, team: 1, hash: '4f8eb0e0'},
];

const game = readFileSync(join(root, 'tiny-conquerors.html'), 'utf8');
const page404 = new Set(); // asset probes that legitimately 404 (sprites/models fall back)

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/test.html')) {
    res.writeHead(200, {'content-type': 'text/html'});
    res.end('<!doctype html><html><head><meta charset="utf-8"></head><body>' + game + '</body></html>');
    return;
  }
  // serve app/ assets if present so the sprite/model paths resolve like production
  try {
    const p = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, ''));
    const body = readFileSync(p);
    res.writeHead(200);
    res.end(body);
  } catch {
    page404.add(req.url);
    res.writeHead(404);
    res.end();
  }
});

await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await puppeteer.launch({args: ['--no-sandbox', '--disable-setuid-sandbox']});
const page = await browser.newPage();

const consoleErrors = [];
page.on('console', m => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
});
page.on('pageerror', e => consoleErrors.push(String(e)));

await page.goto(`http://localhost:${port}/test.html`, {waitUntil: 'load'});
await page.waitForFunction('typeof newGame === "function"', {timeout: 15000});

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};

for (const b of BASELINES) {
  const [h1, h2] = await page.evaluate((b) => {
    const run = () => {
      mapSel = b.map; playersSel = b.np; teamSel = b.team;
      diffSel = 1; civSel = 0; turboSel = 0; regicideSel = 0; mission = null;
      resetNet(); pendingSeed = b.seed; newGame();
      for (let i = 0; i < b.steps; i++) step(0.05);
      return stateHash();
    };
    return [run(), run()];
  }, b);
  check(`baseline ${b.name}`, h1 === b.hash, `expected ${b.hash}, got ${h1}`);
  check(`repeat   ${b.name}`, h1 === h2, `first ${h1}, second ${h2}`);
}

// save/load round-trip on a live 2p game
const sl = await page.evaluate(() => {
  mapSel = 0; playersSel = 2; teamSel = 0; diffSel = 1; civSel = 0;
  turboSel = 0; regicideSel = 0; mission = null;
  resetNet(); pendingSeed = 777; newGame();
  for (let i = 0; i < 1200; i++) step(0.05);
  const before = stateHash();
  if (!saveGame('tq_ci')) return {ok: false, why: 'save failed'};
  if (!loadGame('tq_ci')) return {ok: false, why: 'load failed'};
  localStorage.removeItem('tq_ci');
  const after = stateHash();
  return {ok: before === after, why: before + ' vs ' + after};
});
check('save/load round-trip', sl.ok, sl.why);

check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
server.close();

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
