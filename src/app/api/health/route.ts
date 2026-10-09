import { NextResponse } from 'next/server';
import { envPublicoOk } from '@/lib/env';

export const dynamic = 'force-dynamic';

// Saúde do app. Não expõe valores, só se a configuração existe.
export function GET() {
  return NextResponse.json({ ok: true, app: 'adega-sb', env: envPublicoOk(), admin: Boolean(process.env.SUPABASE_SECRET_KEY) });
}
