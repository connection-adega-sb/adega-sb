import type { Metadata } from 'next';
import { Topo } from '@/components/Topo';
import { exigirSessao } from '@/lib/sessao';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ROTULO_PAPEL, ehPapel } from '@/lib/papeis';
import { FormNovo } from './FormNovo';
import { alternarAtivo } from './actions';

export const metadata: Metadata = { title: 'Usuários' };
export const dynamic = 'force-dynamic';

export default async function Usuarios() {
  const s = await exigirSessao(['master']);
  const adm = supabaseAdmin();
  const [{ data: perfis }, { data: locais }, { data: vinc }, { data: auth }] = await Promise.all([
    adm.from('profiles').select('id, nome, role, ativo, deve_trocar_senha').eq('tenant_id', s.tenantId).order('nome'),
    adm.from('locais').select('id, nome').eq('tenant_id', s.tenantId).eq('ativo', true).order('nome'),
    adm.from('profile_locais').select('profile_id, local_id').eq('tenant_id', s.tenantId),
    adm.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const email = new Map((auth?.users ?? []).map((u) => [u.id, u.email]));
  const nomeLocal = new Map((locais ?? []).map((l) => [l.id, l.nome]));
  return (
    <>
      <Topo nome={s.nome} papel={s.papel} />
      <main className="mx-auto max-w-6xl px-4 py-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <section>
          <h1 className="text-2xl font-bold text-estrutura mb-4">Usuários e acessos</h1>
          <div className="overflow-x-auto rounded-card border border-line bg-white">
            <table className="w-full text-sm" data-testid="tabela-usuarios">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                <th className="px-3 py-2">Nome</th><th className="px-3 py-2">E-mail</th><th className="px-3 py-2">Papel</th><th className="px-3 py-2">Locais</th><th className="px-3 py-2">Status</th><th /></tr></thead>
              <tbody>{(perfis ?? []).map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-bold text-estrutura">{p.nome}</td>
                  <td className="px-3 py-2">{email.get(p.id) ?? '—'}</td>
                  <td className="px-3 py-2">{ehPapel(p.role) ? ROTULO_PAPEL[p.role] : p.role}</td>
                  <td className="px-3 py-2">{['master', 'gerente'].includes(p.role) ? 'todos' : (vinc ?? []).filter((v) => v.profile_id === p.id).map((v) => nomeLocal.get(v.local_id)).join(', ') || '—'}</td>
                  <td className="px-3 py-2">{p.ativo ? <span className="text-ok font-bold">ativo</span> : <span className="text-bad font-bold">inativo</span>}{p.deve_trocar_senha && <span className="block text-xs text-warn">troca de senha pendente</span>}</td>
                  <td className="px-3 py-2 text-right">{p.id !== s.id && (
                    <form action={alternarAtivo}><input type="hidden" name="id" value={p.id} />
                      <button className="rounded-full border border-line px-3 py-1 text-xs font-bold">{p.ativo ? 'Desativar' : 'Reativar'}</button></form>)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
        <FormNovo locais={locais ?? []} />
      </main>
    </>
  );
}
