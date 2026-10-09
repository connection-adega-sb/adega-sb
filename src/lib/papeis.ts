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
];

export const ROTAS_PUBLICAS = ['/login', '/sem-acesso', '/indisponivel', '/api/health'];

export function papelPodeAcessar(papel: Papel, caminho: string): boolean {
  const regra = ACESSO_ROTA.find((r) => caminho === r.prefixo || caminho.startsWith(r.prefixo + '/'));
  return regra ? regra.papeis.includes(papel) : true;
}

export const ehPapel = (v: unknown): v is Papel => typeof v === 'string' && (PAPEIS as readonly string[]).includes(v);
