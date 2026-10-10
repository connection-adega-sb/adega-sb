'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { envPublicoOk } from '@/lib/env';
import { supabaseServidor } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ehPapel, rotaInicial } from '@/lib/papeis';

const Entrada = z.object({
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.'),
  senha: z.string().min(1, 'Informe a senha.'),
  next: z.string().optional(),
});

export type EstadoLogin = { erro?: string };

// Só aceita destino interno ("/algo"), nunca URL externa ou "//host".
const destinoSeguro = (n?: string) => (n && n.startsWith('/') && !n.startsWith('//') ? n : null);

export async function entrar(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  if (!envPublicoOk()) return { erro: 'Sistema indisponível: configuração ausente no servidor.' };
  const dados = Entrada.safeParse({ email: form.get('email'), senha: form.get('senha'), next: form.get('next') ?? undefined });
  if (!dados.success) return { erro: dados.error.issues[0]?.message ?? 'Dados inválidos.' };
  const sb = await supabaseServidor();
  const { data, error } = await sb.auth.signInWithPassword({ email: dados.data.email, password: dados.data.senha });
  if (error) return { erro: 'E-mail ou senha incorretos.' };

  // Sem `next` explícito, entra direto no módulo do papel (caixa/gerente → PDV, bartender → bar,
  // estoquista → estoque). O papel é lido pelo admin: dentro do mesmo request o cookie de sessão
  // ainda não devolve a policy "profiles_le_proprio".
  const destino = destinoSeguro(dados.data.next);
  if (destino) redirect(destino);
  const uid = data.user?.id;
  let papel: unknown = null;
  if (uid) {
    const { data: perfil } = await supabaseAdmin().from('profiles').select('role').eq('id', uid).maybeSingle();
    papel = perfil?.role;
  }
  redirect(ehPapel(papel) ? rotaInicial(papel) : '/painel');
}

export async function sair() {
  if (envPublicoOk()) {
    const sb = await supabaseServidor();
    await sb.auth.signOut();
  }
  redirect('/login');
}
