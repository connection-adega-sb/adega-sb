'use server';
import { z } from 'zod';
import { exigirSessao } from '@/lib/sessao';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Cadastro de produto — usado de QUALQUER módulo de venda (PDV, bar) no meio da operação.
// Pedido do cliente 2026-10-10: "produto novo que apareceu no meio da venda".
// Toda regra fica NO SERVIDOR (0007 produto_criar): tenant vem do perfil do usuário, validação
// dos dados e saldo inicial gravado como movimento 'entrada' auditado.
// Papéis: quem opera venda precisa poder cadastrar na hora; `produtos.criado_por` guarda quem.

const UUID = z.string().uuid();
const PAPEIS_CADASTRO = ['master', 'gerente', 'caixa', 'bartender', 'estoquista'] as const;

export type ProdutoNovo = {
  id: string; codigo_barras: string | null; nome: string;
  preco_varejo: number; adulto: boolean; fumigeno: boolean;
  estoque: number; categoria: string | null;
  tipo: 'revenda' | 'preparado' | 'insumo'; unidade: string;
};

export type EstadoCadastro = { erro?: string; produto?: ProdutoNovo };

const Entrada = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do produto.'),
  tipo: z.enum(['revenda', 'preparado', 'insumo']),
  unidade: z.enum(['un', 'kg', 'l']),
  precoVarejo: z.number().nonnegative('Preço de venda inválido.'),
  codigoBarras: z.string().nullable(),
  categoriaId: z.string().nullable(),
  conteudo: z.number().positive('Conteúdo deve ser maior que zero.').nullable(),
  conteudoUnidade: z.enum(['ml', 'g', 'un']).nullable(),
  custoMedio: z.number().nonnegative('Custo médio inválido.').nullable(),
  localId: UUID,
  saldoInicial: z.number(),
  adulto: z.boolean(),
  fumigeno: z.boolean(),
});

export type Categoria = { id: string; nome: string };

export async function listarCategorias(): Promise<Categoria[]> {
  await exigirSessao(PAPEIS_CADASTRO);
  const { data } = await supabaseAdmin().from('categorias')
    .select('id, nome').eq('ativo', true).order('nome');
  return (data ?? []) as Categoria[];
}

// O cliente monta o FormData (modal com botão "Cadastrar e voltar para a venda").
export async function criarProdutoRapido(_: EstadoCadastro, form: FormData): Promise<EstadoCadastro> {
  const s = await exigirSessao(PAPEIS_CADASTRO);

  const txt = (k: string) => { const v = form.get(k); return typeof v === 'string' ? v.trim() : ''; };
  // aceita "12,50" (teclado brasileiro) e "12.50" (input type=number já normaliza com ponto)
  const numero = (k: string) => {
    const v = txt(k);
    if (v === '') return NaN;
    return Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
  };
  const opcional = (k: string) => (txt(k) === '' ? null : numero(k));

  const bruto = {
    nome: txt('nome'),
    tipo: (txt('tipo') || 'revenda') as 'revenda' | 'preparado' | 'insumo',
    unidade: (txt('unidade') || 'un') as 'un' | 'kg' | 'l',
    precoVarejo: numero('precoVarejo'),
    codigoBarras: txt('codigoBarras') || null,
    categoriaId: txt('categoriaId') || null,
    conteudo: opcional('conteudo'),
    conteudoUnidade: txt('conteudoUnidade') || null,
    custoMedio: opcional('custoMedio'),
    localId: txt('localId'),
    saldoInicial: opcional('saldoInicial') ?? 0,
    adulto: form.get('adulto') === 'on',
    fumigeno: form.get('fumigeno') === 'on',
  };
  // NaN escapa do zod (typeof NaN é "number") — trapo aqui com mensagem amigável
  if (Number.isNaN(bruto.precoVarejo)) return { erro: 'Preço de venda inválido (ex.: 12,50).' };
  if (bruto.conteudo !== null && Number.isNaN(bruto.conteudo)) return { erro: 'Conteúdo inválido (ex.: 350).' };
  if (bruto.custoMedio !== null && Number.isNaN(bruto.custoMedio)) return { erro: 'Custo médio inválido (ex.: 18,50).' };
  if (Number.isNaN(bruto.saldoInicial)) return { erro: 'Saldo inicial inválido (ex.: 10).' };

  const dados = Entrada.safeParse(bruto);
  if (!dados.success) return { erro: dados.error.issues[0]?.message ?? 'Dados inválidos.' };
  const d = dados.data;

  if (s.papel !== 'master' && !s.locais.includes(d.localId)) {
    return { erro: 'Você não tem acesso a este local.' };
  }
  if (d.fumigeno && !d.adulto) return { erro: 'Produto fumígeno exige classificação +18.' };
  if (d.saldoInicial !== 0 && d.saldoInicial < 0) return { erro: 'Saldo inicial não pode ser negativo.' };

  const sb = supabaseAdmin();
  const { data: id, error } = await sb.rpc('produto_criar', {
    p_nome: d.nome,
    p_preco_varejo: d.precoVarejo,
    p_usuario: s.id,
    p_codigo_barras: d.codigoBarras,
    p_categoria_id: d.categoriaId,
    p_tipo: d.tipo,
    p_unidade: d.unidade,
    p_conteudo: d.conteudo,
    p_conteudo_unidade: d.conteudoUnidade,
    p_adulto: d.adulto,
    p_fumigeno: d.fumigeno,
    p_custo_medio: d.custoMedio,
    p_local: d.saldoInicial === 0 ? null : d.localId,
    p_quantidade_inicial: d.saldoInicial,
  });
  if (error) return { erro: traduzErro(error.message) };

  // devolve o produto no formato que a tela de venda já usa, para entrar na comanda na hora
  const [rProd, rSaldo] = await Promise.all([
    sb.from('produtos')
      .select('id, codigo_barras, nome, preco_varejo, adulto, fumigeno, tipo, unidade, categorias(nome)')
      .eq('id', id).maybeSingle(),
    sb.from('estoque_saldos').select('quantidade').eq('produto_id', id).eq('local_id', d.localId).maybeSingle(),
  ]);
  const p = rProd.data;
  if (!p) return { erro: 'Produto criado, mas não foi possível ler de volta.' };
  const cat = p.categorias as unknown as { nome: string } | null;

  return {
    produto: {
      id: p.id, codigo_barras: p.codigo_barras, nome: p.nome,
      preco_varejo: Number(p.preco_varejo), adulto: p.adulto, fumigeno: p.fumigeno,
      estoque: Number(rSaldo.data?.quantidade ?? 0), categoria: cat?.nome ?? null,
      tipo: p.tipo as ProdutoNovo['tipo'], unidade: p.unidade,
    },
  };
}

// Mensagens amigáveis do banco (mesmo vocabulário das outras server actions).
function traduzErro(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('código de barras já cadastrado')) return 'Este código de barras já está cadastrado.';
  if (m.includes('nome do produto é obrigatório')) return 'Informe o nome do produto.';
  if (m.includes('preço de venda inválido')) return 'Preço de venda inválido.';
  if (m.includes('tipo de produto inválido')) return 'Tipo de produto inválido.';
  if (m.includes('unidade de venda inválida')) return 'Unidade de venda inválida.';
  if (m.includes('unidade de conteúdo inválida')) return 'Unidade de conteúdo inválida.';
  if (m.includes('informe o conteúdo')) return 'Informe o conteúdo da embalagem.';
  if (m.includes('fumígeno exige')) return 'Produto fumígeno exige classificação +18.';
  if (m.includes('categoria não encontrada')) return 'Categoria inválida.';
  if (m.includes('informe o local')) return 'Informe o local para o saldo inicial.';
  if (m.includes('saldo inicial não pode ser negativo')) return 'Saldo inicial não pode ser negativo.';
  if (m.includes('local não encontrado')) return 'Local inválido para este cadastro.';
  if (m.includes('usuário sem perfil ativo')) return 'Sessão inválida: recarregue a página e entre de novo.';
  if (m.includes('sem permissão para editar')) return 'Só master, gerente ou estoquista editam produto.';
  if (m.includes('produto não encontrado')) return 'Produto não encontrado.';
  if (m.includes('fumígeno só pode')) return 'Fumígeno só pode ser produto de revenda.';
  if (m.includes('duplicate key') || m.includes('unique constraint')) return 'Já existe um produto com estes dados.';
  return msg;
}


// ================================================================ tela /produtos (cadastro FORA da venda — 0009)
// Pedido do cliente 2026-10-11: "tela de cadastro de produtos para o operacional cadastrar independente
// da venda, em outro terminal". Cadastro: quem vende (PAPEIS_CADASTRO). Edição: master/gerente/estoquista
// (0009 produto_atualizar — preço muda só por quem responde pelo estoque; tudo no audit_log).

export type ProdutoLinha = {
  id: string; nome: string; codigo_barras: string | null; categoria_id: string | null; categoria: string | null;
  preco_varejo: number; custo_medio: number | null; adulto: boolean; fumigeno: boolean;
  tipo: string; unidade: string; ativo: boolean; criado_em: string; saldo: number;
};
export type FiltroProdutos = 'ativos' | 'todos' | 'sem_estoque';
export type KpisProdutos = { ativos: number; semCodigo: number; adultos: number; semEstoque: number; novosMes: number };

const limparTermo = (t: string) => t.replace(/[,()*%\\"]/g, ' ').trim();

export async function listarProdutosCatalogo(termo: string, filtro: FiltroProdutos): Promise<ProdutoLinha[]> {
  const s = await exigirSessao(PAPEIS_CADASTRO);
  const sb = supabaseAdmin();
  const t = limparTermo(termo);
  let q = sb.from('produtos')
    .select('id, nome, codigo_barras, categoria_id, preco_varejo, custo_medio, adulto, fumigeno, tipo, unidade, ativo, criado_em, categorias(nome)')
    .eq('tenant_id', s.tenantId);
  if (filtro !== 'todos') q = q.eq('ativo', true);
  if (t.length >= 2) q = q.or(`nome.ilike.%${t}%,codigo_barras.ilike.%${t}%`);
  const { data } = await q.order('nome').limit(500);
  const prods = data ?? [];
  const saldo = new Map<string, number>();
  if (prods.length) {
    const { data: sal } = await sb.from('estoque_saldos').select('produto_id, quantidade')
      .in('produto_id', prods.map((p) => p.id as string));
    for (const r of sal ?? []) saldo.set(r.produto_id as string, (saldo.get(r.produto_id as string) ?? 0) + Number(r.quantidade));
  }
  const linhas: ProdutoLinha[] = prods.map((p) => ({
    id: p.id as string, nome: p.nome as string, codigo_barras: (p.codigo_barras as string | null) ?? null,
    categoria_id: (p.categoria_id as string | null) ?? null,
    categoria: (p.categorias as unknown as { nome: string } | null)?.nome ?? null,
    preco_varejo: Number(p.preco_varejo), custo_medio: p.custo_medio === null ? null : Number(p.custo_medio),
    adulto: !!p.adulto, fumigeno: !!p.fumigeno, tipo: p.tipo as string, unidade: p.unidade as string,
    ativo: !!p.ativo, criado_em: p.criado_em as string, saldo: Math.round((saldo.get(p.id as string) ?? 0) * 1000) / 1000,
  }));
  return filtro === 'sem_estoque' ? linhas.filter((l) => l.tipo === 'revenda' && l.saldo <= 0) : linhas;
}

export async function kpisProdutos(): Promise<KpisProdutos> {
  const lista = await listarProdutosCatalogo('', 'ativos');
  const d = new Date();
  const mes = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  return {
    ativos: lista.length,
    semCodigo: lista.filter((p) => !p.codigo_barras).length,
    adultos: lista.filter((p) => p.adulto).length,
    semEstoque: lista.filter((p) => p.tipo === 'revenda' && p.saldo <= 0).length,
    novosMes: lista.filter((p) => p.criado_em >= mes).length,
  };
}

// locais em que o usuário pode dar saldo inicial (master: todos; demais: os vinculados)
export async function listarLocaisCadastro(): Promise<{ id: string; nome: string }[]> {
  const s = await exigirSessao(PAPEIS_CADASTRO);
  let q = supabaseAdmin().from('locais').select('id, nome').eq('tenant_id', s.tenantId).order('nome');
  if (s.papel !== 'master') {
    if (!s.locais.length) return [];
    q = q.in('id', s.locais);
  }
  const { data } = await q;
  return (data ?? []) as { id: string; nome: string }[];
}

export type EstadoEdicao = { erro?: string; ok?: boolean };

export async function atualizarProduto(_: EstadoEdicao, form: FormData): Promise<EstadoEdicao> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  const txt = (k: string) => { const v = form.get(k); return typeof v === 'string' ? v.trim() : ''; };
  const id = txt('id');
  if (!UUID.safeParse(id).success) return { erro: 'Produto não encontrado.' };
  const precoTxt = txt('precoVarejo');
  const preco = Number(precoTxt.includes(',') ? precoTxt.replace(/\./g, '').replace(',', '.') : precoTxt);
  if (!precoTxt || Number.isNaN(preco) || preco < 0) return { erro: 'Preço de venda inválido (ex.: 12,50).' };
  const categoria = txt('categoriaId');
  if (categoria && !UUID.safeParse(categoria).success) return { erro: 'Categoria inválida.' };
  const { error } = await supabaseAdmin().rpc('produto_atualizar', {
    p_usuario: s.id, p_id: id, p_nome: txt('nome'), p_preco_varejo: preco,
    p_codigo_barras: txt('codigoBarras') || null, p_categoria_id: categoria || null,
    p_adulto: form.get('adulto') === 'on', p_fumigeno: form.get('fumigeno') === 'on',
    p_ativo: form.get('ativo') === 'on',
  });
  return error ? { erro: traduzErro(error.message) } : { ok: true };
}
