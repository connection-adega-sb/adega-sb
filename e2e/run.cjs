// npm run e2e → build própria em .next-e2e SEM o .env.local, roda as suítes em ordem e para no primeiro FAIL.
// Por quê: o Next embute NEXT_PUBLIC_* no build e o `next start` lê o .env.local; com ele presente,
// os testes de "sem configuração → 503" nunca veriam o sistema sem configuração.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const RAIZ = path.join(__dirname, '..');
const ENV = path.join(RAIZ, '.env.local');
const GUARDADO = path.join(RAIZ, '.env.local.e2e-guardado');
const SUITES = ['acesso-gate.cjs'];

// Sobra de execução interrompida: devolve o .env.local antes de qualquer coisa.
if (fs.existsSync(GUARDADO) && !fs.existsSync(ENV)) fs.renameSync(GUARDADO, ENV);
const tinhaEnv = fs.existsSync(ENV);
const devolver = () => { if (tinhaEnv && fs.existsSync(GUARDADO)) fs.renameSync(GUARDADO, ENV); };
process.on('SIGINT', () => { devolver(); process.exit(130); });

let codigo = 0;
try {
  if (tinhaEnv) { fs.renameSync(ENV, GUARDADO); console.log('.env.local guardado durante o E2E (volta sozinho no fim)'); }
  const env = { ...process.env, NEXT_DIST_DIR: '.next-e2e' };
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) delete env[k];
  console.log('=== build de teste (.next-e2e, sem .env.local)');
  execFileSync(process.execPath, [path.join(RAIZ, 'node_modules/next/dist/bin/next'), 'build'], { cwd: RAIZ, env, stdio: ['ignore', 'ignore', 'inherit'] });
  for (const s of SUITES) {
    console.log(`\n=== ${s}`);
    try { execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit', env }); }
    catch { console.error(`\nSuíte ${s} falhou — cadeia interrompida.`); codigo = 1; break; }
  }
} catch (e) { console.error('Falha no build de teste:', e.message); codigo = 1; }
finally { devolver(); if (tinhaEnv) console.log('.env.local devolvido'); }
process.exit(codigo);
