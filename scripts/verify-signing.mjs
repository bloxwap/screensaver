import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseSigningArgs, SIGNING_CHANNELS, signingPlatform } from './signing-preflight.mjs';
import { macOSBuildPlan, verifyMacOSBundle } from './macos-build.mjs';

const FORMATS = { macos: ['dmg', 'zip'], windows: ['exe'], linux: ['AppImage', 'deb'] };
const HOST = { macos: 'darwin', windows: 'win32', linux: 'linux' };

export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    // Commands only receive artifact paths; signing credentials are never arguments.
    throw new Error(`${command} verification failed (${result.status ?? result.error?.code ?? 'unknown'}). ${String(result.stderr || '').trim().slice(0, 1_000)}`);
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function assertDeveloperIdSignature(details) {
  if (!/^Authority=Developer ID Application:/m.test(details) || !/^TeamIdentifier=[A-Z0-9]{10}$/m.test(details)) throw new Error('Mac application is not signed with a Developer ID Application identity.');
  if (!/^CodeDirectory .*flags=.*\bruntime\b/m.test(details)) throw new Error('Mac application does not have hardened runtime enabled.');
}

export function assertAuthenticodeSignature(value) {
  if (value?.status !== 'Valid' || value?.hasSigner !== true) throw new Error('Windows Authenticode signature is not valid.');
  if (value?.hasTimestamp !== true) throw new Error('Windows signature has no verified timestamp certificate.');
}

async function verifyWindowsFile(file, run) {
  // Supply the path through the environment rather than interpolate it into PowerShell.
  const script = "$ErrorActionPreference='Stop'; $signature = Get-AuthenticodeSignature -LiteralPath $env:SCREENSAVER_VERIFY_FILE; @{status=$signature.Status.ToString();hasSigner=($null -ne $signature.SignerCertificate);hasTimestamp=($null -ne $signature.TimeStamperCertificate)} | ConvertTo-Json -Compress";
  const result = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, SCREENSAVER_VERIFY_FILE: file } });
  let value;
  try { value = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()); } catch { throw new Error('Windows signature verifier did not return valid JSON.'); }
  assertAuthenticodeSignature(value);
}

async function verifyMacArtifact(file, format, expected, channel, run) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'bloxwap-signature-'));
  const extracted = path.join(temporary, 'application');
  await mkdir(extracted);
  let mounted = false;
  try {
    if (format === 'zip') run('ditto', ['-x', '-k', file, extracted]);
    else {
      run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', extracted, file]);
      mounted = true;
    }
    const entries = await readdir(extracted, { withFileTypes: true });
    const bundles = entries.filter((entry) => entry.isDirectory() && entry.name.endsWith('.saver'));
    if (bundles.length !== 1 || entries.some((entry) => entry.name.endsWith('.app'))) throw new Error('Mac installer must contain exactly one native .saver bundle and no .app.');
    const bundle = path.join(extracted, bundles[0].name);
    const plan = macOSBuildPlan({ asset: { bitcoin: 'BTC', solana: 'SOL', ethereum: 'ETH', hyperliquid: 'HYPE' }[expected.slug], arch: expected.arch });
    if (plan.version !== expected.version || bundles[0].name !== path.basename(plan.bundle)) throw new Error('Native screen saver archive version/name does not match the release.');
    plan.bundle = bundle;
    plan.binary = path.join(bundle, 'Contents/MacOS', plan.identity);
    plan.resources = path.join(bundle, 'Contents/Resources');
    await verifyMacOSBundle(plan, (command, args) => run(command, args).stdout.trim());
    run('codesign', ['--verify', '--strict', '--verbose=2', bundle]);
    const details = run('codesign', ['--display', '--verbose=4', bundle]);
    if (channel === 'stable') {
      assertDeveloperIdSignature(`${details.stdout}\n${details.stderr}`);
      // Native .saver plug-ins are not applications, so assess notarized code
      // directly instead of using spctl's application-only execute assessment.
      run('codesign', ['--verify', '--strict', '-R=notarized', '--check-notarization', bundle]);
      if (format === 'dmg') {
        run('codesign', ['--verify', '--strict', file]);
        run('xcrun', ['stapler', 'validate', file]);
        run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', file]);
      }
    } else if (!/^Signature=adhoc$/m.test(`${details.stdout}\n${details.stderr}`)) {
      throw new Error('Preview native screen savers must have an ad-hoc signature.');
    }
  } finally {
    if (mounted) {
      // Never recursively remove a still-mounted image if detaching fails.
      run('hdiutil', ['detach', extracted]);
    }
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Verify the actual downloadable archives, then bind evidence to their hashes. */
export async function verifySigning({ platform = process.platform, channel = process.env.SCREENSAVER_RELEASE_CHANNEL ?? 'preview', directory, run = execute, host = process.platform } = {}) {
  platform = signingPlatform(platform);
  if (!SIGNING_CHANNELS.includes(channel)) throw new Error('Release channel must be preview or stable.');
  if (!directory) throw new Error('--directory must identify one asset/platform/architecture build output.');
  const root = path.resolve(directory);
  const reportPath = path.join(root, 'signing.json');
  // A failed re-verification must not leave stale successful evidence for upload.
  await rm(reportPath, { force: true });
  if ((channel === 'stable' || platform === 'macos') && HOST[platform] !== host) throw new Error(`${channel} ${platform} verification requires a native ${platform} runner.`);
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const format = FORMATS[platform].find((extension) => entry.name.endsWith(`.${extension}`));
    if (!format) continue;
    const pattern = new RegExp('^bloxwap-screensaver-(bitcoin|solana|ethereum|hyperliquid)-([0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?)-' + platform + '-(arm64|x64)\\.' + format + '$');
    const match = entry.name.match(pattern);
    if (!match) throw new Error(`Unexpected installer filename: ${entry.name}`);
    if (platform !== 'macos' && match[3] !== 'x64') throw new Error('Windows and Linux releases currently support x64 only.');
    const file = path.join(root, entry.name);
    if ((await stat(file)).size === 0) throw new Error(`Installer is empty: ${entry.name}`);
    files.push({ filename: entry.name, file, format, slug: match[1], version: match[2], arch: match[3] });
  }
  if (files.length !== FORMATS[platform].length || FORMATS[platform].some((format) => files.filter((file) => file.format === format).length !== 1)) throw new Error(`Expected exactly one ${FORMATS[platform].join(' and ')} installer in ${root}.`);
  if (new Set(files.map((file) => `${file.slug}/${file.version}/${file.arch}`)).size !== 1) throw new Error('Signing output mixes asset editions, versions, or architectures.');
  files.sort((a, b) => a.filename.localeCompare(b.filename));

  if (channel === 'stable' && platform === 'windows') {
    const unpacked = path.join(root, 'win-unpacked');
    const executables = (await readdir(unpacked, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.exe'));
    if (!executables.length) throw new Error('Windows verification requires the unpacked application executable.');
    for (const executable of executables) await verifyWindowsFile(path.join(unpacked, executable.name), run);
  }

  const verified = [];
  for (const file of files) {
    const sha256 = await sha256File(file.file);
    if (platform === 'macos') await verifyMacArtifact(file.file, file.format, file, channel, run);
    if (channel === 'stable' && platform === 'windows') await verifyWindowsFile(file.file, run);
    if (sha256 !== await sha256File(file.file)) throw new Error(`Installer changed during verification: ${file.filename}`);
    verified.push({ filename: file.filename, sha256, kind: platform === 'macos' ? 'screensaver' : 'application', signed: channel === 'stable' && platform !== 'linux', ...(platform === 'macos' ? { notarized: channel === 'stable', verification: 'embedded-screensaver', stapled: channel === 'stable' && file.format === 'dmg' } : {}), ...(platform === 'windows' ? { timestamped: channel === 'stable' } : {}) });
  }
  const report = { schemaVersion: 1, platform, channel, arch: files[0].arch, asset: { bitcoin: 'BTC', solana: 'SOL', ethereum: 'ETH', hyperliquid: 'HYPE' }[files[0].slug], version: files[0].version, verifiedAt: new Date().toISOString(), files: verified };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await verifySigning(parseSigningArgs(process.argv.slice(2), ['platform', 'channel', 'directory']));
    console.log(`${report.platform} ${report.channel}: ${report.files.length} installer hashes recorded${report.channel === 'stable' && report.platform !== 'linux' ? ' with platform signature verification' : '; no publisher-signing claim'}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
