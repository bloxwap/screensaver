import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { REPOSITORY, releaseNotes, releaseResumeState, sha256File, validateManifest, verifyReleaseAssets } from './lib/releases.mjs';
import { fetchReleaseManifest } from './fetch-release.mjs';

const { values } = parseArgs({ options: {
  directory: { type: 'string', default: 'release' }, metadata: { type: 'string', default: 'release-metadata' },
  target: { type: 'string' },
} });
if (!values.target || !/^[a-f0-9]{40}$/.test(values.target)) throw new Error('--target requires the full source commit SHA');
const manifest = validateManifest(JSON.parse(await readFile(resolve(values.metadata, 'release-manifest.json'), 'utf8')), { requireCurrentKinds: true });
if (manifest.channel === 'unreleased') throw new Error('Cannot publish an empty release');
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const allReleases = JSON.parse(gh('api', `repos/${REPOSITORY}/releases?per_page=100`));
const existing = allReleases.find((release) => release.tag_name === manifest.tag);
const tagCommitSha = existing && !existing.draft
  ? gh('api', `repos/${REPOSITORY}/commits/${encodeURIComponent(manifest.tag)}`, '--jq', '.sha')
  : null;
const publishedManifest = existing && !existing.draft ? await fetchReleaseManifest(existing) : null;
const resume = releaseResumeState(manifest, existing, { sourceSha: values.target, tagCommitSha, publishedManifest });
if (resume === 'verified-public') {
  console.log(`Verified existing immutable release ${manifest.releaseUrl}; continuing public metadata and website refresh.`);
  process.exit(0);
}
const notes = releaseNotes(manifest, values.target);
const notesPath = resolve(values.metadata, 'release-notes.md');
await writeFile(notesPath, notes);
const args = ['release', 'create', manifest.tag, '--repo', REPOSITORY, '--target', values.target, '--draft', '--title', `Bloxwap Screensaver ${manifest.version}${manifest.channel === 'preview' ? ' · Preview' : ''}`, '--notes-file', notesPath];
if (manifest.channel === 'preview') args.push('--prerelease', '--latest=false');
else args.push('--verify-tag', '--latest');
if (!existing) gh(...args);
async function walk(path) {
  return (await Promise.all((await readdir(path, { withFileTypes: true })).map((entry) => entry.isDirectory() ? walk(join(path, entry.name)) : entry.isFile() ? [join(path, entry.name)] : []))).flat();
}
const allowed = new Set(manifest.downloads.map((entry) => entry.filename));
const files = (await walk(resolve(values.directory))).filter((path) => allowed.has(basename(path)));
if (files.length !== allowed.size) throw new Error('Installer set changed after manifest generation');
for (const file of files) {
  const entry = manifest.downloads.find((download) => download.filename === basename(file));
  if (await sha256File(file) !== entry.sha256) throw new Error(`Installer changed after manifest generation: ${entry.filename}`);
  const uploaded = existing?.assets.find((asset) => asset.name === entry.filename);
  if (uploaded) {
    if (uploaded.size !== entry.size || uploaded.digest !== `sha256:${entry.sha256}`) throw new Error(`Draft already contains a different artifact: ${entry.filename}`);
  } else gh('release', 'upload', manifest.tag, file, '--repo', REPOSITORY);
}
// Retrying an incomplete matching draft can regenerate metadata; public assets are never overwritten.
for (const file of [resolve(values.metadata, 'release-manifest.json'), resolve(values.metadata, 'SHA256SUMS')]) gh('release', 'upload', manifest.tag, file, '--repo', REPOSITORY, '--clobber');
// REST lookup by pending tag cannot find a draft. The CLI resolves its database id via GraphQL.
const { databaseId } = JSON.parse(gh('release', 'view', manifest.tag, '--repo', REPOSITORY, '--json', 'databaseId'));
const release = JSON.parse(gh('api', `repos/${REPOSITORY}/releases/${databaseId}`));
verifyReleaseAssets(manifest, release, { allowDraft: true });
gh('release', 'edit', manifest.tag, '--repo', REPOSITORY, '--draft=false', manifest.channel === 'preview' ? '--latest=false' : '--latest');
console.log(`Published ${manifest.releaseUrl}`);
