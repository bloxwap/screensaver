import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { canonical } from '@/lib/site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: canonical('/') }, ...source.getPages().map(page => ({ url: canonical(`${page.url.replace(/\/$/, '')}/`) }))];
}
