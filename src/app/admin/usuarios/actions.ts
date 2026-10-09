'use server';
import { randomInt } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { exigirSessao } from '@/lib/sessao';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PAPEIS } from '@/lib/papeis';

// Senha inicial: 14 caracteres sem ambíguos (0/O, 1/l). Exibida UMA vez; o usuário troca no 1º acesso.
function senhaInicial() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789#@%';
  return Array.from({ length: 14 }, () => A[randomInt(A.length)]).join('');
}

const Novo = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.'),
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  papel: z.enum(PAPEIS, { message: 'Papel inválido.' }),
  locais: z.array(z.string().uuid()),
});

export type EstadoNovo = { erro?: string; senha?: string; email?: string };

export async function criarUsuario(_: EstadoNovo, form: FormData): Promise<EstadoNovo> {
  const master = await exigirSessao(['master']);
  const d = Novo.safeParse({ nome: form.get('nome'), email: form.get('email'), papel: form.get('papel'), locais: form.getAll('locais') });
  if (!d.success) return { erro: d.error.issues[0]?.message };
  if (!['master', 'gerente'].includes(d.data.papel) && d.data.locais.length === 0) return { erro: 'Escolha pelo menos um local para este papel.' };
  const adm = supabaseAdmin();
  const senha = senhaInicial();
  const { data: criado, error } = await adm.auth.admin.createUser({ email: d.data.email, password: senha, email_confirm: true });
  if (error || !criado.user) return { erro: error?.message.includes('already') ? 'Já existe usuário com este e-mail.' : 'Não foi possível criar o usuário.' };
  const { error: e2 } = await adm.from('profiles').insert({ id: criado.user.id, tenant_id: master.tenantId, nome: d.data.nome, role: d.data.papel });
  if (e2) { await adm.auth.admin.deleteUser(criado.user.id); return { erro: 'Falha ao gravar o perfil; nada foi criado.' }; }
  if (d.data.locais.length) {
    const { error: e3 } = await adm.from('profile_locais').insert(d.data.locais.map((local_id) => ({ profile_id: criado.user!.id, local_id, tenant_id: master.tenantId })));
    if (e3) { await adm.auth.admin.deleteUser(criado.user.id); return { erro: 'Falha ao vincular os locais; nada foi criado.' }; }
  }
  revalidatePath('/admin/usuarios');
  return { senha, email: d.data.email };
}

export async function alternarAtivo(form: FormData) {
  const master = await exigirSessao(['master']);
  const id = z.string().uuid().parse(form.get('id'));
  if (id === master.id) return;   // master não se desativa
  const adm = supabaseAdmin();
  const { data } = await adm.from('profiles').select('ativo').eq('id', id).eq('tenant_id', master.tenantId).maybeSingle();
  if (!data) return;
  await adm.from('profiles').update({ ativo: !data.ativo }).eq('id', id);
  revalidatePath('/admin/usuarios');
}
