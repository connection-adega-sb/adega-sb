'use server';
import { z } from 'zod';
import { exigirSessao } from '@/lib/sessao';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Server actions do catálogo + estoque profundo (PRD-catalogo-estoque-multilocal.md §5–§10).
// Regras de negócio ficam NO SERVIDOR: chamamos as funções security definer da 0004 (transação
// única no banco). Nada de saldo/custo calculado no cliente.

const UUID = z.string().uuid();

function traduzErro(msg: string): string {
  if (msg.includes('saldo insuficiente')) return 'Estoque insuficiente no local de origem.';
  if (msg.includes('origem e destino são o mesmo local')) return 'Origem e destino são o mesmo local.';
  if (msg.includes('transferência está vazia')) return 'A transferência está vazia.';
  if (msg.includes('recebido maior que enviado')) return 'Recebido maior que o enviado.';
  if (msg.includes('só transferência')) return msg; // estado inválido (já legível)
  if (msg.includes('fumígeno')) return 'Produto fumígeno não entra em ficha técnica.';
  if (msg.includes('sem ficha técnica')) return 'Este produto ainda não tem ficha técnica.';
  if (msg.includes('sem conteúdo')) return 'Informe o conteúdo do insumo (ex.: 1000 ml).';
  if (msg.includes('dose')) return msg;
  if (msg.includes('insumo')) return msg;
  if (msg.includes('inventário')) return msg;
  return msg;
}

// ---------------------------------------------------------------- locais (escopo do operador)
export type LocalResumo = { id: string; nome: string; codigo: string; tipo: string };

// O estoquista/gerente vê os SEUS locais; master vê todos.
export async function listarLocais(): Promise<LocalResumo[]> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  const sb = supabaseAdmin();
  let q = sb.from('locais').select('id, nome, codigo, tipo').order('nome');
  if (s.papel !== 'master') {
    if (!s.locais.length) return [];
    q = q.in('id', s.locais);
  }
  const { data } = await q;
  return (data ?? []).map((l) => ({ id: l.id, nome: l.nome, codigo: l.codigo, tipo: l.tipo }));
}

// ---------------------------------------------------------------- saldos por local
export type SaldoLinha = {
  produtoId: string; sku: string | null; nome: string; tipo: string;
  unidade: string; quantidade: number; minimo: number; categoria: string | null;
};

export async function buscarSaldos(localId: string, termo?: string): Promise<SaldoLinha[]> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  const pLocal = UUID.safeParse(localId);
  if (!pLocal.success) return [];
  if (s.papel !== 'master' && !s.locais.includes(pLocal.data)) return [];

  const sb = supabaseAdmin();
  let q = sb.from('estoque_saldos')
    .select('produto_id, quantidade, minimo, produtos!inner(id, sku, nome, tipo, unidade, ativo, categoria_id)')
    .eq('local_id', pLocal.data)
    .eq('produtos.ativo', true);
  const t = termo?.trim();
  // filtro em coluna embedada: o .or() precisa da foreignTable senão o parser do PostgREST reclama
  if (t) q = q.or(`nome.ilike.%${t}%,sku.ilike.%${t}%`, { referencedTable: 'produtos' });
  const { data } = await q.order('produtos(nome)').limit(400);

  const { data: cats } = await supabaseAdmin().from('categorias').select('id, nome');
  const nomeCat = new Map((cats ?? []).map((c) => [c.id, c.nome]));

  return (data ?? []).map((r) => {
    const pr = r.produtos as unknown as { sku: string | null; nome: string; tipo: string; unidade: string; categoria_id: string | null };
    return {
      produtoId: r.produto_id, sku: pr.sku, nome: pr.nome, tipo: pr.tipo, unidade: pr.unidade,
      quantidade: Number(r.quantidade), minimo: Number(r.minimo),
      categoria: nomeCat.get(pr.categoria_id ?? '') ?? null,
    };
  });
}

// ---------------------------------------------------------------- produtos para montar item
export type ProdutoEscolha = {
  id: string; sku: string | null; nome: string; tipo: string; unidade: string;
  conteudo: number | null; conteudoUnidade: string | null;
};

export async function listarProdutos(): Promise<ProdutoEscolha[]> {
  await exigirSessao(['master', 'gerente', 'estoquista']);
  const sb = supabaseAdmin();
  const { data } = await sb.from('produtos')
    .select('id, sku, nome, tipo, unidade, conteudo, conteudo_unidade, ativo')
    .eq('ativo', true).order('nome').limit(500);
  return (data ?? []).map((p) => ({
    id: p.id, sku: p.sku, nome: p.nome, tipo: p.tipo, unidade: p.unidade,
    conteudo: p.conteudo === null ? null : Number(p.conteudo), conteudoUnidade: p.conteudo_unidade,
  }));
}

// ---------------------------------------------------------------- transferências
export type TransferenciaLinha = {
  id: string; status: string; motivo: string | null;
  origem: string; destino: string; criadoEm: string;
  itens: { produtoId: string; nome: string; quantidade: number; recebida: number | null }[];
};

async function carregarTransferencia(
  sb: ReturnType<typeof supabaseAdmin>, id: string,
  cod: Map<string, string>,
): Promise<TransferenciaLinha | null> {
  const { data: t } = await sb.from('transferencias')
    .select('id, status, motivo, criado_em, origem_local_id, destino_local_id')
    .eq('id', id).maybeSingle();
  if (!t) return null;
  const { data: itens } = await sb.from('transferencia_itens')
    .select('produto_id, quantidade, recebida, produtos(nome)')
    .eq('transferencia_id', id);
  return {
    id: t.id, status: t.status, motivo: t.motivo, criadoEm: t.criado_em,
    origem: cod.get(t.origem_local_id) ?? '',
    destino: cod.get(t.destino_local_id) ?? '',
    itens: (itens ?? []).map((i) => ({
      produtoId: i.produto_id,
      nome: (i.produtos as unknown as { nome: string })?.nome ?? '',
      quantidade: Number(i.quantidade),
      recebida: i.recebida === null ? null : Number(i.recebida),
    })),
  };
}

export async function listarTransferencias(status?: string): Promise<TransferenciaLinha[]> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  const sb = supabaseAdmin();
  let q = sb.from('transferencias')
    .select('id, status, motivo, criado_em, origem_local_id, destino_local_id')
    .order('criado_em', { ascending: false }).limit(60);
  if (status) q = q.eq('status', status);
  if (s.papel !== 'master') {
    if (!s.locais.length) return [];
    q = q.or(`origem_local_id.in.(${s.locais.join(',')}),destino_local_id.in.(${s.locais.join(',')})`);
  }
  const { data } = await q;
  const { data: locais } = await supabaseAdmin().from('locais').select('id, codigo');
  const cod = new Map((locais ?? []).map((l) => [l.id, l.codigo]));
  const linhas: TransferenciaLinha[] = [];
  for (const t of data ?? []) {
    const full = await carregarTransferencia(sb, t.id, cod);
    if (full) linhas.push(full);
  }
  return linhas;
}

export type EstadoTransferencia = { erro?: string; ok?: string; id?: string };

const ItemTransfer = z.object({ produtoId: UUID, quantidade: z.coerce.number().positive('Qtd deve ser > 0.') });
const CriarTrans = z.object({
  origem: UUID, destino: UUID,
  itens: z.array(ItemTransfer).min(1, 'Adicione ao menos um item.'),
  motivo: z.string().trim().max(300).optional(),
});

export async function criarTransferencia(_: EstadoTransferencia, form: FormData): Promise<EstadoTransferencia> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  let raw: unknown;
  try { raw = JSON.parse(String(form.get('dados'))); } catch { return { erro: 'Dados inválidos.' }; }
  const p = CriarTrans.safeParse(raw);
  if (!p.success) return { erro: p.error.issues[0].message };
  if (s.papel !== 'master' && !s.locais.includes(p.data.origem)) return { erro: 'Você não tem acesso ao local de origem.' };

  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc('transferencia_criar', {
    p_origem: p.data.origem, p_destino: p.data.destino,
    p_produtos: p.data.itens.map((i) => i.produtoId),
    p_quantidades: p.data.itens.map((i) => i.quantidade),
    p_motivo: p.data.motivo ?? null,
  });
  if (error) return { erro: traduzErro(error.message) };
  // audit: preenche criado_por (a função lê JWT claim, que via service_role é nulo)
  if (typeof data === 'string') await sb.from('transferencias').update({ criado_por: s.id }).eq('id', data);
  return { ok: 'Transferência criada em rascunho.', id: typeof data === 'string' ? data : undefined };
}

export async function enviarTransferencia(id: string): Promise<EstadoTransferencia> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  const p = UUID.safeParse(id);
  if (!p.success) return { erro: 'Transferência inválida.' };
  const sb = supabaseAdmin();
  const { data: t } = await sb.from('transferencias').select('origem_local_id').eq('id', p.data).maybeSingle();
  if (!t) return { erro: 'Transferência não encontrada.' };
  if (s.papel !== 'master' && !s.locais.includes(t.origem_local_id)) return { erro: 'Você não tem acesso ao local de origem.' };
  const { error } = await sb.rpc('transferencia_enviar', { p_id: p.data });
  if (error) return { erro: traduzErro(error.message) };
  return { ok: 'Enviada. Estoque baixado na origem.' };
}

const ReceberTrans = z.object({
  id: UUID,
  contagens: z.array(z.object({ produtoId: UUID, recebida: z.coerce.number().min(0, 'Contagem inválida.') })).min(1),
});

export async function receberTransferencia(_: EstadoTransferencia, form: FormData): Promise<EstadoTransferencia> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  let raw: unknown;
  try { raw = JSON.parse(String(form.get('dados'))); } catch { return { erro: 'Dados inválidos.' }; }
  const p = ReceberTrans.safeParse(raw);
  if (!p.success) return { erro: p.error.issues[0].message };
  const sb = supabaseAdmin();
  const { data: t } = await sb.from('transferencias').select('destino_local_id').eq('id', p.data.id).maybeSingle();
  if (!t) return { erro: 'Transferência não encontrada.' };
  if (s.papel !== 'master' && !s.locais.includes(t.destino_local_id)) return { erro: 'Você não tem acesso ao local de destino.' };

  const { error } = await sb.rpc('transferencia_receber', {
    p_id: p.data.id,
    p_produtos: p.data.contagens.map((c) => c.produtoId),
    p_recebidas: p.data.contagens.map((c) => c.recebida),
  });
  if (error) return { erro: traduzErro(error.message) };
  return { ok: 'Recebida. Divergências registradas como perda.' };
}

export async function cancelarTransferencia(id: string, motivo: string): Promise<EstadoTransferencia> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  const p = UUID.safeParse(id);
  if (!p.success) return { erro: 'Transferência inválida.' };
  const sb = supabaseAdmin();
  const { data: t } = await sb.from('transferencias').select('origem_local_id, destino_local_id').eq('id', p.data).maybeSingle();
  if (!t) return { erro: 'Transferência não encontrada.' };
  if (s.papel !== 'master' && !s.locais.includes(t.origem_local_id) && !s.locais.includes(t.destino_local_id)) {
    return { erro: 'Você não tem acesso a esta transferência.' };
  }
  const { error } = await sb.rpc('transferencia_cancelar', { p_id: p.data, p_motivo: motivo || null });
  if (error) return { erro: traduzErro(error.message) };
  return { ok: 'Transferência cancelada.' };
}

// ---------------------------------------------------------------- inventário cego
export type InventarioLinha = {
  id: string; status: string; local: string; categoria: string | null;
  abertoEm: string; itens: { produtoId: string; nome: string; contado: number | null; saldo: number }[];
};

export async function listarInventarios(status?: string): Promise<InventarioLinha[]> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  const sb = supabaseAdmin();
  let q = sb.from('inventarios')
    .select('id, status, local_id, categoria_id, aberto_em')
    .order('aberto_em', { ascending: false }).limit(40);
  if (status) q = q.eq('status', status);
  if (s.papel !== 'master') {
    if (!s.locais.length) return [];
    q = q.in('local_id', s.locais);
  }
  const { data } = await q;
  const { data: locais } = await supabaseAdmin().from('locais').select('id, codigo');
  const cod = new Map((locais ?? []).map((l) => [l.id, l.codigo]));
  const { data: cats } = await supabaseAdmin().from('categorias').select('id, nome');
  const nomeCat = new Map((cats ?? []).map((c) => [c.id, c.nome]));

  const linhas: InventarioLinha[] = [];
  for (const inv of data ?? []) {
    const { data: itens } = await sb.from('inventario_itens')
      .select('produto_id, contado, saldo_no_fechamento, produtos(nome)')
      .eq('inventario_id', inv.id);
    linhas.push({
      id: inv.id, status: inv.status,
      local: cod.get(inv.local_id) ?? '', categoria: nomeCat.get(inv.categoria_id ?? '') ?? null,
      abertoEm: inv.aberto_em,
      itens: (itens ?? []).map((i) => ({
        produtoId: i.produto_id,
        nome: (i.produtos as unknown as { nome: string })?.nome ?? '',
        contado: i.contado === null ? null : Number(i.contado),
        saldo: Number(i.saldo_no_fechamento),
      })),
    });
  }
  return linhas;
}

export type EstadoInventario = { erro?: string; ok?: string; id?: string };

const AbrirInv = z.object({ localId: UUID, categoriaId: UUID.nullable().optional() });

export async function abrirInventario(_: EstadoInventario, form: FormData): Promise<EstadoInventario> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  const p = AbrirInv.safeParse({ localId: form.get('localId'), categoriaId: form.get('categoriaId') || null });
  if (!p.success) return { erro: p.error.issues[0].message };
  if (s.papel !== 'master' && !s.locais.includes(p.data.localId)) return { erro: 'Você não tem acesso a este local.' };

  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc('inventario_abrir', {
    p_local: p.data.localId, p_categoria: p.data.categoriaId ?? null,
  });
  if (error) return { erro: traduzErro(error.message) };
  if (typeof data === 'string') await sb.from('inventarios').update({ aberto_por: s.id }).eq('id', data);
  return { ok: 'Inventário aberto. Conte às cegas.', id: typeof data === 'string' ? data : undefined };
}

const Contar = z.object({ inventarioId: UUID, itens: z.array(z.object({ produtoId: UUID, contado: z.coerce.number().min(0) })) });

export async function contarInventario(_: EstadoInventario, form: FormData): Promise<EstadoInventario> {
  await exigirSessao(['master', 'gerente', 'estoquista']);
  let raw: unknown;
  try { raw = JSON.parse(String(form.get('dados'))); } catch { return { erro: 'Dados inválidos.' }; }
  const p = Contar.safeParse(raw);
  if (!p.success) return { erro: p.error.issues[0].message };

  const sb = supabaseAdmin();
  const { data: inv } = await sb.from('inventarios').select('status').eq('id', p.data.inventarioId).maybeSingle();
  if (!inv) return { erro: 'Inventário não encontrado.' };
  if (inv.status !== 'aberto') return { erro: 'Só inventário aberto aceita contagem.' };

  for (const it of p.data.itens) {
    const { error } = await sb.from('inventario_itens')
      .update({ contado: it.contado })
      .eq('inventario_id', p.data.inventarioId).eq('produto_id', it.produtoId);
    if (error) return { erro: traduzErro(error.message) };
  }
  return { ok: 'Contagem salva.' };
}

export async function fecharInventario(id: string): Promise<EstadoInventario> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  const p = UUID.safeParse(id);
  if (!p.success) return { erro: 'Inventário inválido.' };
  const sb = supabaseAdmin();
  const { data: inv } = await sb.from('inventarios').select('local_id').eq('id', p.data).maybeSingle();
  if (!inv) return { erro: 'Inventário não encontrado.' };
  if (s.papel !== 'master' && !s.locais.includes(inv.local_id)) return { erro: 'Você não tem acesso a este local.' };
  const { error } = await sb.rpc('inventario_fechar', { p_id: p.data });
  if (error) return { erro: traduzErro(error.message) };
  return { ok: 'Fechado para revisão.' };
}

// Aprovar ajusta saldo de verdade → gerente/master apenas.
export async function aprovarInventario(id: string): Promise<EstadoInventario> {
  const s = await exigirSessao(['master', 'gerente']);
  const p = UUID.safeParse(id);
  if (!p.success) return { erro: 'Inventário inválido.' };
  const sb = supabaseAdmin();
  const { error } = await sb.rpc('inventario_aprovar', { p_id: p.data });
  if (error) return { erro: traduzErro(error.message) };
  await sb.from('inventarios').update({ aprovado_por: s.id }).eq('id', p.data);
  return { ok: 'Aprovado. Saldos ajustados pelo contado.' };
}

export async function cancelarInventario(id: string, motivo: string): Promise<EstadoInventario> {
  await exigirSessao(['master', 'gerente', 'estoquista']);
  const p = UUID.safeParse(id);
  if (!p.success) return { erro: 'Inventário inválido.' };
  if (!motivo.trim()) return { erro: 'Informe o motivo do cancelamento.' };
  const sb = supabaseAdmin();
  const { error } = await sb.rpc('inventario_cancelar', { p_id: p.data, p_motivo: motivo.trim() });
  if (error) return { erro: traduzErro(error.message) };
  return { ok: 'Inventário cancelado.' };
}

// ---------------------------------------------------------------- fichas técnicas (copão)
export type Ficha = {
  produtoId: string; markup: number;
  insumos: { produtoId: string; nome: string; quantidade: number; unidade: string }[];
  cmv: number | null; preco: number | null;
};

export async function buscarFicha(produtoId: string): Promise<Ficha | null> {
  await exigirSessao(['master', 'gerente', 'estoquista']);
  const p = UUID.safeParse(produtoId);
  if (!p.success) return null;
  const sb = supabaseAdmin();
  const { data: f } = await sb.from('fichas_tecnicas')
    .select('produto_id, markup').eq('produto_id', p.data).maybeSingle();
  const { data: prod } = await sb.from('produtos')
    .select('preco_varejo, custo_medio').eq('id', p.data).maybeSingle();
  const { data: ins } = await sb.from('fichas_tecnicas_insumos')
    .select('insumo_produto_id, quantidade, unidade, produtos(nome)').eq('ficha_id', p.data);
  const insumos = (ins ?? []).map((i) => ({
    produtoId: i.insumo_produto_id,
    nome: (i.produtos as unknown as { nome: string })?.nome ?? '',
    quantidade: Number(i.quantidade), unidade: i.unidade,
  }));
  if (!f) return { produtoId: p.data, markup: 2.5, insumos: [], cmv: null, preco: Number(prod?.preco_varejo ?? 0) };
  return {
    produtoId: p.data, markup: Number(f.markup), insumos,
    cmv: prod?.custo_medio === null || prod?.custo_medio === undefined ? null : Number(prod.custo_medio),
    preco: Number(prod?.preco_varejo ?? 0),
  };
}

export type EstadoFicha = { erro?: string; ok?: string; cmv?: number; preco?: number };

const InsumoFicha = z.object({ produtoId: UUID, quantidade: z.coerce.number().positive('Dose deve ser > 0.'), unidade: z.enum(['ml', 'g', 'un']) });
const SalvarFicha = z.object({
  produtoId: UUID, markup: z.coerce.number().positive('Markup deve ser > 0.'),
  insumos: z.array(InsumoFicha).min(1, 'A ficha precisa de pelo menos 1 insumo.'),
});

export async function salvarFicha(_: EstadoFicha, form: FormData): Promise<EstadoFicha> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  let raw: unknown;
  try { raw = JSON.parse(String(form.get('dados'))); } catch { return { erro: 'Dados inválidos.' }; }
  const p = SalvarFicha.safeParse(raw);
  if (!p.success) return { erro: p.error.issues[0].message };

  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc('ficha_salvar', {
    p_produto: p.data.produtoId, p_markup: p.data.markup,
    p_insumos: p.data.insumos.map((i) => ({ produto_id: i.produtoId, quantidade: i.quantidade, unidade: i.unidade })),
  });
  if (error) return { erro: traduzErro(error.message) };
  if (typeof data === 'string') await sb.from('fichas_tecnicas').update({ criado_por: s.id }).eq('id', data);
  return { ok: 'Ficha salva (histórico registrado).' };
}

// Aplica preço no PDV: custo_medio = CMV e preco = CMV × markup arredondado (gerente/master).
export async function aplicarPrecoFicha(produtoId: string): Promise<EstadoFicha> {
  await exigirSessao(['master', 'gerente']);
  const p = UUID.safeParse(produtoId);
  if (!p.success) return { erro: 'Produto inválido.' };
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc('ficha_aplicar_preco', { p_produto: p.data });
  if (error) return { erro: traduzErro(error.message) };
  const { data: prod } = await sb.from('produtos').select('custo_medio').eq('id', p.data).maybeSingle();
  return {
    ok: 'Preço aplicado no PDV.',
    preco: typeof data === 'number' ? Number(data) : undefined,
    cmv: prod?.custo_medio === null || prod?.custo_medio === undefined ? undefined : Number(prod.custo_medio),
  };
}

// ---------------------------------------------------------------- copões disponíveis (bar)
export type CopaoDisponivel = { produtoId: string; sku: string | null; nome: string; preco: number; disponiveis: number };

export async function copoesDisponiveis(localId: string): Promise<CopaoDisponivel[]> {
  const s = await exigirSessao(['master', 'gerente', 'estoquista', 'bartender']);
  const p = UUID.safeParse(localId);
  if (!p.success) return [];
  if (s.papel !== 'master' && !s.locais.includes(p.data)) return [];
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc('copoes_disponiveis', { p_local: p.data });
  if (error || !data) return [];
  return (data as unknown as { produto_id: string; sku: string | null; nome: string; preco_varejo: number; disponiveis: number }[])
    .map((c) => ({
      produtoId: c.produto_id, sku: c.sku, nome: c.nome,
      preco: Number(c.preco_varejo), disponiveis: Number(c.disponiveis),
    }));
}
