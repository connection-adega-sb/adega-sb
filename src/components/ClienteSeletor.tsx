'use client';
import { useEffect, useRef, useState } from 'react';
import { buscarClientes, type Cliente } from '@/app/clientes/actions';
import { ClienteForm } from '@/components/ClienteForm';
import { Icone } from '@/components/Icone';
import { cpf as fmtCpf, fone as fmtFone } from '@/lib/formatar';

// "Identificar cliente" no meio da venda (PDV): busca por nome, telefone ou CPF; se não achar,
// cadastra NA HORA e já volta para a venda com o cliente escolhido. Ninguém sai da tela.
export function ClienteSeletor({ fechar, onEscolher }: {
  fechar: () => void;
  onEscolher: (c: Cliente) => void;
}) {
  const [termo, setTermo] = useState('');
  const [lista, setLista] = useState<Cliente[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [destaque, setDestaque] = useState(0);
  const [novo, setNovo] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);
  const fecharRef = useRef(fechar);
  useEffect(() => { fecharRef.current = fechar; });

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecharRef.current(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  useEffect(() => { if (!novo) buscaRef.current?.focus(); }, [novo]);

  useEffect(() => {
    if (termo.trim().length < 2) { setLista([]); return; }
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      const r = await buscarClientes(termo);
      if (vivo) { setLista(r); setDestaque(0); setBuscando(false); }
    }, 200);
    return () => { vivo = false; clearTimeout(t); };
  }, [termo]);

  const so = termo.replace(/\D/g, '');
  const prefill = so.length >= 10 && so.length <= 11 ? { telefone: termo.trim() } : { nome: termo.trim() };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" data-testid="cliente-seletor">
      <div className="absolute inset-0 bg-estrutura/60" onClick={fechar} />
      <div className="relative w-full max-w-xl rounded-t-banner bg-white p-5 sm:rounded-banner">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-estrutura">{novo ? 'Novo cliente' : 'Identificar cliente'}</h2>
          <button onClick={fechar} aria-label="Fechar" className="text-ink-soft"><Icone n="fechar" /></button>
        </div>

        {novo ? (
          <ClienteForm prefill={prefill} rotuloSalvar="Cadastrar e voltar para a venda"
            onSalvo={(c) => { onEscolher(c); fechar(); }} onCancelar={() => setNovo(false)} />
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft"><Icone n="busca" className="h-4 w-4" /></span>
              <input ref={buscaRef} value={termo} onChange={(e) => setTermo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setDestaque((d) => Math.min(d + 1, lista.length - 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setDestaque((d) => Math.max(d - 1, 0)); }
                  if (e.key === 'Enter' && lista[destaque]) { e.preventDefault(); onEscolher(lista[destaque]); fechar(); }
                }}
                placeholder="Nome, telefone ou CPF" data-testid="cliente-busca" autoComplete="off"
                className="w-full rounded-full border border-line bg-white py-3 pl-11 pr-4 shadow-card focus:border-estrutura focus:outline-none" />
            </div>

            <ul className="max-h-72 space-y-1 overflow-y-auto" data-testid="cliente-resultados">
              {lista.map((c, i) => (
                <li key={c.id}>
                  <button type="button" onClick={() => { onEscolher(c); fechar(); }} data-testid="cliente-opcao"
                    className={`flex w-full items-center justify-between gap-3 rounded-card border px-4 py-2.5 text-left ${i === destaque ? 'border-estrutura bg-fundo' : 'border-line bg-white hover:border-estrutura'}`}>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-estrutura">{c.nome}</span>
                      <span className="block text-xs text-ink-soft">{[fmtFone(c.telefone), fmtCpf(c.cpf)].filter(Boolean).join(' · ') || 'sem telefone'}</span>
                    </span>
                    <Icone n="usuario" className="h-4 w-4 shrink-0 text-ink-soft" />
                  </button>
                </li>
              ))}
            </ul>

            {termo.trim().length >= 2 && !buscando && lista.length === 0 && (
              <p className="text-sm text-ink-soft" data-testid="cliente-nenhum">Nenhum cliente encontrado.</p>
            )}

            <button type="button" onClick={() => setNovo(true)} data-testid="cliente-novo"
              className="flex w-full items-center justify-center gap-2 rounded-full border border-acao-600 px-5 py-3 font-extrabold text-acao-700 hover:bg-acao-100">
              <Icone n="mais" className="h-4 w-4" /> Cadastrar novo cliente
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
