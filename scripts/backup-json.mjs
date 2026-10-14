// backup-json.mjs · cópia de segurança dos DADOS (todas as tabelas do sistema) em um arquivo .json, sem Docker.
// Uso (PowerShell, na pasta do staging):
//   PRODUÇÃO: node --env-file=C:\Projetos\adega-sb\.env.local scripts/backup-json.mjs
//   STAGING:  node --env-file=.env.local scripts/backup-json.mjs
// Grava em ..\adega-sb-docs\backups\<banco>-AAAA-MM-DD_HHMM.json. O arquivo tem dados de clientes (CPF, telefone):
// fica só no seu computador, nunca em e-mail, chat ou git.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL, CHAVE = process.env.SUPABASE_SECRET_KEY;
if (!URL_SB || !CHAVE) { console.error('Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY no --env-file.'); process.exit(1); }
const db = createClient(URL_SB, CHAVE, { auth: { persistSession: false } });
const banco = new URL(URL_SB).hostname.split('.')[0];
const TABELAS = ['tenants', 'locais', 'profiles', 'profile_locais', 'categorias', 'produtos', 'estoque_saldos', 'estoque_movimentos',
  'caixas', 'caixa_sessoes', 'caixa_movimentos', 'vendas', 'venda_itens', 'transferencias', 'transferencia_itens', 'inventarios',
  'inventario_itens', 'fichas_tecnicas', 'fichas_tecnicas_insumos', 'fichas_tecnicas_historico', 'mesas', 'mesas_status_log',
  'comandas', 'comanda_itens', 'clientes', 'credito_pagamentos', 'audit_log'];

const copia = { banco, gerado_em: new Date().toISOString(), tabelas: {} };
for (const t of TABELAS) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db.from(t).select('*').range(de, de + 999);
    if (error) { console.error(`ERRO ao ler ${t}: ${error.message}`); process.exit(1); }
    linhas.push(...data);
    if (data.length < 1000) break;
  }
  copia.tabelas[t] = linhas;
  console.log(`  ${t.padEnd(26)} ${linhas.length}`);
}
const pasta = path.resolve(process.cwd(), '..', 'adega-sb-docs', 'backups');
fs.mkdirSync(pasta, { recursive: true });
const agora = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16).replace('T', '_').replace(':', '');
const arq = path.join(pasta, `${banco}-${agora}.json`);
fs.writeFileSync(arq, JSON.stringify(copia));
console.log(`\nBACKUP OK: ${arq} (${(fs.statSync(arq).size / 1024).toFixed(0)} KB)`);
