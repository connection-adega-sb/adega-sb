'use client';
import { useEffect, useState } from 'react';
import {
  listarPrecificacao, aplicarPrecoVarejo,
  type FichaPrecificacao, type ResultadoSimples,
} from '@/app/pdv/actions';
import { Icone } from '@/components/Icone';

// Modal "Precificação" do topo do PDV — ficha técnica real do copão (tabelas da migration
// 0004: fichas_tecnicas + fichas_tecnicas_insumos). Nada aqui é dado de protótipo:
// CMV sai da dose ÷ conteúdo × custo_medio do insumo, e "Aplicar no PDV" grava em
// produtos.preco_varejo (só master/gerente — o servidor recusa caixa).

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// rótulo de campo (mesmo desenho dos títulos de seção do protótipo)
const LBL = 'block text-[11px] font-bold uppercase tracking-wide text-ink-soft';

type Props = { fechar: () => void };

export function PrecificacaoModal({ fechar }: Props) {
  const [fichas, setFichas] = useState<FichaPrecificacao[] | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pendente, setPendente] = useState(false);
  const [confirmado, setConfirmado] = useState(false);

  useEffect(() => {
    let vivo = true;
    listarPrecificacao()
      .then((f) => { if (vivo) { setFichas(f); setAberta(f[0]?.fichaId ?? null); } })
      .catch(() => { if (vivo) setFichas([]); });
    return () => { vivo = false; };
  }, []);

  // Esc fecha (mesmo tratamento do CadastroRapidoProduto)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); fechar(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fechar]);

  // O markup do cadastro pode deixar o preço sugerido ABAIXO do preço praticado
  // (CMV × markup < preço atual). Derrubar preço de venda não pode ser um clique só:
  // nesse caso o botão pede um segundo clique para confirmar.
  async function aplicar(f: FichaPrecificacao) {
    if (f.precoSugerido < f.precoVarejo && !confirmado) {
      setConfirmado(true);
      setAviso({
        tipo: 'erro',
        texto: `Atenção: o preço sugerido (${brl(f.precoSugerido)}) fica ABAIXO do preço atual `
          + `(${brl(f.precoVarejo)}). Confira o markup — clique de novo para confirmar.`,
      });
      return;
    }
    setConfirmado(false);
    setPendente(true);
    setAviso(null);
    try {
      const r: ResultadoSimples = await aplicarPrecoVarejo({
        produtoId: f.produtoId,
        preco: Math.round(f.precoSugerido * 100) / 100,
      });
      if (r.erro) setAviso({ tipo: 'erro', texto: r.erro });
      else {
        setAviso({ tipo: 'ok', texto: `Preço de ${f.nome} atualizado para ${brl(f.precoSugerido)}.` });
        setFichas((atual) => (atual ?? []).map((x) =>
          x.fichaId === f.fichaId ? { ...x, precoVarejo: f.precoSugerido } : x));
      }
    } catch {
      setAviso({ tipo: 'erro', texto: 'Não foi possível aplicar o preço.' });
    } finally {
      setPendente(false);
    }
  }

  const selecionada = fichas?.find((f) => f.fichaId === aberta) ?? fichas?.[0] ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-testid="pdv-modal-precificacao"
      role="dialog" aria-modal="true" aria-label="Precificação">
      <div className="absolute inset-0 bg-estrutura/70" onClick={fechar} data-testid="pdv-precificacao-fundo" />
      <div className="relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-banner bg-white sm:rounded-banner">

        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-estrutura px-5 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <span className="rounded-full bg-white/10 p-1.5"><Icone n="calculadora" className="h-5 w-5" /></span>
            <div>
              <h2 className="text-base font-extrabold leading-tight">Precificação</h2>
              <p className="text-[11.5px] text-white/70">Ficha técnica do copão · markup e fracionamento</p>
            </div>
          </div>
          <button onClick={fechar} aria-label="Fechar" data-testid="pdv-precificacao-fechar"
            className="rounded-full p-1.5 text-white/80 hover:bg-white/10 hover:text-white">
            <Icone n="fechar" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {fichas === null && <p className="py-8 text-center text-sm text-ink-soft">Carregando fichas técnicas…</p>}

          {fichas?.length === 0 && (
            <div className="rounded-card border border-dashed border-line-input bg-fundo p-8 text-center">
              <Icone n="pacote" className="mx-auto mb-3 h-10 w-10 text-ink-faint" />
              <p className="text-sm font-semibold text-estrutura">Nenhuma ficha técnica cadastrada</p>
              <p className="mt-1 text-xs text-ink-soft">
                A ficha do copão (insumos + markup) é criada no módulo de catálogo. Enquanto não existir,
                a precificação fica por conta do preço de custo do produto.
              </p>
            </div>
          )}

          {fichas && fichas.length > 0 && (
            <div className="grid gap-5 md:grid-cols-[minmax(0,240px)_1fr]">
              {/* lista de copões */}
              <nav className="space-y-2">
                <span className={LBL}>Copões com ficha</span>
                {fichas.map((f) => (
                  <button key={f.fichaId} onClick={() => { setAberta(f.fichaId); setAviso(null); setConfirmado(false); }}
                    data-testid={`pdv-preco-item-${f.fichaId}`}
                    className={`flex w-full items-center justify-between gap-2 rounded-card border px-3 py-2.5 text-left text-sm ${selecionada?.fichaId === f.fichaId
                      ? 'border-acao-600 bg-acao-100 font-bold text-acao-700'
                      : 'border-line bg-white text-ink hover:border-estrutura'}`}>
                    <span className="min-w-0 truncate">{f.nome}</span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-soft">{brl(f.precoVarejo)}</span>
                  </button>
                ))}
              </nav>

              {/* ficha aberta */}
              {selecionada && (
                <section className="min-w-0" data-testid="pdv-preco-ficha">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-lg font-extrabold text-estrutura">{selecionada.nome}</h3>
                    {selecionada.sku && <span className="font-mono text-xs text-ink-soft">{selecionada.sku}</span>}
                  </div>

                  <div className="mt-4 overflow-hidden rounded-card border border-line">
                    <table className="w-full text-sm">
                      <thead className="bg-fundo text-left text-[11px] uppercase text-ink-soft">
                        <tr>
                          <th className="px-3 py-2">Insumo</th>
                          <th className="px-3 py-2 text-right">Dose</th>
                          <th className="px-3 py-2 text-right">Compra (R$)</th>
                          <th className="px-3 py-2 text-right">Custo (R$)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selecionada.insumos.map((i) => (
                          <tr key={i.id} className="border-t border-line">
                            <td className="px-3 py-2 font-semibold text-ink">{i.nome}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                              {i.dose.toLocaleString('pt-BR')} {i.unidade}
                              <span className="block text-[10.5px] text-ink-faint">
                                embalagem {i.conteudo.toLocaleString('pt-BR')} {i.unidade}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{brl(i.custoMedio)}</td>
                            <td className="px-3 py-2 text-right font-bold tabular-nums text-estrutura">{brl(i.custo)}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-estrutura bg-fundo/60">
                          <td colSpan={3} className="px-3 py-2.5 text-right font-extrabold text-estrutura">CMV</td>
                          <td className="px-3 py-2.5 text-right font-extrabold tabular-nums text-estrutura">
                            {brl(selecionada.cmv)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-card border border-line bg-white p-3">
                      <span className={LBL}>Markup</span>
                      <p className="text-xl font-extrabold tabular-nums text-estrutura">{selecionada.markup}×</p>
                    </div>
                    <div className="rounded-card border border-line bg-white p-3">
                      <span className={LBL}>Preço hoje</span>
                      <p className="text-xl font-extrabold tabular-nums text-ink">{brl(selecionada.precoVarejo)}</p>
                    </div>
                    <div className="rounded-card border-2 border-acao-600 bg-acao-100 p-3">
                      <span className={`${LBL} text-acao-700`}>Preço sugerido</span>
                      <p className="text-xl font-extrabold tabular-nums text-acao-700">{brl(selecionada.precoSugerido)}</p>
                    </div>
                  </div>

                  <p className="mt-3 text-xs text-ink-soft">
                    Margem de <strong className="text-estrutura">{brl(selecionada.margem)}</strong> por copão
                    ({selecionada.margemPct.toFixed(0)}% do preço).
                  </p>

                  {selecionada.precoSugerido < selecionada.precoVarejo && (
                    <p className="mt-2 flex items-start gap-2 rounded-card bg-bad/10 px-3 py-2 text-xs font-semibold text-bad"
                      data-testid="pdv-preco-abaixo">
                      <Icone n="alerta" className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        O preço sugerido está <strong>abaixo</strong> do preço praticado hoje.
                        Confira o markup (hoje {selecionada.markup}×) antes de aplicar no PDV.
                      </span>
                    </p>
                  )}

                  {aviso && (
                    <p role="alert" data-testid="pdv-preco-aviso"
                      className={`mt-3 rounded-card px-3 py-2 text-sm font-bold ${aviso.tipo === 'ok' ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'}`}>
                      {aviso.texto}
                    </p>
                  )}
                </section>
              )}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-line bg-fundo px-5 py-4">
          <button onClick={fechar} data-testid="pdv-precificacao-cancelar"
            className="rounded-full border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink-soft hover:border-estrutura hover:text-estrutura">
            Fechar
          </button>
          <button onClick={() => selecionada && aplicar(selecionada)} disabled={!selecionada || pendente}
            data-testid="pdv-precificacao-aplicar"
            className="rounded-full bg-acao-600 px-5 py-2.5 text-sm font-bold text-white shadow-acao disabled:opacity-50">
            {pendente ? 'Aplicando…' : confirmado ? 'Confirmar queda de preço' : 'Aplicar no PDV'}
          </button>
        </footer>
      </div>
    </div>
  );
}
