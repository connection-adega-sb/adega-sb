'use client';
import { useCallback, useEffect, useState } from 'react';
import { useActionState } from 'react';
import {
  buscarSaldos, listarProdutos,
  criarTransferencia, enviarTransferencia, receberTransferencia, cancelarTransferencia,
  listarTransferencias, listarInventarios, abrirInventario, contarInventario, fecharInventario, aprovarInventario, cancelarInventario,
  buscarFicha, salvarFicha, aplicarPrecoFicha, copoesDisponiveis,
  type SaldoLinha, type ProdutoEscolha, type LocalResumo, type TransferenciaLinha,
  type InventarioLinha, type Ficha, type CopaoDisponivel,
  type EstadoTransferencia, type EstadoInventario, type EstadoFicha,
} from './actions';
import { ROTULO_PAPEL, type Papel } from '@/lib/papeis';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

type Aba = 'saldos' | 'transferencias' | 'inventario' | 'fichas';

type Aviso = { tipo: 'ok' | 'erro'; texto: string } | null;

function Aviso({ aviso }: { aviso: Aviso }) {
  if (!aviso) return null;
  return (
    <p
      data-testid="estoque-aviso"
      className={`rounded-card border-l-4 p-3 text-sm ${aviso.tipo === 'ok' ? 'border-ok bg-white' : 'border-bad bg-white'}`}
    >
      {aviso.texto}
    </p>
  );
}

export function Estoque({ locais: locaisInicial, papel, nome, deveTrocarSenha }: {
  locais: LocalResumo[]; papel: Papel; nome: string; deveTrocarSenha: boolean;
}) {
  const [locais] = useState<LocalResumo[]>(locaisInicial);
  const [aba, setAba] = useState<Aba>('saldos');
  const [localId, setLocalId] = useState<string>(locaisInicial[0]?.id ?? '');
  const [aviso, setAviso] = useState<Aviso>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => { setCarregando(false); }, []);

  const podeAprovar = papel === 'master' || papel === 'gerente';

  const trocarAba = useCallback((a: Aba) => { setAba(a); setAviso(null); }, []);

  if (carregando) return <main className="p-8 text-center text-ink-soft">Carregando estoque.</main>;

  return (
    <div className="min-h-screen bg-fundo" data-testid="estoque">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-estrutura">Catálogo e estoque</h1>
            <p className="text-sm text-ink-soft">{nome} · {ROTULO_PAPEL[papel]}</p>
          </div>
          {locais.length > 0 && (
            <label className="ml-auto flex items-center gap-2">
              <span className="text-sm font-bold text-ink-soft">Local</span>
              <select
                value={localId}
                onChange={(e) => setLocalId(e.target.value)}
                data-testid="estoque-local"
                className="rounded-full border-[1.5px] border-line-input bg-white px-3 py-1.5 font-bold focus:outline-none"
              >
                {locais.map((l) => <option key={l.id} value={l.id}>{l.nome} · {l.codigo}</option>)}
              </select>
            </label>
          )}
        </div>

        {deveTrocarSenha && (
          <p className="rounded-card border-l-4 border-warn bg-white p-3 text-sm">
            <strong>Troque sua senha.</strong> A senha inicial expira no primeiro acesso.
          </p>
        )}

        <nav className="flex flex-wrap gap-2" role="tablist">
          {([
            ['saldos', 'Saldos'],
            ['transferencias', 'Transferências'],
            ['inventario', 'Inventário'],
            ['fichas', 'Fichas do copão'],
          ] as [Aba, string][]).map(([id, rotulo]) => (
            <button
              key={id}
              role="tab"
              aria-selected={aba === id}
              onClick={() => trocarAba(id)}
              data-testid={`aba-${id}`}
              className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                aba === id ? 'bg-acao-600 text-white' : 'bg-white text-ink-soft hover:bg-acao-100'
              }`}
            >
              {rotulo}
            </button>
          ))}
        </nav>

        <Aviso aviso={aviso} />

        {aba === 'saldos' && <AbaSaldos localId={localId} />}
        {aba === 'transferencias' && <AbaTransferencias localId={localId} locais={locais} setAviso={setAviso} />}
        {aba === 'inventario' && <AbaInventario localId={localId} locais={locais} podeAprovar={podeAprovar} setAviso={setAviso} />}
        {aba === 'fichas' && <AbaFichas localId={localId} podeAprovar={podeAprovar} setAviso={setAviso} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Saldos
function AbaSaldos({ localId }: { localId: string }) {
  const [linhas, setLinhas] = useState<SaldoLinha[]>([]);
  const [termo, setTermo] = useState('');
  const [vazio, setVazio] = useState(false);

  useEffect(() => {
    let vivo = true;
    buscarSaldos(localId, termo).then((r) => { if (vivo) { setLinhas(r); setVazio(r.length === 0); } });
    return () => { vivo = false; };
  }, [localId, termo]);

  const baixo = linhas.filter((l) => l.quantidade <= l.minimo).length;

  return (
    <section className="space-y-3" data-testid="painel-saldos">
      <div className="rounded-card bg-white p-4">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Filtrar por nome ou SKU…"
          data-testid="saldos-busca"
          className="w-full rounded-full border-[1.5px] border-line-input bg-white px-4 py-2.5 focus:outline-none focus:border-estrutura"
        />
        <p className="mt-2 text-xs text-ink-soft">
          {linhas.length} produto(s) · {baixo} no mínimo ou abaixo
        </p>
      </div>

      {vazio ? (
        <p className="rounded-card bg-white p-6 text-center text-sm text-ink-soft" data-testid="saldos-vazio">
          Nenhum produto com saldo neste local.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="bg-fundo text-left text-xs uppercase text-ink-soft">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Produto</th>
                <th className="px-3 py-2">Categoria</th>
                <th className="px-3 py-2 text-right">Saldo</th>
                <th className="px-3 py-2 text-right">Mínimo</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.produtoId} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-xs">{l.sku ?? '—'}</td>
                  <td className="px-3 py-2">
                    {l.nome}
                    {l.tipo === 'preparado' && <span className="ml-1 rounded bg-acao-600 px-1 text-[10px] font-bold text-white">copão</span>}
                    {l.tipo === 'insumo' && <span className="ml-1 rounded bg-estrutura px-1 text-[10px] font-bold text-white">insumo</span>}
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{l.categoria ?? '—'}</td>
                  <td className={`px-3 py-2 text-right font-bold ${l.quantidade <= l.minimo ? 'text-warn' : 'text-ink'}`}>
                    {num(l.quantidade)} {l.unidade}
                    {l.quantidade <= l.minimo && <span className="ml-1 text-xs font-normal">baixo</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-soft">{num(l.minimo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Transferências
type ItemTrans = { produtoId: string; quantidade: number };

function AbaTransferencias({ localId, locais, setAviso }: {
  localId: string; locais: LocalResumo[];
  setAviso: (a: Aviso) => void;
}) {
  const [lista, setLista] = useState<TransferenciaLinha[]>([]);
  const [filtro, setFiltro] = useState<string>('');
  const [produtos, setProdutos] = useState<ProdutoEscolha[]>([]);
  const [recebendo, setRecebendo] = useState<TransferenciaLinha | null>(null);

  // formulário nova transferência
  const [origem, setOrigem] = useState(localId);
  const [destino, setDestino] = useState('');
  const [motivo, setMotivo] = useState('');
  const [itens, setItens] = useState<ItemTrans[]>([]);
  const [buscaItem, setBuscaItem] = useState('');

  const recarregar = useCallback(() => {
    listarTransferencias(filtro || undefined).then(setLista);
  }, [filtro]);

  useEffect(() => { recarregar(); }, [recarregar]);
  useEffect(() => { listarProdutos().then(setProdutos); }, []);

  const [stTrans, formTrans] = useActionState(criarTransferencia, {} as EstadoTransferencia);
  const [stEnv, formEnv] = useActionState(
    (_s: EstadoTransferencia, f: FormData) => enviarTransferencia(String(f.get('id'))),
    {} as EstadoTransferencia,
  );
  const [stRec, formRec] = useActionState(receberTransferencia, {} as EstadoTransferencia);
  const [stCan, formCan] = useActionState(
    (_s: EstadoTransferencia, f: FormData) => cancelarTransferencia(String(f.get('id')), String(f.get('motivo') ?? '')),
    {} as EstadoTransferencia,
  );

  useEffect(() => {
    if (stTrans.ok || stTrans.erro) { setAviso({ tipo: stTrans.erro ? 'erro' : 'ok', texto: stTrans.erro ?? stTrans.ok ?? '' }); if (stTrans.ok) { setItens([]); setMotivo(''); recarregar(); } }
  }, [stTrans, recarregar, setAviso]);
  useEffect(() => {
    if (stEnv.ok || stEnv.erro) { setAviso({ tipo: stEnv.erro ? 'erro' : 'ok', texto: stEnv.erro ?? stEnv.ok ?? '' }); if (stEnv.ok) recarregar(); }
  }, [stEnv, recarregar, setAviso]);
  useEffect(() => {
    if (stRec.ok || stRec.erro) { setAviso({ tipo: stRec.erro ? 'erro' : 'ok', texto: stRec.erro ?? stRec.ok ?? '' }); if (stRec.ok) { setRecebendo(null); recarregar(); } }
  }, [stRec, recarregar, setAviso]);
  useEffect(() => {
    if (stCan.ok || stCan.erro) { setAviso({ tipo: stCan.erro ? 'erro' : 'ok', texto: stCan.erro ?? stCan.ok ?? '' }); if (stCan.ok) recarregar(); }
  }, [stCan, recarregar, setAviso]);

  const produtosFiltrados = buscaItem.trim()
    ? produtos.filter((p) => (p.nome + ' ' + (p.sku ?? '')).toLowerCase().includes(buscaItem.toLowerCase())).slice(0, 8)
    : [];

  const addItem = (p: ProdutoEscolha) => {
    setItens((it) => it.find((x) => x.produtoId === p.id) ? it : [...it, { produtoId: p.id, quantidade: 1 }]);
    setBuscaItem('');
  };
  const nomeProduto = (id: string) => produtos.find((p) => p.id === id)?.nome ?? id.slice(0, 8);

  const podeCriar = origem && destino && origem !== destino && itens.length > 0;

  return (
    <section className="space-y-4" data-testid="painel-transferencias">
      {/* nova transferência */}
      <div className="rounded-card bg-white p-4 space-y-3">
        <h2 className="font-bold text-estrutura">Nova transferência</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="font-bold text-ink-soft">Origem</span>
            <select value={origem} onChange={(e) => setOrigem(e.target.value)} data-testid="trans-origem"
              className="mt-1 w-full rounded border-[1.5px] border-line-input bg-white px-3 py-2">
              {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-bold text-ink-soft">Destino</span>
            <select value={destino} onChange={(e) => setDestino(e.target.value)} data-testid="trans-destino"
              className="mt-1 w-full rounded border-[1.5px] border-line-input bg-white px-3 py-2">
              <option value="">Escolha…</option>
              {locais.filter((l) => l.id !== origem).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </label>
        </div>

        <div className="text-sm">
          <span className="font-bold text-ink-soft">Adicionar item</span>
          <input
            value={buscaItem}
            onChange={(e) => setBuscaItem(e.target.value)}
            placeholder="Buscar produto…"
            data-testid="trans-busca-item"
            className="mt-1 w-full rounded border-[1.5px] border-line-input bg-white px-3 py-2"
          />
          {produtosFiltrados.length > 0 && (
            <ul className="mt-1 overflow-hidden rounded border border-line">
              {produtosFiltrados.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => addItem(p)}
                    className="block w-full px-3 py-2 text-left hover:bg-fundo">
                    {p.nome} <span className="text-ink-soft">· {p.sku ?? '—'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {itens.length > 0 && (
          <ul className="space-y-2" data-testid="trans-itens">
            {itens.map((it) => (
              <li key={it.produtoId} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{nomeProduto(it.produtoId)}</span>
                <input
                  type="number" min="0.001" step="0.001" value={it.quantidade}
                  onChange={(e) => setItens((arr) => arr.map((x) => x.produtoId === it.produtoId ? { ...x, quantidade: Number(e.target.value) } : x))}
                  data-testid={`trans-qtd-${it.produtoId}`}
                  className="w-24 rounded border-[1.5px] border-line-input px-2 py-1 text-right"
                />
                <button type="button" onClick={() => setItens((arr) => arr.filter((x) => x.produtoId !== it.produtoId))}
                  className="rounded-full bg-bad/10 px-2 py-1 text-xs font-bold text-bad">✕</button>
              </li>
            ))}
          </ul>
        )}

        <label className="block text-sm">
          <span className="font-bold text-ink-soft">Motivo (opcional)</span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300}
            className="mt-1 w-full rounded border-[1.5px] border-line-input bg-white px-3 py-2" />
        </label>

        <form action={formTrans}>
          <input type="hidden" name="dados" value={JSON.stringify({ origem, destino, itens, motivo: motivo || undefined })} />
          <button type="submit" disabled={!podeCriar} data-testid="trans-criar"
            className="rounded-full bg-acao-600 px-5 py-2 text-sm font-bold text-white disabled:bg-fundo disabled:text-ink-soft">
            Criar rascunho
          </button>
        </form>
      </div>

      {/* lista */}
      <div className="rounded-card bg-white p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-bold text-estrutura">Transferências</h2>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} data-testid="trans-filtro"
            className="ml-auto rounded border-[1.5px] border-line-input bg-white px-2 py-1 text-sm">
            <option value="">Todas</option>
            <option value="rascunho">Rascunho</option>
            <option value="enviada">Enviadas</option>
            <option value="recebida">Recebidas</option>
            <option value="cancelada">Canceladas</option>
          </select>
        </div>

        {lista.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-soft" data-testid="trans-vazio">Nenhuma transferência.</p>
        ) : (
          <ul className="divide-y divide-line">
            {lista.map((t) => (
              <li key={t.id} className="py-3" data-testid={`trans-${t.id}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold">{t.origem} → {t.destino}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    t.status === 'recebida' ? 'bg-ok/10 text-ok'
                    : t.status === 'enviada' ? 'bg-acao-100 text-acao-700'
                    : t.status === 'cancelada' ? 'bg-bad/10 text-bad' : 'bg-fundo text-ink-soft'}`}>
                    {t.status}
                  </span>
                  <span className="text-xs text-ink-soft">{new Date(t.criadoEm).toLocaleString('pt-BR')}</span>
                </div>
                <ul className="mt-1 text-xs text-ink-soft">
                  {t.itens.map((i) => (
                    <li key={i.produtoId}>
                      {i.nome} · enviados {num(i.quantidade)}
                      {i.recebida !== null && <> · recebidos {num(i.recebida)}</>}
                    </li>
                  ))}
                </ul>
                {t.status === 'rascunho' && (
                  <div className="mt-2 flex gap-2">
                    <form action={formEnv}>
                      <input type="hidden" name="id" value={t.id} />
                      <button data-testid={`enviar-${t.id}`} className="rounded-full bg-acao-600 px-3 py-1 text-xs font-bold text-white">Enviar</button>
                    </form>
                    <form action={formCan}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="motivo" value="cancelada pelo estoque" />
                      <button data-testid={`cancelar-${t.id}`} className="rounded-full bg-bad/10 px-3 py-1 text-xs font-bold text-bad">Cancelar</button>
                    </form>
                  </div>
                )}
                {t.status === 'enviada' && (
                  <button onClick={() => setRecebendo(t)} data-testid={`receber-${t.id}`}
                    className="mt-2 rounded-full bg-ok px-3 py-1 text-xs font-bold text-white">
                    Receber
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* drawer receber */}
      {recebendo && (
        <FormRecebimento transferencia={recebendo} formRec={formRec} onFechar={() => setRecebendo(null)} />
      )}
    </section>
  );
}

function FormRecebimento({ transferencia, formRec, onFechar }: {
  transferencia: TransferenciaLinha;
  formRec: (payload: FormData) => void;
  onFechar: () => void;
}) {
  const [contagens, setContagens] = useState<Record<string, number>>(
    Object.fromEntries(transferencia.itens.map((i) => [i.produtoId, i.quantidade])),
  );

  const payload = JSON.stringify({
    id: transferencia.id,
    contagens: transferencia.itens.map((i) => ({ produtoId: i.produtoId, recebida: contagens[i.produtoId] ?? 0 })),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" data-testid="drawer-receber">
      <div className="w-full max-w-md rounded-card bg-white p-4 space-y-3">
        <div className="flex items-center">
          <h3 className="font-bold text-estrutura">Receber · {transferencia.origem} → {transferencia.destino}</h3>
          <button onClick={onFechar} className="ml-auto text-ink-soft" aria-label="Fechar">✕</button>
        </div>
        <p className="text-xs text-ink-soft">Informe a contagem real. Divergência vira perda auditada.</p>
        <ul className="space-y-2">
          {transferencia.itens.map((i) => (
            <li key={i.produtoId} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{i.nome}</span>
              <span className="text-xs text-ink-soft">enviado {num(i.quantidade)}</span>
              <input
                type="number" min="0" step="0.001" value={contagens[i.produtoId] ?? 0}
                onChange={(e) => setContagens((c) => ({ ...c, [i.produtoId]: Number(e.target.value) }))}
                data-testid={`contagem-${i.produtoId}`}
                className="w-24 rounded border-[1.5px] border-line-input px-2 py-1 text-right"
              />
            </li>
          ))}
        </ul>
        <form action={formRec}>
          <input type="hidden" name="dados" value={payload} />
          <button data-testid="confirmar-recebimento"
            className="w-full rounded-full bg-ok px-4 py-2 text-sm font-bold text-white">
            Confirmar recebimento
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Inventário
function AbaInventario({ localId, locais, podeAprovar, setAviso }: {
  localId: string; locais: LocalResumo[]; podeAprovar: boolean; setAviso: (a: Aviso) => void;
}) {
  const [lista, setLista] = useState<InventarioLinha[]>([]);
  const [contando, setContando] = useState<InventarioLinha | null>(null);

  const recarregar = useCallback(() => { listarInventarios().then(setLista); }, []);
  useEffect(() => { recarregar(); }, [recarregar]);

  const [stAbrir, formAbrir] = useActionState(abrirInventario, {} as EstadoInventario);
  const [stContar, formContar] = useActionState(contarInventario, {} as EstadoInventario);
  const [stFechar, formFechar] = useActionState(
    (_s: EstadoInventario, f: FormData) => fecharInventario(String(f.get('id'))), {} as EstadoInventario,
  );
  const [stAprovar, formAprovar] = useActionState(
    (_s: EstadoInventario, f: FormData) => aprovarInventario(String(f.get('id'))), {} as EstadoInventario,
  );
  const [stCancelar, formCancelar] = useActionState(
    (_s: EstadoInventario, f: FormData) => cancelarInventario(String(f.get('id')), String(f.get('motivo') ?? '')), {} as EstadoInventario,
  );

  useEffect(() => {
    for (const [st, limpar] of [[stAbrir, null], [stContar, null], [stFechar, null], [stAprovar, null], [stCancelar, null]] as [EstadoInventario, unknown][]) {
      if (st.ok || st.erro) {
        setAviso({ tipo: st.erro ? 'erro' : 'ok', texto: st.erro ?? st.ok ?? '' });
        if (st.ok) { recarregar(); if (limpar === null && stAbrir.id && st === stAbrir) { /* abre contagem */ } }
      }
    }
  }, [stAbrir, stContar, stFechar, stAprovar, stCancelar, recarregar, setAviso]);

  useEffect(() => { if (stAbrir.ok && stAbrir.id) { listarInventarios().then((l) => setContando(l.find((x) => x.id === stAbrir.id) ?? null)); } }, [stAbrir]);

  return (
    <section className="space-y-4" data-testid="painel-inventario">
      <div className="rounded-card bg-white p-4 space-y-3">
        <h2 className="font-bold text-estrutura">Abrir inventário cego</h2>
        <p className="text-xs text-ink-soft">Congela a folha de contagem dos produtos com saldo ≠ 0 no local. O contador vê só o produto — nunca o saldo.</p>
        <form action={formAbrir} className="flex flex-wrap items-center gap-2">
          <select name="localId" defaultValue={localId} data-testid="inv-local"
            className="rounded border-[1.5px] border-line-input bg-white px-3 py-2 text-sm">
            {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
          <button data-testid="inv-abrir" className="rounded-full bg-acao-600 px-4 py-2 text-sm font-bold text-white">Abrir</button>
        </form>
      </div>

      {contando && (
        <FormContagem inventario={contando} formContar={formContar} onFechar={() => setContando(null)} />
      )}

      <div className="rounded-card bg-white p-4 space-y-3">
        <h2 className="font-bold text-estrutura">Inventários</h2>
        {lista.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-soft" data-testid="inv-vazio">Nenhum inventário.</p>
        ) : (
          <ul className="divide-y divide-line">
            {lista.map((inv) => (
              <li key={inv.id} className="py-3" data-testid={`inv-${inv.id}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold">{inv.local}</span>
                  {inv.categoria && <span className="text-xs text-ink-soft">· {inv.categoria}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    inv.status === 'aprovado' ? 'bg-ok/10 text-ok'
                    : inv.status === 'em_revisao' ? 'bg-acao-100 text-acao-700'
                    : inv.status === 'cancelado' ? 'bg-bad/10 text-bad' : 'bg-fundo text-ink-soft'}`}>
                    {inv.status}
                  </span>
                  <span className="text-xs text-ink-soft">{new Date(inv.abertoEm).toLocaleString('pt-BR')}</span>
                </div>
                <p className="mt-1 text-xs text-ink-soft">{inv.itens.length} item(ns) na folha</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {inv.status === 'aberto' && (
                    <>
                      <button onClick={() => setContando(inv)} data-testid={`contar-${inv.id}`}
                        className="rounded-full bg-acao-600 px-3 py-1 text-xs font-bold text-white">Contar</button>
                      <form action={formFechar}>
                        <input type="hidden" name="id" value={inv.id} />
                        <button data-testid={`fechar-${inv.id}`} className="rounded-full bg-estrutura px-3 py-1 text-xs font-bold text-white">Fechar para revisão</button>
                      </form>
                    </>
                  )}
                  {inv.status === 'em_revisao' && podeAprovar && (
                    <form action={formAprovar}>
                      <input type="hidden" name="id" value={inv.id} />
                      <button data-testid={`aprovar-${inv.id}`} className="rounded-full bg-ok px-3 py-1 text-xs font-bold text-white">Aprovar e ajustar</button>
                    </form>
                  )}
                  {(inv.status === 'aberto' || inv.status === 'em_revisao') && (
                    <form action={formCancelar} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={inv.id} />
                      <input name="motivo" placeholder="Motivo" required
                        className="w-32 rounded border-[1.5px] border-line-input px-2 py-1 text-xs" />
                      <button data-testid={`cancelar-inv-${inv.id}`} className="rounded-full bg-bad/10 px-3 py-1 text-xs font-bold text-bad">Cancelar</button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function FormContagem({ inventario, formContar, onFechar }: {
  inventario: InventarioLinha;
  formContar: (payload: FormData) => void;
  onFechar: () => void;
}) {
  const [contados, setContados] = useState<Record<string, number>>(
    Object.fromEntries(inventario.itens.map((i) => [i.produtoId, i.contado ?? 0])),
  );
  const payload = JSON.stringify({
    inventarioId: inventario.id,
    itens: inventario.itens.map((i) => ({ produtoId: i.produtoId, contado: contados[i.produtoId] ?? 0 })),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" data-testid="drawer-contagem">
      <div className="w-full max-w-lg rounded-card bg-white p-4 space-y-3">
        <div className="flex items-center">
          <h3 className="font-bold text-estrutura">Contagem cega · {inventario.local}</h3>
          <button onClick={onFechar} className="ml-auto text-ink-soft" aria-label="Fechar">✕</button>
        </div>
        <p className="text-xs text-ink-soft">Digite a quantidade contada. O saldo fica oculto até o fechamento.</p>
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {inventario.itens.map((i) => (
            <li key={i.produtoId} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{i.nome}</span>
              <input
                type="number" min="0" step="0.001" value={contados[i.produtoId] ?? 0}
                onChange={(e) => setContados((c) => ({ ...c, [i.produtoId]: Number(e.target.value) }))}
                data-testid={`contado-${i.produtoId}`}
                className="w-24 rounded border-[1.5px] border-line-input px-2 py-1 text-right"
              />
            </li>
          ))}
        </ul>
        <form action={formContar}>
          <input type="hidden" name="dados" value={payload} />
          <button data-testid="salvar-contagem" className="w-full rounded-full bg-acao-600 px-4 py-2 text-sm font-bold text-white">
            Salvar contagem
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Fichas do copão
function AbaFichas({ localId, podeAprovar, setAviso }: {
  localId: string; podeAprovar: boolean; setAviso: (a: Aviso) => void;
}) {
  const [produtos, setProdutos] = useState<ProdutoEscolha[]>([]);
  const [preparados, setPreparados] = useState<ProdutoEscolha[]>([]);
  const [produtoId, setProdutoId] = useState('');
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [markup, setMarkup] = useState(2.5);
  const [insumos, setInsumos] = useState<{ produtoId: string; quantidade: number; unidade: string }[]>([]);
  const [buscaIns, setBuscaIns] = useState('');
  const [copoes, setCopoes] = useState<CopaoDisponivel[]>([]);

  useEffect(() => {
    listarProdutos().then((ps) => { setProdutos(ps); setPreparados(ps.filter((p) => p.tipo === 'preparado')); });
  }, []);
  useEffect(() => { copoesDisponiveis(localId).then(setCopoes); }, [localId]);
  useEffect(() => {
    if (!produtoId) { setFicha(null); return; }
    buscarFicha(produtoId).then((f) => {
      setFicha(f); setMarkup(f?.markup ?? 2.5);
      setInsumos(f?.insumos.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade, unidade: i.unidade })) ?? []);
    });
  }, [produtoId]);

  const [stSalvar, formSalvar] = useActionState(salvarFicha, {} as EstadoFicha);
  const [stPreco, formPreco] = useActionState(
    (_s: EstadoFicha, f: FormData) => aplicarPrecoFicha(String(f.get('produtoId'))), {} as EstadoFicha,
  );

  useEffect(() => {
    if (stSalvar.ok || stSalvar.erro) setAviso({ tipo: stSalvar.erro ? 'erro' : 'ok', texto: stSalvar.erro ?? stSalvar.ok ?? '' });
  }, [stSalvar, setAviso]);
  useEffect(() => {
    if (stPreco.ok || stPreco.erro) {
      setAviso({ tipo: stPreco.erro ? 'erro' : 'ok', texto: stPreco.erro ?? stPreco.ok ?? '' });
      if (stPreco.ok && produtoId) buscarFicha(produtoId).then(setFicha);
    }
  }, [stPreco, produtoId, setAviso]);

  const insumosIns = buscaIns.trim()
    ? produtos.filter((p) => p.tipo !== 'preparado' && (p.nome + ' ' + (p.sku ?? '')).toLowerCase().includes(buscaIns.toLowerCase())).slice(0, 8)
    : [];
  const nomeProduto = (id: string) => produtos.find((p) => p.id === id)?.nome ?? id.slice(0, 8);

  const payloadSalvar = JSON.stringify({ produtoId, markup, insumos });

  return (
    <section className="space-y-4" data-testid="painel-fichas">
      {/* copões disponíveis no local */}
      <div className="rounded-card bg-white p-4 space-y-2">
        <h2 className="font-bold text-estrutura">Copões disponíveis no local</h2>
        {copoes.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-soft" data-testid="copoes-vazio">Nenhum copão com estoque de insumos aqui.</p>
        ) : (
          <ul className="divide-y divide-line">
            {copoes.map((c) => (
              <li key={c.produtoId} className="flex items-center gap-2 py-2 text-sm" data-testid={`copao-${c.produtoId}`}>
                <span className="flex-1">{c.nome} <span className="text-xs text-ink-soft">· {c.sku ?? '—'}</span></span>
                <span className="font-bold">{brl(c.preco)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${c.disponiveis > 0 ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'}`}>
                  {c.disponiveis} copo(s)
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* editar ficha */}
      <div className="rounded-card bg-white p-4 space-y-3">
        <h2 className="font-bold text-estrutura">Ficha técnica do copão</h2>
        <label className="block text-sm">
          <span className="font-bold text-ink-soft">Produto (copão)</span>
          <select value={produtoId} onChange={(e) => setProdutoId(e.target.value)} data-testid="ficha-produto"
            className="mt-1 w-full rounded border-[1.5px] border-line-input bg-white px-3 py-2">
            <option value="">Escolha o copão…</option>
            {preparados.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>

        {produtoId && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm">
                <span className="font-bold text-ink-soft">Markup</span>
                <input type="number" min="0.1" step="0.1" value={markup} onChange={(e) => setMarkup(Number(e.target.value))}
                  data-testid="ficha-markup"
                  className="mt-1 w-full rounded border-[1.5px] border-line-input px-3 py-2" />
              </label>
              <div className="text-sm">
                <span className="font-bold text-ink-soft">CMV</span>
                <p className="mt-1 text-lg font-bold" data-testid="ficha-cmv">{ficha?.cmv != null ? brl(ficha.cmv) : '—'}</p>
              </div>
              <div className="text-sm">
                <span className="font-bold text-ink-soft">Preço no PDV</span>
                <p className="mt-1 text-lg font-bold" data-testid="ficha-preco">{ficha?.preco != null ? brl(ficha.preco) : '—'}</p>
              </div>
            </div>

            <div className="text-sm">
              <span className="font-bold text-ink-soft">Insumos (dose por copo)</span>
              <input value={buscaIns} onChange={(e) => setBuscaIns(e.target.value)} placeholder="Buscar insumo…"
                data-testid="ficha-busca-insumo"
                className="mt-1 w-full rounded border-[1.5px] border-line-input bg-white px-3 py-2" />
              {insumosIns.length > 0 && (
                <ul className="mt-1 overflow-hidden rounded border border-line">
                  {insumosIns.map((p) => (
                    <li key={p.id}>
                      <button type="button"
                        onClick={() => { setInsumos((arr) => arr.find((x) => x.produtoId === p.id) ? arr : [...arr, { produtoId: p.id, quantidade: 0, unidade: p.conteudoUnidade ?? 'un' }]); setBuscaIns(''); }}
                        className="block w-full px-3 py-2 text-left hover:bg-fundo">
                        {p.nome} <span className="text-ink-soft">· {p.sku ?? '—'} · conteúdo {p.conteudo ?? '—'} {p.conteudoUnidade ?? ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {insumos.length > 0 && (
              <ul className="space-y-2" data-testid="ficha-insumos">
                {insumos.map((ins) => (
                  <li key={ins.produtoId} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="flex-1">{nomeProduto(ins.produtoId)}</span>
                    <input type="number" min="0.001" step="0.001" value={ins.quantidade}
                      onChange={(e) => setInsumos((arr) => arr.map((x) => x.produtoId === ins.produtoId ? { ...x, quantidade: Number(e.target.value) } : x))}
                      data-testid={`insumo-qtd-${ins.produtoId}`}
                      className="w-24 rounded border-[1.5px] border-line-input px-2 py-1 text-right" />
                    <select value={ins.unidade}
                      onChange={(e) => setInsumos((arr) => arr.map((x) => x.produtoId === ins.produtoId ? { ...x, unidade: e.target.value } : x))}
                      className="rounded border-[1.5px] border-line-input px-2 py-1">
                      <option value="ml">ml</option><option value="g">g</option><option value="un">un</option>
                    </select>
                    <button type="button" onClick={() => setInsumos((arr) => arr.filter((x) => x.produtoId !== ins.produtoId))}
                      className="rounded-full bg-bad/10 px-2 py-1 text-xs font-bold text-bad">✕</button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-2">
              <form action={formSalvar}>
                <input type="hidden" name="dados" value={payloadSalvar} />
                <button data-testid="ficha-salvar" className="rounded-full bg-acao-600 px-4 py-2 text-sm font-bold text-white">Salvar ficha</button>
              </form>
              {podeAprovar && (
                <form action={formPreco}>
                  <input type="hidden" name="produtoId" value={produtoId} />
                  <button data-testid="ficha-aplicar-preco" className="rounded-full bg-ok px-4 py-2 text-sm font-bold text-white">Aplicar preço no PDV</button>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

