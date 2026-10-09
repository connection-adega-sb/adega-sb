// Injeta o gate antes do `rollback;` final de um teste pgTAP.
// Por quê: `supabase db query --project-ref X --file t.sql` só devolve a ÚLTIMA linha e não tem
// senha; o finish() deste pgTAP retorna 0 linhas quando tudo passa. Sem gate, um `not ok`
// passaria em silêncio. Com o gate, o comando FALHA (exit != 0) se num_failed() > 0.
// Uso: node scripts/gate-pgtap.cjs supabase/tests/0003_test.sql supabase/tests/_gate_0003.sql
const fs = require('node:fs');
const [origem, destino] = process.argv.slice(2);
if (!origem || !destino) {
  console.error('Uso: node scripts/gate-pgtap.cjs <teste.sql> <saida.sql>');
  process.exit(1);
}
let t = fs.readFileSync(origem, 'utf8');
const gate = [
  '-- gate injetado por scripts/gate-pgtap.cjs: derruba o comando se algum teste falhar',
  'do $g$ begin',
  '  if (select num_failed()) > 0 then',
  "    raise exception 'pgTAP: % teste(s) falharam', (select num_failed());",
  '  end if;',
  'end $g$;',
  'rollback;',
].join('\n');
if (!/rollback;\s*$/.test(t)) { console.error('rollback final não encontrado em', origem); process.exit(1); }
fs.writeFileSync(destino, t.replace(/rollback;\s*$/, gate));
console.log('gate injetado →', destino);
