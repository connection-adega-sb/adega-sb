import type { Metadata } from 'next';
import { exigirSessao } from '@/lib/sessao';
import { Topo } from '@/components/Topo';
import { listarLocais, type LocalResumo } from './actions';
import { Bar } from './Bar';

export const metadata: Metadata = { title: 'Bar' };
export const dynamic = 'force-dynamic';

// Mesas, comandas e venda de copão com baixa pela ficha técnica — F4.1 do roadmap-enterprise.md.
// Bartender/caixa operam; gerente e master supervisionam (papeis.ts ACESSO_ROTA /bar).
export default async function PageBar() {
  const s = await exigirSessao(['master', 'gerente', 'bartender', 'caixa']);
  const locais: LocalResumo[] = await listarLocais();
  return (
    <>
      <Topo nome={s.nome} papel={s.papel} />
      <Bar locais={locais} papel={s.papel} nome={s.nome} deveTrocarSenha={s.deveTrocarSenha} />
    </>
  );
}
