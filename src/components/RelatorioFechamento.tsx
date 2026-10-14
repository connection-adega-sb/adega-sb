'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { relatorioFechamento, type RelatorioFechamento as Rel } from '@/app/pdv/actions';
import { EMPRESA } from '@/lib/empresa';

// Relatório de fechamento de caixa — impresso (A4 ou bobina 80 mm, mesmo esquema do comprovante:
// cópia presa no <body> só para a impressão). Serve para o turno fechado e para "leitura parcial" com o caixa aberto.
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dh = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const hm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

export function RelatorioFechamento({ sessaoId, fechar }: { sessaoId: string; fechar: () => void }) {
  const [r, setR] = useState<Rel | null>(null);
  const [erro, setErro] = useState('');
  const fecharRef = useRef(fechar);
  useEffect(() => { fecharRef.current = fechar; });
  useEffect(() => {
    let vivo = true;
    relatorioFechamento(sessaoId).then((x) => { if (vivo) { if (x.r) setR(x.r); else setErro(x.erro ?? 'Não foi possível montar o relatório.'); } })
      .catch(() => { if (vivo) setErro('Não foi possível montar o relatório.'); });
    return () => { vivo = false; };
  }, [sessaoId]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecharRef.current(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Relatório de fechamento" data-testid="pdv-relatorio">
      <div className="absolute inset-0 bg-estrutura/60 print:hidden" onClick={fechar} />
      <div className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-banner bg-white sm:rounded-banner">
        <div className="flex items-start justify-between border-b border-line p-5 print:hidden">
          <div>
            <h2 className="text-xl font-extrabold text-estrutura">Relatório de fechamento</h2>
            <p className="text-sm text-ink-soft">{r ? `${r.caixa} · ${r.operador} · ${r.status === 'aberta' ? 'leitura parcial (caixa aberto)' : 'turno encerrado'}` : 'Montando…'}</p>
          </div>
          <button onClick={fechar} aria-label="Fechar" className="text-2xl leading-none text-ink-soft">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-fundo p-4">
          {erro && <p role="alert" className="text-sm font-bold text-bad">{erro}</p>}
          {!r && !erro && <p className="py-10 text-center text-sm text-ink-soft">Somando o turno…</p>}
          {r && <Papel r={r} />}
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2 border-t border-line p-4 print:hidden">
          <button onClick={() => window.print()} disabled={!r} data-testid="pdv-relatorio-imprimir"
            className="rounded-full bg-acao-600 px-5 py-3 font-extrabold text-white shadow-acao disabled:opacity-50">Imprimir</button>
          <button onClick={fechar} className="rounded-full border border-line px-5 py-3 font-bold text-estrutura hover:border-estrutura">Fechar (Esc)</button>
        </div>
      </div>
      {r && typeof document !== 'undefined' && createPortal(<div className="area-impressao"><Papel r={r} copia /></div>, document.body)}
    </div>
  );
}

function Linha({ a, b, forte = false }: { a: string; b: string; forte?: boolean }) {
  return <p className={`flex justify-between gap-2 ${forte ? 'font-bold' : ''}`}><span>{a}</span><span className="tabular-nums">{b}</span></p>;
}
const Sep = () => <hr className="my-2 border-dashed border-black/40" />;

function Papel({ r, copia = false }: { r: Rel; copia?: boolean }) {
  const recCred = r.recebCredito.pix + r.recebCredito.cartao + r.recebCredito.dinheiro;
  const dif = r.diferenca;
  return (
    <div className="papel-recibo mx-auto w-full max-w-[80mm] bg-white p-4 font-mono text-[11.5px] leading-snug text-black shadow-card" data-testid={copia ? undefined : 'pdv-relatorio-papel'}>
      <div className="text-center">
        <p className="font-bold">{EMPRESA.fantasia}</p>
        <p>CNPJ {EMPRESA.cnpj}</p>
        <Sep />
        <p className="font-bold">{r.status === 'aberta' ? 'LEITURA PARCIAL DO CAIXA' : 'FECHAMENTO DE CAIXA'}</p>
        <p className="text-[10.5px]">NÃO É DOCUMENTO FISCAL</p>
      </div>
      <Sep />
      <Linha a="Caixa" b={r.caixa} />
      {r.local && <Linha a="Local" b={r.local} />}
      <Linha a="Operador" b={r.operador} />
      <Linha a="Abertura" b={dh(r.abertaEm)} />
      <Linha a="Fechamento" b={r.fechadaEm ? dh(r.fechadaEm) : 'em aberto'} />

      <Sep />
      <p className="font-bold">VENDAS</p>
      <Linha a="Quantidade" b={String(r.vendasQtd)} />
      <Linha a="Bruto" b={brl(r.vendasBruto)} />
      {r.descontos > 0 && <Linha a="Descontos" b={`- ${brl(r.descontos)}`} />}
      <Linha a="Total vendido" b={brl(r.vendasTotal)} forte />
      <Linha a="Ticket médio" b={brl(r.ticketMedio)} />
      <p className="mt-1 font-bold">Por forma</p>
      <Linha a={`PIX (${r.qtdPorForma.pix})`} b={brl(r.porForma.pix)} />
      <Linha a={`Cartão (${r.qtdPorForma.cartao})`} b={brl(r.porForma.cartao)} />
      <Linha a={`Dinheiro (${r.qtdPorForma.dinheiro})`} b={brl(r.porForma.dinheiro)} />
      <Linha a={`Crédito/fiado (${r.qtdPorForma.credito})`} b={brl(r.porForma.credito)} />

      {recCred > 0 && (<>
        <Sep />
        <p className="font-bold">RECEBIMENTOS DE CRÉDITO</p>
        {r.recebCredito.pix > 0 && <Linha a="PIX" b={brl(r.recebCredito.pix)} />}
        {r.recebCredito.cartao > 0 && <Linha a="Cartão" b={brl(r.recebCredito.cartao)} />}
        {r.recebCredito.dinheiro > 0 && <Linha a="Dinheiro" b={brl(r.recebCredito.dinheiro)} />}
      </>)}

      {r.movimentos.length > 0 && (<>
        <Sep />
        <p className="font-bold">SANGRIAS E SUPRIMENTOS</p>
        {r.movimentos.map((m, k) => (
          <Linha key={k} a={`${hm(m.quando)} ${m.tipo === 'sangria' ? 'Sangria' : 'Suprimento'}${m.motivo ? ` · ${m.motivo}` : ''}`}
            b={`${m.tipo === 'sangria' ? '-' : '+'}${brl(m.valor)}`} />
        ))}
      </>)}

      <Sep />
      <p className="font-bold">GAVETA (DINHEIRO)</p>
      <Linha a="Abertura" b={brl(r.valorAbertura)} />
      <Linha a="+ Vendas em dinheiro" b={brl(r.porForma.dinheiro)} />
      {r.suprimentos > 0 && <Linha a="+ Suprimentos" b={brl(r.suprimentos)} />}
      {r.sangrias > 0 && <Linha a="- Sangrias" b={brl(r.sangrias)} />}
      <Linha a="Esperado" b={brl(r.esperado)} forte />
      {r.contado !== null && <Linha a="Contado" b={brl(r.contado)} forte />}
      {dif !== null && (
        <p className="mt-1 text-center font-bold" data-testid={copia ? undefined : 'pdv-relatorio-diferenca'}>
          {Math.abs(dif) < 0.005 ? 'CAIXA CONFERE' : dif > 0 ? `SOBRA DE ${brl(dif)}` : `FALTA DE ${brl(Math.abs(dif))}`}
        </p>
      )}

      {r.produtos.length > 0 && (<>
        <Sep />
        <p className="font-bold">PRODUTOS VENDIDOS</p>
        {r.produtos.map((p, k) => (
          <div key={k} className="mb-0.5">
            <p>{p.nome}</p>
            <Linha a={`${p.qtd.toLocaleString('pt-BR')} un`} b={brl(p.total)} />
          </div>
        ))}
      </>)}

      <Sep />
      <p className="mt-6 border-t border-black/60 pt-1 text-center">{r.operador} (operador)</p>
      <p className="mt-6 border-t border-black/60 pt-1 text-center">Conferido por</p>
      <p className="mt-3 text-center text-[10.5px]">Emitido em {dh(r.emitidoEm)} por {r.emitidoPor}</p>
    </div>
  );
}
