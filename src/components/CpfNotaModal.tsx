'use client';
import { useEffect, useRef, useState } from 'react';
import { cpfValido, mascaraCpf, soDigitos } from '@/lib/cpf';

// "CPF na nota?" — passo final do F12 (mesmo desenho do protótipo pdv.html). Vazio = consumidor não
// identificado. Enter confirma, Esc volta para a venda. Com cliente identificado, o CPF dele já vem preenchido.
export function CpfNotaModal({ resumo, cpfInicial, pendente, confirmar, voltar }: {
  resumo: string;
  cpfInicial?: string | null;
  pendente: boolean;
  confirmar: (cpf: string | null) => void;
  voltar: () => void;
}) {
  const [cpf, setCpf] = useState(cpfInicial ? mascaraCpf(cpfInicial) : '');
  const [erro, setErro] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const voltarRef = useRef(voltar);
  useEffect(() => { voltarRef.current = voltar; });
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); voltarRef.current(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  function enviar(semCpf = false) {
    if (pendente) return;
    if (semCpf || !soDigitos(cpf)) { confirmar(null); return; }
    if (!cpfValido(cpf)) { setErro('CPF inválido: confira os números ou deixe em branco.'); return; }
    confirmar(soDigitos(cpf));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-testid="pdv-cpf-modal" role="dialog" aria-modal="true" aria-label="CPF na nota">
      <div className="absolute inset-0 bg-estrutura/60" onClick={() => !pendente && voltar()} />
      <div className="relative w-full max-w-md rounded-t-banner bg-white p-5 sm:rounded-banner">
        <h2 className="text-xl font-extrabold text-estrutura">CPF na nota?</h2>
        <p className="mt-1 text-sm text-ink-soft">{resumo}. Deixe em branco para consumidor não identificado.</p>
        <label className="mt-4 block text-[11px] font-extrabold uppercase tracking-[.1em] text-ink-soft" htmlFor="pdv-cpf">CPF do cliente</label>
        <input id="pdv-cpf" ref={ref} value={cpf} inputMode="numeric" autoComplete="off" placeholder="000.000.000-00"
          data-testid="pdv-cpf" disabled={pendente}
          onChange={(e) => { setCpf(mascaraCpf(e.target.value)); setErro(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enviar(); } }}
          className="mt-1 w-full rounded-full border-[1.5px] border-estrutura bg-white px-5 py-3 text-lg tabular-nums focus:outline-none" />
        <p role="alert" className="min-h-5 pt-1 text-sm font-bold text-bad" data-testid="pdv-cpf-erro">{erro}</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => enviar(true)} disabled={pendente} data-testid="pdv-sem-cpf"
            className="rounded-full border border-line bg-white px-4 py-3 font-bold text-estrutura hover:border-estrutura disabled:opacity-50">Sem CPF</button>
          <button type="button" onClick={() => enviar()} disabled={pendente} data-testid="pdv-confirmar-venda"
            className="rounded-full bg-acao-600 px-4 py-3 font-extrabold text-white shadow-acao disabled:opacity-50">{pendente ? 'Finalizando…' : 'Finalizar venda'}</button>
        </div>
        <p className="mt-3 text-center text-xs text-ink-soft"><strong>Enter</strong> finaliza · <strong>Esc</strong> volta para a venda</p>
      </div>
    </div>
  );
}
