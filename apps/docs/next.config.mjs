import { createMDX } from 'fumadocs-mdx/next';

export default createMDX()({
  output: 'export',
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  images: { unoptimized: true },
  reactStrictMode: true,
});
