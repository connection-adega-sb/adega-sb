'use client';
import { useActionState } from 'react';
import { redefinirSenha, type EstadoRedefinir } from './actions';

// Botão "Redefinir senha" da linha do usuário: a senha nova aparece só aqui, uma vez.
export function RedefinirSenha({ id }: { id: string }) {
  const [e, acao, pend] = useActionState<EstadoRedefinir, FormData>(redefinirSenha, {});
  return (
    <form action={acao} className="inline-block text-left" data-testid="form-redefinir-senha">
      <input type="hidden" name="id" value={id} />
      <button disabled={pend} className="rounded-full border border-line px-3 py-1 text-xs font-bold disabled:opacity-50">
        {pend ? 'Gerando…' : 'Redefinir senha'}
      </button>
      {e.erro && <span className="ml-2 text-xs font-bold text-bad">{e.erro}</span>}
      {e.senha && (
        <span className="mt-2 block rounded-xl bg-acao-100 p-2 text-xs" data-testid="senha-redefinida">
          Senha inicial (aparece só agora): <code className="select-all font-bold">{e.senha}</code>
        </span>
      )}
    </form>
  );
}
