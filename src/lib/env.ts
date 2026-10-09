// Variáveis de ambiente. Nunca logar valores. Sem env → o middleware responde 503 (fail-closed).
export const env = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  publishable: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
};

export const envPublicoOk = () => Boolean(env.url && env.publishable);
