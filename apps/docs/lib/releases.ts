export type ReleaseDownloadKind = 'screensaver' | 'application';

type DownloadIdentity = {
  platform: string;
  kind?: ReleaseDownloadKind;
};

/** Older manifests describe desktop apps and do not carry an explicit kind. */
export function downloadKind(download: Pick<DownloadIdentity, 'kind'>): ReleaseDownloadKind {
  return download.kind === 'screensaver' ? 'screensaver' : 'application';
}

export function isNativeMacDownload(download: DownloadIdentity): boolean {
  return download.platform === 'macos' && downloadKind(download) === 'screensaver';
}

export function macPackageLabel(download: DownloadIdentity): '.saver' | 'App' {
  return isNativeMacDownload(download) ? '.saver' : 'App';
}

export function macPackageDescription(download: DownloadIdentity): string {
  return isNativeMacDownload(download) ? 'native screen saver (.saver)' : 'desktop app';
}

export function macInstallationSummary(downloads: readonly DownloadIdentity[]): string | null {
  const macDownloads = downloads.filter((download) => download.platform === 'macos');
  if (macDownloads.length === 0) return null;
  const nativeDownloads = macDownloads.filter(isNativeMacDownload);
  if (nativeDownloads.length === 0) return 'The current Mac downloads contain desktop apps.';
  if (nativeDownloads.length === macDownloads.length) return 'Mac downloads install a native .saver in your system screen saver settings.';
  return 'Mac downloads marked .saver use the system screen saver settings. Downloads marked App are desktop apps.';
}
