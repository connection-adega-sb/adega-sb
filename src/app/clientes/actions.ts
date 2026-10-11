'use server';
import { z } from 'zod';
import { exigirSessao } from '@/lib/sessao';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Cadastro de clientes (PRD-clientes.md · migration 0008). Usado na tela /clientes e no PDV
// ("Identificar cliente" no meio da venda). Toda regra fica NO SERVIDOR (cliente_salvar):
// tenant vem do perfil, telefone/CPF normalizados e únicos, CPF com dígito verificador.

const UUID = z.string().uuid();
const PAPEIS_CLIENTE = ['master', 'gerente', 'caixa'] as const;

export type Cliente = {
  id: string; nome: string; telefone: string | null; cpf: string | null;
  email: string | null; observacao: string | null; ativo: boolean; criado_em: string;
  limite_credito: number | null;   // 0009: vazio = sem limite
};

export type ClienteResumo = Cliente & { compras: number; gasto: number; ultimaCompra: string | null; emAberto: number };

export type KpisClientes = { ativos: number; novosMes: number; compraramMes: number; comTelefone: number; gastoMes: number; aReceber: number };

export type EstadoCliente = { erro?: string; cliente?: Cliente };

const COLS = 'id, nome, telefone, cpf, email, observacao, ativo, criado_em, limite_credito';

// termo de busca → filtro do PostgREST sem caracteres de controle do `or()` (vírgula, parênteses)
function limparTermo(t: string) { return t.replace(/[,()*%\\"]/g, ' ').trim(); }

const inicioMes = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
};

// ---------------------------------------------------------------- busca (PDV + tela)
export async function buscarClientes(termo: string, incluirInativos = false): Promise<Cliente[]> {
  const s = await exigirSessao(PAPEIS_CLIENTE);
  const t = limparTermo(termo);
  let q = supabaseAdmin().from('clientes').select(COLS).eq('tenant_id', s.tenantId);
  if (!incluirInativos) q = q.eq('ativo', true);
  if (t.length >= 2) {
    const dig = t.replace(/\D/g, '');
    const filtros = [`nome.ilike.%${t}%`];
    if (dig.length >= 3) filtros.push(`telefone.like.%${dig}%`, `cpf.like.%${dig}%`);
    q = q.or(filtros.join(','));
  }
  const { data } = await q.order('nome').limit(t.length >= 2 ? 20 : 200);
  return (data ?? []) as Cliente[];
}

// ---------------------------------------------------------------- tela /clientes
export async function listarClientes(termo: string, incluirInativos: boolean): Promise<ClienteResumo[]> {
  const s = await exigirSessao(PAPEIS_CLIENTE);
  const lista = await buscarClientes(termo, incluirInativos);
  if (!lista.length) return [];
  const ids = lista.map((c) => c.id);
  const sb = supabaseAdmin();
  const [{ data: vendas }, emAberto] = await Promise.all([
    sb.from('vendas').select('cliente_id, total, criado_em').eq('tenant_id', s.tenantId).in('cliente_id', ids),
    saldosCredito(s.tenantId, ids),
  ]);
  const agg = new Map<string, { compras: number; gasto: number; ultima: string | null }>();
  for (const v of vendas ?? []) {
    const a = agg.get(v.cliente_id as string) ?? { compras: 0, gasto: 0, ultima: null };
    a.compras += 1; a.gasto += Number(v.total);
    if (!a.ultima || (v.criado_em as string) > a.ultima) a.ultima = v.criado_em as string;
    agg.set(v.cliente_id as string, a);
  }
  return lista.map((c) => {
    const a = agg.get(c.id);
    return {
      ...c, limite_credito: c.limite_credito === null ? null : Number(c.limite_credito),
      compras: a?.compras ?? 0, gasto: Math.round((a?.gasto ?? 0) * 100) / 100, ultimaCompra: a?.ultima ?? null,
      emAberto: emAberto.get(c.id) ?? 0,
    };
  });
}

export async function kpisClientes(): Promise<KpisClientes> {
  const s = await exigirSessao(PAPEIS_CLIENTE);
  const sb = supabaseAdmin();
  const mes = inicioMes();
  const [{ data: cli }, { data: ven }] = await Promise.all([
    sb.from('clientes').select('id, telefone, criado_em').eq('tenant_id', s.tenantId).eq('ativo', true),
    sb.from('vendas').select('cliente_id, total').eq('tenant_id', s.tenantId)
      .not('cliente_id', 'is', null).gte('criado_em', mes),
  ]);
  const c = cli ?? [];
  const abertos = await saldosCredito(s.tenantId, c.map((x) => x.id as string));
  // só vendas de clientes ATIVOS: um cliente desativado (ex.: de teste) não infla os números do mês
  const ativos = new Set(c.map((x) => x.id));
  const v = (ven ?? []).filter((x) => ativos.has(x.cliente_id));
  return {
    ativos: c.length,
    novosMes: c.filter((x) => (x.criado_em as string) >= mes).length,
    comTelefone: c.filter((x) => !!x.telefone).length,
    compraramMes: new Set(v.map((x) => x.cliente_id)).size,
    gastoMes: Math.round(v.reduce((s2, x) => s2 + Number(x.total), 0) * 100) / 100,
    aReceber: Math.round([...abertos.values()].reduce((a, b) => a + b, 0) * 100) / 100,
  };
}

export type CompraCliente = { id: string; criado_em: string; total: number; forma: string; canal: string; itens: number };

export async function historicoCliente(clienteId: string): Promise<CompraCliente[]> {
  const s = await exigirSessao(PAPEIS_CLIENTE);
  if (!UUID.safeParse(clienteId).success) return [];
  const { data } = await supabaseAdmin().from('vendas')
    .select('id, criado_em, total, forma_pagamento, canal, venda_itens(count)')
    .eq('tenant_id', s.tenantId).eq('cliente_id', clienteId)
    .order('criado_em', { ascending: false }).limit(30);
  return (data ?? []).map((v) => ({
    id: v.id as string, criado_em: v.criado_em as string, total: Number(v.total),
    forma: v.forma_pagamento as string, canal: v.canal as string,
    itens: Array.isArray(v.venda_itens) ? Number((v.venda_itens[0] as { count?: number })?.count ?? 0) : 0,
  }));
}

// ---------------------------------------------------------------- salvar (criar/editar)
function traduz(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('nome do cliente é obrigatório')) return 'Informe o nome do cliente.';
  if (m.includes('nome do cliente muito longo')) return 'Nome muito longo (máximo 120 letras).';
  if (m.includes('telefone inválido')) return 'Telefone inválido: use DDD + número (10 ou 11 dígitos).';
  if (m.includes('telefone já cadastrado')) return msg.replace(/^.*telefone já cadastrado para /i, 'Este telefone já é de ') + '.';
  if (m.includes('cpf já cadastrado')) return msg.replace(/^.*CPF já cadastrado para /i, 'Este CPF já é de ') + '.';
  if (m.includes('cpf inválido')) return 'CPF inválido: confira os números.';
  if (m.includes('e-mail inválido')) return 'E-mail inválido.';
  if (m.includes('observação muito longa')) return 'Observação muito longa (máximo 500 letras).';
  if (m.includes('cliente não encontrado')) return 'Cliente não encontrado.';
  return 'Não foi possível salvar o cliente.';
}

export async function salvarCliente(_: EstadoCliente, form: FormData): Promise<EstadoCliente> {
  const s = await exigirSessao(PAPEIS_CLIENTE);
  const txt = (k: string) => { const v = form.get(k); return typeof v === 'string' ? v.trim() : ''; };
  const id = txt('id');
  if (id && !UUID.safeParse(id).success) return { erro: 'Cliente não encontrado.' };
  if (!txt('nome')) return { erro: 'Informe o nome do cliente.' };

  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc('cliente_salvar', {
    p_usuario: s.id,
    p_nome: txt('nome'),
    p_telefone: txt('telefone') || null,
    p_cpf: txt('cpf') || null,
    p_email: txt('email') || null,
    p_observacao: txt('observacao') || null,
    p_id: id || null,
  });
  if (error) return { erro: traduz(error.message) };

  const { data: c } = await sb.from('clientes').select(COLS).eq('id', data as string).maybeSingle();
  return c ? { cliente: c as Cliente } : { erro: 'Cliente salvo, mas não foi possível recarregar.' };
}

export async function definirAtivoCliente(id: string, ativo: boolean): Promise<{ erro?: string }> {
  const s = await exigirSessao(['master', 'gerente']);
  if (!UUID.safeParse(id).success) return { erro: 'Cliente não encontrado.' };
  const { error } = await supabaseAdmin().rpc('cliente_definir_ativo', { p_usuario: s.id, p_id: id, p_ativo: ativo });
  return error ? { erro: traduz(error.message) } : {};
}


// ================================================================ crédito (conta do cliente — 0009)
// Venda no "Crédito" = o cliente leva e paga depois. Só com cliente identificado (o banco recusa sem).
// Saldo em aberto = vendas no crédito − pagamentos (credito_pagamentos, append-only).

async function saldosCredito(tenantId: string, ids: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (!ids.length) return m;
  const sb = supabaseAdmin();
  const [{ data: v }, { data: p }] = await Promise.all([
    sb.from('vendas').select('cliente_id, total').eq('tenant_id', tenantId).eq('forma_pagamento', 'credito').in('cliente_id', ids),
    sb.from('credito_pagamentos').select('cliente_id, valor').eq('tenant_id', tenantId).in('cliente_id', ids),
  ]);
  for (const r of v ?? []) m.set(r.cliente_id as string, (m.get(r.cliente_id as string) ?? 0) + Number(r.total));
  for (const r of p ?? []) m.set(r.cliente_id as string, (m.get(r.cliente_id as string) ?? 0) - Number(r.valor));
  for (const [k, val] of m) m.set(k, Math.round(val * 100) / 100);
  return m;
}

export type CreditoCliente = { saldo: number; limite: number | null };

export async function creditoCliente(clienteId: string): Promise<CreditoCliente> {
  const s = await exigirSessao(PAPEIS_CLIENTE);
  if (!UUID.safeParse(clienteId).success) return { saldo: 0, limite: null };
  const [m, { data: c }] = await Promise.all([
    saldosCredito(s.tenantId, [clienteId]),
    supabaseAdmin().from('clientes').select('limite_credito').eq('id', clienteId).eq('tenant_id', s.tenantId).maybeSingle(),
  ]);
  return { saldo: m.get(clienteId) ?? 0, limite: c?.limite_credito == null ? null : Number(c.limite_credito) };
}

export type PagamentoCredito = { id: string; criado_em: string; valor: number; forma: string; observacao: string | null };

export async function pagamentosCliente(clienteId: string): Promise<PagamentoCredito[]> {
  const s = await exigirSessao(PAPEIS_CLIENTE);
  if (!UUID.safeParse(clienteId).success) return [];
  const { data } = await supabaseAdmin().from('credito_pagamentos')
    .select('id, criado_em, valor, forma, observacao').eq('tenant_id', s.tenantId).eq('cliente_id', clienteId)
    .order('criado_em', { ascending: false }).limit(30);
  return (data ?? []).map((r) => ({ id: r.id as string, criado_em: r.criado_em as string, valor: Number(r.valor), forma: r.forma as string, observacao: (r.observacao as string | null) ?? null }));
}

const numeroBR = (t: string) => Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);

function traduzCredito(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('valor maior que o saldo')) return msg.replace(/^.*valor maior que o saldo em aberto/i, 'Valor maior que o saldo em aberto') + '.';
  if (m.includes('abra o seu caixa')) return 'Para receber em dinheiro, abra o seu caixa no PDV (o dinheiro entra na gaveta).';
  if (m.includes('maior que zero')) return 'Informe um valor maior que zero.';
  if (m.includes('forma de recebimento')) return 'Escolha PIX, cartão ou dinheiro.';
  if (m.includes('só master ou gerente')) return 'Só master ou gerente define limite de crédito.';
  if (m.includes('limite de crédito inválido')) return 'Limite inválido.';
  if (m.includes('cliente não encontrado')) return 'Cliente não encontrado.';
  return 'Não foi possível registrar.';
}

export async function receberCredito(_: { erro?: string; ok?: boolean }, form: FormData): Promise<{ erro?: string; ok?: boolean }> {
  const s = await exigirSessao(PAPEIS_CLIENTE);
  const id = String(form.get('clienteId') ?? '');
  if (!UUID.safeParse(id).success) return { erro: 'Cliente não encontrado.' };
  const valor = numeroBR(String(form.get('valor') ?? '').trim());
  if (!valor || Number.isNaN(valor) || valor <= 0) return { erro: 'Informe um valor maior que zero (ex.: 25,00).' };
  const forma = String(form.get('forma') ?? '');
  if (!['pix', 'cartao', 'dinheiro'].includes(forma)) return { erro: 'Escolha PIX, cartão ou dinheiro.' };
  const { error } = await supabaseAdmin().rpc('credito_receber', {
    p_usuario: s.id, p_cliente: id, p_valor: valor, p_forma: forma,
    p_observacao: String(form.get('observacao') ?? '').trim() || null,
  });
  return error ? { erro: traduzCredito(error.message) } : { ok: true };
}

export async function definirLimiteCliente(id: string, valorTxt: string): Promise<{ erro?: string }> {
  const s = await exigirSessao(['master', 'gerente']);
  if (!UUID.safeParse(id).success) return { erro: 'Cliente não encontrado.' };
  const t = valorTxt.trim();
  const limite = t === '' ? null : numeroBR(t);
  if (limite !== null && (Number.isNaN(limite) || limite < 0)) return { erro: 'Limite inválido (ex.: 200,00 ou vazio para sem limite).' };
  const { error } = await supabaseAdmin().rpc('cliente_definir_limite', { p_usuario: s.id, p_id: id, p_limite: limite });
  return error ? { erro: traduzCredito(error.message) } : {};
}
