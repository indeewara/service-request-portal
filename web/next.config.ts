import type { NextConfig } from 'next';

// Where the browser uploads to and loads photos from (pre-signed S3 URLs).
const s3Origin = process.env.S3_PUBLIC_ORIGIN ?? 'http://localhost:4566';
const isDev = process.env.NODE_ENV !== 'production';

// No nonce setup: Next.js inlines small hydration scripts, so scripts need 'unsafe-inline'.
// Everything else is locked to this site and the photo bucket.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${s3Origin}`,
  `connect-src 'self' ${s3Origin}`,
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
