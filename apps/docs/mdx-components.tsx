import Link from 'next/link';
import defaults from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import type { ComponentPropsWithoutRef } from 'react';
import { asset } from '@/lib/site';

function DocsLink({ href, children, ...props }: ComponentPropsWithoutRef<'a'>) {
  // Preview is a separately built Vite document and needs a complete navigation.
  if (href?.startsWith('/preview/')) return <a href={asset(href)} {...props}>{children}</a>;
  if (href?.startsWith('/') && !href.startsWith('//')) return <Link href={href} {...props}>{children}</Link>;
  return <a href={href} {...props}>{children}</a>;
}

export function getMDXComponents(components: MDXComponents = {}): MDXComponents {
  return { ...defaults, a: DocsLink, ...components };
}
