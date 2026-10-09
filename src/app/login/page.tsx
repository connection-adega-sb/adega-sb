import Image from 'next/image';
import type { Metadata } from 'next';
import { envPublicoOk } from '@/lib/env';
import { FormLogin } from './FormLogin';

export const metadata: Metadata = { title: 'Entrar' };
export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="min-h-dvh grid place-items-center bg-estrutura px-4 py-10">
      <div className="w-full max-w-sm">
        <Image src="/brand/logo-colour.png" alt="ADEGA SB" width={260} height={107} priority className="mx-auto mb-8 h-auto w-56" />
        <div className="rounded-banner bg-white p-6 shadow-xl">
          <h1 className="text-2xl font-bold text-estrutura mb-1">Entrar</h1>
          <p className="text-sm text-ink-soft mb-5">Acesso restrito à equipe da ADEGA SB.</p>
          <FormLogin next={next} indisponivel={!envPublicoOk()} />
        </div>
        <p className="mt-6 text-center text-xs text-white/70">Venda proibida para menores de 18 anos.</p>
      </div>
    </main>
  );
}
