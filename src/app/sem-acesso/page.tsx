import Link from 'next/link';
export const metadata = { title: 'Sem acesso' };
export default function SemAcesso() {
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="max-w-md text-center" data-testid="pagina-403">
        <p className="text-sm font-extrabold uppercase tracking-widest text-acao-600">403</p>
        <h1 className="text-3xl font-bold text-estrutura mt-1">Sem acesso a esta área</h1>
        <p className="text-ink-soft mt-3">Seu usuário não tem papel ativo para esta tela. Fale com o master da ADEGA SB.</p>
        <Link href="/painel" className="inline-block mt-6 rounded-full bg-acao-600 px-5 py-3 font-bold text-white">Voltar ao painel</Link>
      </div>
    </main>
  );
}
