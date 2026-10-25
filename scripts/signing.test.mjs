import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signingEnvironment, signingPreflight, parseSigningArgs } from './signing-preflight.mjs';
import { assertAuthenticodeSignature, assertDeveloperIdSignature, sha256File, verifySigning } from './verify-signing.mjs';
import { macOSBuildPlan, bundleMetadata } from './macos-build.mjs';
import { signMacOSBundle, securityArgument, assertAcceptedNotarization } from './sign-macos-bundle.mjs';

const macPlan = macOSBuildPlan({ asset: 'BTC', arch: 'arm64' });
const VERSION = macPlan.version;

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
  assert.equal(signingPreflight({ platform: 'macos', channel: 'stable', env: { ...macCredentials, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } }).signingRequired, true);
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
  for (const format of extensions) await writeFile(path.join(directory, `bloxwap-screensaver-bitcoin-${VERSION}-${platform}-${arch}.${format}`), `${platform} ${format} fixture`);
  return directory;
}

test('Linux preview evidence binds hashes to all expected application files without signing claims', async (t) => {
  const directory = await fixture(t, 'linux', ['AppImage', 'deb']);
  const report = await verifySigning({ platform: 'linux', channel: 'preview', directory, run: () => { throw new Error('must not invoke signing tools'); } });
  assert.equal(report.files.length, 2);
  for (const file of report.files) {
    assert.equal(file.signed, false);
    assert.equal(file.kind, 'application');
    assert.equal(file.sha256, await sha256File(path.join(directory, file.filename)));
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'signing.json'), 'utf8')), report);
});

test('missing/mixed installers and failed reruns cannot leave successful signing evidence', async (t) => {
  const directory = await fixture(t, 'linux', ['AppImage', 'deb']);
  await verifySigning({ platform: 'linux', channel: 'preview', directory });
  await rm(path.join(directory, `bloxwap-screensaver-bitcoin-${VERSION}-linux-x64.deb`));
  await assert.rejects(verifySigning({ platform: 'linux', channel: 'preview', directory }), /Expected exactly one/);
  await assert.rejects(readFile(path.join(directory, 'signing.json')), { code: 'ENOENT' });
  await writeFile(path.join(directory, `bloxwap-screensaver-solana-${VERSION}-linux-x64.deb`), 'wrong edition');
  await assert.rejects(verifySigning({ platform: 'linux', channel: 'preview', directory }), /mixes asset editions/);
});

function macRunner(calls, { channel = 'stable', wrongAsset = false, wrongArchitecture = false, application = false } = {}) {
  return (command, args) => {
    calls.push([command, ...args]);
    const destination = command === 'ditto' ? args[3] : command === 'hdiutil' && args[0] === 'attach' ? args[4] : null;
    if (destination) {
      const bundle = path.join(destination, application ? 'Legacy.app' : path.basename(macPlan.bundle));
      mkdirSync(bundle);
      if (!application) {
        const contents = {
          'Contents/Info.plist': 'fixture metadata',
          [`Contents/MacOS/${macPlan.identity}`]: 'fixture Mach-O bundle',
          'Contents/Resources/edition.json': JSON.stringify({ symbol: 'BTC', name: 'Bitcoin', slug: 'bitcoin' }),
          'Contents/Resources/dist/index.html': '<script src="./assets/index.js"></script>',
          'Contents/Resources/dist/assets/index.js': '/* renderer */',
          'Contents/Resources/dist/third-party-notices.txt': 'notices',
          'Contents/Resources/dist/brand/BTC.svg': '<svg/>',
          'Contents/Resources/dist/brand/BloxwapSans-Variable.woff2': 'font',
          'Contents/Resources/dist/brand/BloxwapMono-Variable.woff2': 'font',
        };
        for (const [name, content] of Object.entries(contents)) { mkdirSync(path.dirname(path.join(bundle, name)), { recursive: true }); writeFileSync(path.join(bundle, name), content); }
      }
    }
    if (command === 'plutil') return { stdout: JSON.stringify({ ...bundleMetadata(macPlan), ...(wrongAsset ? { BloxwapAssetSymbol: 'ETH' } : {}) }), stderr: '' };
    if (command === 'xcrun' && args[0] === 'lipo') return { stdout: wrongArchitecture ? 'x86_64' : 'arm64', stderr: '' };
    if (command === 'xcrun' && args[0] === 'otool') return { stdout: 'Mach header\nMH_MAGIC_64 ARM64 BUNDLE', stderr: '' };
    return { stdout: '', stderr: command === 'codesign' && args[0] === '--display' ? channel === 'stable' ? developerId : 'Signature=adhoc' : '' };
  };
}

test('stable Mac verifies the native saver from each download and always detaches DMGs', async (t) => {
  const directory = await fixture(t, 'macos', ['dmg', 'zip']);
  const calls = [];
  const run = macRunner(calls);
  const report = await verifySigning({ platform: 'macos', channel: 'stable', directory, host: 'darwin', run });
  assert.ok(report.files.every((file) => file.signed && file.notarized && file.kind === 'screensaver' && file.verification === 'embedded-screensaver'));
  assert.equal(calls.filter(([command]) => command === 'spctl').length, 1);
  assert.equal(calls.filter(([command, subcommand]) => command === 'xcrun' && subcommand === 'stapler').length, 1);
  assert.equal(calls.filter(([command, ...args]) => command === 'codesign' && args.includes('--check-notarization')).length, 2);
  assert.equal(calls.filter(([command, action]) => command === 'hdiutil' && action === 'detach').length, 1);
  await assert.rejects(verifySigning({ platform: 'macos', channel: 'stable', directory, host: 'darwin', run: (command, args) => {
    const result = run(command, args);
    if (command === 'xcrun' && args[0] === 'stapler') throw new Error('Missing stapled ticket');
    return result;
  } }), /Missing stapled ticket/);
  assert.equal(calls.filter(([command, action]) => command === 'hdiutil' && action === 'detach').length, 2);
  await assert.rejects(readFile(path.join(directory, 'signing.json')), { code: 'ENOENT' });
});

test('preview Mac archive verification rejects apps, wrong assets, and wrong architectures', async (t) => {
  const directory = await fixture(t, 'macos', ['dmg', 'zip']);
  const report = await verifySigning({ platform: 'macos', channel: 'preview', directory, host: 'darwin', run: macRunner([], { channel: 'preview' }) });
  assert.ok(report.files.every((file) => file.kind === 'screensaver' && !file.signed && !file.notarized));
  await assert.rejects(verifySigning({ platform: 'macos', channel: 'preview', directory, host: 'darwin', run: macRunner([], { channel: 'preview', application: true }) }), /native .saver/);
  await assert.rejects(verifySigning({ platform: 'macos', channel: 'preview', directory, host: 'darwin', run: macRunner([], { channel: 'preview', wrongAsset: true }) }), /BloxwapAssetSymbol/);
  await assert.rejects(verifySigning({ platform: 'macos', channel: 'preview', directory, host: 'darwin', run: macRunner([], { channel: 'preview', wrongArchitecture: true }) }), /architecture/);
});

test('native preview signing is ad-hoc, uses no Electron entitlements, and signs before archiving', async () => {
  const calls = [];
  let packaged = false;
  const report = await signMacOSBundle({ bundle: '/tmp/Bloxwap Bitcoin.saver', channel: 'preview', host: 'darwin', env: {}, run: (command, args) => { assert.equal(packaged, false); calls.push([command, ...args]); return { stdout: '', stderr: '' }; }, packageArtifacts: async () => { packaged = true; return ['/tmp/bitcoin.dmg', '/tmp/bitcoin.zip']; } });
  assert.equal(report.signed, false);
  assert.equal(report.kind, 'screensaver');
  assert.ok(calls[0].includes('-'));
  assert.ok(!calls.flat().includes('--entitlements'));
  assert.ok(!calls.flat().includes('--options'));
});

test('native stable signing keeps credential material out of argv and cleans the ephemeral keychain on rejection', async () => {
  const calls = [];
  const env = { ...macCredentials, CSC_LINK: Buffer.from('fixture certificate').toString('base64') };
  const run = (command, args, options = {}) => {
    calls.push({ command, args, options });
    assert.ok(!args.some((arg) => [env.CSC_LINK, env.CSC_KEY_PASSWORD, env.APPLE_ID, env.APPLE_APP_SPECIFIC_PASSWORD].includes(arg)));
    if (command.endsWith('/security') && args[0] === 'list-keychains' && !args.includes('-s')) return { stdout: '    "/Users/example/Library/Keychains/login.keychain-db"\n', stderr: '' };
    if (args[0] === 'find-identity') return { stdout: `  1) ${'A'.repeat(40)} "Developer ID Application: Bloxwap (ABCDEFGHIJ)"\n`, stderr: '' };
    if (args[0] === 'notarytool' && args[1] === 'submit') return { stdout: '{"status":"Invalid","id":"fixture"}', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  await assert.rejects(signMacOSBundle({ bundle: '/tmp/Bloxwap Bitcoin.saver', channel: 'stable', env, host: 'darwin', run, packageArtifacts: async () => ['/tmp/bitcoin.dmg', '/tmp/bitcoin.zip'] }), /not accepted/);
  assert.ok(calls.some((call) => call.args[0] === '-i' && call.options.input.includes('import') && call.options.sensitive));
  assert.ok(calls.some((call) => call.args[0] === 'notarytool' && call.args[1] === 'store-credentials' && call.options.input === '\naccount-secret\nnotary-secret\nABCDEFGHIJ\n'));
  assert.ok(calls.some((call) => call.args[0] === 'delete-keychain'));
  assert.ok(calls.some((call) => call.args[0] === 'list-keychains' && call.args.includes('-s') && call.args.includes('/Users/example/Library/Keychains/login.keychain-db')));
  assert.throws(() => securityArgument('password\ncommand'), /single-line/);
  assert.throws(() => assertAcceptedNotarization('{"status":"In Progress","id":"fixture"}'), /not accepted/);
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
