import type { Metadata } from 'next';
import { Topo } from '@/components/Topo';
import { exigirSessao } from '@/lib/sessao';

export const metadata: Metadata = { title: 'Protótipos' };
export const dynamic = 'force-dynamic';

// Protótipos HTML de 07/10/2026 (public/prototipos). Referência funcional: guardam dados SÓ no navegador,
// sem banco e sem login próprio. Cada um vira módulo real conforme o roadmap.
const ITENS = [
  { href: '/prototipos/index.html', nome: 'PDV balcão', fase: 'vira F3', desc: 'Caixa, leitor, +18, F9 (Balcão · Delivery · App), romaneio, precificação do copão e site da loja dentro do PDV.' },
  { href: '/prototipos/site.html', nome: 'Site da loja', fase: 'vira F5', desc: 'Catálogo com fotos, calculadora da festa, checkout e acompanhamento do pedido. Pedido feito aqui aparece no PDV (F9 › App) deste navegador.' },
  { href: '/prototipos/vendas.html', nome: 'Vendas', fase: 'vira F7', desc: 'Pedidos, varejo e atacado, notas, entregas e transportadoras, devoluções.' },
  { href: '/prototipos/compras.html', nome: 'Compras', fase: 'vira F8', desc: 'Pedidos a fornecedor, importação, recebimento e notas de entrada.' },
];

export default async function Prototipos() {
  const s = await exigirSessao(['master', 'gerente']);
  return (
    <>
      <Topo nome={s.nome} papel={s.papel} />
      <main className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-estrutura">Protótipos</h1>
          <p className="text-ink-soft mt-1 max-w-3xl">Telas de referência aprovadas. <strong>Não são o sistema real:</strong> os dados ficam só neste navegador, sem banco. Cada protótipo vira módulo real na fase indicada.</p>
        </div>
        <section className="grid gap-4 sm:grid-cols-2" data-testid="lista-prototipos">
          {ITENS.map((p) => (
            <a key={p.href} href={p.href} target="_blank" rel="noopener" className="rounded-card border border-line bg-white p-5 hover:shadow-lg transition-shadow">
              <p className="text-xs font-extrabold uppercase tracking-widest text-acao-600">Protótipo · {p.fase}</p>
              <h2 className="text-xl font-bold text-estrutura mt-1">{p.nome} ↗</h2>
              <p className="text-sm text-ink-soft mt-1">{p.desc}</p>
            </a>
          ))}
        </section>
      </main>
    </>
  );
}
