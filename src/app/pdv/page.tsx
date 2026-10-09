import type { Metadata } from 'next';
import { exigirSessao } from '@/lib/sessao';
import { listarCaixas, type CaixaInfo } from './actions';
import { Pdv } from './Pdv';

export const metadata: Metadata = { title: 'PDV' };
export const dynamic = 'force-dynamic';

// PDV balcão (modulo-pdv.md §7). Só caixa/gerente/master (papeis.ts ACESSO_ROTA).
export default async function PagePDV() {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  const caixas: CaixaInfo[] = await listarCaixas();
  return <Pdv caixas={caixas} nome={s.nome} papel={s.papel} deveTrocarSenha={s.deveTrocarSenha} />;
}
