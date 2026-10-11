import type { MetadataRoute } from 'next';

// App instalável (PWA) — "o app que vamos mandar para o cliente" (2026-10-11).
// O mesmo sistema web vira ícone na tela do celular/tablet/PC, abre em tela cheia e cai no módulo
// do papel depois do login (rotaInicial em papeis.ts). Público: o navegador lê o manifesto antes do login
// (middleware.ts exclui /manifest.webmanifest do matcher).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ADEGA SB',
    short_name: 'ADEGA SB',
    description: 'Sistema da ADEGA SB: PDV, bar, estoque, produtos e clientes.',
    lang: 'pt-BR',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#E9EAEC',
    theme_color: '#232F3E',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  };
}
