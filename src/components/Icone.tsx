import type { SVGProps } from 'react';

// Ícones do PDV no traço do brandbook (24×24, stroke 2, sem preenchimento) — mesmo vocabulário
// visual do protótipo public/prototipos/pdv.html. Só o que a tela usa: nada de biblioteca extra.
const TRACOS: Record<string, string[]> = {
  busca: ['M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0 -16 0', 'M21 21l-4.35-4.35'],
  codigo: ['M3 5v14', 'M7 5v14', 'M11 5v14', 'M15 5v10', 'M19 5v14'],
  carrinho: ['M2 2h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12', 'M9 21m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M19 21m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0'],
  fechar: ['M18 6 6 18', 'M6 6l12 12'],
  lixo: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  menos: ['M5 12h14'],
  mais: ['M5 12h14', 'M12 5v14'],
  percentual: ['M6 17m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M18 7m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M19 5 5 19'],
  caixa: ['M2 7h20v10H2z', 'M6 11h4', 'M14 11h4', 'M6 15h12'],
  confirmar: ['M20 6 9 17l-5-5'],
  calculadora: ['M4 2h16v20H4z', 'M8 6h8', 'M8 11h.01', 'M12 11h.01', 'M16 11h.01', 'M8 15h.01', 'M12 15h.01', 'M16 15h.01', 'M8 19h8'],
  globo: ['M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0', 'M2 12h20', 'M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10'],
  caminhao: ['M14 16V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2', 'M15 16H9', 'M19 16h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 6H14', 'M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0', 'M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0'],
  usuario: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M12 11m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0'],
  cadeado: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  alerta: ['M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  desbloqueado: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 7.9-1'],
  pacote: ['M21 8 12 3 3 8v8l9 5 9-5z', 'M3 8l9 5 9-5', 'M12 13v8'],
  pix: ['M6 6h12v12H6z', 'M10 10h4v4h-4z', 'M9 9h.01', 'M15 15h.01'],
  cartao: ['M2 6h20v12H2z', 'M2 10h20'],
  dinheiro: ['M2 6h20v12H2z', 'M12 15m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0'],
  telefone: ['M22 16.92v3a2 2 0 0 1-2.18 2 19 19 0 0 1-8.31-2.94 19 19 0 0 1-5.77-5.77A19 19 0 0 1 2.84 4.9 2 2 0 0 1 4.83 3h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L9 10.07a16 16 0 0 0 6 6l.43-.43a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92'],
  loja: ['M3 9 4.5 4h15L21 9', 'M4 9h16v11H4z', 'M9 20v-6h6v6'],
};

export function Icone({ n, className = 'h-5 w-5', ...resto }: { n: keyof typeof TRACOS | string; className?: string } & SVGProps<SVGSVGElement>) {
  const tracos = TRACOS[n] ?? TRACOS.pacote;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true" {...resto}>
      {tracos.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
