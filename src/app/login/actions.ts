'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { envPublicoOk } from '@/lib/env';
import { supabaseServidor } from '@/lib/supabase/server';

const Entrada = z.object({
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.'),
  senha: z.string().min(1, 'Informe a senha.'),
  next: z.string().optional(),
});

export type EstadoLogin = { erro?: string };

// Só aceita destino interno ("/algo"), nunca URL externa ou "//host".
const destinoSeguro = (n?: string) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/painel');

export async function entrar(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  if (!envPublicoOk()) return { erro: 'Sistema indisponível: configuração ausente no servidor.' };
  const dados = Entrada.safeParse({ email: form.get('email'), senha: form.get('senha'), next: form.get('next') ?? undefined });
  if (!dados.success) return { erro: dados.error.issues[0]?.message ?? 'Dados inválidos.' };
  const sb = await supabaseServidor();
  const { error } = await sb.auth.signInWithPassword({ email: dados.data.email, password: dados.data.senha });
  if (error) return { erro: 'E-mail ou senha incorretos.' };
  redirect(destinoSeguro(dados.data.next));
}

export async function sair() {
  if (envPublicoOk()) {
    const sb = await supabaseServidor();
    await sb.auth.signOut();
  }
  redirect('/login');
}
