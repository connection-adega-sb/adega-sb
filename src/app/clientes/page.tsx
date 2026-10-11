import type { Metadata } from 'next';
import { exigirSessao } from '@/lib/sessao';
import { Topo } from '@/components/Topo';
import { Clientes } from './Clientes';

export const metadata: Metadata = { title: 'Clientes' };
export const dynamic = 'force-dynamic';

// Cadastro de clientes (PRD-clientes.md · 0008). Caixa/gerente/master (papeis.ts ACESSO_ROTA /clientes).
export default async function PageClientes() {
  const s = await exigirSessao(['master', 'gerente', 'caixa']);
  return (
    <>
      <Topo nome={s.nome} papel={s.papel} />
      <Clientes papel={s.papel} />
    </>
  );
}
