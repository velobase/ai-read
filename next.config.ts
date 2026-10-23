import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pdfjs-dist'],
  outputFileTracingIncludes: { '/*': ['node_modules/pdfjs-dist/legacy/build/*.mjs'] },
  experimental: { proxyClientMaxBodySize: '32mb' },
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;
