'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { trocarSenha, type EstadoSenha } from './actions';

export function FormSenha() {
  const [e, acao, pend] = useActionState<EstadoSenha, FormData>(trocarSenha, {});
  if (e.ok) return <p className="font-bold text-ok">Senha trocada. <Link href="/painel" className="underline">Voltar ao painel</Link></p>;
  const campo = 'mt-1 w-full rounded-xl border-[1.5px] border-line-input bg-white px-3.5 py-2.5';
  return (
    <form action={acao} className="space-y-4">
      <label className="block"><span className="text-sm font-bold text-estrutura">Nova senha</span><input name="senha" type="password" autoComplete="new-password" className={campo} /></label>
      <label className="block"><span className="text-sm font-bold text-estrutura">Repita a nova senha</span><input name="confirma" type="password" autoComplete="new-password" className={campo} /></label>
      <p role="alert" className="min-h-5 text-sm font-bold text-bad">{e.erro}</p>
      <button disabled={pend} className="rounded-full bg-acao-600 px-5 py-3 font-bold text-white disabled:opacity-50">Salvar</button>
    </form>
  );
}
