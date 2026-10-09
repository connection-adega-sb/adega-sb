import { Topo } from '@/components/Topo';
import { exigirSessao } from '@/lib/sessao';
import { FormSenha } from './FormSenha';

export const metadata = { title: 'Trocar senha' };
export const dynamic = 'force-dynamic';

export default async function Senha() {
  const s = await exigirSessao();
  return (
    <>
      <Topo nome={s.nome} papel={s.papel} />
      <main className="mx-auto max-w-md px-4 py-8">
        <h1 className="text-2xl font-bold text-estrutura mb-4">Trocar senha</h1>
        <FormSenha />
      </main>
    </>
  );
}
