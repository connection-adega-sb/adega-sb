'use client';
// Cabeçalho ERP único — mesmo desenho do <header> de public/prototipos/vendas.html e compras.html
// (PRD-layout-adega-sb.md, entrega L1). Logo + rótulo "ERP · <módulo> · data" + navegação por módulo
// em pílulas (ativa = bg-acao-600) + usuário e Sair. Só mostra os módulos que o papel pode abrir.
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { sair } from '@/app/login/actions';
import { ROTULO_PAPEL, papelPodeAcessar, type Papel } from '@/lib/papeis';

const MODULOS: { rota: string; rotulo: string }[] = [
  { rota: '/painel', rotulo: 'Painel' },
  { rota: '/pdv', rotulo: 'PDV' },
  { rota: '/bar', rotulo: 'Bar' },
  { rota: '/estoque', rotulo: 'Estoque' },
  { rota: '/produtos', rotulo: 'Produtos' },
  { rota: '/clientes', rotulo: 'Clientes' },
  { rota: '/admin/usuarios', rotulo: 'Usuários' },
  { rota: '/prototipos', rotulo: 'Protótipos' },
];

export function Topo({ nome, papel, modulo }: { nome: string; papel: Papel; modulo?: string }) {
  const caminho = usePathname() ?? '';
  const hoje = new Date().toLocaleDateString('pt-BR');
  const itens = MODULOS.filter((m) => papelPodeAcessar(papel, m.rota));
  const atual = itens.find((m) => caminho === m.rota || caminho.startsWith(m.rota + '/'));
  return (
    <header className="bg-estrutura border-b border-white/10 shrink-0 text-white" data-testid="topo">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-3 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/painel" className="shrink-0" aria-label="ADEGA SB, painel">
            <Image src="/brand/logo-colour.png" alt="ADEGA SB" width={116} height={48} priority className="h-10 w-auto sm:h-11" />
          </Link>
          <p className="truncate text-[10.5px] font-extrabold uppercase tracking-[.1em] text-white/70">
            ERP · {modulo ?? atual?.rotulo ?? 'Painel'} · {hoje}
          </p>
        </div>
        <nav className="flex gap-1.5 overflow-x-auto" aria-label="Módulos">
          {itens.map((m) => {
            const on = atual?.rota === m.rota;
            return (
              <Link key={m.rota} href={m.rota} aria-current={on ? 'page' : undefined}
                className={`flex items-center whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] ${on ? 'bg-acao-600 font-bold text-white' : 'font-semibold text-white/85 hover:bg-white/10'}`}>
                {m.rotulo}
              </Link>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-3 text-sm">
          <span className="hidden lg:inline" data-testid="topo-usuario"><strong>{nome}</strong> · {ROTULO_PAPEL[papel]}</span>
          <form action={sair}>
            <button className="rounded-full bg-white/10 px-4 py-2 font-bold hover:bg-white/20" data-testid="btn-sair">Sair</button>
          </form>
        </div>
      </div>
    </header>
  );
}
