// npm run e2e → roda as suítes em ordem e para no primeiro FAIL (AGENTS.md §Testes).
const { execFileSync } = require('node:child_process');
const SUITES = ['acesso-gate.cjs'];
for (const s of SUITES) {
  console.log(`\n=== ${s}`);
  try { execFileSync(process.execPath, [require('node:path').join(__dirname, s)], { stdio: 'inherit' }); }
  catch { console.error(`\nSuíte ${s} falhou — cadeia interrompida.`); process.exit(1); }
}
