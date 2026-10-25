import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signingEnvironment, signingPreflight, parseSigningArgs } from './signing-preflight.mjs';
import { assertAuthenticodeSignature, assertDeveloperIdSignature, sha256File, verifySigning } from './verify-signing.mjs';

const macCredentials = { CSC_LINK: 'certificate-secret', CSC_KEY_PASSWORD: 'password-secret', APPLE_ID: 'account-secret', APPLE_APP_SPECIFIC_PASSWORD: 'notary-secret', APPLE_TEAM_ID: 'ABCDEFGHIJ' };
const developerId = 'Authority=Developer ID Application: Bloxwap\nTeamIdentifier=ABCDEFGHIJ\nCodeDirectory v=20500 size=100 flags=0x10000(runtime)';

test('preview and Linux preflight work without signing credentials', () => {
  for (const platform of ['macos', 'windows', 'linux']) assert.equal(signingPreflight({ platform, channel: 'preview', env: {} }).signingRequired, false);
  assert.equal(signingPreflight({ platform: 'linux', channel: 'stable', env: {} }).signingRequired, false);
  assert.throws(() => signingPreflight({ platform: 'macos', channel: 'production', env: {} }), /preview or stable/);
});

test('stable Mac preflight rejects incomplete credential sets without revealing their values', () => {
  assert.equal(signingPreflight({ platform: 'darwin', channel: 'stable', env: macCredentials }).signingRequired, true);
  assert.throws(() => signingPreflight({ platform: 'macos', channel: 'stable', env: { ...macCredentials, APPLE_TEAM_ID: '' } }), /Missing APPLE_TEAM_ID/);
  assert.throws(() => signingPreflight({ platform: 'macos', channel: 'stable', env: { ...macCredentials, CSC_LINK: '' } }), (error) => !error.message.includes('password-secret') && error.message.includes('CSC_LINK'));
  assert.throws(() => signingPreflight({ platform: 'macos', channel: 'stable', env: { ...macCredentials, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } }), /must not be false/);
});

test('Mac notarization precedence matches the installed builder', () => {
  const env = { CSC_LINK: 'cert', CSC_KEY_PASSWORD: 'pass', APPLE_API_KEY: '/temporary/key.p8', APPLE_API_KEY_ID: 'KEY', APPLE_API_ISSUER: 'ISSUER' };
  assert.equal(signingPreflight({ platform: 'macos', channel: 'stable', env }).signingRequired, true);
  assert.throws(() => signingPreflight({ platform: 'macos', channel: 'stable', env: { ...env, APPLE_ID: 'partial-account' } }), /Missing APPLE_APP_SPECIFIC_PASSWORD/);
  assert.equal(signingPreflight({ platform: 'macos', channel: 'stable', env: { CSC_LINK: 'cert', CSC_KEY_PASSWORD: 'pass', APPLE_KEYCHAIN_PROFILE: 'notary' } }).signingRequired, true);
});

test('stable Windows requires a certificate and its password', () => {
  assert.throws(() => signingPreflight({ platform: 'windows', channel: 'stable', env: {} }), /WIN_CSC_LINK/);
  assert.throws(() => signingPreflight({ platform: 'windows', channel: 'stable', env: { WIN_CSC_LINK: 'secret' } }), /WIN_CSC_KEY_PASSWORD/);
  assert.equal(signingPreflight({ platform: 'windows', channel: 'stable', env: { WIN_CSC_LINK: 'cert', WIN_CSC_KEY_PASSWORD: 'pass' } }).signingRequired, true);
});

test('preview environment removes signing material without mutating its source', () => {
  const input = { ...macCredentials, WIN_CSC_LINK: 'win-secret', APPLE_API_KEY: 'api-secret', AZURE_CLIENT_SECRET: 'azure-secret', PATH: '/bin', GITHUB_TOKEN: 'release-token', SCREENSAVER_ASSET: 'SOL' };
  const env = signingEnvironment({ channel: 'preview', env: input });
  assert.deepEqual(env, { PATH: '/bin', GITHUB_TOKEN: 'release-token', SCREENSAVER_ASSET: 'SOL', SCREENSAVER_RELEASE_CHANNEL: 'preview', CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  assert.equal(input.CSC_LINK, 'certificate-secret');
  assert.equal(signingEnvironment({ channel: 'stable', env: input }).CSC_LINK, 'certificate-secret');
});

test('signature validation rejects ad-hoc, non-hardened, invalid, and untimestamped signatures', () => {
  assert.doesNotThrow(() => assertDeveloperIdSignature(developerId));
  assert.throws(() => assertDeveloperIdSignature('Signature=adhoc\nTeamIdentifier=not set'), /Developer ID/);
  assert.throws(() => assertDeveloperIdSignature(developerId.replace('(runtime)', '')), /hardened runtime/);
  assert.doesNotThrow(() => assertAuthenticodeSignature({ status: 'Valid', hasSigner: true, hasTimestamp: true }));
  assert.throws(() => assertAuthenticodeSignature({ status: 'UnknownError', hasSigner: true, hasTimestamp: true }), /not valid/);
  assert.throws(() => assertAuthenticodeSignature({ status: 'Valid', hasSigner: true, hasTimestamp: false }), /timestamp/);
});

async function fixture(t, platform, extensions, arch = platform === 'macos' ? 'arm64' : 'x64') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bloxwap-signing-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const format of extensions) await writeFile(path.join(directory, `bloxwap-screensaver-bitcoin-0.1.0-${platform}-${arch}.${format}`), `${platform} ${format} fixture`);
  return directory;
}

test('preview evidence binds hashes to all expected downloadable files and never invokes signing tools', async (t) => {
  const directory = await fixture(t, 'macos', ['dmg', 'zip']);
  const report = await verifySigning({ platform: 'macos', channel: 'preview', directory, run: () => { throw new Error('must not invoke signing tools'); } });
  assert.equal(report.files.length, 2);
  for (const file of report.files) {
    assert.equal(file.signed, false);
    assert.equal(file.notarized, false);
    assert.equal(file.sha256, await sha256File(path.join(directory, file.filename)));
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'signing.json'), 'utf8')), report);
});

test('missing/mixed installers and failed reruns cannot leave successful signing evidence', async (t) => {
  const directory = await fixture(t, 'linux', ['AppImage', 'deb']);
  await verifySigning({ platform: 'linux', channel: 'preview', directory });
  await rm(path.join(directory, 'bloxwap-screensaver-bitcoin-0.1.0-linux-x64.deb'));
  await assert.rejects(verifySigning({ platform: 'linux', channel: 'preview', directory }), /Expected exactly one/);
  await assert.rejects(readFile(path.join(directory, 'signing.json')), { code: 'ENOENT' });
  await writeFile(path.join(directory, 'bloxwap-screensaver-solana-0.1.0-linux-x64.deb'), 'wrong edition');
  await assert.rejects(verifySigning({ platform: 'linux', channel: 'preview', directory }), /mixes asset editions/);
});

test('stable Mac verifies the embedded app from each download and always detaches DMGs', async (t) => {
  const directory = await fixture(t, 'macos', ['dmg', 'zip']);
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'ditto') mkdirSync(path.join(args[3], 'Bloxwap Bitcoin.app'));
    if (command === 'hdiutil' && args[0] === 'attach') mkdirSync(path.join(args[4], 'Bloxwap Bitcoin.app'));
    return { stdout: '', stderr: command === 'codesign' && args[0] === '--display' ? developerId : '' };
  };
  const report = await verifySigning({ platform: 'macos', channel: 'stable', directory, host: 'darwin', run });
  assert.ok(report.files.every((file) => file.signed && file.notarized));
  assert.equal(calls.filter(([command]) => command === 'spctl').length, 2);
  assert.equal(calls.filter(([command]) => command === 'xcrun').length, 2);
  assert.equal(calls.filter(([command, action]) => command === 'hdiutil' && action === 'detach').length, 1);
  await assert.rejects(verifySigning({ platform: 'macos', channel: 'stable', directory, host: 'darwin', run: (command, args) => {
    const result = run(command, args);
    if (command === 'xcrun') throw new Error('Missing stapled ticket');
    return result;
  } }), /Missing stapled ticket/);
  assert.equal(calls.filter(([command, action]) => command === 'hdiutil' && action === 'detach').length, 2);
  await assert.rejects(readFile(path.join(directory, 'signing.json')), { code: 'ENOENT' });
});

test('stable Windows verifies both the installer and unpacked app with a path-safe PowerShell call', async (t) => {
  const directory = await fixture(t, 'windows', ['exe']);
  await mkdir(path.join(directory, 'win-unpacked'));
  await writeFile(path.join(directory, 'win-unpacked', "Bloxwap Bitcoin's.exe"), 'application');
  const calls = [];
  const report = await verifySigning({ platform: 'windows', channel: 'stable', directory, host: 'win32', run: (command, args, options) => {
    calls.push({ command, args, file: options.env.SCREENSAVER_VERIFY_FILE });
    assert.ok(!args.join(' ').includes('Bitcoin'));
    return { stdout: JSON.stringify({ status: 'Valid', hasSigner: true, hasTimestamp: true }), stderr: '' };
  } });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.command === 'powershell.exe'));
  assert.equal(report.files[0].timestamped, true);
  await assert.rejects(verifySigning({ platform: 'windows', channel: 'stable', directory, host: 'win32', run: () => ({ stdout: '{"status":"Valid","hasSigner":true,"hasTimestamp":false}', stderr: '' }) }), /timestamp/);
});

test('stable verification refuses the wrong OS and the CLI rejects ambiguous flags', async (t) => {
  const directory = await fixture(t, 'windows', ['exe']);
  await assert.rejects(verifySigning({ platform: 'windows', channel: 'stable', directory, host: 'darwin' }), /native windows runner/);
  assert.throws(() => parseSigningArgs(['--platform', 'windows', '--platform', 'linux']), /Duplicate/);
  assert.throws(() => parseSigningArgs(['--platform']), /Invalid/);
});
