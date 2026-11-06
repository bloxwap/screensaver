import { createMDX } from 'fumadocs-mdx/next';

export default createMDX()({
  output: 'export',
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  images: { unoptimized: true },
  reactStrictMode: true,
  // HIG 0.2 is one package. Next compiles it here instead of the unpublished 0.1 split packages.
  transpilePackages: ['@bloxwap/hig'],
});
