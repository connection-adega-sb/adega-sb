'use client';
import { useActionState } from 'react';
import { entrar, type EstadoLogin } from './actions';

export function FormLogin({ next, indisponivel }: { next?: string; indisponivel: boolean }) {
  const [estado, acao, pendente] = useActionState<EstadoLogin, FormData>(entrar, {});
  return (
    <form action={acao} className="space-y-4" data-testid="form-login" noValidate>
      <input type="hidden" name="next" value={next ?? ''} />
      <label className="block">
        <span className="text-sm font-bold text-estrutura">E-mail</span>
        <input name="email" type="email" autoComplete="username" required data-testid="login-email"
          className="mt-1 w-full rounded-xl border-[1.5px] border-line-input bg-white px-3.5 py-2.5 focus:outline-none focus:border-estrutura" />
      </label>
      <label className="block">
        <span className="text-sm font-bold text-estrutura">Senha</span>
        <input name="senha" type="password" autoComplete="current-password" required data-testid="login-senha"
          className="mt-1 w-full rounded-xl border-[1.5px] border-line-input bg-white px-3.5 py-2.5 focus:outline-none focus:border-estrutura" />
      </label>
      <p role="alert" data-testid="login-erro" className="min-h-5 text-sm font-bold text-bad">
        {indisponivel ? 'Sistema indisponível: configuração ausente no servidor.' : estado.erro}
      </p>
      <button disabled={pendente || indisponivel} data-testid="login-entrar"
        className="w-full rounded-full bg-acao-600 hover:bg-acao-700 disabled:opacity-50 px-5 py-3 font-extrabold text-white">
        {pendente ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
