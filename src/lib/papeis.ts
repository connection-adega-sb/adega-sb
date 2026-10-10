// Papéis e acesso por rota (parecer-acesso-enterprise.md §4). Fonte única para middleware e telas.
export const PAPEIS = ['master', 'gerente', 'caixa', 'bartender', 'estoquista', 'vendedor_b2b', 'entregador', 'motorista', 'financeiro', 'contador'] as const;
export type Papel = (typeof PAPEIS)[number];

export const ROTULO_PAPEL: Record<Papel, string> = {
  master: 'Master', gerente: 'Gerente', caixa: 'Caixa', bartender: 'Bartender', estoquista: 'Estoquista',
  vendedor_b2b: 'Vendedor B2B', entregador: 'Entregador', motorista: 'Motorista', financeiro: 'Financeiro', contador: 'Contador',
};

// Prefixo de rota → papéis com acesso. Rota protegida que não está aqui: qualquer papel ativo.
export const ACESSO_ROTA: { prefixo: string; papeis: readonly Papel[] }[] = [
  { prefixo: '/admin', papeis: ['master'] },
  { prefixo: '/prototipos', papeis: ['master', 'gerente'] },   // protótipos HTML de referência (public/prototipos)
  { prefixo: '/pdv', papeis: ['master', 'gerente', 'caixa'] }, // PDV balcão (modulo-pdv.md §8)
  { prefixo: '/bar', papeis: ['master', 'gerente', 'bartender', 'caixa'] }, // mesas/comandas/copão (roadmap F4.1)
  { prefixo: '/estoque', papeis: ['master', 'gerente', 'estoquista'] }, // catálogo + estoque profundo (PRD-catalogo-estoque-multilocal.md)
];

export const ROTAS_PUBLICAS = ['/login', '/sem-acesso', '/indisponivel', '/api/health'];

export function papelPodeAcessar(papel: Papel, caminho: string): boolean {
  const regra = ACESSO_ROTA.find((r) => caminho === r.prefixo || caminho.startsWith(r.prefixo + '/'));
  return regra ? regra.papeis.includes(papel) : true;
}

// Destino do login quando não há `next` (pedido do cliente 2026-10-10): quem opera venda cai
// direto no módulo, sem passar pelo painel. Ordem: PDV → bar → estoque → painel.
export function rotaInicial(papel: Papel): string {
  if (papelPodeAcessar(papel, '/pdv')) return '/pdv';
  if (papelPodeAcessar(papel, '/bar')) return '/bar';
  if (papelPodeAcessar(papel, '/estoque')) return '/estoque';
  return '/painel';
}

export const ehPapel = (v: unknown): v is Papel => typeof v === 'string' && (PAPEIS as readonly string[]).includes(v);
