'use client';
import { useEffect, useMemo, useState } from 'react';
import { catalogoSite, type ItemSite } from '@/app/pdv/actions';
import { Icone } from '@/components/Icone';

// Modal "Site da loja" do topo do PDV — mostra o catálogo REAL (produtos + preço + saldo do
// banco) do jeito que o cliente veria no site. Não é iframe do protótipo: aqui o número vem de
// public.produtos e public.estoque_saldos. Carrinho/checkout entram na fase do site.

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Props = { fechar: () => void };

export function SiteLojaModal({ fechar }: Props) {
  const [dados, setDados] = useState<{ itens: ItemSite[]; categorias: string[] } | null>(null);
  const [busca, setBusca] = useState('');
  const [cat, setCat] = useState('');

  useEffect(() => {
    let vivo = true;
    catalogoSite()
      .then((d) => { if (vivo) setDados(d); })
      .catch(() => { if (vivo) setDados({ itens: [], categorias: [] }); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); fechar(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fechar]);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (dados?.itens ?? []).filter((i) =>
      (!cat || i.categoria === cat) &&
      (!t || i.nome.toLowerCase().includes(t) || (i.sku ?? '').toLowerCase().includes(t)));
  }, [dados, busca, cat]);

  const emFalta = visiveis.filter((i) => i.estoque <= 0).length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-testid="pdv-modal-site"
      role="dialog" aria-modal="true" aria-label="Site da loja">
      <div className="absolute inset-0 bg-estrutura/70" onClick={fechar} data-testid="pdv-site-fundo" />
      <div className="relative flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-banner bg-white sm:rounded-banner">

        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-estrutura px-5 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <span className="rounded-full bg-white/10 p-1.5"><Icone n="loja" className="h-5 w-5" /></span>
            <div>
              <h2 className="text-base font-extrabold leading-tight">Site da loja</h2>
              <p className="text-[11.5px] text-white/70">Como o cliente vê o catálogo · dados do estoque em tempo real</p>
            </div>
          </div>
          <button onClick={fechar} aria-label="Fechar" data-testid="pdv-site-fechar"
            className="rounded-full p-1.5 text-white/80 hover:bg-white/10 hover:text-white">
            <Icone n="fechar" />
          </button>
        </header>

        <div className="shrink-0 space-y-3 border-b border-line bg-fundo px-5 py-4">
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft"><Icone n="busca" className="h-4 w-4" /></span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} data-testid="pdv-site-busca"
              placeholder="Buscar no catálogo…"
              className="w-full rounded-full border-[1.5px] border-line-input bg-white py-2.5 pl-10 pr-4 text-sm focus:border-estrutura focus:outline-none" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setCat('')}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${!cat ? 'bg-estrutura text-white' : 'bg-white text-ink-soft border border-line hover:border-estrutura'}`}>
              Tudo
            </button>
            {(dados?.categorias ?? []).map((c) => (
              <button key={c} onClick={() => setCat(c)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${cat === c ? 'bg-estrutura text-white' : 'bg-white text-ink-soft border border-line hover:border-estrutura'}`}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {dados === null && <p className="py-8 text-center text-sm text-ink-soft">Carregando catálogo…</p>}

          {dados && visiveis.length === 0 && (
            <div className="rounded-card border border-dashed border-line-input bg-fundo p-10 text-center">
              <Icone n="pacote" className="mx-auto mb-3 h-10 w-10 text-ink-faint" />
              <p className="text-sm font-semibold text-estrutura">Nada encontrado</p>
              <p className="mt-1 text-xs text-ink-soft">Ajuste a busca ou escolha outra categoria.</p>
            </div>
          )}

          {visiveis.length > 0 && (
            <>
              <p className="mb-3 text-xs text-ink-soft">
                {visiveis.length} {visiveis.length === 1 ? 'produto' : 'produtos'} no ar
                {emFalta > 0 && <> · <strong className="text-warn">{emFalta}</strong> sem estoque</>}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="pdv-site-grade">
                {visiveis.map((i) => (
                  <article key={i.id} data-testid={`pdv-site-item-${i.id}`}
                    className={`flex flex-col rounded-card border bg-white p-3 ${i.estoque <= 0 ? 'border-line opacity-60' : 'border-line'}`}>
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <span className="text-ink-faint"><Icone n="pacote" className="h-6 w-6" /></span>
                      {i.adulto && <span className="rounded bg-estrutura px-1.5 py-0.5 text-[10px] font-bold text-white">+18</span>}
                    </div>
                    <h3 className="line-clamp-2 text-sm font-bold text-ink">{i.nome}</h3>
                    <p className="mt-0.5 text-[11px] text-ink-soft">
                      {i.categoria ?? 'Sem categoria'}{i.sku && <> · <span className="font-mono">{i.sku}</span></>}
                    </p>
                    <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                      <span className="text-xl font-extrabold tabular-nums text-estrutura">{brl(i.preco)}</span>
                      <span className={`text-[11px] font-bold ${i.estoque <= 0 ? 'text-bad' : i.estoque <= 5 ? 'text-warn' : 'text-ok'}`}>
                        {i.estoque <= 0 ? 'Esgotado' : `${i.estoque} em estoque`}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-fundo px-5 py-3.5">
          <p className="text-[11.5px] text-ink-soft">
            Este é o catálogo que o cliente compra. Carrinho e pedido de entrega entram na fase do site.
          </p>
          <button onClick={fechar} data-testid="pdv-site-voltar"
            className="rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-ink-soft hover:border-estrutura hover:text-estrutura">
            Voltar ao PDV
          </button>
        </footer>
      </div>
    </div>
  );
}
