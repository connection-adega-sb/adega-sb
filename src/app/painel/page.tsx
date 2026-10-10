import Link from 'next/link';
import type { Metadata } from 'next';
import { Topo } from '@/components/Topo';
import { exigirSessao } from '@/lib/sessao';
import { type Papel } from '@/lib/papeis';

export const metadata: Metadata = { title: 'Painel' };
export const dynamic = 'force-dynamic';

// Módulos do roadmap (roadmap-enterprise.md §3). Os que já têm rota viram link; o resto
// continua "em construção". `papeis` espelha ACESSO_ROTA (src/lib/papeis.ts) — quem não tem
// acesso vê o card tracejado em vez de cair em /sem-acesso.
type Modulo = { fase: string; nome: string; desc: string; rota?: string; papeis?: readonly Papel[] };

const MODULOS: Modulo[] = [
  { fase: 'F2', nome: 'Catálogo e estoque', desc: 'Produtos, estoque por local (loja · bar · depósito), transferências, fichas do copão.', rota: '/estoque', papeis: ['master', 'gerente', 'estoquista'] },
  { fase: 'F3', nome: 'PDV balcão', desc: 'Caixa, leitor, +18, vendas do dia (F9).', rota: '/pdv', papeis: ['master', 'gerente', 'caixa'] },
  { fase: 'F4', nome: 'Bar', desc: 'Mesas, comandas e copão com baixa de insumo.', rota: '/bar', papeis: ['master', 'gerente', 'bartender', 'caixa'] },
  { fase: 'F5', nome: 'Delivery e site', desc: 'Entregador próprio, romaneio, pedidos do site.' },
  { fase: 'F6', nome: 'Plataformas', desc: 'iFood e outras plataformas de entrega.' },
  { fase: 'F7', nome: 'Distribuidora', desc: 'Bares clientes, atacado, carga, frota própria e terceirizada.' },
];

export default async function Painel() {
  const s = await exigirSessao();
  return (
    <>
      <Topo nome={s.nome} papel={s.papel} />
      <main className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        {s.deveTrocarSenha && (
          <div className="rounded-card border-l-4 border-warn bg-white p-4 flex flex-wrap items-center gap-3" data-testid="aviso-trocar-senha">
            <p className="text-sm"><strong>Troque sua senha.</strong> A senha inicial foi exibida uma única vez e precisa ser trocada no primeiro acesso.</p>
            <Link href="/conta/senha" className="ml-auto rounded-full bg-acao-600 px-4 py-2 text-sm font-bold text-white">Trocar agora</Link>
          </div>
        )}
        <div>
          <h1 className="text-3xl font-bold text-estrutura">Olá, {s.nome.split(' ')[0]}</h1>
          <p className="text-ink-soft">Locais vinculados: {s.papel === 'master' || s.papel === 'gerente' ? 'todos' : s.locais.length}</p>
        </div>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {s.papel === 'master' && (
            <Link href="/admin/usuarios" data-testid="card-usuarios" className="rounded-card border border-line bg-white p-5 hover:shadow-lg transition-shadow">
              <p className="text-xs font-extrabold uppercase tracking-widest text-acao-600">Fase 1 · ativo</p>
              <h2 className="text-xl font-bold text-estrutura mt-1">Usuários e acessos</h2>
              <p className="text-sm text-ink-soft mt-1">Criar equipe, papel e locais de cada pessoa.</p>
            </Link>
          )}
          {(s.papel === 'master' || s.papel === 'gerente') && (
            <Link href="/prototipos" data-testid="card-prototipos" className="rounded-card border border-line bg-white p-5 hover:shadow-lg transition-shadow">
              <p className="text-xs font-extrabold uppercase tracking-widest text-acao-600">Referência · protótipos</p>
              <h2 className="text-xl font-bold text-estrutura mt-1">Protótipos</h2>
              <p className="text-sm text-ink-soft mt-1">PDV, site, Vendas e Compras como aprovados (dados só no navegador).</p>
            </Link>
          )}
          {MODULOS.map((m) => {
            const podeAbrir = Boolean(m.rota && m.papeis?.includes(s.papel));
            if (podeAbrir && m.rota) {
              return (
                <Link
                  key={m.nome}
                  href={m.rota}
                  data-testid={`card-${m.rota.slice(1)}`}
                  className="rounded-card border border-line bg-white p-5 hover:shadow-lg transition-shadow"
                >
                  <p className="text-xs font-extrabold uppercase tracking-widest text-acao-600">{m.fase} · ativo</p>
                  <h2 className="text-xl font-bold text-estrutura mt-1">{m.nome}</h2>
                  <p className="text-sm text-ink-soft mt-1">{m.desc}</p>
                </Link>
              );
            }
            return (
              <div key={m.nome} className="rounded-card border border-dashed border-line bg-white/60 p-5" aria-disabled="true">
                <p className="text-xs font-extrabold uppercase tracking-widest text-ink-soft">{m.fase} · em construção</p>
                <h2 className="text-xl font-bold text-estrutura mt-1">{m.nome}</h2>
                <p className="text-sm text-ink-soft mt-1">{m.desc}</p>
              </div>
            );
          })}
        </section>
      </main>
    </>
  );
}
