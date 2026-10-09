import 'server-only';
import { redirect } from 'next/navigation';
import { supabaseServidor } from '@/lib/supabase/server';
import { ehPapel, type Papel } from '@/lib/papeis';

export type Sessao = { id: string; email: string; nome: string; papel: Papel; tenantId: string; deveTrocarSenha: boolean; locais: string[] };

// Lê usuário + perfil (RLS: o próprio). Sem sessão → /login. Sem perfil ativo → /sem-acesso.
export async function exigirSessao(papeis?: readonly Papel[]): Promise<Sessao> {
  const sb = await supabaseServidor();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const { data: perfil } = await sb.from('profiles').select('nome, role, tenant_id, ativo, deve_trocar_senha').eq('id', user.id).maybeSingle();
  if (!perfil || !perfil.ativo || !ehPapel(perfil.role)) redirect('/sem-acesso');
  if (papeis && !papeis.includes(perfil.role)) redirect('/sem-acesso');
  const { data: vinc } = await sb.from('profile_locais').select('local_id').eq('profile_id', user.id);
  return { id: user.id, email: user.email ?? '', nome: perfil.nome, papel: perfil.role, tenantId: perfil.tenant_id,
           deveTrocarSenha: perfil.deve_trocar_senha, locais: (vinc ?? []).map((v) => v.local_id) };
}
