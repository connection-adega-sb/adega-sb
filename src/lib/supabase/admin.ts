import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

// service_role: ignora RLS. SÓ no servidor (server actions/rotas), nunca em componente cliente.
export function supabaseAdmin() {
  const chave = process.env.SUPABASE_SECRET_KEY;
  if (!env.url || !chave) throw new Error('SUPABASE_SECRET_KEY ausente: operação administrativa indisponível');
  return createClient(env.url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
}
