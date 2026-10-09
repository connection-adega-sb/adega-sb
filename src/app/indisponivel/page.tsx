export const metadata = { title: 'Indisponível' };
export default function Indisponivel() {
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="max-w-md text-center" data-testid="pagina-503">
        <p className="text-sm font-extrabold uppercase tracking-widest text-acao-600">503</p>
        <h1 className="text-3xl font-bold text-estrutura mt-1">Sistema indisponível</h1>
        <p className="text-ink-soft mt-3">A configuração do servidor está incompleta. Nenhuma tela operacional abre sem ela.</p>
      </div>
    </main>
  );
}
