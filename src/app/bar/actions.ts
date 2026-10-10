'use server';
import { z } from 'zod';
import { exigirSessao, type Sessao } from '@/lib/sessao';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { type Papel } from '@/lib/papeis';

// Server actions da tela do bar — F4.1 do roadmap-enterprise.md (mesas, comandas, copão).
// Toda regra fica NO SERVIDOR: chamamos as funções security definer da 0005/0006, que rodam
// numa transação única no banco. O cliente recebe só o estado recalculado — nunca calcula
// total, saldo de insumo ou permissão. Mesmo padrão de src/app/estoque/actions.ts.

const UUID = z.string().uuid();
const QTD = z.coerce.number().positive('Quantidade inválida.');

const PAPEIS: readonly Papel[] = ['master', 'gerente', 'bartender', 'caixa'];

function traduzErro(msg: string): string {
  if (msg.includes('já está ocupada')) return 'Mesa já está ocupada.';
  if (msg.includes('não está ocupada')) return 'Esta mesa está livre.';
  if (msg.includes('destino está ocupada')) return 'A mesa de destino está ocupada.';
  if (msg.includes('mesas de locais diferentes')) return 'As mesas são de locais diferentes.';
  if (msg.includes('ficaria vazia')) return 'A comanda ficaria vazia: transfira a mesa em vez de dividir.';
  if (msg.includes('escolha ao menos um item')) return 'Escolha ao menos um item para transferir.';
  if (msg.includes('item fora desta comanda')) return 'Este item não pertence à comanda.';
  if (msg.includes('feche a comanda antes')) return 'Feche a comanda antes de liberar a mesa.';
  if (msg.includes('comanda está fechada: item')) return 'Comanda já fechada: item não pode ser removido.';
  if (msg.includes('comanda já está fechada')) return 'Comanda já está fechada.';
  if (msg.includes('comanda está fechada')) return 'Comanda já está fechada.';
  if (msg.includes('só comanda aberta')) return 'Só comanda aberta pode ser dividida.';
  if (msg.includes('item +18')) return 'Item +18: confirme que o cliente é maior de 18 anos.';
  if (msg.includes('quantidade deve ser maior')) return 'Quantidade deve ser maior que zero.';
  if (msg.includes('caixa fechado')) return 'Abra o caixa do bar para faturar.';
  if (msg.includes('caixa não pertence')) return 'O caixa aberto pertence a outro local.';
  if (msg.includes('sessão de caixa não encontrada')) return 'Abra o caixa do bar para faturar.';
  if (msg.includes('comanda está vazia')) return 'A comanda está vazia.';
  if (msg.includes('comanda não encontrada')) return 'Comanda não encontrada.';
  if (msg.includes('mesa não encontrada')) return 'Mesa não encontrada.';
  if (msg.includes('produto não é preparado')) return 'Este produto não é um copão.';
  if (msg.includes('produto sem ficha')) return 'Este copão não tem ficha técnica.';
  if (msg.includes('produto indisponível')) return 'Produto indisponível.';
  if (msg.includes('forma de pagamento inválida')) return 'Forma de pagamento inválida.';
  if (msg.includes('estoque insuficiente')) return 'Estoque insuficiente no bar.';
  if (msg.includes('item não encontrado')) return 'Item não encontrado.';
  return msg;
}

// ---------------------------------------------------------------- tipos

export type LocalResumo = { id: string; nome: string; codigo: string };

export type MesaLinha = {
  id: string; codigo: string; capacidade: number; status: 'livre' | 'ocupada';
  comandaId: string | null; total: number; itens: number; abertaEm: string | null;
};

export type Avulsa = { comandaId: string; total: number; itens: number; abertaEm: string };

export type ItemLinha = {
  id: string; produtoId: string; nome: string; tipoItem: string; quantidade: number;
  precoUnit: number; subtotal: number; adulto: boolean;
};

export type Escolha = {
  produtoId: string; nome: string; unidade: string; tipo: string;
  preco: number; estoque: number | null; disponiveis: number; adulto: boolean;
};

export type CaixaInfo = {
  caixaId: string | null; caixaNome: string | null;
  sessaoId: string | null; operador: string | null; abertura: number | null;
};

export type VendaBar = { id: string; total: number; forma: string; hora: string };

export type Estado = {
  localId: string;
  mesas: MesaLinha[];
  avulsas: Avulsa[];
  copoes: Escolha[];
  revendas: Escolha[];
  caixa: CaixaInfo;
  comandaId: string | null;
  itens: ItemLinha[];
  total: number;
  vendas: VendaBar[];
};

export type Resultado = { ok?: string; erro?: string; estado?: Estado };

// ---------------------------------------------------------------- estado

function semAcesso(localId: string): Estado {
  return {
    localId, mesas: [], avulsas: [], copoes: [], revendas: [],
    caixa: { caixaId: null, caixaNome: null, sessaoId: null, operador: null, abertura: null },
    comandaId: null, itens: [], total: 0, vendas: [],
  };
}

function podeVer(s: Sessao, localId: string): boolean {
  return s.papel === 'master' || s.locais.includes(localId);
}

// Monta o estado completo que a tela renderiza. Toda mutação devolve isto recalculado,
// então a UI nunca refaz consulta a parte nem soma no cliente.
async function montar(s: Sessao, localId: string, comandaId: string | null): Promise<Estado> {
  if (!UUID.safeParse(localId).success || !podeVer(s, localId)) return semAcesso(localId);
  const sb = supabaseAdmin();

  const [rMesas, rAbertas, rCopoes, rSaldos, rCaixas, rVendas, rPreparados] = await Promise.all([
    sb.from('mesas').select('id, codigo, capacidade, status, comanda_id').eq('local_id', localId).order('codigo'),
    sb.from('comandas').select('id, mesa_id, total, aberta_em').eq('local_id', localId).eq('status', 'aberta').order('aberta_em'),
    sb.rpc('copoes_disponiveis', { p_local: localId }),
    sb.from('estoque_saldos')
      .select('quantidade, produtos!inner(id, nome, tipo, unidade, preco_varejo, adulto)')
      .eq('local_id', localId).eq('produtos.ativo', true).gt('quantidade', 0),
    sb.from('caixas').select('id, nome').eq('local_id', localId).eq('ativo', true).order('nome').limit(1),
    sb.from('vendas').select('id, total, forma_pagamento, criado_em')
      .eq('local_id', localId).eq('canal', 'bar').order('criado_em', { ascending: false }).limit(8),
    sb.from('produtos').select('id, adulto').eq('tenant_id', s.tenantId).eq('tipo', 'preparado').eq('ativo', true),
  ]);
  const preparados = new Map(
    ((rPreparados.data ?? []) as { id: string; adulto: boolean }[]).map((p) => [p.id, p.adulto]),
  );

  // contagem de itens por comanda aberta (evita embed com count, que o PostgREST trata diferente)
  const abertas = rAbertas.data ?? [];
  const contagem = new Map<string, number>();
  if (abertas.length > 0) {
    const rItens = await sb.from('comanda_itens').select('comanda_id').in('comanda_id', abertas.map((a) => a.id));
    for (const i of rItens.data ?? []) contagem.set(i.comanda_id, (contagem.get(i.comanda_id) ?? 0) + 1);
  }

  const abertaDe = new Map(abertas.map((a) => [a.mesa_id ?? '', a]));
  const mesas: MesaLinha[] = (rMesas.data ?? []).map((m) => {
    const c = abertaDe.get(m.id);
    return {
      id: m.id, codigo: m.codigo, capacidade: m.capacidade,
      // `comanda_id` em mesas pode apontar para uma comanda já faturada (a mesa só vira livre
      // na mesa_fechar). Sem fallback: sem comanda ABERTA, a mesa se comporta como livre.
      status: m.status as MesaLinha['status'],
      comandaId: c?.id ?? null, total: c ? Number(c.total) : 0,
      itens: c ? contagem.get(c.id) ?? 0 : 0, abertaEm: c?.aberta_em ?? null,
    };
  });

  const avulsas: Avulsa[] = abertas.filter((a) => !a.mesa_id).map((a) => ({
    comandaId: a.id, total: Number(a.total), itens: contagem.get(a.id) ?? 0, abertaEm: a.aberta_em,
  }));

  // comanda selecionada: só vale se continuar aberta e neste local
  const atual = comandaId ? abertas.find((a) => a.id === comandaId) : undefined;
  const comandaEfetiva = atual?.id ?? null;
  let itens: ItemLinha[] = [];
  let total = 0;
  if (atual) {
    total = Number(atual.total);
    const rItens = await sb.from('comanda_itens')
      .select('id, produto_id, quantidade, preco_unit, subtotal, tipo_item, produtos(nome, tipo, adulto)')
      .eq('comanda_id', atual.id).order('criado_em');
    itens = (rItens.data ?? []).map((i) => {
      const p = i.produtos as unknown as { nome: string; tipo: string; adulto: boolean } | null;
      return {
        id: i.id, produtoId: i.produto_id, nome: p?.nome ?? '(produto removido)',
        tipoItem: i.tipo_item, quantidade: Number(i.quantidade), precoUnit: Number(i.preco_unit),
        subtotal: Number(i.subtotal), adulto: p?.adulto ?? false,
      };
    });
  }

  // copões: só os que têm estoque de insumos neste local
  const copoes: Escolha[] = ((rCopoes.data ?? []) as unknown as {
    produto_id: string; nome: string; preco_varejo: number; disponiveis: number;
  }[])
    .filter((c) => c.disponiveis > 0)
    .map((c) => ({
      produtoId: c.produto_id, nome: c.nome, unidade: 'copo', tipo: 'preparado',
      preco: Number(c.preco_varejo), estoque: null,
      disponiveis: c.disponiveis, adulto: preparados.get(c.produto_id) ?? false,
    }));

  // revenda/fumígeno com saldo no local — o copão já cobre o `preparado`, então fica fora
  const copaoIds = new Set(copoes.map((c) => c.produtoId));
  const revendas: Escolha[] = (rSaldos.data ?? [])
    .map((r) => {
      const p = r.produtos as unknown as {
        id: string; nome: string; tipo: string; unidade: string;
        preco_varejo: number; adulto: boolean;
      };
      return {
        produtoId: p.id, nome: p.nome, unidade: p.unidade, tipo: p.tipo,
        preco: Number(p.preco_varejo), estoque: Number(r.quantidade),
        disponiveis: Number(r.quantidade), adulto: p.adulto,
      };
    })
    .filter((e) => e.tipo !== 'preparado' && !copaoIds.has(e.produtoId))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  // caixa do local: precisa existir e estar com sessão aberta para faturar
  const caixa = rCaixas.data?.[0] ?? null;
  let sessaoId: string | null = null;
  let operador: string | null = null;
  let abertura: number | null = null;
  if (caixa) {
    const rSess = await sb.from('caixa_sessoes')
      .select('id, valor_abertura, profiles(nome)')
      .eq('caixa_id', caixa.id).eq('status', 'aberta').limit(1);
    const sess = rSess.data?.[0];
    if (sess) {
      sessaoId = sess.id;
      abertura = Number(sess.valor_abertura);
      operador = (sess.profiles as unknown as { nome: string } | null)?.nome ?? null;
    }
  }

  return {
    localId,
    mesas, avulsas, copoes, revendas,
    caixa: {
      caixaId: caixa?.id ?? null, caixaNome: caixa?.nome ?? null,
      sessaoId, operador, abertura,
    },
    comandaId: comandaEfetiva, itens, total,
    vendas: (rVendas.data ?? []).map((v) => ({
      id: v.id, total: Number(v.total), forma: v.forma_pagamento, hora: v.criado_em,
    })),
  };
}

// ---------------------------------------------------------------- leitura

export async function listarLocais(): Promise<LocalResumo[]> {
  const s = await exigirSessao(PAPEIS);
  const { data } = await supabaseAdmin().from('locais').select('id, nome, codigo').order('codigo');
  return (data ?? [])
    .filter((l) => s.papel === 'master' || s.locais.includes(l.id))
    .map((l) => ({ id: l.id, nome: l.nome, codigo: l.codigo }));
}

export async function buscarEstado(localId: string, comandaId: string | null): Promise<Estado> {
  const s = await exigirSessao(PAPEIS);
  return montar(s, localId, comandaId);
}

// ---------------------------------------------------------------- mesas

export async function abrirMesa(localId: string, mesaId: string): Promise<Resultado> {
  const s = await exigirSessao(PAPEIS);
  if (!podeVer(s, localId)) return { erro: 'Sem acesso a este local.' };
  const sb = supabaseAdmin();
  const { data: mesa } = await sb.from('mesas')
    .select('id, comanda_id').eq('id', mesaId).eq('local_id', localId).maybeSingle();
  if (!mesa) return { erro: 'Mesa não encontrada.' };
  if (mesa.comanda_id) {
    // comanda ainda aberta? só seleciona. Já faturada? a mesa ficou "ocupada" de propósito
    // (mesa_fechar é passo separado e auditado no mesas_status_log) — aqui ela é liberada
    // e uma comanda nova é aberta, senão o clique na mesa vira beco sem saída.
    const { data: atual } = await sb.from('comandas').select('id, status').eq('id', mesa.comanda_id).maybeSingle();
    if (atual?.status === 'aberta') {
      return { ok: 'Mesa já tinha comanda aberta.', estado: await montar(s, localId, atual.id) };
    }
    const { error: eLiberar } = await sb.rpc('mesa_fechar', { p_mesa: mesaId });
    if (eLiberar) return { erro: traduzErro(eLiberar.message) };
  }

  const { data, error } = await sb.rpc('mesa_abrir', { p_mesa: mesaId, p_aberto_por: s.id });
  if (error) return { erro: traduzErro(error.message) };
  return { ok: 'Mesa aberta.', estado: await montar(s, localId, data as string) };
}

export async function transferirMesa(localId: string, origem: string, destino: string): Promise<Resultado> {
  const s = await exigirSessao(PAPEIS);
  if (!podeVer(s, localId)) return { erro: 'Sem acesso a este local.' };
  const { error } = await supabaseAdmin().rpc('mesa_transferir', { p_mesa_origem: origem, p_mesa_destino: destino });
  if (error) return { erro: traduzErro(error.message) };
  const { data } = await supabaseAdmin().from('mesas').select('comanda_id').eq('id', destino).maybeSingle();
  return { ok: 'Comanda transferida.', estado: await montar(s, localId, data?.comanda_id ?? null) };
}

export async function abrirAvulsa(localId: string): Promise<Resultado> {
  const s = await exigirSessao(PAPEIS);
  if (!podeVer(s, localId)) return { erro: 'Sem acesso a este local.' };
  const { data, error } = await supabaseAdmin().rpc('comanda_abrir', { p_local: localId, p_aberto_por: s.id });
  if (error) return { erro: traduzErro(error.message) };
  return { ok: 'Comanda avulsa aberta.', estado: await montar(s, localId, data as string) };
}

// ---------------------------------------------------------------- itens da comanda

export async function adicionarItem(
  localId: string, comandaId: string, produtoId: string,
  quantidade: number, tipoItem: 'copao' | 'revenda', maior18: boolean,
): Promise<Resultado> {
  const s = await exigirSessao(PAPEIS);
  if (!podeVer(s, localId)) return { erro: 'Sem acesso a este local.' };
  const pComanda = UUID.safeParse(comandaId);
  const pProduto = UUID.safeParse(produtoId);
  const pQtd = QTD.safeParse(quantidade);
  if (!pComanda.success) return { erro: 'Comanda inválida.' };
  if (!pProduto.success) return { erro: 'Produto inválido.' };
  if (!pQtd.success) return { erro: pQtd.error.issues[0].message };

  const { error } = await supabaseAdmin().rpc('comanda_adicionar', {
    p_comanda: pComanda.data, p_produto: pProduto.data,
    p_quantidade: pQtd.data, p_tipo_item: tipoItem, p_maior18: maior18,
  });
  if (error) return { erro: traduzErro(error.message) };
  return { ok: 'Item lançado na comanda.', estado: await montar(s, localId, comandaId) };
}

export async function removerItem(localId: string, comandaId: string, itemId: string): Promise<Resultado> {
  const s = await exigirSessao(PAPEIS);
  if (!podeVer(s, localId)) return { erro: 'Sem acesso a este local.' };
  const pItem = UUID.safeParse(itemId);
  if (!pItem.success) return { erro: 'Item inválido.' };
  const { error } = await supabaseAdmin().rpc('comanda_remover_item', { p_item: pItem.data });
  if (error) return { erro: traduzErro(error.message) };
  return { ok: 'Item removido.', estado: await montar(s, localId, comandaId) };
}

export async function dividirComanda(
  localId: string, origem: string, mesaDestino: string, itens: string[],
): Promise<Resultado> {
  const s = await exigirSessao(PAPEIS);
  if (!podeVer(s, localId)) return { erro: 'Sem acesso a este local.' };
  if (itens.length === 0) return { erro: 'Escolha ao menos um item para transferir.' };
  const { error } = await supabaseAdmin().rpc('mesa_dividir', {
    p_comanda_origem: origem, p_mesa_destino: mesaDestino, p_itens: itens,
  });
  if (error) return { erro: traduzErro(error.message) };
  // a seleção fica na comanda de origem: o usuário estava mexendo nela
  return { ok: 'Comanda dividida.', estado: await montar(s, localId, origem) };
}

// ---------------------------------------------------------------- caixa e faturamento

export async function abrirCaixaBar(localId: string, valorAbertura: number, comandaId: string | null): Promise<Resultado> {
  const s = await exigirSessao(PAPEIS);
  if (!podeVer(s, localId)) return { erro: 'Sem acesso a este local.' };
  const pValor = QTD.safeParse(Math.max(0, Number(valorAbertura) || 0));
  if (!pValor.success) return { erro: 'Valor de abertura inválido.' };
  const sb = supabaseAdmin();
  const { data: caixa } = await sb.from('caixas')
    .select('id').eq('local_id', localId).eq('ativo', true).order('nome').limit(1).maybeSingle();
  if (!caixa) return { erro: 'Este local não tem caixa cadastrado.' };

  const { data: jaAberta } = await sb.from('caixa_sessoes')
    .select('id').eq('caixa_id', caixa.id).eq('status', 'aberta').limit(1);
  if (jaAberta?.length) return { ok: 'Caixa já estava aberto.', estado: await montar(s, localId, comandaId) };

  const { error } = await sb.from('caixa_sessoes').insert({
    tenant_id: s.tenantId, caixa_id: caixa.id, local_id: localId,
    operador_id: s.id, valor_abertura: pValor.data,
  });
  if (error) return { erro: traduzErro(error.message) };
  return { ok: 'Caixa do bar aberto.', estado: await montar(s, localId, comandaId) };
}

export async function fecharComanda(
  localId: string, comandaId: string, formaPagamento: string,
): Promise<Resultado> {
  const s = await exigirSessao(PAPEIS);
  if (!podeVer(s, localId)) return { erro: 'Sem acesso a este local.' };
  const sb = supabaseAdmin();
  const st = await montar(s, localId, comandaId);
  if (!st.caixa.sessaoId) return { erro: 'Abra o caixa do bar para faturar.', estado: st };
  const { data: com } = await sb.from('comandas').select('mesa_id').eq('id', comandaId).maybeSingle();

  const { error } = await sb.rpc('comanda_fechar', {
    p_comanda: comandaId, p_caixa_sessao: st.caixa.sessaoId, p_forma_pagamento: formaPagamento,
  });
  if (error) return { erro: traduzErro(error.message), estado: st };

  // comanda_fechar não mexe na mesa de propósito (o log de status fica auditável por etapa);
  // o passo seguinte é a mesa_fechar. Aqui ele roda junto para o usuário não ficar com mesa presa.
  if (com?.mesa_id) {
    const { error: eLiberar } = await sb.rpc('mesa_fechar', { p_mesa: com.mesa_id });
    if (eLiberar && !eLiberar.message.includes('não está ocupada')) {
      return { erro: `Comanda faturada, mas a mesa não foi liberada: ${traduzErro(eLiberar.message)}`, estado: await montar(s, localId, null) };
    }
  }
  return { ok: 'Comanda faturada.', estado: await montar(s, localId, null) };
}

export async function venderCopao(
  localId: string, produtoId: string, quantidade: number, formaPagamento: string,
  comandaId: string | null, maior18: boolean,
): Promise<Resultado> {
  const s = await exigirSessao(PAPEIS);
  if (!podeVer(s, localId)) return { erro: 'Sem acesso a este local.' };
  const sb = supabaseAdmin();
  const st = await montar(s, localId, comandaId);
  if (!st.caixa.sessaoId) return { erro: 'Abra o caixa do bar para vender.', estado: st };

  const pProduto = UUID.safeParse(produtoId);
  const pQtd = QTD.safeParse(quantidade);
  if (!pProduto.success) return { erro: 'Produto inválido.', estado: st };
  if (!pQtd.success) return { erro: pQtd.error.issues[0].message, estado: st };

  // copao_vender (0005) não recebe p_maior18 — o bloqueio de idade existe só em comanda_adicionar.
  // Confere aqui, no ponto de entrada do servidor, para a venda avulsa não pular a regra do PDV.
  const { data: prod } = await sb.from('produtos').select('adulto').eq('id', pProduto.data).maybeSingle();
  if (prod?.adulto && !maior18) {
    return { erro: 'Item +18: confirme que o cliente é maior de 18 anos.', estado: st };
  }

  const { error } = await sb.rpc('copao_vender', {
    p_produto: pProduto.data, p_local: localId,
    p_quantidade: pQtd.data, p_caixa_sessao: st.caixa.sessaoId, p_forma_pagamento: formaPagamento,
  });
  if (error) return { erro: traduzErro(error.message), estado: st };
  return { ok: 'Copão vendido.', estado: await montar(s, localId, comandaId) };
}
