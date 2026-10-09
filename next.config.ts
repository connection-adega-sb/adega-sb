import type { NextConfig } from 'next';

// Cabeçalhos de segurança (roadmap §4 trilho Segurança). CSP completa entra quando houver integrações.
const seguranca = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: seguranca }];
  },
};

export default nextConfig;
