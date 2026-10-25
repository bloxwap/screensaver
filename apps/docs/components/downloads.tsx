import Link from 'next/link';
import { asset as assetUrl, repository } from '@/lib/site';
import { macInstallationSummary, macPackageDescription, macPackageLabel, type ReleaseDownloadKind } from '@/lib/releases';

export type ScreenAsset = {
  symbol: string;
  name: string;
  slug: string;
  tradeUrl: string;
  icon: string;
};

export type ReleaseDownload = {
  asset: string;
  platform: 'macos' | 'windows' | 'linux';
  arch: 'arm64' | 'x64';
  format: 'dmg' | 'zip' | 'exe' | 'AppImage' | 'deb';
  filename: string;
  url: string;
  size: number;
  sha256: string;
  signed: boolean;
  kind?: ReleaseDownloadKind;
};

export type ReleaseManifest = {
  schemaVersion: number;
  version: string | null;
  tag: string | null;
  publishedAt: string | null;
  releaseUrl: string | null;
  channel: 'unreleased' | 'preview' | 'stable';
  downloads: ReleaseDownload[];
};

const platforms = [
  { id: 'macos', label: 'Mac', primary: 'dmg', architectures: ['arm64', 'x64'] },
  { id: 'windows', label: 'Windows', primary: 'exe', architectures: ['x64'] },
  { id: 'linux', label: 'Linux', primary: 'AppImage', architectures: ['x64'] },
] as const;

type Platform = (typeof platforms)[number];

function fileSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}

function architectureLabel(platform: string, architecture: string): string {
  if (platform === 'macos') return architecture === 'arm64' ? 'Apple Silicon' : 'Intel';
  return architecture === 'arm64' ? 'ARM64' : '64-bit';
}

function publicDownload(download: ReleaseDownload): boolean {
  try {
    const url = new URL(download.url);
    return url.origin === 'https://github.com'
      && url.pathname.startsWith('/bloxwap/screensaver/releases/download/')
      && Number.isFinite(download.size) && download.size > 0
      && /^[a-f\d]{64}$/i.test(download.sha256);
  } catch {
    return false;
  }
}

function DownloadIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4" /></svg>;
}

function DownloadCell({ screenAsset, platform, manifest }: { screenAsset: ScreenAsset; platform: Platform; manifest: ReleaseManifest }) {
  const downloads = manifest.downloads.filter((download) => download.asset === screenAsset.symbol && download.platform === platform.id && publicDownload(download));
  const primaryDownloads = platform.architectures.map((arch) => downloads.find((download) => download.arch === arch && download.format === platform.primary));
  const otherDownloads = downloads.filter((download) => download.format !== platform.primary);

  if (!primaryDownloads.some(Boolean)) return <div className="download-unavailable">
    <span>Coming soon</span>
    <small>{platform.id === 'macos' ? 'Apple Silicon & Intel' : '64-bit'}</small>
  </div>;

  return <div className="download-options">
    <div className={`download-primary download-primary-${platform.id}`}>
      {platform.architectures.map((arch, index) => {
        const download = primaryDownloads[index];
        const architecture = architectureLabel(platform.id, arch);
        if (!download) return <span key={arch} className="download-architecture-unavailable">{architecture} coming soon</span>;
        return <div key={arch} className="download-option">
          <a className="download-link" href={download.url} aria-label={`Download ${screenAsset.name} for ${platform.label} (${architecture}), ${platform.id === 'macos' ? `${macPackageDescription(download)}, ` : ''}version ${manifest.version}, ${download.format}, ${fileSize(download.size)}`}>
            <span>{platform.id === 'macos' ? architecture : 'Download'}</span><DownloadIcon />
          </a>
          <span className="download-file">{platform.id === 'macos' && `${macPackageLabel(download)} · `}{download.format === 'AppImage' ? 'AppImage' : download.format.toUpperCase()} · {fileSize(download.size)}</span>
        </div>;
      })}
    </div>
    {otherDownloads.length > 0 && <details className="download-formats">
      <summary>Other formats</summary>
      <ul>{otherDownloads.map((download) => <li key={download.filename}>
        <a href={download.url} aria-label={`Download ${screenAsset.name} for ${platform.label} (${architectureLabel(platform.id, download.arch)}), ${platform.id === 'macos' ? `${macPackageDescription(download)}, ` : ''}${download.format}, ${fileSize(download.size)}`}>
          {download.format.toUpperCase()}<span>{platform.id === 'macos' && `${macPackageLabel(download)} · `}{architectureLabel(platform.id, download.arch)} · {fileSize(download.size)}</span>
        </a>
      </li>)}</ul>
    </details>}
  </div>;
}

export function Downloads({ assets, manifest }: { assets: readonly ScreenAsset[]; manifest: ReleaseManifest }) {
  const available = manifest.downloads.some(publicDownload);
  const unsigned = manifest.downloads.some((download) => publicDownload(download) && download.platform !== 'linux' && !download.signed);
  const macInstallation = macInstallationSummary(manifest.downloads.filter(publicDownload));

  return <section className="downloads-section" id="downloads" aria-labelledby="downloads-heading">
    <div className="downloads-heading">
      <div><p className="landing-eyebrow">Choose your asset</p><h2 id="downloads-heading">Make it your screensaver.</h2></div>
      <div className="release-meta">
        {available && manifest.version ? <>
          <span className="release-version">v{manifest.version.replace(/^v/, '')}{manifest.channel === 'preview' && <span className="release-badge">Preview release</span>}</span>
          {manifest.releaseUrl && <a href={manifest.releaseUrl}>Release notes <span aria-hidden="true">↗</span></a>}
        </> : <span>Browser previews are ready to try.</span>}
      </div>
    </div>

    {unsigned && <p className="release-notice">These preview builds are unsigned. Your computer may ask you to confirm installation. <Link href="/docs/installation/">Installation help <span aria-hidden="true">↗</span></Link></p>}
    {!available && <p className="release-notice">Desktop builds are on the way. Open a live preview below to try each screensaver in your browser.</p>}

    <div className="downloads-table-wrap">
      <table className="downloads-table" role="table" aria-label="Screensaver downloads by asset and operating system">
        <caption className="landing-sr-only">Choose Bitcoin, Solana, Ethereum, or Hyperliquid, then download for Mac, Windows, or Linux, or open a live browser preview.</caption>
        <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Asset</th>{platforms.map((platform) => <th scope="col" role="columnheader" key={platform.id}>{platform.label}</th>)}<th scope="col" role="columnheader">Try it first</th></tr></thead>
        <tbody role="rowgroup">{assets.map((screenAsset) => <tr role="row" key={screenAsset.symbol} id={screenAsset.slug} data-asset={screenAsset.symbol}>
          <th scope="row" role="rowheader" className="download-asset">
            {/* The canonical asset artwork is copied into the static site during assembly. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assetUrl(`/${screenAsset.icon}`)} width="40" height="40" alt="" />
            <span><strong>{screenAsset.name}</strong><small>{screenAsset.symbol}</small></span>
          </th>
          {platforms.map((platform) => <td role="cell" key={platform.id} data-label={platform.label}><DownloadCell screenAsset={screenAsset} platform={platform} manifest={manifest} /></td>)}
          <td role="cell" data-label="Try it first" className="preview-cell"><a className="preview-link" href={assetUrl(`/preview/?asset=${encodeURIComponent(screenAsset.symbol)}`)} aria-label={`Preview ${screenAsset.name} screensaver`}><svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 3 7 5-7 5V3Z" fill="currentColor" /></svg>Preview<span aria-hidden="true">↗</span></a><span className="preview-caption">Live in your browser</span></td>
        </tr>)}</tbody>
      </table>
    </div>

    <div className="downloads-footnote"><p>Fresh prices need an internet connection. No account or wallet required.</p><Link href="/docs/installation/">Installation & setup <span aria-hidden="true">↗</span></Link></div>
    {macInstallation && <p className="download-verification">{macInstallation}</p>}
    {available && <p className="download-verification">Downloads are hosted on <a href={manifest.releaseUrl ?? `${repository}/releases`}>GitHub Releases</a>. Checksums are included with each release.</p>}
  </section>;
}
