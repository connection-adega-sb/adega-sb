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
};

export type ClienteResumo = Cliente & { compras: number; gasto: number; ultimaCompra: string | null };

export type KpisClientes = { ativos: number; novosMes: number; compraramMes: number; comTelefone: number; gastoMes: number };

export type EstadoCliente = { erro?: string; cliente?: Cliente };

const COLS = 'id, nome, telefone, cpf, email, observacao, ativo, criado_em';

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
  const { data: vendas } = await supabaseAdmin().from('vendas')
    .select('cliente_id, total, criado_em').eq('tenant_id', s.tenantId)
    .in('cliente_id', lista.map((c) => c.id));
  const agg = new Map<string, { compras: number; gasto: number; ultima: string | null }>();
  for (const v of vendas ?? []) {
    const a = agg.get(v.cliente_id as string) ?? { compras: 0, gasto: 0, ultima: null };
    a.compras += 1; a.gasto += Number(v.total);
    if (!a.ultima || (v.criado_em as string) > a.ultima) a.ultima = v.criado_em as string;
    agg.set(v.cliente_id as string, a);
  }
  return lista.map((c) => {
    const a = agg.get(c.id);
    return { ...c, compras: a?.compras ?? 0, gasto: Math.round((a?.gasto ?? 0) * 100) / 100, ultimaCompra: a?.ultima ?? null };
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
  // só vendas de clientes ATIVOS: um cliente desativado (ex.: de teste) não infla os números do mês
  const ativos = new Set(c.map((x) => x.id));
  const v = (ven ?? []).filter((x) => ativos.has(x.cliente_id));
  return {
    ativos: c.length,
    novosMes: c.filter((x) => (x.criado_em as string) >= mes).length,
    comTelefone: c.filter((x) => !!x.telefone).length,
    compraramMes: new Set(v.map((x) => x.cliente_id)).size,
    gastoMes: Math.round(v.reduce((s2, x) => s2 + Number(x.total), 0) * 100) / 100,
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
