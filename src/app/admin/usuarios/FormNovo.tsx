'use client';
import { useActionState } from 'react';
import { criarUsuario, type EstadoNovo } from './actions';
import { PAPEIS, ROTULO_PAPEL } from '@/lib/papeis';

export function FormNovo({ locais }: { locais: { id: string; nome: string }[] }) {
  const [e, acao, pend] = useActionState<EstadoNovo, FormData>(criarUsuario, {});
  const campo = 'mt-1 w-full rounded-xl border-[1.5px] border-line-input bg-white px-3 py-2';
  return (
    <form action={acao} className="rounded-card border border-line bg-white p-5 space-y-3" data-testid="form-novo-usuario">
      <h2 className="text-lg font-bold text-estrutura">Novo usuário</h2>
      <label className="block text-sm font-bold text-estrutura">Nome<input name="nome" className={campo} /></label>
      <label className="block text-sm font-bold text-estrutura">E-mail<input name="email" type="email" className={campo} /></label>
      <label className="block text-sm font-bold text-estrutura">Papel
        <select name="papel" className={campo} defaultValue="caixa">{PAPEIS.map((p) => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}</select>
      </label>
      <fieldset><legend className="text-sm font-bold text-estrutura">Locais</legend>
        <div className="mt-1 flex flex-wrap gap-3">{locais.map((l) => (
          <label key={l.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="locais" value={l.id} className="h-4 w-4 accent-acao-600" />{l.nome}</label>
        ))}</div>
      </fieldset>
      <p role="alert" className="min-h-5 text-sm font-bold text-bad">{e.erro}</p>
      {e.senha && (
        <div className="rounded-xl bg-acao-100 p-3 text-sm" data-testid="senha-inicial">
          Usuário <strong>{e.email}</strong> criado. Senha inicial (aparece só agora): <code className="font-bold select-all">{e.senha}</code>
        </div>
      )}
      <button disabled={pend} className="rounded-full bg-acao-600 hover:bg-acao-700 px-5 py-2.5 font-bold text-white disabled:opacity-50">Criar usuário</button>
    </form>
  );
}
