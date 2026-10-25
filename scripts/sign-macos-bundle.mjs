import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { signingPreflight } from './signing-preflight.mjs';

function execute(command, args, options = {}) {
  const { sensitive = false, ...spawnOptions } = options;
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024, ...spawnOptions });
  if (result.error || result.status !== 0) {
    // Interactive credential commands must not echo their input or raw errors.
    const detail = sensitive ? '' : ` ${String(result.stderr ?? '').trim().slice(0, 800)}`;
    throw new Error(`${path.basename(command)} failed (${result.status ?? result.error?.code ?? 'unknown'}).${detail}`);
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function securityArgument(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Signing credential values must be single-line text without control characters.');
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function securityInput(run, args) {
  // security -i parses its own command language; no shell is involved. Passwords
  // travel only over stdin, never process arguments, build logs, or script files.
  return run('/usr/bin/security', ['-i'], { input: `${args.map(securityArgument).join(' ')}\n`, sensitive: true });
}

export function developerIdentity(output) {
  const identities = [...output.matchAll(/\b([A-Fa-f0-9]{40})\s+"(Developer ID Application:[^"]+)"/g)];
  if (identities.length !== 1) throw new Error('The signing certificate must contain exactly one valid Developer ID Application identity.');
  return identities[0][1];
}

async function certificateData(value) {
  let data;
  if (value.startsWith('https://')) {
    const response = await fetch(value, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.url.startsWith('https://')) throw new Error('Could not download the signing certificate over HTTPS.');
    data = Buffer.from(await response.arrayBuffer());
  } else if (value.startsWith('file:')) data = await readFile(fileURLToPath(value));
  else if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.startsWith('~/')) data = await readFile(value.startsWith('~/') ? path.join(homedir(), value.slice(2)) : value);
  else {
    const compact = value.replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new Error('CSC_LINK must be a certificate path, HTTPS URL, or base64 PKCS#12 data.');
    data = Buffer.from(compact, 'base64');
  }
  if (!data.length || data.length > 10 * 1024 * 1024) throw new Error('Signing certificate is empty or exceeds the supported size.');
  return data;
}

function notaryProfile(run, env, keychain, profile) {
  if (env.APPLE_KEYCHAIN_PROFILE && !env.APPLE_ID && !env.APPLE_APP_SPECIFIC_PASSWORD && !env.APPLE_API_KEY) {
    return ['--keychain-profile', env.APPLE_KEYCHAIN_PROFILE, ...(env.APPLE_KEYCHAIN ? ['--keychain', env.APPLE_KEYCHAIN] : [])];
  }
  const inputs = env.APPLE_ID || env.APPLE_APP_SPECIFIC_PASSWORD
    ? ['', env.APPLE_ID, env.APPLE_APP_SPECIFIC_PASSWORD, env.APPLE_TEAM_ID]
    : [env.APPLE_API_KEY, env.APPLE_API_KEY_ID, env.APPLE_API_ISSUER];
  for (const value of inputs) securityArgument(value);
  run('/usr/bin/xcrun', ['notarytool', 'store-credentials', profile, '--keychain', keychain, '--validate'], { input: `${inputs.join('\n')}\n`, sensitive: true });
  return ['--keychain-profile', profile, '--keychain', keychain];
}

export function assertAcceptedNotarization(output) {
  let value;
  try { value = JSON.parse(output); } catch { throw new Error('The notarization service did not return a JSON result.'); }
  if (value.status !== 'Accepted' || typeof value.id !== 'string') throw new Error('Notarization was not accepted. Inspect the submission in the Apple developer account before publishing.');
  return value.id;
}

/** Sign a native plug-in, then package/notarize the exact distributable files. */
export async function signMacOSBundle({ bundle, channel = 'preview', env = process.env, packageArtifacts, run = execute, host = process.platform } = {}) {
  if (host !== 'darwin') throw new Error('Native screensaver signing requires macOS.');
  if (!bundle || !bundle.endsWith('.saver')) throw new Error('Mac signing requires a native .saver bundle.');
  signingPreflight({ platform: 'macos', channel, env });
  const target = path.resolve(bundle);
  const archives = async () => {
    const files = packageArtifacts ? await packageArtifacts() : [];
    if (!Array.isArray(files) || (packageArtifacts && (files.length !== 2 || files.filter((file) => file.endsWith('.dmg')).length !== 1 || files.filter((file) => file.endsWith('.zip')).length !== 1))) throw new Error('Mac packaging must return exactly one DMG and one ZIP.');
    return files.map((file) => path.resolve(file));
  };
  if (channel === 'preview') {
    run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', target]);
    run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', target]);
    return { files: await archives(), kind: 'screensaver', signed: false, notarized: false };
  }

  const temporary = await mkdtemp(path.join(tmpdir(), 'bloxwap-native-signing-'));
  const keychain = path.join(temporary, 'build.keychain-db');
  const password = randomBytes(32).toString('hex');
  const profile = `bloxwap-${randomBytes(12).toString('hex')}`;
  let keychains = null;
  let created = false;
  try {
    const originalList = run('/usr/bin/security', ['list-keychains', '-d', 'user']).stdout;
    keychains = [...originalList.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1].replace(/\\(["\\])/g, '$1'));
    const certificate = path.join(temporary, 'certificate.p12');
    await writeFile(certificate, await certificateData(env.CSC_LINK), { mode: 0o600 });
    securityInput(run, ['create-keychain', '-p', password, keychain]);
    created = true;
    run('/usr/bin/security', ['set-keychain-settings', '-lut', '7200', keychain]);
    securityInput(run, ['unlock-keychain', '-p', password, keychain]);
    securityInput(run, ['import', certificate, '-k', keychain, '-f', 'pkcs12', '-P', env.CSC_KEY_PASSWORD, '-x', '-T', '/usr/bin/codesign']);
    securityInput(run, ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', password, keychain]);
    const identity = developerIdentity(run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning', keychain]).stdout);
    run('/usr/bin/codesign', ['--force', '--sign', identity, '--keychain', keychain, '--options', 'runtime', '--timestamp', target]);
    run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', target]);
    const auth = notaryProfile(run, env, keychain, profile);
    const files = await archives();
    const zip = files.find((file) => file.endsWith('.zip')) ?? path.join(temporary, 'screensaver.zip');
    if (!files.length) run('/usr/bin/ditto', ['-c', '-k', '--keepParent', target, zip]);
    const submit = (file) => assertAcceptedNotarization(run('/usr/bin/xcrun', ['notarytool', 'submit', file, ...auth, '--wait', '--timeout', '20m', '--output-format', 'json'], { timeout: 21 * 60_000, sensitive: true }).stdout);
    const submissions = [{ format: 'zip', id: submit(zip) }];
    // A .saver is plug-in code, not an application. Gatekeeper's app assessment
    // and generic bundle stapling are inappropriate; test its notarized code.
    run('/usr/bin/codesign', ['--verify', '--strict', '-R=notarized', '--check-notarization', target]);
    const dmg = files.find((file) => file.endsWith('.dmg'));
    if (dmg) {
      run('/usr/bin/codesign', ['--force', '--sign', identity, '--keychain', keychain, '--timestamp', dmg]);
      submissions.push({ format: 'dmg', id: submit(dmg) });
      run('/usr/bin/xcrun', ['stapler', 'staple', dmg]);
      run('/usr/bin/xcrun', ['stapler', 'validate', dmg]);
    }
    return { files, kind: 'screensaver', signed: true, notarized: true, submissions };
  } finally {
    // Restore the user's keychain search list even if importing or notarization
    // fails. Certificate material and temporary credentials never persist.
    let cleanupError;
    if (created) {
      try { run('/usr/bin/security', ['delete-keychain', keychain], { sensitive: true }); } catch (error) { cleanupError = error; }
    }
    if (keychains) {
      try { run('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...keychains], { sensitive: true }); } catch (error) { cleanupError ??= error; }
    }
    await rm(temporary, { recursive: true, force: true });
    if (cleanupError) throw new Error('Could not restore the temporary signing keychain state.');
  }
}
