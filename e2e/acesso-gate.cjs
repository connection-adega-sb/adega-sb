// E2E acesso-gate · Fase 1 · sobe o build (npm run build antes) em 2 modos e confere o fail-closed.
// Modo A: sem env → 503 em tudo que é protegido. Modo B: env presente, sem sessão → /login?next=.
// Não precisa de banco: nenhuma checagem depende de usuário real (as de login real ficam na suíte com staging).
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');
const RAIZ = path.join(__dirname, '..');
let ok = 0, falha = 0;
const check = async (id, nome, fn) => {
  try { const r = await fn(); if (r === false) throw new Error('falso'); ok++; console.log('PASS', id, nome); }
  catch (e) { falha++; console.log('FAIL', id, nome, '—', String(e.message).split('\n')[0]); }
};
function subir(porta, envExtra) {
  const env = { ...process.env, PORT: String(porta), ...envExtra };
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) if (!(k in envExtra)) delete env[k];
  const p = spawn(process.execPath, [path.join(RAIZ, 'node_modules/next/dist/bin/next'), 'start', '-p', String(porta)], { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((ok_, erro) => {
    const t = setTimeout(() => erro(new Error('servidor não subiu em 30 s')), 30000);
    p.stdout.on('data', (b) => { if (/Ready|started server|Local:/i.test(String(b))) { clearTimeout(t); setTimeout(() => ok_(p), 300); } });
    p.on('exit', (c) => erro(new Error('next start saiu com código ' + c)));
  });
}
const get = (u) => fetch(u, { redirect: 'manual' });
(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  // ------------------------------------------------ Modo A: sem env
  let srv = await subir(3101, {});
  const A = 'http://127.0.0.1:3101';
  await check('A1', '/api/health responde 200 com env:false', async () => { const r = await get(A + '/api/health'); const j = await r.json(); return r.status === 200 && j.env === false; });
  await check('A2', '/painel sem env → 503', async () => { const r = await get(A + '/painel'); return r.status === 503 && /Sistema indisponível/.test(await r.text()); });
  await check('A3', '/admin/usuarios sem env → 503', async () => (await get(A + '/admin/usuarios')).status === 503);
  await check('A4', '/ sem env → 503', async () => (await get(A + '/')).status === 503);
  await check('A4b', '/prototipos/pdv.html sem env → 503', async () => (await get(A + '/prototipos/pdv.html')).status === 503);
  await check('A5', 'cabeçalhos de segurança presentes', async () => { const r = await get(A + '/login'); return r.headers.get('x-frame-options') === 'DENY' && r.headers.get('x-content-type-options') === 'nosniff' && !r.headers.get('x-powered-by'); });
  let pg = await browser.newPage();
  await pg.goto(A + '/login');
  await check('A6', '/login sem env: aviso e botão Entrar desabilitado', async () => (await pg.getByTestId('login-entrar').isDisabled()) && /indisponível/.test(await pg.getByTestId('login-erro').innerText()));
  await check('A7', 'logo oficial carrega no login', async () => pg.locator('img[alt="ADEGA SB"]').first().evaluate((i) => i.complete && i.naturalWidth > 0));
  await check('A8', 'ícone do app (/icon.png) publicado', async () => (await get(A + '/icon.png')).status === 200);
  await pg.close(); srv.kill();
  // ------------------------------------------------ Modo B: env presente (backend inalcançável de propósito), sem sessão
  srv = await subir(3102, { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_teste_e2e' });
  const B = 'http://127.0.0.1:3102';
  await check('B1', '/painel sem sessão → /login?next=/painel', async () => { const r = await get(B + '/painel'); return [302, 303, 307, 308].includes(r.status) && new URL(r.headers.get('location'), B).pathname === '/login' && new URL(r.headers.get('location'), B).searchParams.get('next') === '/painel'; });
  await check('B2', '/admin/usuarios sem sessão → /login?next=/admin/usuarios', async () => { const r = await get(B + '/admin/usuarios'); return new URL(r.headers.get('location') || '/', B).searchParams.get('next') === '/admin/usuarios'; });
  await check('B3', '/ sem sessão → /login (sem next)', async () => { const r = await get(B + '/'); const u = new URL(r.headers.get('location') || '/x', B); return u.pathname === '/login' && !u.searchParams.has('next'); });
  await check('B4', '/api/health com env → env:true, admin:false', async () => { const j = await (await get(B + '/api/health')).json(); return j.env === true && j.admin === false; });
  pg = await browser.newPage();
  await pg.goto(B + '/login?next=/painel');
  await check('B5', '/login com env: botão habilitado e next preservado', async () => !(await pg.getByTestId('login-entrar').isDisabled()) && (await pg.locator('input[name=next]').inputValue()) === '/painel');
  await pg.getByTestId('login-email').fill('nao-e-email'); await pg.getByTestId('login-senha').fill('x'); await pg.getByTestId('login-entrar').click();
  await check('B6', 'e-mail inválido → "Informe um e-mail válido."', async () => { await pg.getByTestId('login-erro').filter({ hasText: 'e-mail válido' }).waitFor({ timeout: 8000 }); return true; });
  await pg.getByTestId('login-email').fill('alguem@adegasb.invalid'); await pg.getByTestId('login-senha').fill('senha-errada'); await pg.getByTestId('login-entrar').click();
  await check('B7', 'falha de autenticação → mensagem genérica, continua no /login', async () => { await pg.getByTestId('login-erro').filter({ hasText: 'E-mail ou senha incorretos.' }).waitFor({ timeout: 15000 }); return new URL(pg.url()).pathname === '/login'; });
  await check('B10', '/prototipos e /prototipos/pdv.html sem sessão → /login', async () => { const r1 = await get(B + '/prototipos'); const r2 = await get(B + '/prototipos/pdv.html'); return [r1, r2].every((r) => new URL(r.headers.get('location') || '/x', B).pathname === '/login'); });
  await check('B8', '/sem-acesso responde e explica o 403', async () => { const r = await get(B + '/sem-acesso'); return r.status === 200 && /Sem acesso/.test(await r.text()); });
  await pg.close();
  const m = await browser.newPage({ viewport: { width: 390, height: 800 } });
  await m.goto(B + '/login');
  await check('B9', '/login em 390 px sem rolagem horizontal', async () => (await m.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await m.close(); srv.kill();
  await browser.close();
  console.log(`TOTAL: ${ok + falha} checks · ${ok} PASS · ${falha} FAIL`);
  process.exit(falha ? 1 : 0);
})().catch((e) => { console.error('ERRO', e); process.exit(2); });
