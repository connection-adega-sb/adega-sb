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

  // fiscal sugerido pela consulta do código de barras (gtin.ts): NCM 8 e CEST 7 dígitos; inválido é ignorado
  const ncm = txt('ncm').replace(/\D/g, '');
  const cest = txt('cest').replace(/\D/g, '');
  if ((ncm.length === 8 || cest.length === 7) && typeof id === 'string') {
    await sb.from('produtos').update({
      ...(ncm.length === 8 ? { ncm } : {}), ...(cest.length === 7 ? { cest } : {}),
    }).eq('id', id).eq('tenant_id', s.tenantId);
  }

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
  if (m.includes('ncm deve ter 8')) return 'NCM deve ter 8 dígitos.';
  if (m.includes('cest deve ter 7')) return 'CEST deve ter 7 dígitos (ou deixe vazio).';
  if (m.includes('código de barras deve ter')) return 'Código de barras deve ter 8, 12, 13 ou 14 dígitos.';
  if (m.includes('valor numérico inválido em')) return 'Número inválido no campo ' + msg.split(' em ').pop() + '.';
  if (m.includes('violates check constraint')) return 'Algum campo está fora do padrão (confira unidade, CSOSN, CST e datas).';
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
  tipo: string; unidade: string; ativo: boolean; criado_em: string; saldo: number; revisar: string | null;
};
export type FiltroProdutos = 'ativos' | 'todos' | 'sem_estoque' | 'revisar';
export type KpisProdutos = { ativos: number; semCodigo: number; adultos: number; semEstoque: number; novosMes: number; revisar: number };

const limparTermo = (t: string) => t.replace(/[,()*%\\"]/g, ' ').trim();

export async function listarProdutosCatalogo(termo: string, filtro: FiltroProdutos): Promise<ProdutoLinha[]> {
  const s = await exigirSessao(PAPEIS_CADASTRO);
  const sb = supabaseAdmin();
  const t = limparTermo(termo);
  let q = sb.from('produtos')
    .select('id, nome, codigo_barras, categoria_id, preco_varejo, custo_medio, adulto, fumigeno, tipo, unidade, ativo, criado_em, revisar, categorias(nome)')
    .eq('tenant_id', s.tenantId);
  if (filtro !== 'todos') q = q.eq('ativo', true);
  if (filtro === 'revisar') q = q.not('revisar', 'is', null);
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
    ativo: !!p.ativo, criado_em: p.criado_em as string, revisar: (p.revisar as string | null) ?? null, saldo: Math.round((saldo.get(p.id as string) ?? 0) * 1000) / 1000,
  }));
  return filtro === 'sem_estoque' ? linhas.filter((l) => l.tipo === 'revenda' && l.saldo <= 0) : linhas;
}

export async function kpisProdutos(): Promise<KpisProdutos> {
  const s = await exigirSessao(PAPEIS_CADASTRO);
  const sb = supabaseAdmin();
  const d = new Date();
  const mes = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  // contagem no BANCO (head + count): a lista da tela mostra no máximo 500 linhas, os números não
  const conta = async (f: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => (await f(base())).count ?? 0;
  const base = () => sb.from('produtos').select('id', { count: 'exact', head: true }).eq('tenant_id', s.tenantId).eq('ativo', true);
  const [ativos, semCodigo, adultos, novosMes, revisar] = await Promise.all([
    conta((q) => q), conta((q) => q.is('codigo_barras', null)), conta((q) => q.eq('adulto', true)),
    conta((q) => q.gte('criado_em', mes)), conta((q) => q.not('revisar', 'is', null)),
  ]);
  // sem estoque: revenda ativa sem saldo positivo em nenhum local
  const comSaldo = new Set<string>();
  for (let de = 0; ; de += 1000) {
    const { data } = await sb.from('estoque_saldos').select('produto_id').gt('quantidade', 0).range(de, de + 999);
    for (const r of data ?? []) comSaldo.add(r.produto_id as string);
    if (!data || data.length < 1000) break;
  }
  let revenda = 0, revendaComSaldo = 0;
  for (let de = 0; ; de += 1000) {
    const { data } = await sb.from('produtos').select('id').eq('tenant_id', s.tenantId).eq('ativo', true)
      .eq('tipo', 'revenda').order('id').range(de, de + 999);
    for (const r of data ?? []) { revenda++; if (comSaldo.has(r.id as string)) revendaComSaldo++; }
    if (!data || data.length < 1000) break;
  }
  return { ativos, semCodigo, adultos, novosMes, revisar, semEstoque: revenda - revendaComSaldo };
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

// ================================================================ FICHA COMPLETA do produto (layout novo · 0010 produto_salvar_ficha)
// Tela "Cadastro de produto" (adega-sb-docs\novo layout\cadastro produtos001-003): dados gerais, financeiro,
// emissão fiscal (NF-e/NFC-e), reforma tributária, observações e "outros". Estoque NÃO se edita aqui.
export type FichaProduto = {
  id: string; nome: string; codigo: string; sku: string; codigo_barras: string;
  categoria: string; fornecedor: string; fabricante: string; unidade_comercial: string;
  preco_custo: string; preco_varejo: string; custo_medio: number | null; estoque_minimo: string; saldo: number; unidade: string;
  ultimo_reajuste: string; oculto_tabela: boolean; ativo: boolean; adulto: boolean; fumigeno: boolean;
  ncm: string; csosn: string; cest: string; origem: string; icms_aliquota: string; icms_base: string;
  ipi_aliquota: string; cst_pis: string; cst_cofins: string; peso_bruto: string; peso_liquido: string;
  cst_ibs_cbs: string; cclass_trib: string; observacao: string; gtin_tributavel: string; previsao_chegada: string;
  codigo_anp: string; fabricacao_propria: boolean; revisar: string | null; atualizado_em: string | null;
};

const br = (v: unknown, casas = 2) => (v === null || v === undefined || v === '' ? ''
  : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: Math.max(casas, 4), useGrouping: false }));
const tx = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export async function carregarFicha(id: string): Promise<FichaProduto | null> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  if (!UUID.safeParse(id).success) return null;
  const sb = supabaseAdmin();
  const { data: p } = await sb.from('produtos').select('*, categorias(nome)').eq('id', id).eq('tenant_id', s.tenantId).maybeSingle();
  if (!p) return null;
  const { data: sal } = await sb.from('estoque_saldos').select('quantidade').eq('produto_id', id);
  const saldo = (sal ?? []).reduce((a, r) => a + Number(r.quantidade), 0);
  return {
    id: p.id, nome: tx(p.nome), codigo: tx(p.codigo), sku: tx(p.sku), codigo_barras: tx(p.codigo_barras),
    categoria: (p.categorias as { nome: string } | null)?.nome ?? '', fornecedor: tx(p.fornecedor), fabricante: tx(p.fabricante),
    unidade_comercial: tx(p.unidade_comercial) || 'UN',
    preco_custo: br(p.preco_custo), preco_varejo: br(p.preco_varejo),
    custo_medio: p.custo_medio === null ? null : Number(p.custo_medio),
    estoque_minimo: br(p.estoque_minimo, 0), saldo: Math.round(saldo * 1000) / 1000, unidade: tx(p.unidade),
    ultimo_reajuste: tx(p.ultimo_reajuste), oculto_tabela: !!p.oculto_tabela, ativo: !!p.ativo,
    adulto: !!p.adulto, fumigeno: !!p.fumigeno,
    ncm: tx(p.ncm), csosn: tx(p.csosn), cest: tx(p.cest), origem: tx(p.origem ?? 0),
    icms_aliquota: br(p.icms_aliquota), icms_base: br(p.icms_base), ipi_aliquota: br(p.ipi_aliquota),
    cst_pis: tx(p.cst_pis), cst_cofins: tx(p.cst_cofins), peso_bruto: br(p.peso_bruto, 3), peso_liquido: br(p.peso_liquido, 3),
    cst_ibs_cbs: tx(p.cst_ibs_cbs), cclass_trib: tx(p.cclass_trib), observacao: tx(p.observacao),
    gtin_tributavel: tx(p.gtin_tributavel), previsao_chegada: tx(p.previsao_chegada), codigo_anp: tx(p.codigo_anp),
    fabricacao_propria: !!p.fabricacao_propria, revisar: (p.revisar as string | null) ?? null,
    atualizado_em: (p.atualizado_em as string | null) ?? null,
  };
}

// "Setor busca ou cadastra na hora": nome livre; se não existir, cria a categoria.
export async function salvarFicha(id: string, dados: Omit<FichaProduto, 'id' | 'custo_medio' | 'saldo' | 'unidade' | 'revisar' | 'atualizado_em'>):
  Promise<{ erro?: string; ok?: boolean }> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  if (!UUID.safeParse(id).success) return { erro: 'Produto não encontrado.' };
  const sb = supabaseAdmin();
  let categoriaId: string | null = null;
  const setor = dados.categoria.replace(/\s+/g, ' ').trim();
  if (setor) {
    const { data: cats } = await sb.from('categorias').select('id, nome').eq('tenant_id', s.tenantId);
    const achou = (cats ?? []).find((c) => String(c.nome).toLowerCase() === setor.toLowerCase());
    if (achou) categoriaId = achou.id as string;
    else {
      const { data: nova, error } = await sb.from('categorias').insert({ tenant_id: s.tenantId, nome: setor.slice(0, 60) }).select('id').single();
      if (error) return { erro: 'Não foi possível criar o setor ' + setor + '.' };
      categoriaId = nova.id as string;
    }
  }
  const { categoria: _c, ...resto } = dados;
  void _c;
  const { error } = await sb.rpc('produto_salvar_ficha', { p_usuario: s.id, p_id: id, p_dados: { ...resto, categoria_id: categoriaId } });
  return error ? { erro: traduzErro(error.message) } : { ok: true };
}

export async function listarSetores(): Promise<string[]> {
  const s = await exigirSessao(PAPEIS_CADASTRO);
  const { data } = await supabaseAdmin().from('categorias').select('nome').eq('tenant_id', s.tenantId).eq('ativo', true).order('nome');
  return (data ?? []).map((c) => c.nome as string);
}
