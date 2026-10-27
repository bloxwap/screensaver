#!/usr/bin/env node
// Runs the TypeScript compiler for the current workspace package: tsrs (Rust port of the TypeScript 7
// compiler, byte-identical output) where its native binary resolves, else the regular `typescript`
// package (`tsc`) with the same arguments. tsrs ships binaries for macOS arm64 and Linux x64/arm64
// (glibc and musl) only, so Windows and Intel Mac use tsc automatically. Force tsc with TYPECHECK=tsc.
// Zero dependencies. Mirrors bloxwap/sfx's packages/sfx/scripts/tsc-or-tsrs.mjs: arguments pass
// through unchanged. Used by the root build and the apps/docs check.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(join(process.cwd(), 'package.json'));
const args = process.argv.slice(2);

function bin(pkg, name) {
  const manifest = require.resolve(`${pkg}/package.json`);
  const { bin } = require(manifest);
  return join(dirname(manifest), typeof bin === 'string' ? bin : bin[name]);
}

async function tsrsEntry() {
  const entry = bin('tsrs', 'tsrs');
  // tsrs's own resolver (platform package, glibc/musl detection, TSRS_BINARY) throws when this
  // platform has no binary installed.
  const { default: getExePath } = await import(pathToFileURL(join(dirname(entry), '..', 'lib', 'getExePath.js')).href);
  getExePath();
  return entry;
}

let tool = 'tsc';
let entry;
if (process.env.TYPECHECK === 'tsc') {
  console.warn('tsc-or-tsrs: TYPECHECK=tsc set; using tsc');
} else {
  try {
    entry = await tsrsEntry();
    tool = 'tsrs';
  } catch (error) {
    const reason = String(error?.message ?? error).split('\n')[0];
    console.warn(`tsc-or-tsrs: tsrs unavailable on ${process.platform}-${process.arch} (${reason}); using tsc`);
  }
}
entry ??= bin('typescript', 'tsc');
console.warn(`tsc-or-tsrs: ${tool} ${args.join(' ')}`.trimEnd());

const result = spawnSync(process.execPath, [entry, ...args], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
