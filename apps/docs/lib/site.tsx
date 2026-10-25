import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const siteUrl = 'https://bloxwap.github.io';
export const repository = 'https://github.com/bloxwap/screensaver';
export const asset = (path: string) => `${basePath}${path}`;
export const canonical = (path: string) => `${siteUrl}${asset(path)}`;

export function layoutOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <span className="brand"><img src={asset('/logos/bloxwap-icon-green.svg')} width={28} height={28} alt="Bloxwap" /><span className="brand-product">Screensaver</span></span>,
      url: '/',
    },
    githubUrl: repository,
    themeSwitch: { enabled: false },
    links: [{ text: 'Docs', url: '/docs/', active: 'nested-url' }],
  };
}
