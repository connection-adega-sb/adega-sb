'use server';
import { z } from 'zod';
import { exigirSessao } from '@/lib/sessao';
import { supabaseServidor } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const Senha = z.object({ senha: z.string().min(10, 'Mínimo de 10 caracteres.'), confirma: z.string() })
  .refine((d) => d.senha === d.confirma, { message: 'As senhas não conferem.' });

export type EstadoSenha = { erro?: string; ok?: boolean };

export async function trocarSenha(_: EstadoSenha, form: FormData): Promise<EstadoSenha> {
  const s = await exigirSessao();
  const d = Senha.safeParse({ senha: form.get('senha'), confirma: form.get('confirma') });
  if (!d.success) return { erro: d.error.issues[0]?.message };
  const sb = await supabaseServidor();
  const { error } = await sb.auth.updateUser({ password: d.data.senha });
  if (error) return { erro: 'Não foi possível trocar a senha. Tente outra.' };
  await supabaseAdmin().from('profiles').update({ deve_trocar_senha: false }).eq('id', s.id);
  return { ok: true };
}
