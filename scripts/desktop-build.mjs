import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { desktopOptions, desktopConfig, artifactNames, nativePlatform, parseDesktopArgs } from './lib/desktop-config.cjs';
import { stageDesktop } from './stage-desktop.mjs';

export async function buildDesktop(args = process.argv.slice(2)) {
  const input = parseDesktopArgs(args);
  if (input.help) {
    console.log('Usage: node scripts/desktop-build.mjs [--asset BTC|SOL|ETH|HYPE] [--arch arm64|x64] [--platform macos|windows|linux] [--channel preview|stable] [--dir] [--skip-build] [--dry-run]');
    return;
  }
  const options = desktopOptions(input);
  if (input.dryRun) {
    console.log(JSON.stringify({ asset: options.asset.symbol, platform: options.platform, arch: options.arch, appId: options.appId, productName: options.productName, channel: options.channel, stageDirectory: options.stageDirectory, outputDirectory: options.outputDirectory, artifacts: artifactNames(options) }, null, 2));
    return;
  }
  if (options.platform !== nativePlatform()) {
    throw new Error(`Build ${options.platform} installers on a native ${options.platform} runner. This host is ${nativePlatform()}.`);
  }
  const { signingPreflight, signingEnvironment } = await import('./signing-preflight.mjs');
  await signingPreflight({ platform: options.platform, channel: options.channel });
  // Preview builds cannot accidentally consume a developer certificate present on
  // the host. This script is its own process, so sanitizing the environment here
  // does not change the shell or the next release job.
  const signingEnv = signingEnvironment({ channel: options.channel });
  for (const key of Object.keys(process.env)) if (!(key in signingEnv)) delete process.env[key];
  Object.assign(process.env, signingEnv, { SCREENSAVER_ASSET: options.asset.symbol, SCREENSAVER_PLATFORM: options.platform, SCREENSAVER_ARCH: options.arch, SCREENSAVER_RELEASE_CHANNEL: options.channel });
  if (!input.skipBuild) {
    const npmCLI = process.env.npm_execpath;
    const build = npmCLI
      ? spawnSync(process.execPath, [npmCLI, 'run', 'build'], { cwd: options.projectRoot, stdio: 'inherit' })
      : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: options.projectRoot, stdio: 'inherit', shell: process.platform === 'win32' });
    if (build.error) throw build.error;
    if (build.status !== 0) throw new Error(`Renderer build failed with exit code ${build.status ?? 'unknown'}.`);
  }
  await stageDesktop(options);
  // Pass an explicit target and architecture: runner defaults must never silently
  // relabel a different architecture as the artifact requested by the release job.
  const { Arch, Platform, build } = await import('electron-builder');
  const platform = { macos: Platform.MAC, windows: Platform.WINDOWS, linux: Platform.LINUX }[options.platform];
  await build({ projectDir: options.projectRoot, config: desktopConfig(options), targets: platform.createTarget(input.dir ? 'dir' : null, Arch[options.arch]), publish: 'never' });
  console.log(`Built ${options.productName} for ${options.platform}/${options.arch}: ${options.outputDirectory}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildDesktop().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
