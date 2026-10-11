import type { Metadata } from 'next';
import { exigirSessao } from '@/lib/sessao';
import { Topo } from '@/components/Topo';
import { listarLocaisCadastro } from './actions';
import { Produtos } from './Produtos';

export const metadata: Metadata = { title: 'Produtos' };
export const dynamic = 'force-dynamic';

// Cadastro de produtos FORA da venda (PRD-credito-produtos.md · 0009). Quem vende cadastra;
// master/gerente/estoquista também editam (papeis.ts ACESSO_ROTA /produtos).
export default async function PageProdutos() {
  const s = await exigirSessao(['master', 'gerente', 'caixa', 'bartender', 'estoquista']);
  const locais = await listarLocaisCadastro();
  return (
    <>
      <Topo nome={s.nome} papel={s.papel} />
      <Produtos papel={s.papel} locais={locais} deveTrocarSenha={s.deveTrocarSenha} />
    </>
  );
}
