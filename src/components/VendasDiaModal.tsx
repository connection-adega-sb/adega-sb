'use client';
import { useEffect, useState } from 'react';
import { vendasDoDia, type VendaDia } from '@/app/pdv/actions';
import { Icone } from '@/components/Icone';

// Modal "Vendas e entregas (F9)" do topo do PDV.
// A aba Balcão é 100% real: lê public.vendas do dia (canal varejo/bar) + venda_itens.
// Delivery e App ainda não têm tabela no banco (pedidos/entregas entram na fase do site) —
// as abas aparecem com o quadro vazio declarando isso, em vez de inventar dado.

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const FORMA: Record<string, string> = { pix: 'PIX', cartao: 'Cartão', dinheiro: 'Dinheiro', boleto: 'Boleto' };

// rótulo de campo (mesmo desenho dos títulos de seção do protótipo)
const LBL = 'block text-[11px] font-bold uppercase tracking-wide text-ink-soft';
const CANAL: Record<string, string> = { varejo: 'Balcão', bar: 'Bar', delivery: 'Delivery', app: 'App', b2b: 'Atacado' };

// Kanban do protótipo — só ganha colunas quando existir tabela de pedido/entrega
const COLUNAS_DELIVERY = ['Novos', 'Em separação', 'Prontos', 'Em rota', 'Finalizados'];

type Props = { fechar: () => void };

export function VendasDiaModal({ fechar }: Props) {
  const [aba, setAba] = useState<'balcao' | 'delivery' | 'app'>('balcao');
  const [dados, setDados] = useState<{ vendas: VendaDia[]; total: number } | null>(null);

  useEffect(() => {
    let vivo = true;
    vendasDoDia()
      .then((d) => { if (vivo) setDados(d); })
      .catch(() => { if (vivo) setDados({ vendas: [], total: 0 }); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); fechar(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fechar]);

  const vendas = dados?.vendas ?? [];
  const total = dados?.total ?? 0;
  const porForma = { pix: 0, cartao: 0, dinheiro: 0 };
  for (const v of vendas) if (v.forma in porForma) porForma[v.forma as keyof typeof porForma] += v.total;
  const balcão = vendas.filter((v) => v.canal === 'varejo' || v.canal === 'bar');

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-testid="pdv-modal-vendas-dia"
      role="dialog" aria-modal="true" aria-label="Vendas do dia e entregas">
      <div className="absolute inset-0 bg-estrutura/70" onClick={fechar} data-testid="pdv-vendas-fundo" />
      <div className="relative flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-banner bg-white sm:rounded-banner">

        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-estrutura px-5 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <span className="rounded-full bg-white/10 p-1.5"><Icone n="caminhao" className="h-5 w-5" /></span>
            <div>
              <h2 className="text-base font-extrabold leading-tight">Vendas do dia</h2>
              <p className="text-[11.5px] text-white/70">
                {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
              </p>
            </div>
          </div>
          <button onClick={fechar} aria-label="Fechar" data-testid="pdv-vendas-fechar"
            className="rounded-full p-1.5 text-white/80 hover:bg-white/10 hover:text-white">
            <Icone n="fechar" />
          </button>
        </header>

        <div className="flex shrink-0 gap-1 border-b border-line bg-fundo px-4 pt-3">
          {([['balcao', 'Balcão'], ['delivery', 'Delivery'], ['app', 'App']] as const).map(([id, rotulo]) => (
            <button key={id} onClick={() => setAba(id)} data-testid={`pdv-vendas-aba-${id}`}
              aria-selected={aba === id} role="tab"
              className={`rounded-t-card px-4 py-2.5 text-sm font-bold ${aba === id
                ? 'bg-white text-estrutura shadow-[inset_0_-3px_0_0_var(--color-acao-600)]'
                : 'text-ink-soft hover:text-estrutura'}`}>
              {rotulo}
              {id === 'balcao' && (
                <span className="ml-1.5 rounded-full bg-acao-100 px-1.5 py-0.5 text-[10.5px] tabular-nums text-acao-700">
                  {balcão.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {aba === 'balcao' && (
            <section data-testid="pdv-vendas-balcao">
              {dados === null && <p className="py-8 text-center text-sm text-ink-soft">Carregando vendas…</p>}

              {dados && (
                <>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded-card border border-line bg-white p-3">
                      <span className={LBL}>Vendas</span>
                      <p className="text-2xl font-extrabold tabular-nums text-estrutura">{balcão.length}</p>
                    </div>
                    <div className="rounded-card border border-line bg-white p-3">
                      <span className={LBL}>Faturado</span>
                      <p className="text-2xl font-extrabold tabular-nums text-estrutura">{brl(total)}</p>
                    </div>
                    <div className="rounded-card border border-line bg-white p-3">
                      <span className={LBL}>Ticket médio</span>
                      <p className="text-2xl font-extrabold tabular-nums text-ink">
                        {brl(balcão.length ? total / balcão.length : 0)}
                      </p>
                    </div>
                    <div className="rounded-card border border-line bg-white p-3">
                      <span className={LBL}>Dinheiro em caixa</span>
                      <p className="text-2xl font-extrabold tabular-nums text-ok">{brl(porForma.dinheiro)}</p>
                    </div>
                  </div>

                  {balcão.length === 0 ? (
                    <div className="mt-5 rounded-card border border-dashed border-line-input bg-fundo p-10 text-center">
                      <Icone n="carrinho" className="mx-auto mb-3 h-10 w-10 text-ink-faint" />
                      <p className="text-sm font-semibold text-estrutura">Nenhuma venda no balcão hoje</p>
                      <p className="mt-1 text-xs text-ink-soft">As vendas aparecem aqui assim que o caixa for finalizado.</p>
                    </div>
                  ) : (
                    <div className="mt-5 overflow-hidden rounded-card border border-line" data-testid="pdv-vendas-lista">
                      <table className="w-full text-sm">
                        <thead className="bg-fundo text-left text-[11px] uppercase text-ink-soft">
                          <tr>
                            <th className="px-3 py-2">Hora</th>
                            <th className="px-3 py-2">Canal</th>
                            <th className="px-3 py-2">Operador</th>
                            <th className="px-3 py-2 text-right">Itens</th>
                            <th className="px-3 py-2">Pagamento</th>
                            <th className="px-3 py-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {balcão.map((v) => (
                            <tr key={v.id} className="border-t border-line" data-testid={`pdv-venda-${v.id}`}>
                              <td className="px-3 py-2 font-bold tabular-nums text-estrutura">{v.hora}</td>
                              <td className="px-3 py-2 text-ink-soft">{CANAL[v.canal] ?? v.canal}</td>
                              <td className="px-3 py-2 text-ink">{v.operador}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{v.itensQtd}</td>
                              <td className="px-3 py-2 text-ink-soft">{FORMA[v.forma] ?? v.forma}</td>
                              <td className="px-3 py-2 text-right font-bold tabular-nums text-estrutura">{brl(v.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-estrutura bg-fundo/60">
                            <td colSpan={5} className="px-3 py-2.5 text-right font-extrabold text-estrutura">Total do dia</td>
                            <td className="px-3 py-2.5 text-right font-extrabold tabular-nums text-estrutura">{brl(total)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {aba !== 'balcao' && (
            <section data-testid={`pdv-vendas-${aba}`}>
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {COLUNAS_DELIVERY.map((c) => (
                  <div key={c} className="rounded-card border border-line bg-fundo px-3 py-2.5 text-center">
                    <span className="text-[11px] font-bold uppercase text-ink-soft">{c}</span>
                    <p className="text-lg font-extrabold tabular-nums text-ink-faint">0</p>
                  </div>
                ))}
              </div>
              <div className="rounded-card border border-dashed border-line-input bg-fundo p-10 text-center">
                <Icone n="caminhao" className="mx-auto mb-3 h-10 w-10 text-ink-faint" />
                <p className="text-sm font-semibold text-estrutura">
                  {aba === 'delivery' ? 'Nenhum pedido de delivery' : 'Nenhum pedido pelo app'}
                </p>
                <p className="mx-auto mt-1 max-w-md text-xs text-ink-soft">
                  O quadro de pedidos e o app do cliente ainda não têm tabela no banco — eles entram junto
                  com o site da loja. Enquanto isso, todo o movimento do dia acontece no balcão.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
