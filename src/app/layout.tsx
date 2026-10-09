import type { Metadata } from 'next';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import '@fontsource/source-sans-3/800.css';
import './globals.css';

// Fonte do brandbook (Source Sans 3) servida pelo próprio app (sem depender do Google Fonts no build).
export const metadata: Metadata = {
  title: { default: 'ADEGA SB', template: '%s · ADEGA SB' },
  description: 'Sistema de gestão da ADEGA SB: balcão, bar, depósito, delivery e distribuidora.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased min-h-dvh">{children}</body>
    </html>
  );
}
