'use server';
import { z } from 'zod';
import { exigirSessao } from '@/lib/sessao';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { cpfValido } from '@/lib/cpf';
import { normalizarChave, textoPix } from '@/lib/pix';

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
  porForma: { pix: number; cartao: number; dinheiro: number; credito: number };
  movimentos: { id: string; tipo: string; valor: number; motivo: string }[];
  operador: string; operadorId: string; abertaEm: string;
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

  const porForma = { pix: 0, cartao: 0, dinheiro: 0, credito: 0 };
  let vendasTotal = 0;
  for (const v of vendas ?? []) {
    vendasTotal += Number(v.total);
    if (v.forma_pagamento === 'pix') porForma.pix += Number(v.total);
    else if (v.forma_pagamento === 'cartao') porForma.cartao += Number(v.total);
    else if (v.forma_pagamento === 'dinheiro') porForma.dinheiro += Number(v.total);
    else if (v.forma_pagamento === 'credito') porForma.credito += Number(v.total);   // 0009: não entra na gaveta
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
    operadorId: sess.operador_id as string,
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

export type ResultadoFechamento = { erro?: string; diferenca?: number; esperado?: number; sessaoId?: string };

export async function fecharCaixa(_: ResultadoFechamento, form: FormData): Promise<ResultadoFechamento> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  const p = Fechar.safeParse({ sessaoId: form.get('sessaoId'), valorContado: form.get('valorContado') });
  if (!p.success) return { erro: p.error.issues[0].message };

  const sb = supabaseAdmin();
  const { data: sess } = await sb.from('caixa_sessoes')
    .select('id, status, operador_id, valor_abertura, local_id').eq('id', p.data.sessaoId).maybeSingle();
  if (!sess) return { erro: 'Sessão não encontrada.' };
  if (sess.status !== 'aberta') return { erro: 'Este caixa já está fechado.' };
  if (sess.operador_id !== s.id && s.papel !== 'master') return { erro: 'Esta sessão é de outro operador.' };
  // 0011: conta de cliente aberta = consumo ainda não pago → não deixa fechar o caixa
  const { count: contasAbertas } = await sb.from('comandas').select('id', { count: 'exact', head: true })
    .eq('local_id', sess.local_id).eq('status', 'aberta').eq('origem', 'pdv');
  if (contasAbertas) {
    return { erro: `Há ${contasAbertas} conta${contasAbertas > 1 ? 's' : ''} de cliente aberta${contasAbertas > 1 ? 's' : ''}: receba ou feche antes de fechar o caixa.` };
  }

  const r = await resumoSessao(sess.id);
  const esperado = r?.dinheiroEsperado ?? 0;
  const diferenca = p.data.valorContado - esperado;

  const { error } = await sb.from('caixa_sessoes').update({
    valor_esperado: esperado, valor_contado: p.data.valorContado,
    diferenca, fechada_em: new Date().toISOString(), status: 'fechada',
  }).eq('id', sess.id);
  if (error) return { erro: error.message };
  return { diferenca, esperado, sessaoId: sess.id };
}

// ---------------------------------------------------------------- finalizar venda (FV-03)
const Item = z.object({ produto_id: UUID, quantidade: z.coerce.number().positive().max(999) });
const Finalizar = z.object({
  sessaoId: UUID,
  itens: z.array(Item).min(1, 'Comanda vazia.'),
  desconto: z.coerce.number().min(0).default(0),
  forma: z.enum(['pix', 'cartao', 'dinheiro', 'credito']),
  maior18: z.boolean().default(false),
  clienteId: UUID.nullable().default(null),   // opcional (0008): cliente identificado na venda
  cpf: z.string().regex(/^\d{11}$/, 'CPF inválido.').nullable().default(null),   // "CPF na nota?" (só dígitos)
});

export type ResultadoVenda = { erro?: string; total?: number; forma?: string; vendaId?: string; quando?: string };

export async function finalizarVendaPdv(dados: {
  sessaoId: string; itens: { produto_id: string; quantidade: number }[];
  desconto?: number; forma: 'pix' | 'cartao' | 'dinheiro' | 'credito'; maior18?: boolean; clienteId?: string | null; cpf?: string | null;
}): Promise<ResultadoVenda> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  const p = Finalizar.safeParse(dados);
  if (!p.success) return { erro: p.error.issues[0].message };
  if (p.data.forma === 'credito' && !p.data.clienteId) return { erro: 'Crédito exige cliente: identifique o cliente (F4).' };
  if (p.data.cpf && !cpfValido(p.data.cpf)) return { erro: 'CPF inválido: confira os números.' };

  const sb = supabaseAdmin();
  const { data: sess } = await sb.from('caixa_sessoes')
    .select('id, status, operador_id').eq('id', p.data.sessaoId).maybeSingle();
  if (!sess) return { erro: 'Sessão não encontrada.' };
  if (sess.status !== 'aberta') return { erro: 'Abra o caixa para vender.' };
  if (sess.operador_id !== s.id && s.papel !== 'master') return { erro: 'Esta sessão é de outro operador.' };

  // FV-03: transação única no banco (venda + itens + movimentos + baixa de estoque).
  // 0008: a mesma venda passa por finalizar_venda_pdv_cliente, que valida o cliente (ativo, mesmo
  // tenant), grava vendas.cliente_id e leva o CPF do cadastro para vendas.cpf — tudo na mesma transação.
  const { data, error } = await sb.rpc('finalizar_venda_pdv_cliente', {
    p_caixa_sessao_id: p.data.sessaoId,
    p_forma_pagamento: p.data.forma,
    p_produtos: p.data.itens.map((i) => i.produto_id),
    p_quantidades: p.data.itens.map((i) => i.quantidade),
    p_desconto: p.data.desconto,
    p_maior18: p.data.maior18,
    p_cliente: p.data.clienteId,
  });
  if (error) return { erro: traduzErro(error.message) };

  const vendaId = typeof data === 'string' ? data : undefined;
  // "CPF na nota?": o digitado vale mais que o do cadastro. Gravado logo depois da venda (a função do banco
  // só recebe o CPF do cliente); se falhar, a venda segue válida e o comprovante sai sem CPF.
  let quando: string | undefined;
  if (vendaId) {
    const upd = p.data.cpf
      ? await sb.from('vendas').update({ cpf: p.data.cpf }).eq('id', vendaId).select('criado_em').maybeSingle()
      : await sb.from('vendas').select('criado_em').eq('id', vendaId).maybeSingle();
    quando = (upd.data?.criado_em as string | undefined) ?? undefined;
  }
  const r = await resumoSessao(sess.id);
  const ultima = r ? r.vendasTotal : 0;
  return { total: ultima, forma: p.data.forma, vendaId, quando };
}

// ================================================================ conta de cliente (0011)
// Consumo no local com o NOME do cliente (como mesa de bar). Cada pessoa que paga vira uma venda própria.
export type ContaItem = { id: string; produtoId: string; nome: string; qtd: number; preco: number; subtotal: number; adulto: boolean };
export type Conta = { id: string; nome: string; total: number; abertaEm: string; clienteId: string | null; itens: ContaItem[] };

type LinhaConta = {
  id: string; nome: string; total: number; aberta_em: string; cliente_id: string | null;
  comanda_itens: { id: string; produto_id: string; quantidade: number; preco_unit: number; subtotal: number;
    produtos: { nome: string; adulto: boolean } | { nome: string; adulto: boolean }[] | null }[];
};

export async function listarContas(localId: string): Promise<Conta[]> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  if (!UUID.safeParse(localId).success) return [];
  if (s.papel !== 'master' && s.papel !== 'gerente' && !s.locais.includes(localId)) return [];
  const { data } = await supabaseAdmin().from('comandas')
    .select('id, nome, total, aberta_em, cliente_id, comanda_itens(id, produto_id, quantidade, preco_unit, subtotal, produtos(nome, adulto))')
    .eq('local_id', localId).eq('status', 'aberta').eq('origem', 'pdv').order('aberta_em');
  return ((data ?? []) as unknown as LinhaConta[]).map((c) => ({
    id: c.id, nome: c.nome, total: Number(c.total), abertaEm: c.aberta_em, clienteId: c.cliente_id,
    itens: (c.comanda_itens ?? []).map((i) => {
      const prod = Array.isArray(i.produtos) ? i.produtos[0] : i.produtos;
      return { id: i.id, produtoId: i.produto_id, nome: prod?.nome ?? '?', qtd: Number(i.quantidade),
        preco: Number(i.preco_unit), subtotal: Number(i.subtotal), adulto: !!prod?.adulto };
    }).sort((a, b) => a.nome.localeCompare(b.nome)),
  }));
}

// a sessão precisa estar aberta e ser do operador (mesma regra do balcão — §8)
async function sessaoDoOperador(sessaoId: string, usuarioId: string, papel: string) {
  const { data: sess } = await supabaseAdmin().from('caixa_sessoes')
    .select('id, status, operador_id, local_id').eq('id', sessaoId).maybeSingle();
  if (!sess) return { erro: 'Sessão não encontrada.' };
  if (sess.status !== 'aberta') return { erro: 'Abra o caixa para usar a conta de cliente.' };
  if (sess.operador_id !== usuarioId && papel !== 'master') return { erro: 'Esta sessão é de outro operador.' };
  return { sess };
}

export async function abrirConta(dados: { sessaoId: string; nome: string; clienteId?: string | null }): Promise<{ erro?: string; contaId?: string }> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  const p = z.object({ sessaoId: UUID, nome: z.string().trim().min(1, 'Informe o nome da conta.').max(60, 'Nome muito longo (até 60 letras).'),
    clienteId: UUID.nullable().default(null) }).safeParse(dados);
  if (!p.success) return { erro: p.error.issues[0].message };
  const v = await sessaoDoOperador(p.data.sessaoId, s.id, s.papel);
  if (v.erro) return { erro: v.erro };
  const { data, error } = await supabaseAdmin().rpc('conta_abrir', {
    p_sessao: p.data.sessaoId, p_usuario: s.id, p_nome: p.data.nome, p_cliente: p.data.clienteId,
  });
  if (error) return { erro: traduzErro(error.message) };
  return { contaId: data as string };
}

async function contaDoLocal(contaId: string, localId: string) {
  const { data } = await supabaseAdmin().from('comandas').select('id, status, origem, local_id').eq('id', contaId).maybeSingle();
  if (!data || data.origem !== 'pdv' || data.local_id !== localId) return 'Conta não encontrada.';
  if (data.status !== 'aberta') return 'Esta conta já foi fechada.';
  return null;
}

export async function adicionarNaConta(dados: { sessaoId: string; contaId: string; produtoId: string; qtd: number; maior18: boolean }): Promise<{ erro?: string }> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  const p = z.object({ sessaoId: UUID, contaId: UUID, produtoId: UUID, qtd: z.number().positive().max(999), maior18: z.boolean() }).safeParse(dados);
  if (!p.success) return { erro: p.error.issues[0].message };
  const v = await sessaoDoOperador(p.data.sessaoId, s.id, s.papel);
  if (v.erro || !v.sess) return { erro: v.erro };
  const e = await contaDoLocal(p.data.contaId, v.sess.local_id);
  if (e) return { erro: e };
  const { error } = await supabaseAdmin().rpc('comanda_adicionar', {
    p_comanda: p.data.contaId, p_produto: p.data.produtoId, p_quantidade: p.data.qtd, p_tipo_item: 'revenda', p_maior18: p.data.maior18,
  });
  if (error) return { erro: traduzErro(error.message) };
  return {};
}

export async function ajustarItemConta(dados: { sessaoId: string; contaId: string; itemId: string; qtd: number }): Promise<{ erro?: string }> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  const p = z.object({ sessaoId: UUID, contaId: UUID, itemId: UUID, qtd: z.number().min(0).max(999) }).safeParse(dados);
  if (!p.success) return { erro: p.error.issues[0].message };
  const v = await sessaoDoOperador(p.data.sessaoId, s.id, s.papel);
  if (v.erro || !v.sess) return { erro: v.erro };
  const e = await contaDoLocal(p.data.contaId, v.sess.local_id);
  if (e) return { erro: e };
  const sb = supabaseAdmin();
  const { data: it } = await sb.from('comanda_itens').select('comanda_id').eq('id', p.data.itemId).maybeSingle();
  if (!it || it.comanda_id !== p.data.contaId) return { erro: 'Item não pertence a esta conta.' };
  const { error } = await sb.rpc('conta_ajustar_item', { p_item: p.data.itemId, p_quantidade: p.data.qtd });
  if (error) return { erro: traduzErro(error.message) };
  return {};
}

export async function pagarParteConta(dados: {
  sessaoId: string; contaId: string; forma: 'pix' | 'cartao' | 'dinheiro' | 'credito';
  itens: { itemId: string; qtd: number }[]; maior18: boolean; clienteId?: string | null; cpf?: string | null;
}): Promise<{ erro?: string; vendaId?: string; quando?: string; total?: number }> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  const p = z.object({
    sessaoId: UUID, contaId: UUID, forma: z.enum(['pix', 'cartao', 'dinheiro', 'credito']),
    itens: z.array(z.object({ itemId: UUID, qtd: z.number().positive().max(999) })).min(1, 'Escolha ao menos um item para esta pessoa.'),
    maior18: z.boolean(), clienteId: UUID.nullable().default(null),
    cpf: z.string().regex(/^\d{11}$/, 'CPF inválido.').nullable().default(null),
  }).safeParse(dados);
  if (!p.success) return { erro: p.error.issues[0].message };
  if (p.data.forma === 'credito' && !p.data.clienteId) return { erro: 'Crédito exige cliente cadastrado na conta.' };
  if (p.data.cpf && !cpfValido(p.data.cpf)) return { erro: 'CPF inválido: confira os números.' };
  const v = await sessaoDoOperador(p.data.sessaoId, s.id, s.papel);
  if (v.erro || !v.sess) return { erro: v.erro };
  const e = await contaDoLocal(p.data.contaId, v.sess.local_id);
  if (e) return { erro: e };
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc('conta_pagar_parte', {
    p_comanda: p.data.contaId, p_caixa_sessao: p.data.sessaoId, p_forma: p.data.forma,
    p_itens: p.data.itens.map((i) => i.itemId), p_qtds: p.data.itens.map((i) => Math.round(i.qtd * 1000) / 1000),
    p_maior18: p.data.maior18, p_cliente: p.data.clienteId, p_cpf: p.data.cpf,
  });
  if (error) return { erro: traduzErro(error.message) };
  const vendaId = data as string;
  const { data: vd } = await sb.from('vendas').select('criado_em, total').eq('id', vendaId).maybeSingle();
  return { vendaId, quando: vd?.criado_em as string | undefined, total: vd ? Number(vd.total) : undefined };
}

function traduzErro(msg: string): string {
  if (msg.includes('cliente não encontrado')) return 'Cliente não encontrado ou desativado. Identifique de novo.';
  if (msg.includes('crédito exige cliente')) return 'Crédito exige cliente: identifique o cliente (F4).';
  if (msg.includes('limite de crédito excedido')) return msg.replace(/^.*limite de crédito excedido/, 'Limite de crédito excedido') + '.';
  if (msg.includes('+18')) return 'Item +18: confirme que o cliente é maior de 18 anos.';
  if (msg.includes('saldo insuficiente')) return 'Estoque insuficiente para um dos itens.';
  if (msg.includes('caixa fechado')) return 'Abra o caixa para vender.';
  if (msg.includes('vazia')) return 'A comanda está vazia.';
  if (msg.includes('já existe uma conta aberta')) return msg.replace(/^.*já existe/, 'Já existe') + '.';
  if (msg.includes('quantidade maior que a que está na conta')) return 'Quantidade maior que a que ainda está na conta.';
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

// ---------------------------------------------------------------- PIX: QR estático com valor
// A chave fica em tenants.config.pix = { chave, nome, cidade } (não é segredo: vai impressa no QR).
// Só o master cadastra/troca. O QR NÃO confirma pagamento: o caixa confere no banco e clica "PIX recebido".
export type ChavePix = { chave: string; nome: string; cidade: string; tipo: string };

export async function lerChavePix(): Promise<{ pix: ChavePix | null; podeEditar: boolean }> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  const { data } = await supabaseAdmin().from('tenants').select('config').eq('id', s.tenantId).single();
  const p = (data?.config as { pix?: Partial<ChavePix> } | null)?.pix;
  const pix = p?.chave && p.nome && p.cidade ? { chave: p.chave, nome: p.nome, cidade: p.cidade, tipo: p.tipo ?? '' } : null;
  return { pix, podeEditar: s.papel === 'master' };
}

export async function salvarChavePix(input: { chave: string; nome: string; cidade: string }): Promise<{ erro?: string; pix?: ChavePix }> {
  const s = await exigirSessao(['master']);
  const k = normalizarChave(String(input.chave ?? ''));
  if (!k) return { erro: 'Chave PIX inválida: use CPF, CNPJ, e-mail, celular com DDD ou chave aleatória.' };
  const nome = textoPix(String(input.nome ?? ''), 25);
  const cidade = textoPix(String(input.cidade ?? ''), 15);
  if (nome.length < 2) return { erro: 'Informe o nome do recebedor (como aparece no banco).' };
  if (cidade.length < 2) return { erro: 'Informe a cidade do recebedor.' };
  const sb = supabaseAdmin();
  const { data, error: e1 } = await sb.from('tenants').select('config').eq('id', s.tenantId).single();
  if (e1) return { erro: 'Não foi possível ler a configuração da empresa.' };
  const pix: ChavePix = { chave: k.chave, nome, cidade, tipo: k.tipo };
  const config = { ...((data?.config as Record<string, unknown>) ?? {}), pix };
  const { error } = await sb.from('tenants').update({ config }).eq('id', s.tenantId);
  if (error) return { erro: 'Não foi possível salvar a chave PIX.' };
  return { pix };
}

// ---------------------------------------------------------------- relatório de fechamento (impresso)
// Tudo que o dono confere no fim do turno: abertura, vendas por forma, descontos, sangrias/suprimentos,
// recebimentos de crédito, esperado × contado, diferença e produtos vendidos. Caixa só vê a própria sessão.
export type RelatorioFechamento = {
  sessaoId: string; caixa: string; local: string; operador: string; status: 'aberta' | 'fechada';
  abertaEm: string; fechadaEm: string | null; emitidoEm: string; emitidoPor: string;
  valorAbertura: number; vendasQtd: number; vendasBruto: number; descontos: number; vendasTotal: number; ticketMedio: number;
  porForma: { pix: number; cartao: number; dinheiro: number; credito: number };
  qtdPorForma: { pix: number; cartao: number; dinheiro: number; credito: number };
  movimentos: { tipo: string; valor: number; motivo: string; quando: string }[];
  sangrias: number; suprimentos: number;
  recebCredito: { pix: number; cartao: number; dinheiro: number };
  esperado: number; contado: number | null; diferenca: number | null;
  produtos: { nome: string; qtd: number; total: number }[];
};

export async function relatorioFechamento(sessaoId: string): Promise<{ erro?: string; r?: RelatorioFechamento }> {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  if (!UUID.safeParse(sessaoId).success) return { erro: 'Sessão inválida.' };
  const sb = supabaseAdmin();
  const { data: sess } = await sb.from('caixa_sessoes')
    .select('id, tenant_id, status, valor_abertura, valor_esperado, valor_contado, diferenca, aberta_em, fechada_em, operador_id, profiles(nome), caixas(nome), locais(nome)')
    .eq('id', sessaoId).maybeSingle();
  if (!sess || sess.tenant_id !== s.tenantId) return { erro: 'Sessão não encontrada.' };
  if (s.papel === 'caixa' && sess.operador_id !== s.id) return { erro: 'Você só imprime o fechamento do seu caixa.' };

  const [{ data: vendas }, { data: movs }, { data: rec }] = await Promise.all([
    sb.from('vendas').select('id, subtotal, desconto, total, forma_pagamento').eq('caixa_sessao_id', sessaoId),
    sb.from('caixa_movimentos').select('tipo, valor, motivo, criado_em').eq('sessao_id', sessaoId).order('criado_em'),
    sb.from('credito_pagamentos').select('valor, forma').eq('caixa_sessao_id', sessaoId),
  ]);
  const porForma = { pix: 0, cartao: 0, dinheiro: 0, credito: 0 };
  const qtdPorForma = { pix: 0, cartao: 0, dinheiro: 0, credito: 0 };
  let bruto = 0, descontos = 0, total = 0;
  for (const v of vendas ?? []) {
    const f = v.forma_pagamento as keyof typeof porForma;
    if (f in porForma) { porForma[f] += Number(v.total); qtdPorForma[f] += 1; }
    bruto += Number(v.subtotal); descontos += Number(v.desconto); total += Number(v.total);
  }
  const recebCredito = { pix: 0, cartao: 0, dinheiro: 0 };
  for (const p of rec ?? []) { const f = p.forma as keyof typeof recebCredito; if (f in recebCredito) recebCredito[f] += Number(p.valor); }
  let sangrias = 0, suprimentos = 0;
  for (const m of movs ?? []) { if (m.tipo === 'sangria') sangrias += Number(m.valor); else suprimentos += Number(m.valor); }

  // produtos vendidos no turno (em lotes de 200 vendas para não estourar a URL)
  const ids = (vendas ?? []).map((v) => v.id as string);
  const agg = new Map<string, { nome: string; qtd: number; total: number }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: itens } = await sb.from('venda_itens').select('produto_id, quantidade, subtotal, produtos(nome)').in('venda_id', ids.slice(i, i + 200));
    for (const it of itens ?? []) {
      const prod = Array.isArray(it.produtos) ? it.produtos[0] : it.produtos;
      const a = agg.get(it.produto_id as string) ?? { nome: (prod as { nome?: string } | null)?.nome ?? '?', qtd: 0, total: 0 };
      a.qtd += Number(it.quantidade); a.total += Number(it.subtotal);
      agg.set(it.produto_id as string, a);
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const esperado = sess.status === 'fechada' && sess.valor_esperado !== null ? Number(sess.valor_esperado)
    : r2(Number(sess.valor_abertura) + porForma.dinheiro + suprimentos - sangrias);
  const um = <T,>(x: unknown) => (Array.isArray(x) ? x[0] : x) as T | null;
  return { r: {
    sessaoId, caixa: um<{ nome: string }>(sess.caixas)?.nome ?? '', local: um<{ nome: string }>(sess.locais)?.nome ?? '',
    operador: um<{ nome: string }>(sess.profiles)?.nome ?? '', status: sess.status as 'aberta' | 'fechada',
    abertaEm: sess.aberta_em as string, fechadaEm: (sess.fechada_em as string | null) ?? null,
    emitidoEm: new Date().toISOString(), emitidoPor: s.nome,
    valorAbertura: Number(sess.valor_abertura), vendasQtd: vendas?.length ?? 0,
    vendasBruto: r2(bruto), descontos: r2(descontos), vendasTotal: r2(total),
    ticketMedio: vendas?.length ? r2(total / vendas.length) : 0,
    porForma: { pix: r2(porForma.pix), cartao: r2(porForma.cartao), dinheiro: r2(porForma.dinheiro), credito: r2(porForma.credito) },
    qtdPorForma,
    movimentos: (movs ?? []).map((m) => ({ tipo: m.tipo as string, valor: Number(m.valor), motivo: (m.motivo as string) ?? '', quando: m.criado_em as string })),
    sangrias: r2(sangrias), suprimentos: r2(suprimentos),
    recebCredito: { pix: r2(recebCredito.pix), cartao: r2(recebCredito.cartao), dinheiro: r2(recebCredito.dinheiro) },
    esperado, contado: sess.valor_contado === null ? null : Number(sess.valor_contado),
    diferenca: sess.diferenca === null ? null : Number(sess.diferenca),
    produtos: [...agg.values()].map((p) => ({ ...p, qtd: Math.round(p.qtd * 1000) / 1000, total: r2(p.total) }))
      .sort((a, b) => b.total - a.total),
  } };
}
