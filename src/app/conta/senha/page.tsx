import { Topo } from '@/components/Topo';
import { exigirSessao } from '@/lib/sessao';
import { rotaInicial } from '@/lib/papeis';
import { FormSenha } from './FormSenha';

export const metadata = { title: 'Trocar senha' };
export const dynamic = 'force-dynamic';

export default async function Senha() {
  const s = await exigirSessao();
  return (
    <>
      <Topo nome={s.nome} papel={s.papel} />
      <main className="mx-auto max-w-md px-4 py-8">
        <h1 className="text-[21px] font-extrabold leading-tight text-estrutura lg:text-[26px] mb-4">Trocar senha</h1>
        {s.deveTrocarSenha && (
          <p className="mb-4 rounded-card border-l-4 border-warn bg-white p-3 text-sm" data-testid="senha-obrigatoria">
            <strong>Primeiro acesso:</strong> crie a sua senha (mínimo 10 caracteres) para continuar.
          </p>
        )}
        <FormSenha inicio={rotaInicial(s.papel)} />
      </main>
    </>
  );
}
