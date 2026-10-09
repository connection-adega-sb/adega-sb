import type { Metadata } from 'next';
import { exigirSessao } from '@/lib/sessao';
import { Topo } from '@/components/Topo';
import { listarLocais, type LocalResumo } from './actions';
import { Estoque } from './Estoque';

export const metadata: Metadata = { title: 'Estoque' };
export const dynamic = 'force-dynamic';

// Catálogo + estoque profundo (PRD-catalogo-estoque-multilocal.md §5–§10).
// Só estoquista/gerente/master (papeis.ts ACESSO_ROTA /estoque).
export default async function PageEstoque() {
  const s = await exigirSessao(['master', 'gerente', 'estoquista']);
  const locais: LocalResumo[] = await listarLocais();
  return (
    <>
      <Topo nome={s.nome} papel={s.papel} />
      <Estoque locais={locais} papel={s.papel} nome={s.nome} deveTrocarSenha={s.deveTrocarSenha} />
    </>
  );
}
