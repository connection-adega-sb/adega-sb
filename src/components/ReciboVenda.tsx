'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { EMPRESA } from '@/lib/empresa';
import { reaisPorExtenso } from '@/lib/extenso';
import { mascaraCpf } from '@/lib/cpf';

// Comprovante e recibo da venda (NÃO fiscais). A NFC-e entra na fase fiscal (F10): depende de IE, certificado A1,
// CSC e enquadramento (pendências do cliente/contador) — por isso aqui NUNCA se imprime "NFC-e" nem chave de acesso.
export type ReciboDados = {
  vendaId: string;
  quando: string;            // ISO
  operador: string;
  caixa: string;
  itens: { nome: string; qtd: number; preco: number }[];
  subtotal: number;
  desconto: number;
  total: number;
  forma: 'pix' | 'cartao' | 'dinheiro' | 'credito';
  recebido: number | null;   // dinheiro: valor entregue pelo cliente (troco)
  cliente: string | null;
  cpf: string | null;
  maior18: boolean;
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const FORMA = { pix: 'PIX', cartao: 'Cartão', dinheiro: 'Dinheiro', credito: 'Crédito (pagar depois)' } as const;

export function ReciboVenda({ r, fechar }: { r: ReciboDados; fechar: () => void }) {
  const [aba, setAba] = useState<'comprovante' | 'recibo'>('comprovante');
  const fecharRef = useRef(fechar);
  useEffect(() => { fecharRef.current = fechar; });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecharRef.current(); }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  const numero = r.vendaId.replace(/-/g, '').slice(0, 8).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-testid="pdv-recibo" role="dialog" aria-modal="true" aria-label="Venda finalizada">
      <div className="absolute inset-0 bg-estrutura/60 print:hidden" onClick={fechar} />
      <div className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-banner bg-white sm:rounded-banner">
        <div className="flex items-start justify-between border-b border-line p-5 print:hidden">
          <div>
            <h2 className="text-xl font-extrabold text-estrutura">Venda finalizada</h2>
            <p className="text-sm text-ink-soft">Venda nº {numero} · {brl(r.total)} no {FORMA[r.forma]}</p>
          </div>
          <button onClick={fechar} aria-label="Fechar" className="text-2xl leading-none text-ink-soft">×</button>
        </div>
        <div className="flex gap-2 px-5 pt-4 print:hidden">
          {([['comprovante', 'Comprovante'], ['recibo', r.forma === 'credito' ? 'Termo de débito' : 'Recibo']] as const).map(([id, rot]) => (
            <button key={id} onClick={() => setAba(id)} data-testid={`pdv-recibo-aba-${id}`}
              className={`rounded-full border px-4 py-2 text-sm font-bold ${aba === id ? 'border-estrutura bg-estrutura text-white' : 'border-line text-ink-soft'}`}>{rot}</button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-fundo p-4">
          <PapelRecibo r={r} aba={aba} />
        </div>

        <div className="space-y-2 border-t border-line p-4 print:hidden">
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button onClick={() => window.print()} data-testid="pdv-recibo-imprimir"
              className="rounded-full border border-line px-5 py-3 font-bold text-estrutura hover:border-estrutura">Imprimir</button>
            <button onClick={fechar} data-testid="pdv-recibo-nova"
              className="rounded-full bg-acao-600 px-5 py-3 font-extrabold text-white shadow-acao">Nova venda (Enter)</button>
          </div>
          <p className="text-center text-xs text-ink-soft">Cupom fiscal (NFC-e) entra na fase fiscal, depois de IE, certificado A1 e CSC.</p>
        </div>
      </div>
      {typeof document !== 'undefined' && createPortal(<div className="area-impressao"><PapelRecibo r={r} aba={aba} copia /></div>, document.body)}
    </div>
  );
}

// O papel em si. Aparece duas vezes: na janela (tela) e numa cópia presa direto no <body> só para impressão.
// Motivo: dentro da janela o papel fica num painel com rolagem e altura máxima, e o navegador cortava a impressão
// (no teste real em A4 saía só o logo). A cópia fora da janela imprime inteira, em A4 ou bobina de 80 mm.
function PapelRecibo({ r, aba, copia = false }: { r: ReciboDados; aba: 'comprovante' | 'recibo'; copia?: boolean }) {
  const numero = r.vendaId.replace(/-/g, '').slice(0, 8).toUpperCase();
  const data = new Date(r.quando);
  const dataHora = data.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const troco = r.forma === 'dinheiro' && r.recebido !== null && r.recebido > r.total ? r.recebido - r.total : null;
  const quem = r.cliente ?? 'consumidor final';
  return (
    <div className="papel-recibo mx-auto w-full max-w-[80mm] bg-white p-4 font-mono text-[11.5px] leading-snug text-black shadow-card" data-testid={copia ? undefined : 'pdv-recibo-papel'}>
      <div className="flex flex-col items-center text-center">
        <Image src="/brand/logo-black.png" alt="ADEGA SB" width={120} height={48} className="h-auto w-[110px]" />
        <p className="mt-1 font-bold">{EMPRESA.fantasia}</p>
        <p>{EMPRESA.razao}</p>
        <p>CNPJ {EMPRESA.cnpj} · IE {EMPRESA.ie}</p>
        <p>{EMPRESA.endereco}</p>
        <p>{EMPRESA.cidade} - {EMPRESA.uf} · CEP {EMPRESA.cep}</p>
        <p>{EMPRESA.fone}</p>
      </div>
      <hr className="my-2 border-dashed border-black/40" />
      {aba === 'comprovante' ? (
        <>
          <p className="text-center font-bold">{r.forma === 'credito' ? 'COMPROVANTE DE COMPRA NO CRÉDITO' : 'COMPROVANTE DE VENDA'}</p>
          <p className="text-center text-[10.5px]">NÃO É DOCUMENTO FISCAL</p>
          <p className="mt-1">Venda nº {numero} · {dataHora}</p>
          <p>{r.caixa} · Operador: {r.operador}</p>
          <hr className="my-2 border-dashed border-black/40" />
          {r.itens.map((i, k) => (
            <div key={k} className="mb-1">
              <p>{i.nome}</p>
              <p className="flex justify-between"><span>{i.qtd.toLocaleString('pt-BR')} x {brl(i.preco)}</span><span>{brl(i.qtd * i.preco)}</span></p>
            </div>
          ))}
          <hr className="my-2 border-dashed border-black/40" />
          <p className="flex justify-between"><span>Subtotal</span><span>{brl(r.subtotal)}</span></p>
          {r.desconto > 0 && <p className="flex justify-between"><span>Desconto</span><span>- {brl(r.desconto)}</span></p>}
          <p className="flex justify-between font-bold"><span>TOTAL</span><span data-testid={copia ? undefined : 'pdv-recibo-total'}>{brl(r.total)}</span></p>
          <p className="flex justify-between"><span>Forma</span><span>{FORMA[r.forma]}</span></p>
          {r.recebido !== null && r.forma === 'dinheiro' && <p className="flex justify-between"><span>Recebido</span><span>{brl(r.recebido)}</span></p>}
          {troco !== null && <p className="flex justify-between font-bold"><span>Troco</span><span>{brl(troco)}</span></p>}
          <hr className="my-2 border-dashed border-black/40" />
          <p>Cliente: {quem}</p>
          <p data-testid={copia ? undefined : 'pdv-recibo-cpf'}>{r.cpf ? `CPF ${mascaraCpf(r.cpf)}` : 'CPF não informado'}</p>
          {r.maior18 && <p>Bebida alcoólica: maior de 18 anos, documento conferido.</p>}
          <p className="mt-2 text-center text-[10.5px]">Venda proibida para menores de 18 anos · Se beber, não dirija.</p>
        </>
      ) : r.forma === 'credito' ? (
        <>
          <p className="text-center font-bold">TERMO DE DÉBITO</p>
          <p className="mt-2">Eu, <strong>{quem}</strong>{r.cpf ? `, CPF ${mascaraCpf(r.cpf)}` : ''}, reconheço que devo a {EMPRESA.fantasia} a importância de <strong>{brl(r.total)}</strong> ({reaisPorExtenso(r.total)}), referente à compra nº {numero} de {dataHora}, para pagamento posterior.</p>
          <p className="mt-6 border-t border-black/60 pt-1 text-center">{quem}</p>
        </>
      ) : (
        <>
          <p className="flex justify-between font-bold"><span>RECIBO</span><span>{brl(r.total)}</span></p>
          <p className="mt-2">Recebemos de <strong>{quem}</strong>{r.cpf ? `, CPF ${mascaraCpf(r.cpf)}` : ''} a importância de <strong>{brl(r.total)}</strong> ({reaisPorExtenso(r.total)}), referente à compra nº {numero}, paga em {FORMA[r.forma]}.</p>
          <p className="mt-2">{EMPRESA.cidade}, {data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })}.</p>
          <p className="mt-6 border-t border-black/60 pt-1 text-center">{EMPRESA.fantasia} · {r.operador}</p>
          <p className="mt-2 text-center text-[10.5px]">Documento sem valor fiscal.</p>
        </>
      )}
    </div>
  );
}
