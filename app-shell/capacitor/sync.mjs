#!/usr/bin/env node
// Copies the deployable game (app/market, resolved relative to this file) into ./www so
// Capacitor bundles it. Run with `npm run sync`. www/ is wiped and recreated each time.
// Node built-ins only.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', '..', 'app', 'market');
const dest = resolve(here, 'www');

function fail(msg) {
  console.error(`sync: ${msg}`);
  process.exit(1);
}

if (!existsSync(src) || !statSync(src).isDirectory()) {
  fail(`source folder not found: ${src}\n      expected the game at app/market, two levels above app-shell/capacitor/`);
}
if (!existsSync(join(src, 'index.html'))) {
  fail(`${src} has no index.html — is this the right checkout?`);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

let files = 0;
let bytes = 0;

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const s = join(from, entry.name);
    const d = join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
      continue;
    }
    if (!entry.isFile()) continue;
    copyFileSync(s, d);
    const size = statSync(d).size;
    files += 1;
    bytes += size;
    console.log(`  ${relative(src, s).padEnd(28)} ${size.toLocaleString('en-US').padStart(10)} bytes`);
  }
}

console.log(`sync: ${src}`);
console.log(`   -> ${dest}`);
copyDir(src, dest);
if (files === 0) fail('nothing was copied');
console.log(`sync: copied ${files} file${files === 1 ? '' : 's'}, ${bytes.toLocaleString('en-US')} bytes`);
