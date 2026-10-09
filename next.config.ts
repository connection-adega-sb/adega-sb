import type { NextConfig } from 'next';

// Cabeçalhos de segurança (roadmap §4 trilho Segurança). CSP completa entra quando houver integrações.
const comuns = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // E2E usa build própria (.next-e2e), feita SEM o .env.local (ver e2e/run.cjs)
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async headers() {
    return [
      // Protótipos: o PDV abre o site num quadro da MESMA origem → SAMEORIGIN só aqui.
      { source: '/prototipos/:path*', headers: [...comuns, { key: 'X-Frame-Options', value: 'SAMEORIGIN' }] },
      { source: '/((?!prototipos/).*)', headers: [...comuns, { key: 'X-Frame-Options', value: 'DENY' }] },
    ];
  },
};

export default nextConfig;
