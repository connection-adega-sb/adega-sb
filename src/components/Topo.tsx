import Image from 'next/image';
import Link from 'next/link';
import { sair } from '@/app/login/actions';
import { ROTULO_PAPEL, type Papel } from '@/lib/papeis';

export function Topo({ nome, papel }: { nome: string; papel: Papel }) {
  return (
    <header className="bg-estrutura text-white">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-4">
        <Link href="/painel" className="shrink-0" aria-label="ADEGA SB, painel">
          <Image src="/brand/logo-colour.png" alt="ADEGA SB" width={116} height={48} priority className="h-11 w-auto" />
        </Link>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden sm:inline" data-testid="topo-usuario"><strong>{nome}</strong> · {ROTULO_PAPEL[papel]}</span>
          <form action={sair}>
            <button className="rounded-full bg-white/10 hover:bg-white/20 px-4 py-2 font-bold" data-testid="btn-sair">Sair</button>
          </form>
        </div>
      </div>
    </header>
  );
}
