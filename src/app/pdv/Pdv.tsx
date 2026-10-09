'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useActionState } from 'react';
import {
  buscarProdutos, sessaoAtual, ultimoTurno,
  abrirCaixa, lancarMovimento, fecharCaixa, finalizarVendaPdv,
  type ProdutoBusca, type CaixaInfo, type ResumoCaixa, type EstadoCaixa, type ResultadoFechamento,
} from './actions';
import { ROTULO_PAPEL, type Papel } from '@/lib/papeis';

type Linha = { produto: ProdutoBusca; qtd: number };

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function Pdv({ caixas: caixasInicial, nome, papel, deveTrocarSenha }: {
  caixas: CaixaInfo[]; nome: string; papel: Papel; deveTrocarSenha: boolean;
}) {
  const [caixas] = useState<CaixaInfo[]>(caixasInicial);
  const [caixaId, setCaixaId] = useState<string>(caixasInicial[0]?.id ?? '');
  const [sessao, setSessao] = useState<ResumoCaixa | null>(null);
  const [turno, setTurno] = useState<ResumoCaixa | null>(null);
  const [carregando, setCarregando] = useState(true);

  // comanda
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [desconto, setDesconto] = useState(0);
  const [forma, setForma] = useState<'pix' | 'cartao' | 'dinheiro'>('pix');
  const [maior18, setMaior18] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  // busca
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<ProdutoBusca[]>([]);
  const [destaque, setDestaque] = useState(0);
  const [buscando, setBuscando] = useState(false);

  // painel caixa
  const [painelAberto, setPainelAberto] = useState(false);
  const [abaCaixa, setAbaCaixa] = useState<'mov' | 'fechar'>('mov');
  const [drawer, setDrawer] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const buscaRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(null);

  const aberto = !!sessao?.aberta;

  // ------------------------------------------------ carrega sessão do caixa escolhido
  const recarregar = useCallback(async (cid: string) => {
    if (!cid) { setSessao(null); setTurno(null); setCarregando(false); return; }
    const [ab, fe] = await Promise.all([sessaoAtual(cid), ultimoTurno(cid)]);
    setSessao(ab); setTurno(fe);
    setCarregando(false);
  }, []);

  useEffect(() => { setCarregando(true); recarregar(caixaId); }, [caixaId, recarregar]);

  // ------------------------------------------------ busca com debounce (PDV-02)
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (termo.trim().length < 2) { setResultados([]); setDestaque(0); return; }
    setBuscando(true);
    debounce.current = setTimeout(async () => {
      const r = await buscarProdutos(termo, aberto ? sessao?.sessaoId && caixas.find(c => c.id === caixaId)?.local_id : undefined);
      setResultados(r); setDestaque(0); setBuscando(false);
    }, 200);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [termo, aberto, caixaId, caixas, sessao?.sessaoId]);

  // ------------------------------------------------ adicionar item (PDV-04/06/07)
  const adicionar = useCallback((p: ProdutoBusca, qtdExtra = 1) => {
    if (!aberto) return;
    if (p.estoque <= 0 && !p.fumigeno) { /* segue: estoque negativo é recusado no servidor */ }
    setLinhas((prev) => {
      const i = prev.findIndex((l) => l.produto.id === p.id);
      if (i >= 0) {
        const copia = [...prev];
        copia[i] = { ...copia[i], qtd: copia[i].qtd + qtdExtra };
        // destaca a linha do último lido (PDV-07): move para o fim
        const [lin] = copia.splice(i, 1);
        return [...copia, lin];
      }
      return [...prev, { produto: p, qtd: qtdExtra }];
    });
    setTermo(''); setResultados([]);
    buscaRef.current?.focus();
  }, [aberto]);

  // parse multiplicador "3*7898107" ou "3x cerveja" (PDV-04)
  const parseMult = (t: string): { qtd: number; resto: string } => {
    const m = t.match(/^\s*(\d{1,3})\s*[*xX]\s*(.*)$/);
    if (m && Number(m[1]) >= 1) return { qtd: Number(m[1]), resto: m[2] };
    return { qtd: 1, resto: t };
  };

  const confirmarBusca = async () => {
    const { qtd, resto } = parseMult(termo);
    const t = resto.trim();
    if (t.length < 1) return;
    // código exato → entra direto (PDV-03, comportamento do leitor)
    const r = resultados.length && !parseMult(termo).resto.match(/^\d{6,}$/) ? resultados : await buscarProdutos(t, caixas.find(c => c.id === caixaId)?.local_id);
    const exato = r.find((p) => p.codigo_barras === t);
    const alvo = exato ?? r[destaque];
    if (alvo) adicionar(alvo, qtd);
  };

  // ------------------------------------------------ atalhos (§5.4)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); buscaRef.current?.focus(); }
      else if (e.key === 'F8') { e.preventDefault(); setPainelAberto(true); }
      else if (e.key === 'F12') { e.preventDefault(); finalizar(); }
      else if (e.key === 'Escape') {
        if (painelAberto) setPainelAberto(false);
        else if (drawer) setDrawer(false);
        else { setTermo(''); setResultados([]); }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const alterarQtd = (id: string, delta: number) =>
    setLinhas((prev) => prev.flatMap((l) =>
      l.produto.id === id ? (l.qtd + delta < 1 ? [] : [{ ...l, qtd: l.qtd + delta }]) : [l]));

  const remover = (id: string) => setLinhas((prev) => prev.filter((l) => l.produto.id !== id));
  const limpar = () => { setLinhas([]); setDesconto(0); setMaior18(false); setAviso(null); };

  const subtotal = linhas.reduce((s, l) => s + l.produto.preco_varejo * l.qtd, 0);
  const total = Math.max(0, subtotal - desconto);
  const temAdulto = linhas.some((l) => l.produto.adulto);

  // ------------------------------------------------ finalizar (FV-01..04)
  async function finalizar() {
    if (!aberto || !sessao || salvando) return;
    if (!linhas.length) { setAviso({ tipo: 'erro', texto: 'Comanda vazia.' }); return; }
    if (temAdulto && !maior18) {
      setAviso({ tipo: 'erro', texto: 'Item +18: confirme que o cliente é maior de 18 anos.' });
      return;
    }
    setSalvando(true); setAviso(null);
    const r = await finalizarVendaPdv({
      sessaoId: sessao.sessaoId,
      itens: linhas.map((l) => ({ produto_id: l.produto.id, quantidade: l.qtd })),
      desconto, forma, maior18,
    });
    setSalvando(false);
    if (r.erro) { setAviso({ tipo: 'erro', texto: r.erro }); return; }
    setAviso({ tipo: 'ok', texto: `Venda finalizada: ${brl(total)} no ${forma.toUpperCase()}` });
    limpar(); setDrawer(false);
    await recarregar(caixaId);
    buscaRef.current?.focus();
  }

  if (deveTrocarSenha) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="rounded-card border-l-4 border-warn bg-white p-4 text-sm">
          <strong>Troque sua senha</strong> antes de usar o PDV.
        </p>
      </main>
    );
  }

  if (carregando) return <main className="p-8 text-center text-ink-soft">Carregando PDV…</main>;
  if (!caixas.length) return <main className="p-8 text-center text-ink-soft">Nenhum caixa cadastrado para seus locais.</main>;

  return (
    <div className="min-h-screen bg-fundo" data-testid="pdv">
      {/* ------------------------------------------------ topo */}
      <header className="bg-estrutura text-white">
        <div className="mx-auto px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-extrabold tracking-wide text-marca">ADEGA SB</span>
          <span className="text-white/70">· PDV</span>
          <label className="ml-2 flex items-center gap-2">
            <span className="sr-only">Caixa</span>
            <select value={caixaId} onChange={(e) => setCaixaId(e.target.value)}
              data-testid="pdv-caixa-select"
              className="rounded-full bg-white/10 px-3 py-1.5 font-bold text-white focus:outline-none">
              {caixas.map((c) => <option key={c.id} value={c.id} className="text-ink">{c.nome}</option>)}
            </select>
          </label>
          <span data-testid="pdv-status" className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${aberto ? 'bg-ok' : 'bg-white/40'}`} />
            {aberto ? 'ABERTO' : 'FECHADO'}
          </span>
          <span className="ml-auto rounded-full bg-white/10 px-3 py-1 font-bold" data-testid="pdv-operador">
            {nome} · {ROTULO_PAPEL[papel]}
          </span>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:flex-row">
        {/* ------------------------------------------------ busca + resultados */}
        <section className="flex-1 space-y-4">
          <div className="rounded-card bg-white p-4">
            <div className="flex items-center gap-2">
              <input
                ref={buscaRef} value={termo} data-testid="pdv-busca"
                onChange={(e) => setTermo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); confirmarBusca(); }
                  else if (e.key === 'ArrowDown') { e.preventDefault(); setDestaque((d) => Math.min(d + 1, resultados.length - 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setDestaque((d) => Math.max(d - 1, 0)); }
                }}
                disabled={!aberto}
                placeholder={aberto ? 'Ponto de venda — passe o leitor ou digite…' : 'Abra o caixa para vender'}
                className="w-full rounded-full border-[1.5px] border-line-input bg-white px-4 py-3 text-lg focus:outline-none focus:border-estrutura disabled:bg-fundo disabled:text-ink-soft"
              />
              <span className="hidden shrink-0 rounded-full bg-acao-100 px-3 py-1.5 text-xs font-bold text-acao-700 sm:inline">Leitor ativo · F2</span>
            </div>

            {buscando && <p className="mt-2 text-xs text-ink-soft" data-testid="pdv-buscando">Buscando…</p>}
            {resultados.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-card border border-line" data-testid="pdv-resultados">
                <table className="w-full text-sm">
                  <thead className="bg-fundo text-left text-xs uppercase text-ink-soft">
                    <tr><th className="px-3 py-2">Código</th><th className="px-3 py-2">Produto</th><th className="px-3 py-2 text-right">Estoque</th><th className="px-3 py-2 text-right">Preço</th></tr>
                  </thead>
                  <tbody>
                    {resultados.map((p, i) => (
                      <tr key={p.id} onClick={() => adicionar(p)} data-testid={`pdv-res-${i}`}
                        className={`cursor-pointer border-t border-line ${i === destaque ? 'bg-acao-100 border-l-[3px] border-l-acao-600' : 'hover:bg-fundo'}`}>
                        <td className="px-3 py-2 font-mono text-xs">{p.codigo_barras}</td>
                        <td className="px-3 py-2">
                          {p.nome}
                          {p.adulto && <span className="ml-1 rounded bg-estrutura px-1 text-[10px] font-bold text-white">+18</span>}
                        </td>
                        <td className={`px-3 py-2 text-right font-bold ${p.estoque <= 5 ? 'text-warn' : 'text-ink'}`}>
                          {p.estoque}{p.estoque <= 5 && <span className="ml-1 text-xs font-normal">baixo</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-bold">{brl(p.preco_varejo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="border-t border-line bg-fundo px-3 py-1.5 text-xs text-ink-soft">{resultados.length} produto(s)</div>
              </div>
            )}

            {!termo && (
              <div className="py-10 text-center" data-testid="pdv-vazio">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-acao-600 text-2xl text-white">▦</div>
                {aberto ? (
                  <>
                    <p className="font-bold text-estrutura">Pronto para vender</p>
                    <p className="text-sm text-ink-soft">F2 busca · F8 caixa · F12 finalizar</p>
                  </>
                ) : (
                  <>
                    <p className="font-bold text-estrutura">Caixa fechado</p>
                    <button onClick={() => setPainelAberto(true)} data-testid="pdv-abrir-caixa-btn"
                      className="mt-3 rounded-full bg-acao-600 px-5 py-2 font-bold text-white">Abrir caixa</button>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ------------------------------------------------ comanda */}
        <aside className="w-full shrink-0 lg:w-[360px] xl:w-[420px]" data-testid="pdv-comanda">
          <div className="rounded-card bg-white p-4 flex flex-col">
            <div className="flex items-center justify-between">
              <h2 className="font-extrabold text-estrutura">Comanda ({linhas.length})</h2>
              <button onClick={limpar} disabled={!linhas.length} data-testid="pdv-limpar"
                className="text-sm font-bold text-acao-600 disabled:opacity-40">Limpar</button>
            </div>

            <div className="mt-3 max-h-[45vh] space-y-2 overflow-y-auto">
              {!linhas.length && <p className="py-6 text-center text-sm text-ink-soft">Nenhum item ainda.</p>}
              {linhas.map((l) => (
                <div key={l.produto.id} className="flex items-center gap-2 rounded-card border border-line px-2 py-2" data-testid={`pdv-item-${l.produto.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-estrutura">{l.produto.nome}</p>
                    <p className="text-xs text-ink-soft">{brl(l.produto.preco_varejo)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => alterarQtd(l.produto.id, -1)} aria-label="Diminuir"
                      className="h-7 w-7 rounded-full border border-line font-bold">−</button>
                    <span className="w-6 text-center font-bold" data-testid="pdv-qtd">{l.qtd}</span>
                    <button onClick={() => alterarQtd(l.produto.id, 1)} aria-label="Aumentar"
                      className="h-7 w-7 rounded-full border border-line font-bold">+</button>
                  </div>
                  <button onClick={() => remover(l.produto.id)} aria-label="Remover item"
                    className="ml-1 text-bad">✕</button>
                </div>
              ))}
            </div>

            {aviso && (
              <p role="alert" data-testid="pdv-aviso"
                className={`mt-3 rounded-card px-3 py-2 text-sm font-bold ${aviso.tipo === 'ok' ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'}`}>
                {aviso.texto}
              </p>
            )}

            <div className="mt-4 space-y-2 border-t border-line pt-3 text-sm">
              <div className="flex justify-between"><span className="text-ink-soft">Subtotal</span><span className="font-bold">{brl(subtotal)}</span></div>
              <div className="flex items-center justify-between">
                <span className="text-ink-soft">Desconto (R$)</span>
                <input type="number" min={0} step="0.01" value={desconto || ''} data-testid="pdv-desconto"
                  onChange={(e) => setDesconto(Math.max(0, Number(e.target.value)))}
                  placeholder="0,00"
                  className="w-24 rounded-full border-[1.5px] border-line-input px-3 py-1 text-right focus:outline-none" />
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-extrabold text-estrutura">TOTAL A PAGAR</span>
                <span data-testid="pdv-total" className="text-[26px] font-extrabold text-estrutura">{brl(total)}</span>
              </div>
            </div>

            <div className="mt-3 flex gap-2" role="group" aria-label="Forma de pagamento">
              {(['pix', 'cartao', 'dinheiro'] as const).map((f) => (
                <button key={f} onClick={() => setForma(f)} data-testid={`pdv-forma-${f}`}
                  className={`flex-1 rounded-full px-3 py-2 text-sm font-bold ${forma === f ? 'bg-acao-600 text-white' : 'border border-line text-ink-soft'}`}>
                  {f === 'pix' ? 'PIX' : f === 'cartao' ? 'Cartão' : 'Dinheiro'}
                </button>
              ))}
            </div>

            {temAdulto && (
              <label className="mt-3 flex items-center gap-2 rounded-card bg-acao-100 px-3 py-2 text-sm font-bold text-acao-700" data-testid="pdv-maior18">
                <input type="checkbox" checked={maior18} onChange={(e) => setMaior18(e.target.checked)} />
                Cliente é maior de 18 anos
              </label>
            )}

            <div className="mt-4 flex gap-2">
              <button onClick={() => setPainelAberto(true)} data-testid="pdv-caixa-btn"
                className="flex-1 rounded-full border border-estrutura px-4 py-3 font-bold text-estrutura">Caixa (F8)</button>
              <button onClick={finalizar} disabled={!aberto || !linhas.length || salvando} data-testid="pdv-finalizar"
                className="flex-[2] rounded-full bg-acao-600 px-4 py-3 font-extrabold text-white disabled:opacity-50">
                {salvando ? 'Finalizando…' : 'Finalizar venda (F12)'}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* ------------------------------------------------ barra mobile */}
      <div className="fixed bottom-0 left-0 right-0 lg:hidden">
        <button onClick={() => (aberto ? setDrawer(true) : setPainelAberto(true))} data-testid="pdv-barra-mobile"
          className={`w-full px-4 py-3.5 font-extrabold text-white ${aberto ? 'bg-acao-600' : 'bg-estrutura'}`}>
          {aberto ? `${linhas.length} itens · ${brl(total)} →` : 'Abrir caixa'}
        </button>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-estrutura/60" onClick={() => setDrawer(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto bg-fundo p-3">
            <button onClick={() => setDrawer(false)} className="mb-2 rounded-full bg-white px-3 py-1 text-sm font-bold">Fechar</button>
            <div className="[&>aside]:w-full [&>aside>div]:rounded-card">{/* comanda repetida no drawer */}</div>
          </div>
        </div>
      )}

      {painelAberto && (
        <PainelCaixa
          caixa={caixas.find((c) => c.id === caixaId)!}
          sessao={sessao} turno={turno} papel={papel}
          aba={abaCaixa} setAba={setAbaCaixa}
          fechar={() => setPainelAberto(false)}
          aoAbrir={() => recarregar(caixaId)}
        />
      )}
    </div>
  );
}

// ================================================================= painel caixa (CX-01..10)
function PainelCaixa({ caixa, sessao, turno, papel, aba, setAba, fechar, aoAbrir }: {
  caixa: CaixaInfo; sessao: ResumoCaixa | null; turno: ResumoCaixa | null;
  papel: Papel; aba: 'mov' | 'fechar'; setAba: (a: 'mov' | 'fechar') => void;
  fechar: () => void; aoAbrir: () => void;
}) {
  const aberto = !!sessao?.aberta;
  const [stAbrir, acaoAbrir, pendAbrir] = useActionState<EstadoCaixa, FormData>(abrirCaixa, {});
  const [stMov, acaoMov, pendMov] = useActionState<EstadoCaixa, FormData>(lancarMovimento, {});
  const [stFech, acaoFech, pendFech] = useActionState<ResultadoFechamento, FormData>(fecharCaixa, {});

  useEffect(() => { if (stAbrir.sessaoId) aoAbrir(); }, [stAbrir, aoAbrir]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-testid="pdv-painel">
      <div className="absolute inset-0 bg-estrutura/60" onClick={fechar} />
      <div className="relative w-full max-w-xl rounded-t-banner bg-white p-5 sm:rounded-banner">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-estrutura">Caixa · {caixa.nome}</h2>
          <button onClick={fechar} aria-label="Fechar painel" className="text-ink-soft">✕</button>
        </div>

        {!aberto ? (
          <form action={acaoAbrir} className="space-y-3" data-testid="pdv-form-abrir" noValidate>
            {turno && (
              <div className="rounded-card bg-fundo p-3 text-sm">
                <p className="font-bold text-estrutura">Último turno</p>
                <p className="text-ink-soft">Contado {brl(turno.valorAbertura)} · esperado {brl(turno.dinheiroEsperado)}</p>
              </div>
            )}
            <input type="hidden" name="caixaId" value={caixa.id} />
            <label className="block">
              <span className="text-sm font-bold text-estrutura">Valor de abertura (R$)</span>
              <input name="valorAbertura" type="number" min={0} step="0.01" required autoFocus defaultValue=""
                data-testid="pdv-valor-abertura"
                className="mt-1 w-full rounded-xl border-[1.5px] border-line-input px-3.5 py-2.5 focus:outline-none focus:border-estrutura" />
            </label>
            <p role="alert" className="min-h-5 text-sm font-bold text-bad">{stAbrir.erro}</p>
            <button disabled={pendAbrir} data-testid="pdv-abrir-submit"
              className="w-full rounded-full bg-acao-600 px-5 py-3 font-extrabold text-white disabled:opacity-50">
              {pendAbrir ? 'Abrindo…' : `Abrir caixa como ${sessao?.operador || ''}`.trim() || 'Abrir caixa'}
            </button>
          </form>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-card bg-fundo p-3"><p className="text-xs text-ink-soft">Abertura</p><p className="font-bold">{brl(sessao.valorAbertura)}</p></div>
              <div className="rounded-card bg-fundo p-3"><p className="text-xs text-ink-soft">Vendas</p><p className="font-bold">{sessao.vendasQtd} · {brl(sessao.vendasTotal)}</p></div>
              <div className="rounded-card bg-acao-600 p-3 text-white"><p className="text-xs">Gaveta</p><p className="font-bold">{brl(sessao.dinheiroEsperado)}</p></div>
            </div>

            <div className="mb-3 flex gap-2">
              <button onClick={() => setAba('mov')} data-testid="pdv-aba-mov"
                className={`rounded-full px-4 py-1.5 text-sm font-bold ${aba === 'mov' ? 'bg-estrutura text-white' : 'border border-line'}`}>Movimentação</button>
              <button onClick={() => setAba('fechar')} data-testid="pdv-aba-fechar"
                className={`rounded-full px-4 py-1.5 text-sm font-bold ${aba === 'fechar' ? 'bg-estrutura text-white' : 'border border-line'}`}>Fechar caixa</button>
            </div>

            {aba === 'mov' ? (
              <form action={acaoMov} className="space-y-3" data-testid="pdv-form-mov" noValidate>
                <input type="hidden" name="sessaoId" value={sessao.sessaoId} />
                <div className="flex gap-2">
                  <label className="flex-1 rounded-card border border-line p-2 text-center text-sm font-bold">
                    <input type="radio" name="tipo" value="sangria" defaultChecked className="mr-1" /> Sangria (↑)
                  </label>
                  <label className="flex-1 rounded-card border border-line p-2 text-center text-sm font-bold">
                    <input type="radio" name="tipo" value="suprimento" className="mr-1" /> Suprimento (↓)
                  </label>
                </div>
                <input name="valor" type="number" min={0.01} step="0.01" required placeholder="Valor (R$)"
                  data-testid="pdv-mov-valor" className="w-full rounded-xl border-[1.5px] border-line-input px-3.5 py-2.5 focus:outline-none" />
                <input name="motivo" required placeholder="Motivo" data-testid="pdv-mov-motivo"
                  className="w-full rounded-xl border-[1.5px] border-line-input px-3.5 py-2.5 focus:outline-none" />
                <p role="alert" className="min-h-5 text-sm font-bold text-bad">{stMov.erro}</p>
                <button disabled={pendMov} data-testid="pdv-mov-submit"
                  className="w-full rounded-full bg-acao-600 px-5 py-2.5 font-bold text-white disabled:opacity-50">
                  {pendMov ? 'Lançando…' : 'Lançar movimento'}
                </button>
                {sessao.movimentos.length > 0 && (
                  <ul className="space-y-1 text-sm" data-testid="pdv-mov-lista">
                    {sessao.movimentos.map((m) => (
                      <li key={m.id} className="flex justify-between rounded-card bg-fundo px-3 py-1.5">
                        <span className="text-ink-soft">{m.tipo} · {m.motivo}</span>
                        <span className={`font-bold ${m.tipo === 'sangria' ? 'text-bad' : 'text-ok'}`}>
                          {m.tipo === 'sangria' ? '−' : '+'}{brl(m.valor)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </form>
            ) : (
              <form action={acaoFech} className="space-y-3" data-testid="pdv-form-fechar" noValidate>
                <input type="hidden" name="sessaoId" value={sessao.sessaoId} />
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-card bg-fundo p-2"><p className="text-xs text-ink-soft">PIX</p><p className="font-bold">{brl(sessao.porForma.pix)}</p></div>
                  <div className="rounded-card bg-fundo p-2"><p className="text-xs text-ink-soft">Cartão</p><p className="font-bold">{brl(sessao.porForma.cartao)}</p></div>
                  <div className="rounded-card bg-fundo p-2"><p className="text-xs text-ink-soft">Dinheiro</p><p className="font-bold">{brl(sessao.porForma.dinheiro)}</p></div>
                </div>
                <p className="text-sm text-ink-soft">Esperado na gaveta: <strong>{brl(sessao.dinheiroEsperado)}</strong></p>
                <input name="valorContado" type="number" min={0} step="0.01" required placeholder="Dinheiro contado (R$)"
                  data-testid="pdv-valor-contado" className="w-full rounded-xl border-[1.5px] border-line-input px-3.5 py-2.5 focus:outline-none" />
                <p role="alert" className="min-h-5 text-sm font-bold text-bad">{stFech.erro}</p>
                {typeof stFech.diferenca === 'number' && !stFech.erro && (
                  <p className="rounded-card bg-fundo px-3 py-2 text-sm font-bold" data-testid="pdv-resultado-fechamento">
                    {Math.abs(stFech.diferenca) < 0.005 ? 'Caixa confere.'
                      : stFech.diferenca > 0 ? `Sobra de ${brl(stFech.diferenca)}`
                      : `Falta de ${brl(Math.abs(stFech.diferenca))}`}
                  </p>
                )}
                <button disabled={pendFech} data-testid="pdv-fechar-submit"
                  className="w-full rounded-full bg-estrutura px-5 py-3 font-extrabold text-white disabled:opacity-50">
                  {pendFech ? 'Fechando…' : `Fechar caixa de ${sessao.operador}`}
                </button>
              </form>
            )}
            {papel !== 'master' && <p className="mt-2 text-xs text-ink-soft">Operador da sessão: {sessao.operador}</p>}
          </>
        )}
      </div>
    </div>
  );
}
