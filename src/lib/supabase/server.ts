import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { env } from '@/lib/env';

// Cliente do usuário logado (respeita RLS). Usar em Server Components e Server Actions.
export async function supabaseServidor() {
  const store = await cookies();
  return createServerClient(env.url, env.publishable, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (lista) => {
        try { lista.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* Server Component: o middleware renova */ }
      },
    },
  });
}
