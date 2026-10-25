import { pathToFileURL } from 'node:url';

export const SIGNING_CHANNELS = ['preview', 'stable'];

export function signingPlatform(value) {
  const platform = { darwin: 'macos', mac: 'macos', macos: 'macos', win32: 'windows', win: 'windows', windows: 'windows', linux: 'linux' }[value];
  if (!platform) throw new Error('Signing platform must be macos, windows, or linux.');
  return platform;
}

function present(env, key) { return typeof env[key] === 'string' && env[key].trim().length > 0; }

/** Check credential names only. Never return or log their contents. */
export function signingPreflight({ platform = process.platform, channel = process.env.SCREENSAVER_RELEASE_CHANNEL ?? 'preview', env = process.env } = {}) {
  platform = signingPlatform(platform);
  if (!SIGNING_CHANNELS.includes(channel)) throw new Error('Release channel must be preview or stable.');
  if (channel === 'preview' || platform === 'linux') return { platform, channel, signingRequired: false };

  const errors = [];
  const requireAll = (names) => {
    for (const name of names) if (!present(env, name)) errors.push(`Missing ${name}`);
  };
  if (platform === 'macos') {
    requireAll(['CSC_LINK', 'CSC_KEY_PASSWORD']);
    // Match electron-builder 26's precedence: Apple ID, API key, then keychain.
    if (present(env, 'APPLE_ID') || present(env, 'APPLE_APP_SPECIFIC_PASSWORD')) {
      requireAll(['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']);
    } else if (['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'].some((name) => present(env, name))) {
      requireAll(['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']);
    } else if (!present(env, 'APPLE_KEYCHAIN_PROFILE')) {
      errors.push('Notarization requires APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_KEYCHAIN_PROFILE');
    }
    if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') errors.push('CSC_IDENTITY_AUTO_DISCOVERY must not be false for a stable Mac build');
  } else {
    if (!present(env, 'WIN_CSC_LINK') && !present(env, 'CSC_LINK')) errors.push('Missing WIN_CSC_LINK (or CSC_LINK)');
    if (!present(env, 'WIN_CSC_KEY_PASSWORD') && !present(env, 'CSC_KEY_PASSWORD')) errors.push('Missing WIN_CSC_KEY_PASSWORD (or CSC_KEY_PASSWORD)');
  }
  if (errors.length) throw new Error(`Stable ${platform} signing is not configured:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  return { platform, channel, signingRequired: true };
}

/** Preview builds must not pick up a developer's signing identity by accident. */
export function signingEnvironment({ channel = 'preview', env = process.env } = {}) {
  if (!SIGNING_CHANNELS.includes(channel)) throw new Error('Release channel must be preview or stable.');
  const result = { ...env, SCREENSAVER_RELEASE_CHANNEL: channel };
  if (channel === 'preview') {
    for (const key of Object.keys(result)) {
      if (/^(?:WIN_)?CSC_/.test(key) || /^APPLE_/.test(key) || /^AZURE_(?:TENANT_ID|CLIENT_ID|CLIENT_SECRET)$/.test(key)) delete result[key];
    }
    result.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  }
  return result;
}

export function parseSigningArgs(argv, allowed = ['platform', 'channel']) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index]?.replace(/^--/, '');
    if (!argv[index]?.startsWith('--') || !allowed.includes(name) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Invalid signing arguments. Supply named --platform, --channel, and, for verification, --directory values.');
    if (Object.hasOwn(args, name)) throw new Error(`Duplicate --${name} argument.`);
    args[name] = argv[++index];
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = signingPreflight(parseSigningArgs(process.argv.slice(2)));
    console.log(`${result.platform} ${result.channel}: ${result.signingRequired ? 'signing credentials configured; artifact verification still required' : 'no publisher-signing claim'}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
