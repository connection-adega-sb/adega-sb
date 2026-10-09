import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { env, envPublicoOk } from '@/lib/env';
import { ROTAS_PUBLICAS, ehPapel, papelPodeAcessar } from '@/lib/papeis';

// Fail-closed (parecer §2.5): sem env → 503 · sem sessão → /login?next= · sem papel/ativo ou papel errado → 403.
export async function middleware(req: NextRequest) {
  const caminho = req.nextUrl.pathname;
  const publica = ROTAS_PUBLICAS.some((r) => caminho === r || caminho.startsWith(r + '/'));

  if (!envPublicoOk()) {
    if (publica) return NextResponse.next();
    return NextResponse.rewrite(new URL('/indisponivel', req.url), { status: 503 });
  }

  let res = NextResponse.next({ request: req });
  const sb = createServerClient(env.url, env.publishable, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (lista) => {
        lista.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        lista.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await sb.auth.getUser();
  if (publica) return res;

  if (!user) {
    const url = new URL('/login', req.url);
    if (caminho !== '/') url.searchParams.set('next', caminho + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  const { data: perfil } = await sb.from('profiles').select('role, ativo').eq('id', user.id).maybeSingle();
  if (!perfil || !perfil.ativo || !ehPapel(perfil.role) || !papelPodeAcessar(perfil.role, caminho)) {
    return NextResponse.rewrite(new URL('/sem-acesso', req.url), { status: 403 });
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|brand/|icon.png|apple-icon.png|favicon.ico|robots.txt).*)'],
};
