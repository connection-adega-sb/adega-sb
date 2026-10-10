'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  buscarEstado, abrirMesa, transferirMesa, abrirAvulsa, adicionarItem, removerItem,
  dividirComanda, abrirCaixaBar, fecharComanda, venderCopao,
  type Estado, type LocalResumo, type Resultado, type Escolha, type MesaLinha,
} from './actions';
import { ROTULO_PAPEL, type Papel } from '@/lib/papeis';
import { CadastroRapidoProduto } from '@/components/CadastroRapidoProduto';
import type { ProdutoNovo } from '@/app/produtos/actions';

// Tela do bar — F4.1 do roadmap-enterprise.md: grade de mesas, comanda aberta (lançar/remover
// item, transferir, dividir, fechar no caixa), venda avulsa de copão e caixa do local.
// Mesmo vocabulário visual de src/app/estoque/Estoque.tsx. Toda regra é do servidor: aqui só
// montamos a chamada e renderizamos o estado devolvido.

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const FORMAS = [
  ['pix', 'Pix'], ['cartao', 'Cartão'], ['dinheiro', 'Dinheiro'], ['boleto', 'Boleto'],
] as const;

const BTN = 'rounded-full bg-acao-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const LIMPO = 'rounded-full border-[1.5px] border-line-input bg-white px-4 py-2 text-sm font-bold transition-colors hover:bg-acao-100 disabled:cursor-not-allowed disabled:opacity-50';
const CAMPO = 'rounded-full border-[1.5px] border-line-input bg-white px-3 py-1.5 text-sm font-bold focus:outline-none disabled:opacity-60';

type Aviso = { tipo: 'ok' | 'erro'; texto: string } | null;
type Aba = 'mesas' | 'venda';

function Aviso({ aviso }: { aviso: Aviso }) {
  if (!aviso) return null;
  return (
    <p data-testid="bar-aviso" className={`rounded-card border-l-4 p-3 text-sm ${aviso.tipo === 'ok' ? 'border-ok bg-white' : 'border-bad bg-white'}`}>
      {aviso.texto}
    </p>
  );
}

export function Bar({ locais: locaisInicial, papel, nome, deveTrocarSenha }: {
  locais: LocalResumo[]; papel: Papel; nome: string; deveTrocarSenha: boolean;
}) {
  const [locais] = useState<LocalResumo[]>(locaisInicial);
  const [localId, setLocalId] = useState<string>(locaisInicial.find((l) => l.codigo === 'bar')?.id ?? locaisInicial[0]?.id ?? '');
  const [aba, setAba] = useState<Aba>('mesas');
  const [estado, setEstado] = useState<Estado | null>(null);
  const [comandaId, setComandaId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [carregando, setCarregando] = useState(true);
  const [pendente, setPendente] = useState(false);

  // lançar item
  const [produtoId, setProdutoId] = useState('');
  const [qtd, setQtd] = useState(1);
  const [maior18, setMaior18] = useState(false);
  // transferir / dividir
  const [destino, setDestino] = useState('');
  const [marcados, setMarcados] = useState<string[]>([]);
  // caixa / faturamento
  const [abertura, setAbertura] = useState('0');
  const [forma, setForma] = useState<string>('pix');
  // venda avulsa
  const [copaoId, setCopaoId] = useState('');
  const [copaoQtd, setCopaoQtd] = useState(1);
  const [maior18Venda, setMaior18Venda] = useState(false);
  const [formaVenda, setFormaVenda] = useState<string>('pix');
  // cadastro de produto no meio da venda (produto novo que ainda não está no catálogo)
  const [cadastro, setCadastro] = useState<null | { origem: 'comanda' | 'venda' | 'mesa' }>(null);

  const recarregar = useCallback(async (l: string, c: string | null) => {
    const e = await buscarEstado(l, c);
    setEstado(e);
    return e;
  }, []);

  useEffect(() => {
    let vivo = true;
    buscarEstado(localId, null).then((e) => { if (vivo) { setEstado(e); setCarregando(false); } }).catch(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [localId]);

  // Selecionar uma comanda exige recarregar: `estado` é a fonte do painel (itens/total),
  // então trocar de mesa só grava o id não bastava — o painel continuava no estado antigo.
  const selecionarComanda = useCallback(async (c: string | null) => {
    setAviso(null);
    const e = await buscarEstado(localId, c);
    setEstado(e);
    setComandaId(e.comandaId);
    setMarcados([]);
  }, [localId]);

  // Toda mutação devolve o estado já recalculado: não há refetch a parte nem soma no cliente.
  const rodar = useCallback(async (fn: () => Promise<Resultado>) => {
    setPendente(true);
    setAviso(null);
    try {
      const r = await fn();
      if (r.estado) {
        setEstado(r.estado);
        setComandaId(r.estado.comandaId);
        setMarcados([]);
      }
      if (r.erro) setAviso({ tipo: 'erro', texto: r.erro });
      else if (r.ok) setAviso({ tipo: 'ok', texto: r.ok });
      return r;
    } finally {
      setPendente(false);
    }
  }, []);

  if (carregando) return <main className="p-8 text-center text-ink-soft">Carregando bar.</main>;
  if (!estado) return <main className="p-8 text-center text-ink-soft">Não foi possível carregar o bar.</main>;

  const mesaDaComanda = estado.mesas.find((m) => m.comandaId === estado.comandaId) ?? null;
  const livres = estado.mesas.filter((m) => m.comandaId === null);
  const escolhidas: Escolha[] = [...estado.copoes, ...estado.revendas];
  const escolhida = escolhidas.find((e) => e.produtoId === produtoId) ?? null;
  const copaoEscolhido = estado.copoes.find((c) => c.produtoId === copaoId) ?? null;
  const temComanda = estado.comandaId !== null;
  const selecionarMesa = (m: MesaLinha) => {
    if (m.comandaId) void selecionarComanda(m.comandaId);
    else void rodar(() => abrirMesa(localId, m.id));
  };

  // Cadastro no MEIO da venda: com comanda aberta o item entra na hora e a operação segue.
  // Sem comanda, o cadastro fica pronto e o próximo passo é abrir uma mesa.
  const cadastrarProduto = async (p: ProdutoNovo) => {
    if (aba === 'venda') setAba('mesas');   // a comanda é onde a venda continua
    const comanda = estado.comandaId;
    const tipoItem: 'copao' | 'revenda' = p.tipo === 'preparado' ? 'copao' : 'revenda';

    if (comanda && (!p.adulto || maior18)) {
      const r = await rodar(() => adicionarItem(localId, comanda, p.id, 1, tipoItem, maior18));
      if (!r.erro) setAviso({ tipo: 'ok', texto: `"${p.nome}" cadastrado e lançado na comanda.` });
      return;
    }

    // recarrega: o produto novo tem de aparecer no <select> antes de poder ser escolhido
    const e = await buscarEstado(localId, comanda);
    setEstado(e);
    setComandaId(e.comandaId);
    if (comanda) {
      setProdutoId(p.id);
      setQtd(1);
      setAviso({
        tipo: 'ok',
        texto: p.adulto
          ? `"${p.nome}" cadastrado (+18): confirme a idade do cliente e clique em Adicionar.`
          : `"${p.nome}" cadastrado e já selecionado — clique em Adicionar.`,
      });
      return;
    }
    setAviso({ tipo: 'ok', texto: `"${p.nome}" cadastrado com saldo no local. Abra uma mesa para lançá-lo na venda.` });
  };

  return (
    <div className="min-h-screen bg-fundo" data-testid="bar">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-estrutura">Bar · mesas e comandas</h1>
            <p className="text-sm text-ink-soft">{nome} · {ROTULO_PAPEL[papel]}</p>
          </div>
          <label className="ml-auto flex items-center gap-2">
            <span className="text-sm font-bold text-ink-soft">Local</span>
            <select
              value={localId}
              onChange={(e) => { setLocalId(e.target.value); setComandaId(null); setAviso(null); }}
              data-testid="bar-local"
              className={CAMPO}
            >
              {locais.map((l) => <option key={l.id} value={l.id}>{l.nome} · {l.codigo}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => { setAviso(null); void recarregar(localId, comandaId); }}
            disabled={pendente}
            data-testid="bar-atualizar"
            className={LIMPO}
          >
            Atualizar
          </button>
        </div>

        {deveTrocarSenha && (
          <p className="rounded-card border-l-4 border-warn bg-white p-3 text-sm">
            <strong>Troque sua senha.</strong> A senha inicial expira no primeiro acesso.
          </p>
        )}

        <Caixa
          estado={estado} pendente={pendente} abertura={abertura} setAbertura={setAbertura}
          comandaId={comandaId} rodar={rodar}
        />

        <nav className="flex flex-wrap gap-2" role="tablist">
          {([
            ['mesas', 'Mesas e comandas'],
            ['venda', 'Venda rápida'],
          ] as [Aba, string][]).map(([id, rotulo]) => (
            <button
              key={id}
              role="tab"
              aria-selected={aba === id}
              onClick={() => { setAba(id); setAviso(null); }}
              data-testid={`bar-aba-${id}`}
              className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${aba === id ? 'bg-acao-600 text-white' : 'bg-white text-ink-soft hover:bg-acao-100'}`}
            >
              {rotulo}
            </button>
          ))}
        </nav>

        <Aviso aviso={aviso} />

        {aba === 'mesas' && (
          <section className="space-y-4" data-testid="painel-mesas">
            <div className="rounded-card bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-bold text-estrutura">Mesas</h2>
                <span className="text-sm text-ink-soft">
                  {estado.mesas.length} mesa(s) · {estado.mesas.filter((m) => m.comandaId !== null).length} ocupada(s)
                </span>
                <button
                  type="button"
                  className={`${LIMPO} ml-auto`}
                  disabled={pendente}
                  onClick={() => void rodar(() => abrirAvulsa(localId))}
                  data-testid="bar-nova-avulsa"
                >
                  + Comanda avulsa
                </button>
              </div>

              {estado.mesas.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-soft" data-testid="mesas-vazio">
                  Este local não tem mesas. Rode o seed do bar (supabase/seed/0005_seed_bar.sql).
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {estado.mesas.map((m) => {
                    // só conta como ocupada se houver comanda ABERTA; `status` no banco pode
                    // ficar 'ocupada' com a comanda já faturada (mesa_fechar é passo à parte)
                    const ocupada = m.comandaId !== null;
                    // `null === null` marcaria todas as mesas livres quando nada está selecionado
                    const ativa = estado.comandaId !== null && m.comandaId === estado.comandaId;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={pendente}
                        onClick={() => selecionarMesa(m)}
                        data-testid={`mesa-${m.codigo}`}
                        aria-pressed={ativa}
                        className={`rounded-card border-2 p-3 text-left transition-colors ${
                          ativa ? 'border-acao-600 bg-acao-100'
                            : ocupada ? 'border-line-input bg-white hover:border-acao-600'
                              : 'border-dashed border-line-input bg-white hover:border-acao-600'
                        }`}
                      >
                        <div className="flex items-baseline justify-between">
                          <span className="text-lg font-bold text-estrutura">{m.codigo}</span>
                          <span className="text-xs text-ink-soft">{m.capacidade} lug.</span>
                        </div>
                        {ocupada ? (
                          <>
                            <span className="mt-1 block rounded-full bg-acao-600 px-2 py-0.5 text-center text-xs font-bold text-white">ocupada</span>
                            <span className="mt-2 block text-sm font-bold text-estrutura">{brl(m.total)}</span>
                            <span className="text-xs text-ink-soft">{m.itens} item(ns) · {m.abertaEm ? hora(m.abertaEm) : ''}</span>
                          </>
                        ) : (
                          <span className="mt-1 block text-sm text-ink-soft">livre · abrir</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {estado.avulsas.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <span className="text-sm font-bold text-ink-soft">Avulsas:</span>
                  {estado.avulsas.map((a) => (
                    <button
                      key={a.comandaId}
                      type="button"
                      disabled={pendente}
                      onClick={() => void selecionarComanda(a.comandaId)}
                      data-testid="chip-avulsa"
                      className={`rounded-full px-3 py-1 text-sm font-bold ${
                        a.comandaId === estado.comandaId ? 'bg-acao-600 text-white' : 'border-[1.5px] border-line-input bg-white hover:bg-acao-100'
                      }`}
                    >
                      Avulsa · {brl(a.total)} · {a.itens} item(ns)
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!temComanda ? (
              <div className="rounded-card bg-white p-6 space-y-3 text-center" data-testid="comanda-vazia">
                <p className="text-sm text-ink-soft">
                  Abra uma mesa (ou uma comanda avulsa) para lançar itens.
                  {livres.length === 0 && estado.mesas.length > 0 && ' Não há mesa livre — feche ou transfira uma comanda.'}
                </p>
                <button
                  type="button"
                  disabled={pendente}
                  onClick={() => setCadastro({ origem: 'mesa' })}
                  data-testid="mesas-novo-produto"
                  className={LIMPO}
                >
                  + Produto novo (cadastrar sem mesa)
                </button>
              </div>
            ) : (
                <Comanda
                  estado={estado} pendente={pendente} mesa={mesaDaComanda}
                produtoId={produtoId} setProdutoId={setProdutoId} qtd={qtd} setQtd={setQtd}
                maior18={maior18} setMaior18={setMaior18} escolhida={escolhida}
                destino={destino} setDestino={setDestino} livres={livres}
                marcados={marcados} setMarcados={setMarcados}
                forma={forma} setForma={setForma} rodar={rodar} localId={localId}
                onNovoProduto={() => setCadastro({ origem: 'comanda' })}
              />
            )}
          </section>
        )}

        {aba === 'venda' && (
          <section className="space-y-4" data-testid="painel-venda">
            <div className="w-full max-w-lg rounded-card bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-bold text-estrutura">Venda avulsa de copão</h2>
                <button
                  type="button"
                  disabled={pendente}
                  onClick={() => setCadastro({ origem: 'venda' })}
                  data-testid="venda-novo-produto"
                  className={`${LIMPO} ml-auto`}
                >
                  + Produto novo
                </button>
              </div>
              <p className="text-sm text-ink-soft">
                Sem mesa: a venda sai direto e a ficha técnica baixa o insumo no local.
              </p>
              {estado.copoes.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-soft" data-testid="venda-copoes-vazio">
                  Nenhum copão com estoque de insumos aqui.
                </p>
              ) : (
                <>
                  <label className="block text-sm font-bold text-ink-soft">
                    Copão
                    <select
                      value={copaoId}
                      onChange={(e) => setCopaoId(e.target.value)}
                      data-testid="venda-copao"
                      className={`${CAMPO} mt-1 w-full`}
                    >
                      <option value="">Escolha o copão…</option>
                      {estado.copoes.map((c) => (
                        <option key={c.produtoId} value={c.produtoId}>
                          {c.nome} · {brl(c.preco)} · {c.disponiveis} disp.
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-sm font-bold text-ink-soft">
                      Qtd.
                      <input
                        type="number" min={1} max={copaoEscolhido?.disponiveis ?? 999} value={copaoQtd}
                        onChange={(e) => setCopaoQtd(Math.max(1, Number(e.target.value) || 1))}
                        data-testid="venda-qtd"
                        className={`${CAMPO} mt-1 w-20`}
                      />
                    </label>
                    <label className="text-sm font-bold text-ink-soft">
                      Pagamento
                      <select value={formaVenda} onChange={(e) => setFormaVenda(e.target.value)} data-testid="venda-forma" className={`${CAMPO} mt-1`}>
                        {FORMAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={pendente || !copaoId || !estado.caixa.sessaoId
                        || Boolean(copaoEscolhido?.adulto && !maior18Venda)}
                      data-testid="venda-vender"
                      className={BTN}
                      onClick={() => void rodar(() => venderCopao(localId, copaoId, copaoQtd, formaVenda, comandaId, maior18Venda))}
                    >
                      Vender {copaoId ? brl((copaoEscolhido?.preco ?? 0) * copaoQtd) : ''}
                    </button>
                  </div>
                  {copaoEscolhido?.adulto && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox" checked={maior18Venda}
                        onChange={(e) => setMaior18Venda(e.target.checked)}
                        data-testid="venda-maior18"
                      />
                      <span className="font-bold text-ink-soft">Confirmo que o cliente é maior de 18 anos</span>
                    </label>
                  )}
                  {!estado.caixa.sessaoId && (
                    <p className="text-sm text-ink-soft">Abra o caixa do bar para vender.</p>
                  )}
                </>
              )}
            </div>

            <div className="rounded-card bg-white p-4 space-y-2">
              <h2 className="font-bold text-estrutura">Últimas vendas do bar</h2>
              {estado.vendas.length === 0 ? (
                <p className="py-3 text-center text-sm text-ink-soft" data-testid="vendas-vazio">Nenhuma venda no bar ainda.</p>
              ) : (
                <ul className="divide-y divide-line" data-testid="vendas-lista">
                  {estado.vendas.map((v) => (
                    <li key={v.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-ink-soft">{hora(v.hora)} · {v.forma}</span>
                      <span className="font-bold text-estrutura">{brl(v.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {cadastro && (
          <CadastroRapidoProduto
            localId={localId}
            localNome={locais.find((l) => l.id === localId)?.nome ?? localId}
            fechar={() => setCadastro(null)}
            onCriado={cadastrarProduto}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- caixa
function Caixa({ estado, pendente, abertura, setAbertura, comandaId, rodar }: {
  estado: Estado; pendente: boolean; abertura: string; setAbertura: (v: string) => void;
  comandaId: string | null;
  rodar: (fn: () => Promise<Resultado>) => Promise<Resultado>;
}) {
  const { caixa } = estado;
  return (
    <div className="rounded-card border-l-4 border-line-input bg-white p-3 text-sm" data-testid="bar-caixa">
      {caixa.caixaNome === null ? (
        <span className="text-ink-soft">Este local não tem caixa cadastrado.</span>
      ) : caixa.sessaoId === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold text-estrutura">{caixa.caixaNome} · fechado</span>
          <label className="flex items-center gap-2">
            <span className="text-ink-soft">Abertura</span>
            <input
              type="number" min={0} step="0.01" value={abertura}
              onChange={(e) => setAbertura(e.target.value)}
              data-testid="caixa-abertura"
              className={CAMPO} size={8}
            />
          </label>
          <button
            type="button" disabled={pendente} data-testid="caixa-abrir" className={BTN}
            onClick={() => void rodar(() => abrirCaixaBar(estado.localId, Number(abertura) || 0, comandaId))}
          >
            Abrir caixa
          </button>
        </div>
      ) : (
        <span>
          <strong className="text-estrutura">{caixa.caixaNome} · aberto</strong>
          <span className="text-ink-soft">
            {' '}· {caixa.operador ?? 'operador'} · abertura {brl(caixa.abertura ?? 0)}
          </span>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- comanda
function Comanda({ estado, pendente, mesa, produtoId, setProdutoId, qtd, setQtd, maior18, setMaior18,
  escolhida, destino, setDestino, livres, marcados, setMarcados, forma, setForma, rodar, localId,
  onNovoProduto }: {
  estado: Estado; pendente: boolean; mesa: MesaLinha | null;
  produtoId: string; setProdutoId: (v: string) => void; qtd: number; setQtd: (v: number) => void;
  maior18: boolean; setMaior18: (v: boolean) => void; escolhida: Escolha | null;
  destino: string; setDestino: (v: string) => void; livres: MesaLinha[];
  marcados: string[]; setMarcados: (v: string[]) => void;
  forma: string; setForma: (v: string) => void;
  rodar: (fn: () => Promise<Resultado>) => Promise<Resultado>; localId: string;
  onNovoProduto: () => void;
}) {
  const comanda = estado.comandaId;
  if (!comanda) return null;
  const tipoItem: 'copao' | 'revenda' = escolhida?.tipo === 'preparado' ? 'copao' : 'revenda';
  const maxQtd = escolhida?.estoque ?? escolhida?.disponiveis ?? 9999;
  const podeTransferir = mesa !== null;

  const add = () => {
    if (!escolhida) return;
    void rodar(() => adicionarItem(localId, comanda, escolhida.produtoId, qtd, tipoItem, maior18))
      .then((r) => { if (r.ok) setQtd(1); });
  };

  return (
    <div className="rounded-card bg-white p-4 space-y-4" data-testid="painel-comanda">
      <div className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
        <h2 className="font-bold text-estrutura">
          Comanda {mesa ? `· Mesa ${mesa.codigo}` : '· avulsa'}
        </h2>
        <span className="text-sm text-ink-soft">{estado.itens.length} item(ns)</span>
        <span className="ml-auto text-xl font-bold text-estrutura" data-testid="comanda-total">{brl(estado.total)}</span>
      </div>

      {estado.itens.length === 0 ? (
        <p className="py-3 text-center text-sm text-ink-soft" data-testid="comanda-itens-vazio">
          Nenhum item ainda.
        </p>
      ) : (
        <ul className="divide-y divide-line" data-testid="comanda-itens">
          {estado.itens.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <label className="flex items-center gap-2" title="Marcar para dividir a comanda">
                <input
                  type="checkbox"
                  checked={marcados.includes(i.id)}
                  onChange={(e) => setMarcados(
                    e.target.checked ? [...marcados, i.id] : marcados.filter((x) => x !== i.id),
                  )}
                  data-testid={`marcar-${i.id}`}
                />
                <span className="text-ink-soft">mover</span>
              </label>
              <span className="font-bold text-estrutura">{i.nome}</span>
              <span className="text-ink-soft">
                {num(i.quantidade)} × {brl(i.precoUnit)}
                {i.tipoItem === 'copao' && ' · copão'}
                {i.adulto && ' · +18'}
              </span>
              <span className="ml-auto font-bold text-estrutura">{brl(i.subtotal)}</span>
              <button
                type="button" disabled={pendente} data-testid={`remover-${i.id}`}
                className="rounded-full border-[1.5px] border-bad px-3 py-1 text-xs font-bold text-bad hover:bg-bad hover:text-white disabled:opacity-50"
                onClick={() => void rodar(() => removerItem(localId, comanda, i.id))}
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-card border border-line p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-bold text-estrutura">Lançar item</h3>
          <button
            type="button"
            disabled={pendente}
            onClick={onNovoProduto}
            data-testid="comanda-novo-produto"
            className={`${LIMPO} ml-auto`}
          >
            + Produto novo
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-56 flex-1 text-sm font-bold text-ink-soft">
            Produto
            <select
              value={produtoId}
              onChange={(e) => setProdutoId(e.target.value)}
              data-testid="comanda-produto"
              className={`${CAMPO} mt-1 w-full`}
            >
              <option value="">Escolha…</option>
              {estado.copoes.length > 0 && (
                <optgroup label="Copões (ficha técnica)">
                  {estado.copoes.map((c) => (
                    <option key={c.produtoId} value={c.produtoId}>
                      {c.nome} · {brl(c.preco)} · {c.disponiveis} disp.
                    </option>
                  ))}
                </optgroup>
              )}
              {estado.revendas.length > 0 && (
                <optgroup label="Bebidas e cigarro (estoque do local)">
                  {estado.revendas.map((r) => (
                    <option key={r.produtoId} value={r.produtoId}>
                      {r.nome} · {brl(r.preco)} · {num(r.estoque ?? 0)} {r.unidade}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="text-sm font-bold text-ink-soft">
            Qtd.
            <input
              type="number" min={1} max={maxQtd} value={qtd}
              onChange={(e) => setQtd(Math.max(1, Number(e.target.value) || 1))}
              data-testid="comanda-qtd"
              className={`${CAMPO} mt-1 w-20`}
            />
          </label>
          <button
            type="button" disabled={pendente || !escolhida} data-testid="comanda-adicionar" className={BTN}
            onClick={add}
          >
            Adicionar
          </button>
        </div>
        {escolhida && (
          <p className="text-xs text-ink-soft">
            {tipoItem === 'copao'
              ? `Baixa ${escolhida.nome.toLowerCase()} pela ficha técnica ao faturar.`
              : `Baixa ${num(escolhida.estoque ?? 0)} ${escolhida.unidade} do local ao faturar.`}
          </p>
        )}
        {escolhida?.adulto && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={maior18} onChange={(e) => setMaior18(e.target.checked)} data-testid="comanda-maior18" />
            <span className="font-bold text-ink-soft">Confirmo que o cliente é maior de 18 anos</span>
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
        <label className="text-sm font-bold text-ink-soft">
          Transferir a mesa
          <select value={destino} onChange={(e) => setDestino(e.target.value)} data-testid="comanda-destino" className={`${CAMPO} mt-1`} disabled={!podeTransferir}>
            <option value="">Escolha a mesa livre…</option>
            {livres.map((m) => <option key={m.id} value={m.id}>{m.codigo} · {m.capacidade} lug.</option>)}
          </select>
        </label>
        <button
          type="button" disabled={pendente || !destino || !podeTransferir} data-testid="comanda-transferir" className={LIMPO}
          onClick={() => { if (mesa) { void rodar(() => transferirMesa(localId, mesa.id, destino)).then(() => setDestino('')); } }}
        >
          Transferir
        </button>
        <button
          type="button" disabled={pendente || marcados.length === 0 || livres.length === 0}
          data-testid="comanda-dividir" className={LIMPO}
          onClick={() => { void rodar(() => dividirComanda(localId, comanda, destino, marcados)).then(() => setDestino('')); }}
          title="Escolha os itens (mover) e a mesa de destino"
        >
          Dividir ({marcados.length})
        </button>
        {!podeTransferir && (
          <span className="text-xs text-ink-soft">Comanda avulsa: use dividir para mandar itens a uma mesa.</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <h3 className="text-sm font-bold text-estrutura">Fechar no caixa</h3>
        <select value={forma} onChange={(e) => setForma(e.target.value)} data-testid="comanda-forma" className={CAMPO}>
          {FORMAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
        <button
          type="button"
          disabled={pendente || estado.total <= 0 || !estado.caixa.sessaoId}
          data-testid="comanda-fechar" className={BTN}
          onClick={() => void rodar(() => fecharComanda(localId, comanda, forma))}
        >
          Faturar {brl(estado.total)}
        </button>
        {estado.total <= 0 && <span className="text-xs text-ink-soft">Comanda vazia não fatura.</span>}
        {!estado.caixa.sessaoId && <span className="text-xs text-ink-soft">Abra o caixa do bar.</span>}
      </div>
    </div>
  );
}
