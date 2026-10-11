'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { salvarCliente, type Cliente } from '@/app/clientes/actions';
import { cpf as fmtCpf, fone as fmtFone } from '@/lib/formatar';

// Formulário de cliente (criar/editar) — o mesmo na tela /clientes e no PDV.
// Só monta o FormData: toda validação real é no servidor (0008 cliente_salvar).
const CAMPO = 'mt-1 w-full rounded-full border border-line bg-white px-4 py-2.5 shadow-card focus:border-estrutura focus:outline-none';
const LBL = 'block text-[11px] font-extrabold uppercase tracking-[.1em] text-ink-soft';

export function ClienteForm({ inicial, prefill, rotuloSalvar = 'Salvar cliente', onSalvo, onCancelar }: {
  inicial?: Cliente | null;
  prefill?: { nome?: string; telefone?: string };
  rotuloSalvar?: string;
  onSalvo: (c: Cliente) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);
  const nomeRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nomeRef.current?.focus(); }, []);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pendente) return;
    setErro(null); setPendente(true);
    try {
      const r = await salvarCliente({}, new FormData(e.currentTarget));
      if (r.erro) { setErro(r.erro); return; }
      if (r.cliente) await onSalvo(r.cliente);
    } catch {
      setErro('Falha ao salvar o cliente.');
    } finally {
      setPendente(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-3" data-testid="cliente-form" noValidate>
      {inicial && <input type="hidden" name="id" value={inicial.id} />}
      <label className={LBL}>Nome *
        <input ref={nomeRef} name="nome" defaultValue={inicial?.nome ?? prefill?.nome ?? ''} maxLength={120}
          required data-testid="cliente-nome" className={CAMPO} autoComplete="off" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LBL}>Telefone (com DDD)
          <input name="telefone" inputMode="tel" defaultValue={inicial ? fmtFone(inicial.telefone) : prefill?.telefone ?? ''}
            placeholder="(11) 98888-0000" data-testid="cliente-telefone" className={CAMPO} autoComplete="off" />
        </label>
        <label className={LBL}>CPF
          <input name="cpf" inputMode="numeric" defaultValue={fmtCpf(inicial?.cpf)}
            placeholder="000.000.000-00" data-testid="cliente-cpf" className={CAMPO} autoComplete="off" />
        </label>
      </div>
      <label className={LBL}>E-mail
        <input name="email" type="email" defaultValue={inicial?.email ?? ''} data-testid="cliente-email" className={CAMPO} autoComplete="off" />
      </label>
      <label className={LBL}>Observação
        <textarea name="observacao" defaultValue={inicial?.observacao ?? ''} maxLength={500} rows={2}
          placeholder="Ex.: prefere cerveja gelada, entrega no portão lateral"
          data-testid="cliente-obs" className="mt-1 w-full rounded-card border border-line bg-white px-4 py-2.5 shadow-card focus:border-estrutura focus:outline-none" />
      </label>
      <p role="alert" data-testid="cliente-erro" className="min-h-5 text-sm font-bold text-bad">{erro}</p>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <button type="button" onClick={onCancelar}
          className="rounded-full border border-line bg-white px-5 py-3 font-bold text-estrutura hover:border-estrutura">Cancelar</button>
        <button type="submit" disabled={pendente} data-testid="cliente-salvar"
          className="rounded-full bg-acao-600 px-5 py-3 font-extrabold text-white shadow-acao disabled:opacity-50">
          {pendente ? 'Salvando…' : rotuloSalvar}
        </button>
      </div>
    </form>
  );
}
