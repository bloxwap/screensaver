import { DocsBody, DocsDescription, DocsPage, DocsTitle, EditOnGitHub } from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import { source } from '@/lib/source';
import { getMDXComponents } from '@/mdx-components';
import { canonical, repository } from '@/lib/site';

export const dynamicParams = false;
export function generateStaticParams() { return source.generateParams(); }

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
  const page = source.getPage((await params).slug);
  if (!page) return {};
  const url = canonical(`${page.url.replace(/\/$/, '')}/`);
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: url },
    openGraph: {
      title: `${page.data.title} · Bloxwap Screensaver`, description: page.data.description,
      url, siteName: 'Bloxwap Screensaver', type: 'website',
      images: [{ url: canonical('/icon-512.png'), width: 512, height: 512, alt: 'Bloxwap Screensaver' }],
    },
    twitter: { card: 'summary', title: `${page.data.title} · Bloxwap Screensaver`, description: page.data.description, images: [canonical('/icon-512.png')] },
  };
}

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  const Content = page.data.body;
  return <DocsPage toc={page.data.toc} footer={{ className: 'page-nav' }}>
    <DocsTitle>{page.data.title}</DocsTitle><DocsDescription>{page.data.description}</DocsDescription>
    <DocsBody><Content components={getMDXComponents()} /></DocsBody>
    <EditOnGitHub className="edit-on-github" href={`${repository}/blob/main/apps/docs/content/docs/${page.slugs.join('/') || 'index'}.mdx`} />
  </DocsPage>;
}
