'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Conta, ContaItem } from '@/app/pdv/actions';
import { pagarParteConta } from '@/app/pdv/actions';
import { cpfValido } from '@/lib/cpf';
import { PixQrModal } from '@/components/PixQrModal';

// Fechamento da "Conta de cliente" (0011): Pagar tudo · Dividir igual · Dividir por itens.
// Cada pessoa vira uma venda própria (forma, CPF e comprovante). O que é pago sai da conta; a conta fecha
// sozinha quando não sobra item. Preço e regras (+18, estoque, crédito) são conferidos no banco.

type Forma = 'pix' | 'cartao' | 'dinheiro' | 'credito';
type Modo = 'tudo' | 'igual' | 'itens';
export type PagamentoConta = {
  vendaId: string; quando: string; forma: Forma; cpf: string | null; total: number;
  itens: { nome: string; qtd: number; preco: number }[];
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtdTxt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const FORMAS: [Forma, string][] = [['pix', 'PIX'], ['cartao', 'Cartão'], ['dinheiro', 'Dinheiro'], ['credito', 'Crédito']];
const valor = (itens: ContaItem[], q: Record<string, number>) =>
  itens.reduce((s, i) => s + Math.round(i.preco * (q[i.id] ?? 0) * 100) / 100, 0);

export function FecharContaModal({ conta, sessaoId, maior18, pausado, fechar, aoPagar, aoMarcar18 }: {
  conta: Conta; sessaoId: string; maior18: boolean; pausado: boolean;
  fechar: () => void; aoPagar: (p: PagamentoConta) => Promise<void>; aoMarcar18?: (v: boolean) => void;
}) {
  const [modo, setModo] = useState<Modo>('tudo');
  const [pessoas, setPessoas] = useState(2);
  const [q, setQ] = useState<Record<string, number>[]>([{}, {}]);       // só no "por itens"
  const [formas, setFormas] = useState<Forma[]>(['pix', 'pix']);
  const [cpfs, setCpfs] = useState<string[]>(['', '']);
  const [pagos, setPagos] = useState<{ total: number; forma: Forma }[]>([]);
  const [pagando, setPagando] = useState<number | null>(null);
  const [erro, setErro] = useState('');
  const [pixPara, setPixPara] = useState<number | null>(null);   // pessoa vendo o QR do PIX
  const [ok18, setOk18] = useState(maior18);
  const temCliente = !!conta.clienteId;
  const temAdulto = conta.itens.some((i) => i.adulto);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (!pausado && pixPara === null && e.key === 'Escape' && pagando === null) { e.preventDefault(); e.stopPropagation(); fechar(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [fechar, pagando, pausado, pixPara]);

  // colunas = pessoas que AINDA vão pagar
  const n = modo === 'tudo' ? 1 : Math.max(1, pessoas);
  const ajustarColunas = (nova: number) => {
    const k = Math.max(1, Math.min(12, nova));
    setPessoas(k);
    setQ((v) => Array.from({ length: k }, (_, i) => v[i] ?? {}));
    setFormas((v) => Array.from({ length: k }, (_, i) => v[i] ?? 'pix'));
    setCpfs((v) => Array.from({ length: k }, (_, i) => v[i] ?? ''));
  };

  // quanto cada pessoa paga de cada item
  const matriz: Record<string, number>[] = useMemo(() => {
    if (modo === 'tudo') return [Object.fromEntries(conta.itens.map((i) => [i.id, i.qtd]))];
    if (modo === 'igual') {
      return Array.from({ length: n }, (_, p) => Object.fromEntries(conta.itens.map((i) => {
        const base = Math.floor((i.qtd * 1000) / n) / 1000;
        return [i.id, p < n - 1 ? base : Math.round((i.qtd - base * (n - 1)) * 1000) / 1000];
      })));
    }
    return Array.from({ length: n }, (_, p) => q[p] ?? {});
  }, [modo, n, q, conta.itens]);

  const falta = (i: ContaItem) => Math.round((i.qtd - matriz.reduce((s, m) => s + (m[i.id] ?? 0), 0)) * 1000) / 1000;
  const excesso = conta.itens.some((i) => falta(i) < 0);
  const totalFalta = conta.itens.reduce((s, i) => s + Math.max(0, falta(i)) * i.preco, 0);

  const mudarQ = (p: number, item: ContaItem, delta: number) => setQ((v) => {
    const c = v.map((m) => ({ ...m }));
    const atual = c[p]?.[item.id] ?? 0;
    const outros = matriz.reduce((s, m, k) => s + (k === p ? 0 : (m[item.id] ?? 0)), 0);
    const novo = Math.max(0, Math.min(item.qtd - outros, atual + delta));
    c[p] = { ...(c[p] ?? {}), [item.id]: novo };
    return c;
  });
  const restoPara = (p: number) => setQ((v) => {   // "o resto" deste item vai para esta pessoa
    const c = v.map((m) => ({ ...m }));
    c[p] = { ...(c[p] ?? {}) };
    for (const i of conta.itens) { const f = falta(i); if (f > 0) c[p][i.id] = (c[p][i.id] ?? 0) + f; }
    return c;
  });

  // 1º clique: confere; no PIX abre o QR com o valor. A venda só grava em efetivar (depois do "PIX recebido").
  function receber(p: number) {
    if (pagando !== null) return;
    const itens = conta.itens.filter((i) => (matriz[p][i.id] ?? 0) > 0);
    if (!itens.length) { setErro('Esta pessoa ainda não tem item para pagar.'); return; }
    if (excesso) { setErro('Tem item com quantidade a mais que a conta: confira a coluna "Falta".'); return; }
    if (temAdulto && !ok18) { setErro('Item +18: marque "Clientes maiores de 18 anos" no topo.'); return; }
    const cpf = cpfs[p].replace(/\D/g, '') || null;
    if (cpf && !cpfValido(cpf)) { setErro(`CPF da pessoa ${p + 1} inválido.`); return; }
    setErro('');
    if (formas[p] !== 'credito') { setPixPara(p); return; }   // pergunta "gerar QR Code PIX?" (crédito = fiado, sem QR)
    void efetivar(p);
  }

  async function efetivar(p: number, formaUsada?: Forma) {
    if (pagando !== null) return;
    const itens = conta.itens.filter((i) => (matriz[p][i.id] ?? 0) > 0).map((i) => ({ itemId: i.id, qtd: matriz[p][i.id] }));
    if (!itens.length) { setErro('Esta pessoa ainda não tem item para pagar.'); return; }
    if (excesso) { setErro('Tem item com quantidade a mais que a conta: confira a coluna "Falta".'); return; }
    const cpf = cpfs[p].replace(/\D/g, '') || null;
    if (cpf && !cpfValido(cpf)) { setErro(`CPF da pessoa ${p + 1} inválido.`); return; }
    setErro(''); setPagando(p);
    const forma = formaUsada ?? formas[p];   // pagou pelo QR → vira PIX
    const r = await pagarParteConta({ sessaoId, contaId: conta.id, forma, itens, maior18: ok18, cpf, clienteId: conta.clienteId });
    if (r.erro || !r.vendaId) { setPagando(null); setPixPara(null); setErro(r.erro ?? 'Não foi possível receber.'); return; }
    setPixPara(null);
    const pago = {
      vendaId: r.vendaId, quando: r.quando ?? new Date().toISOString(), forma, cpf, total: r.total ?? valor(conta.itens, matriz[p]),
      itens: conta.itens.filter((i) => (matriz[p][i.id] ?? 0) > 0).map((i) => ({ nome: i.nome, qtd: matriz[p][i.id], preco: i.preco })),
    };
    setPagos((v) => [...v, { total: pago.total, forma }]);
    // a pessoa que pagou sai das colunas
    if (modo !== 'tudo') {
      setQ((v) => v.filter((_, k) => k !== p));
      setFormas((v) => v.filter((_, k) => k !== p));
      setCpfs((v) => v.filter((_, k) => k !== p));
      setPessoas((k) => Math.max(1, k - 1));
    }
    setPagando(null);
    await aoPagar(pago);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-estrutura/60 sm:items-center" role="dialog" aria-modal="true"
      aria-label={`Fechar conta ${conta.nome}`} data-testid="conta-fechar-modal">
      <div className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-banner bg-white sm:rounded-banner">
        <div className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div>
            <h2 className="text-xl font-extrabold text-estrutura">Fechar conta · {conta.nome}</h2>
            <p className="text-sm text-ink-soft">Cada pessoa vira uma venda com comprovante próprio. Quem ainda não pagou continua na conta.</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-extrabold tabular-nums text-acao-700" data-testid="conta-total">{brl(conta.total)}</p>
            <button type="button" onClick={fechar} disabled={pagando !== null}
              className="mt-1 rounded-full border border-estrutura/40 px-3 py-1.5 text-xs font-bold text-estrutura hover:bg-fundo disabled:opacity-50"
              data-testid="conta-fechar-voltar">← Voltar para a conta (Esc)</button>
          </div>
        </div>

        {temAdulto && (
          <label className={`mx-5 mt-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold ${ok18 ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'}`}
            data-testid="conta-ok18">
            <input type="checkbox" className="h-4 w-4" checked={ok18} data-testid="conta-ok18-check"
              onChange={(e) => { setOk18(e.target.checked); aoMarcar18?.(e.target.checked); setErro(''); }} />
            Tem item +18: confirmo que os clientes são maiores de 18 anos
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
          {([['tudo', 'Pagar tudo'], ['igual', 'Dividir igual'], ['itens', 'Dividir por itens']] as const).map(([id, rot]) => (
            <button key={id} type="button" data-testid={`conta-aba-${id}`} onClick={() => { setModo(id); setErro(''); }}
              className={`rounded-full border px-4 py-2 text-sm font-bold ${modo === id ? 'border-estrutura bg-estrutura text-white' : 'border-line text-ink-soft hover:border-estrutura'}`}>{rot}</button>
          ))}
          {modo !== 'tudo' && (
            <span className="ml-auto flex items-center gap-2 text-sm font-bold text-estrutura">
              Pessoas
              <button type="button" onClick={() => ajustarColunas(pessoas - 1)} data-testid="conta-pessoas-menos" className="h-8 w-8 rounded-full border border-line">−</button>
              <span className="w-6 text-center tabular-nums" data-testid="conta-pessoas">{pessoas}</span>
              <button type="button" onClick={() => ajustarColunas(pessoas + 1)} data-testid="conta-pessoas-mais" className="h-8 w-8 rounded-full border border-line">+</button>
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-soft">
                <th className="py-2 pr-2">Item da conta</th><th className="px-2">Na conta</th>
                {matriz.map((_, p) => <th key={p} className="px-2">{modo === 'tudo' ? 'Paga tudo' : `Pessoa ${pagos.length + p + 1}`}</th>)}
                {modo === 'itens' && <th className="px-2">Falta</th>}
              </tr>
            </thead>
            <tbody>
              {conta.itens.map((i, li) => (
                <tr key={i.id} className="border-b border-fundo">
                  <td className="py-2 pr-2"><strong>{i.nome}</strong> <span className="text-ink-soft">· {brl(i.preco)}</span></td>
                  <td className="px-2 tabular-nums">{qtdTxt(i.qtd)}</td>
                  {matriz.map((m, p) => (
                    <td key={p} className="px-2">
                      {modo === 'itens' ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-line px-1 py-0.5 font-bold">
                          <button type="button" aria-label="Menos" data-testid={`conta-q-${p}-${li}-menos`} onClick={() => mudarQ(p, i, -1)} className="h-6 w-6 rounded-full text-acao-700 hover:bg-acao-100">−</button>
                          <span className="w-8 text-center tabular-nums" data-testid={`conta-q-${p}-${li}`}>{qtdTxt(m[i.id] ?? 0)}</span>
                          <button type="button" aria-label="Mais" data-testid={`conta-q-${p}-${li}-mais`} onClick={() => mudarQ(p, i, 1)} className="h-6 w-6 rounded-full text-acao-700 hover:bg-acao-100">+</button>
                        </span>
                      ) : <span className="tabular-nums">{qtdTxt(m[i.id] ?? 0)}</span>}
                    </td>
                  ))}
                  {modo === 'itens' && (
                    <td className={`px-2 font-bold tabular-nums ${falta(i) === 0 ? 'text-ok' : falta(i) < 0 ? 'text-bad' : 'text-warn'}`} data-testid={`conta-falta-${li}`}>
                      {falta(i) === 0 ? '0 ✓' : qtdTxt(falta(i))}
                    </td>
                  )}
                </tr>
              ))}
              <tr className="bg-acao-100/60 font-extrabold">
                <td className="py-2 pr-2">Cada um paga</td><td className="px-2 tabular-nums">{brl(conta.total)}</td>
                {matriz.map((m, p) => <td key={p} className="px-2 tabular-nums" data-testid={`conta-valor-${p}`}>{brl(valor(conta.itens, m))}</td>)}
                {modo === 'itens' && <td className={`px-2 tabular-nums ${totalFalta === 0 ? 'text-ok' : 'text-warn'}`} data-testid="conta-falta-total">{brl(totalFalta)}</td>}
              </tr>
              <tr>
                <td className="pt-3 text-xs text-ink-soft" colSpan={2}>Forma, CPF na nota e receber →</td>
                {matriz.map((m, p) => (
                  <td key={p} className="space-y-1.5 px-2 pt-3 align-top">
                    <select value={formas[p] ?? 'pix'} data-testid={`conta-forma-${p}`}
                      onChange={(e) => setFormas((v) => { const c = [...v]; c[p] = e.target.value as Forma; return c; })}
                      className="w-full rounded-full border border-line px-2 py-1.5 text-xs font-bold">
                      {FORMAS.map(([id, rot]) => <option key={id} value={id} disabled={id === 'credito' && !temCliente}>{rot}{id === 'credito' && !temCliente ? ' (só com cliente)' : ''}</option>)}
                    </select>
                    <input value={cpfs[p] ?? ''} placeholder="CPF (opcional)" inputMode="numeric" data-testid={`conta-cpf-${p}`}
                      onChange={(e) => setCpfs((v) => { const c = [...v]; c[p] = e.target.value; return c; })}
                      className="w-full rounded-full border border-line px-2 py-1.5 text-xs" />
                    <button type="button" onClick={() => receber(p)} disabled={pagando !== null || valor(conta.itens, m) <= 0}
                      data-testid={`conta-receber-${p}`}
                      className="w-full rounded-full bg-acao-600 px-2 py-2 text-xs font-extrabold text-white disabled:opacity-40">
                      {pagando === p ? 'Recebendo…' : `Receber ${brl(valor(conta.itens, m))}`}
                    </button>
                    {modo === 'itens' && totalFalta > 0 && (
                      <button type="button" onClick={() => restoPara(p)} data-testid={`conta-resto-${p}`}
                        className="w-full text-[11px] font-bold text-acao-700 hover:underline">+ o que falta</button>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <div className="border-t border-line px-5 py-3 text-xs text-ink-soft">
          {erro && <p role="alert" className="mb-2 text-sm font-bold text-bad" data-testid="conta-erro">{erro}</p>}
          {pagos.length > 0 && (
            <p className="mb-1 font-bold text-ok" data-testid="conta-pagos">
              Já pagaram: {pagos.map((p, i) => `Pessoa ${i + 1} ${brl(p.total)} (${FORMAS.find((f) => f[0] === p.forma)?.[1]})`).join(' · ')}
            </p>
          )}
          {modo === 'igual' && <p>Dividir igual: cada pessoa paga a mesma fração de cada item; a última fica com o arredondamento (pode dar 1 centavo de diferença).</p>}
          {modo === 'itens' && <p>Use − e + para dizer quanto cada pessoa paga de cada item. &quot;Falta&quot; mostra o que ainda não tem dono.</p>}
        </div>
      </div>
      {pixPara !== null && (
        <PixQrModal valor={valor(conta.itens, matriz[pixPara] ?? {})} forma={formas[pixPara]}
          descricao={`Conta ${conta.nome}${modo === 'tudo' ? '' : ` · pessoa ${pixPara + 1}`}`}
          txid={`CONTA${conta.id.replace(/-/g, '').slice(0, 10)}${pixPara + 1}`}
          pendente={pagando !== null}
          confirmar={(f) => { if (pixPara !== null) void efetivar(pixPara, f); }}
          voltar={() => setPixPara(null)} />
      )}
    </div>
  );
}
