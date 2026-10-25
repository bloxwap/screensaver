import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { source } from '@/lib/source';
import { layoutOptions } from '@/lib/site';

export default function Layout({ children }: { children: ReactNode }) {
  return <DocsLayout {...layoutOptions()} tree={source.getPageTree()} sidebar={{
    defaultOpenLevel: 1,
    footer: <div className="docs-sidebar-footer"><Link href="/#downloads" className="docs-app-link">Download screensavers <span aria-hidden="true">↓</span></Link></div>,
  }}>{children}</DocsLayout>;
}
