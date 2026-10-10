'use server';
import { z } from 'zod';
import { exigirSessao } from '@/lib/sessao';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Server actions do PDV balcão (modulo-pdv.md §5 e §8).
// Regras de negócio ficam NO SERVIDOR: preço lido do banco, caixa aberto obrigatório,
// operador sempre = usuário autenticado (nunca vem do cliente).

const UUID = z.string().uuid();

// ---------------------------------------------------------------- busca (PDV-02)
// Código exato primeiro, depois ILIKE (índice trigram), limit 8.
export type ProdutoBusca = {
  id: string; codigo_barras: string | null; nome: string;
  preco_varejo: number; adulto: boolean; fumigeno: boolean;
  estoque: number; categoria: string | null;
};

export async function buscarProdutos(termo: string, localId?: string): Promise<ProdutoBusca[]> {
  await exigirSessao(['master', 'gerente', 'caixa']);
  const t = termo.trim();
  if (t.length < 2) return [];              // PDV-01: começa vazia, 2+ caracteres
  const sb = supabaseAdmin();

  const { data: cats } = await sb.from('categorias').select('id, nome');
  const nomeCat = new Map((cats ?? []).map((c) => [c.id, c.nome]));

  let q = sb.from('produtos')
    .select('id, codigo_barras, nome, preco_varejo, adulto, fumigeno, ativo')
    .eq('ativo', true);

  const exato = /^\d{6,}$/.test(t);
  if (exato) q = q.eq('codigo_barras', t);
  else q = q.or(`nome.ilike.%${t}%,codigo_barras.ilike.%${t}%`);

  const { data, error } = await q.limit(8);
  if (error || !data?.length) return [];
  const ids = data.map((p) => p.id);

  // estoque: por local se informado (caixa aberto), senão soma de todos os locais
  let saldo = new Map<string, number>();
  if (localId) {
    const { data: s } = await sb.from('estoque_saldos')
      .select('produto_id, quantidade').eq('local_id', localId).in('produto_id', ids);
    saldo = new Map((s ?? []).map((r) => [r.produto_id, Number(r.quantidade)]));
  } else {
    const { data: s } = await sb.from('estoque_saldos')
      .select('produto_id, quantidade').in('produto_id', ids);
    for (const r of s ?? []) saldo.set(r.produto_id, (saldo.get(r.produto_id) ?? 0) + Number(r.quantidade));
  }

  const { data: prods } = await sb.from('produtos')
    .select('id, categoria_id').in('id', ids);

  // código exato primeiro (PDV-02), depois ordem alfabética
  return data
    .map((p) => ({
      id: p.id, codigo_barras: p.codigo_barras, nome: p.nome,
      preco_varejo: Number(p.preco_varejo), adulto: p.adulto, fumigeno: p.fumigeno,
      estoque: saldo.get(p.id) ?? 0,
      categoria: nomeCat.get(prods?.find((x) => x.id === p.id)?.categoria_id ?? '') ?? null,
    }))
    .sort((a, b) => {
      const ax = exato && a.codigo_barras === t ? 0 : 1;
      const bx = exato && b.codigo_barras === t ? 0 : 1;
      return ax - bx || a.nome.localeCompare(b.nome);
    });
}

// ---------------------------------------------------------------- caixas e sessão
export type CaixaInfo = { id: string; nome: string; local_id: string; local_nome: string };
export type ResumoCaixa = {
  sessaoId: string; aberta: boolean; valorAbertura: number;
  vendasQtd: number; vendasTotal: number; dinheiroEsperado: number;
  porForma: { pix: number; cartao: number; dinheiro: number };
  movimentos: { id: string; tipo: string; valor: number; motivo: string }[];
  operador: string; abertaEm: string;
};

export async function listarCaixas(): Promise<CaixaInfo[]> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  const sb = supabaseAdmin();
  let q = sb.from('caixas').select('id, nome, local_id, locais!inner(codigo)');
  // caixa/gerente vê só caixas dos seus locais; master vê todos.
  // Sem local vinculado → não vê caixa nenhum (antes viaja e abria caixa de qualquer local).
  if (s.papel !== 'master') {
    if (!s.locais.length) return [];
    q = q.in('local_id', s.locais);
  }
  const { data } = await q.eq('ativo', true).order('nome');
  return (data ?? []).map((c) => ({
    id: c.id, nome: c.nome, local_id: c.local_id,
    local_nome: (c.locais as unknown as { codigo: string })?.codigo ?? '',
  }));
}

async function resumoSessao(sessaoId: string): Promise<ResumoCaixa | null> {
  const sb = supabaseAdmin();
  const { data: sess } = await sb.from('caixa_sessoes')
    .select('id, status, valor_abertura, aberta_em, operador_id, profiles(nome)')
    .eq('id', sessaoId).maybeSingle();
  if (!sess) return null;

  const { data: vendas } = await sb.from('vendas')
    .select('total, forma_pagamento, criado_em').eq('caixa_sessao_id', sessaoId);
  const { data: movs } = await sb.from('caixa_movimentos')
    .select('id, tipo, valor, motivo').eq('sessao_id', sessaoId).order('criado_em');

  const porForma = { pix: 0, cartao: 0, dinheiro: 0 };
  let vendasTotal = 0;
  for (const v of vendas ?? []) {
    vendasTotal += Number(v.total);
    if (v.forma_pagamento === 'pix') porForma.pix += Number(v.total);
    else if (v.forma_pagamento === 'cartao') porForma.cartao += Number(v.total);
    else if (v.forma_pagamento === 'dinheiro') porForma.dinheiro += Number(v.total);
  }
  // CX-06: esperado = abertura + dinheiro das vendas + suprimentos − sangrias
  let dinheiroEsperado = Number(sess.valor_abertura) + porForma.dinheiro;
  for (const m of movs ?? []) {
    if (m.tipo === 'suprimento') dinheiroEsperado += Number(m.valor);
    else dinheiroEsperado -= Number(m.valor);
  }
  const { data: vendasHoje } = await sb.from('vendas')
    .select('id').eq('caixa_sessao_id', sessaoId);

  return {
    sessaoId, aberta: sess.status === 'aberta', valorAbertura: Number(sess.valor_abertura),
    vendasQtd: vendasHoje?.length ?? 0, vendasTotal, dinheiroEsperado,
    porForma,
    movimentos: (movs ?? []).map((m) => ({ id: m.id, tipo: m.tipo, valor: Number(m.valor), motivo: m.motivo })),
    operador: (sess.profiles as unknown as { nome: string })?.nome ?? '',
    abertaEm: sess.aberta_em,
  };
}

// Sessão aberta de um caixa, ou null (painel cai na tela de abertura, CX-01).
export async function sessaoAtual(caixaId: string): Promise<ResumoCaixa | null> {
  await exigirSessao(['master', 'gerente', 'caixa']);
  const sb = supabaseAdmin();
  const { data: sess } = await sb.from('caixa_sessoes')
    .select('id').eq('caixa_id', caixaId).eq('status', 'aberta').maybeSingle();
  if (!sess) return null;
  return resumoSessao(sess.id);
}

// Último turno fechado deste caixa (CX-09: resumo quando fechado).
export async function ultimoTurno(caixaId: string): Promise<ResumoCaixa | null> {
  await exigirSessao(['master', 'gerente', 'caixa']);
  const sb = supabaseAdmin();
  const { data: sess } = await sb.from('caixa_sessoes')
    .select('id').eq('caixa_id', caixaId).eq('status', 'fechada')
    .order('fechada_em', { ascending: false }).limit(1).maybeSingle();
  if (!sess) return null;
  return resumoSessao(sess.id);
}

// ---------------------------------------------------------------- abrir caixa (CX-01/CX-02)
export type EstadoCaixa = { erro?: string; sessaoId?: string };

const Abrir = z.object({ caixaId: UUID, valorAbertura: z.coerce.number().min(0, 'Valor inválido.') });

export async function abrirCaixa(_: EstadoCaixa, form: FormData): Promise<EstadoCaixa> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  const p = Abrir.safeParse({ caixaId: form.get('caixaId'), valorAbertura: form.get('valorAbertura') });
  if (!p.success) return { erro: p.error.issues[0].message };

  const sb = supabaseAdmin();
  const { data: caixa } = await sb.from('caixas')
    .select('id, local_id').eq('id', p.data.caixaId).eq('ativo', true).maybeSingle();
  if (!caixa) return { erro: 'Caixa não encontrado.' };

  // já aberto? devolve a sessão existente (índice único impede 2 abertas)
  const { data: aberta } = await sb.from('caixa_sessoes')
    .select('id').eq('caixa_id', caixa.id).eq('status', 'aberta').maybeSingle();
  if (aberta) return { sessaoId: aberta.id };

  const { data, error } = await sb.from('caixa_sessoes').insert({
    tenant_id: s.tenantId, caixa_id: caixa.id, local_id: caixa.local_id,
    operador_id: s.id, valor_abertura: p.data.valorAbertura,
  }).select('id').single();

  if (error) return { erro: error.message.includes('caixa_uma_sessao_aberta') ? 'Este caixa já está aberto.' : error.message };
  return { sessaoId: data.id };
}

// ---------------------------------------------------------------- movimentos (CX-04/CX-05)
const Mov = z.object({
  sessaoId: UUID,
  tipo: z.enum(['sangria', 'suprimento']),
  valor: z.coerce.number().positive('Valor deve ser maior que 0.'),
  motivo: z.string().trim().min(1, 'Informe o motivo.'),
});

export async function lancarMovimento(_: EstadoCaixa, form: FormData): Promise<EstadoCaixa> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  const p = Mov.safeParse({
    sessaoId: form.get('sessaoId'), tipo: form.get('tipo'),
    valor: form.get('valor'), motivo: form.get('motivo'),
  });
  if (!p.success) return { erro: p.error.issues[0].message };

  const sb = supabaseAdmin();
  const { data: sess } = await sb.from('caixa_sessoes')
    .select('id, status, operador_id').eq('id', p.data.sessaoId).maybeSingle();
  if (!sess) return { erro: 'Sessão não encontrada.' };
  if (sess.status !== 'aberta') return { erro: 'Caixa fechado.' };
  // §8: um operador não lança em sessão de outro (master pode operar qualquer uma)
  if (sess.operador_id !== s.id && s.papel !== 'master') return { erro: 'Esta sessão é de outro operador.' };

  // CX-05: sangria não pode passar do dinheiro esperado
  if (p.data.tipo === 'sangria') {
    const r = await resumoSessao(sess.id);
    if (r && p.data.valor > r.dinheiroEsperado + 0.005) {
      return { erro: `A gaveta tem só R$ ${r.dinheiroEsperado.toFixed(2)} em dinheiro.` };
    }
  }

  const { error } = await sb.from('caixa_movimentos').insert({
    tenant_id: s.tenantId, sessao_id: sess.id, tipo: p.data.tipo,
    valor: p.data.valor, motivo: p.data.motivo, criado_por: s.id,
  });
  if (error) return { erro: error.message };
  return {};
}

// ---------------------------------------------------------------- fechar caixa (CX-07/CX-08)
const Fechar = z.object({ sessaoId: UUID, valorContado: z.coerce.number().min(0, 'Valor inválido.') });

export type ResultadoFechamento = { erro?: string; diferenca?: number; esperado?: number };

export async function fecharCaixa(_: ResultadoFechamento, form: FormData): Promise<ResultadoFechamento> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  const p = Fechar.safeParse({ sessaoId: form.get('sessaoId'), valorContado: form.get('valorContado') });
  if (!p.success) return { erro: p.error.issues[0].message };

  const sb = supabaseAdmin();
  const { data: sess } = await sb.from('caixa_sessoes')
    .select('id, status, operador_id, valor_abertura').eq('id', p.data.sessaoId).maybeSingle();
  if (!sess) return { erro: 'Sessão não encontrada.' };
  if (sess.status !== 'aberta') return { erro: 'Este caixa já está fechado.' };
  if (sess.operador_id !== s.id && s.papel !== 'master') return { erro: 'Esta sessão é de outro operador.' };

  const r = await resumoSessao(sess.id);
  const esperado = r?.dinheiroEsperado ?? 0;
  const diferenca = p.data.valorContado - esperado;

  const { error } = await sb.from('caixa_sessoes').update({
    valor_esperado: esperado, valor_contado: p.data.valorContado,
    diferenca, fechada_em: new Date().toISOString(), status: 'fechada',
  }).eq('id', sess.id);
  if (error) return { erro: error.message };
  return { diferenca, esperado };
}

// ---------------------------------------------------------------- finalizar venda (FV-03)
const Item = z.object({ produto_id: UUID, quantidade: z.coerce.number().positive().max(999) });
const Finalizar = z.object({
  sessaoId: UUID,
  itens: z.array(Item).min(1, 'Comanda vazia.'),
  desconto: z.coerce.number().min(0).default(0),
  forma: z.enum(['pix', 'cartao', 'dinheiro']),
  maior18: z.boolean().default(false),
});

export type ResultadoVenda = { erro?: string; total?: number; forma?: string };

export async function finalizarVendaPdv(dados: {
  sessaoId: string; itens: { produto_id: string; quantidade: number }[];
  desconto?: number; forma: 'pix' | 'cartao' | 'dinheiro'; maior18?: boolean;
}): Promise<ResultadoVenda> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  const p = Finalizar.safeParse(dados);
  if (!p.success) return { erro: p.error.issues[0].message };

  const sb = supabaseAdmin();
  const { data: sess } = await sb.from('caixa_sessoes')
    .select('id, status, operador_id').eq('id', p.data.sessaoId).maybeSingle();
  if (!sess) return { erro: 'Sessão não encontrada.' };
  if (sess.status !== 'aberta') return { erro: 'Abra o caixa para vender.' };
  if (sess.operador_id !== s.id && s.papel !== 'master') return { erro: 'Esta sessão é de outro operador.' };

  // FV-03: transação única no banco (venda + itens + movimentos + baixa de estoque)
  const { data, error } = await sb.rpc('finalizar_venda_pdv', {
    p_caixa_sessao_id: p.data.sessaoId,
    p_forma_pagamento: p.data.forma,
    p_produtos: p.data.itens.map((i) => i.produto_id),
    p_quantidades: p.data.itens.map((i) => i.quantidade),
    p_desconto: p.data.desconto,
    p_cpf: null,
    p_maior18: p.data.maior18,
  });
  if (error) return { erro: traduzErro(error.message) };

  const r = await resumoSessao(sess.id);
  const ultima = r ? r.vendasTotal : 0;
  return { total: ultima, forma: p.data.forma, ...(typeof data === 'string' ? { sessao: data } : {}) };
}

function traduzErro(msg: string): string {
  if (msg.includes('18')) return 'Item +18: confirme que o cliente é maior de 18 anos.';
  if (msg.includes('saldo insuficiente')) return 'Estoque insuficiente para um dos itens.';
  if (msg.includes('caixa fechado')) return 'Abra o caixa para vender.';
  if (msg.includes('vazia')) return 'A comanda está vazia.';
  return msg;
}

// ================================================================ módulos do topo do PDV
// Os 3 botões do header (Precificação · Site da loja · Vendas e entregas F9).
// Todos leem dado REAL do banco — nenhum dado de protótipo.

// ---------------------------------------------------------------- precificação (fichas da 0004)
export type FichaPrecificacao = {
  fichaId: string;
  produtoId: string;
  nome: string;
  sku: string | null;
  precoVarejo: number;
  markup: number;
  cmv: number;
  precoSugerido: number;
  margem: number;
  margemPct: number;
  insumos: {
    id: string; nome: string; dose: number; unidade: string;
    conteudo: number; custoMedio: number; custo: number;
  }[];
};

type ProdFicha = { id: string; nome: string; sku: string | null; preco_varejo: number };
type ProdInsumo = { id: string; nome: string; conteudo: number | null; custo_medio: number | null };
type FichaLinha = { id: string; markup: number; produtos: ProdFicha | ProdFicha[] | null };
type InsumoLinha = {
  ficha_id: string;
  quantidade: number; unidade: string;
  produtos: ProdInsumo | ProdInsumo[] | null;
};

// O PostgREST devolve a FK embutida como objeto quando dá para inferir a cardinalidade e como
// array quando não dá — aqui a relação é simples (produto_id → produtos), então normaliza.
const obj = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function listarPrecificacao(): Promise<FichaPrecificacao[]> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  const sb = supabaseAdmin();

  const { data: fichas } = await sb.from('fichas_tecnicas')
    .select('id, markup, produto_id, produtos(id, nome, sku, preco_varejo)')
    .eq('tenant_id', s.tenantId);
  if (!fichas?.length) return [];

  const { data: ins } = await sb.from('fichas_tecnicas_insumos')
    .select('ficha_id, quantidade, unidade, produtos(id, nome, conteudo, custo_medio)')
    .eq('tenant_id', s.tenantId)
    .in('ficha_id', fichas.map((f) => f.id));

  const porFicha = new Map<string, InsumoLinha[]>();
  for (const i of (ins ?? []) as unknown as InsumoLinha[]) {
    const lista = porFicha.get(i.ficha_id) ?? [];
    lista.push(i);
    porFicha.set(i.ficha_id, lista);
  }

  return ((fichas ?? []) as unknown as FichaLinha[])
    .flatMap((f) => {
      const prod = obj(f.produtos);
      if (!prod) return [];
      // CMV por unidade preparada = Σ (dose ÷ conteúdo) × custo médio  (mesma conta da
      // ficha_consumir da 0004, que divide a dose pelo conteúdo da embalagem)
      const insumos = (porFicha.get(f.id) ?? []).map((i) => {
        const p = obj(i.produtos);
        const conteudo = Number(p?.conteudo ?? 0) || 1;
        const unidades = Number(i.quantidade) / conteudo;
        const custoMedio = Number(p?.custo_medio ?? 0);
        return {
          id: p?.id ?? '', nome: p?.nome ?? '—',
          dose: Number(i.quantidade), unidade: i.unidade,
          conteudo, custoMedio, custo: unidades * custoMedio,
        };
      });
      const cmv = insumos.reduce((a, x) => a + x.custo, 0);
      const markup = Number(f.markup);
      const precoSugerido = cmv * markup;
      const precoVarejo = Number(prod.preco_varejo);
      return [{
        fichaId: f.id, produtoId: prod.id,
        nome: prod.nome, sku: prod.sku,
        precoVarejo, markup, cmv,
        precoSugerido,
        margem: precoSugerido - cmv,
        margemPct: precoSugerido > 0 ? ((precoSugerido - cmv) / precoSugerido) * 100 : 0,
        insumos,
      }];
    })
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

export type ResultadoSimples = { erro?: string; ok?: boolean };

// Aplica o preço sugerido no produto (só quem administra o catálogo).
export async function aplicarPrecoVarejo(dados: { produtoId: string; preco: number }): Promise<ResultadoSimples> {
  const s = await exigirSessao(['master', 'gerente']);
  const p = z.object({ produtoId: UUID, preco: z.coerce.number().min(0.01, 'Preço inválido.') }).safeParse(dados);
  if (!p.success) return { erro: p.error.issues[0].message };

  const sb = supabaseAdmin();
  const { data, error } = await sb.from('produtos')
    .update({ preco_varejo: p.data.preco, atualizado_em: new Date().toISOString() })
    .eq('id', p.data.produtoId).eq('tenant_id', s.tenantId)
    .select('id').maybeSingle();
  if (error) return { erro: error.message };
  if (!data) return { erro: 'Produto não encontrado.' };
  return { ok: true };
}

// ---------------------------------------------------------------- vendas do dia (F9)
export type VendaDia = {
  id: string; hora: string; canal: string; forma: string;
  total: number; operador: string; itensQtd: number;
};

export async function vendasDoDia(): Promise<{ vendas: VendaDia[]; total: number }> {
  await exigirSessao(['master', 'gerente', 'caixa']);
  const sb = supabaseAdmin();
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const { data: vs } = await sb.from('vendas')
    .select('id, criado_em, canal, forma_pagamento, total, profiles(nome)')
    .gte('criado_em', hoje.toISOString())
    .order('criado_em', { ascending: false })
    .limit(200);
  if (!vs?.length) return { vendas: [], total: 0 };

  const ids = vs.map((v) => v.id);
  const { data: itens } = await sb.from('venda_itens')
    .select('venda_id').in('venda_id', ids);
  const qtd = new Map<string, number>();
  for (const i of itens ?? []) qtd.set(i.venda_id, (qtd.get(i.venda_id) ?? 0) + 1);

  const vendas = vs.map((v) => ({
    id: v.id,
    hora: new Date(v.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    canal: v.canal,
    forma: v.forma_pagamento,
    total: Number(v.total),
    operador: (v.profiles as unknown as { nome: string } | null)?.nome ?? '—',
    itensQtd: qtd.get(v.id) ?? 0,
  }));
  return { vendas, total: vendas.reduce((a, v) => a + v.total, 0) };
}

// ---------------------------------------------------------------- catálogo do site (visão do cliente)
export type ItemSite = {
  id: string; nome: string; sku: string | null; preco: number;
  categoria: string | null; adulto: boolean; estoque: number;
};

export async function catalogoSite(): Promise<{ itens: ItemSite[]; categorias: string[] }> {
  await exigirSessao(['master', 'gerente', 'caixa']);
  const sb = supabaseAdmin();

  const { data: cats } = await sb.from('categorias').select('id, nome');
  const nomeCat = new Map((cats ?? []).map((c) => [c.id, c.nome]));

  const { data: prods } = await sb.from('produtos')
    .select('id, nome, sku, preco_varejo, categoria_id, adulto, ativo')
    .eq('ativo', true)
    .order('nome');
  if (!prods?.length) return { itens: [], categorias: [] };

  const { data: saldos } = await sb.from('estoque_saldos')
    .select('produto_id, quantidade').in('produto_id', prods.map((p) => p.id));
  const saldo = new Map<string, number>();
  for (const s of saldos ?? []) saldo.set(s.produto_id, (saldo.get(s.produto_id) ?? 0) + Number(s.quantidade));

  const itens = prods.map((p) => ({
    id: p.id, nome: p.nome, sku: p.sku,
    preco: Number(p.preco_varejo),
    categoria: nomeCat.get(p.categoria_id ?? '') ?? null,
    adulto: p.adulto,
    estoque: saldo.get(p.id) ?? 0,
  }));
  const categorias = [...new Set(itens.map((i) => i.categoria).filter(Boolean) as string[])].sort();
  return { itens, categorias };
}
