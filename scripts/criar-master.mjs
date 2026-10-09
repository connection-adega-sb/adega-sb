// Cria o PRIMEIRO usuário master (Fase 1). Senha gerada e exibida UMA vez; trocar no 1º acesso.
// Uso (PowerShell, na pasta do projeto): node --env-file=.env.local scripts/criar-master.mjs email@dominio "Nome Completo"
import { randomInt } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const [email, nome] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, chave = process.env.SUPABASE_SECRET_KEY;
if (!email || !nome) { console.error('Uso: node --env-file=.env.local scripts/criar-master.mjs email "Nome"'); process.exit(1); }
if (!url || !chave) { console.error('Faltam NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SECRET_KEY no .env.local'); process.exit(1); }
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789#@%';
const senha = Array.from({ length: 16 }, () => A[randomInt(A.length)]).join('');
const sb = createClient(url, chave, { auth: { persistSession: false } });
const { data: t, error: et } = await sb.from('tenants').select('id').eq('cnpj', '43.466.024/0001-43').single();
if (et) { console.error('Não foi possível ler o tenant ADEGA SB:', et.message, et.code ? `(${et.code})` : ''); console.error('Confira: 0001 e 0002 aplicadas neste banco e SUPABASE_SECRET_KEY do MESMO projeto no .env.local.'); process.exit(1); }
const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'master');
if (count) { console.error(`Já existe ${count} master. Crie os próximos usuários pela tela /admin/usuarios.`); process.exit(1); }
const { data: u, error } = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true });
if (error) { console.error('Falha ao criar usuário:', error.message); process.exit(1); }
const { error: ep } = await sb.from('profiles').insert({ id: u.user.id, tenant_id: t.id, nome, role: 'master' });
if (ep) { await sb.auth.admin.deleteUser(u.user.id); console.error('Falha ao gravar perfil (usuário desfeito):', ep.message); process.exit(1); }
console.log(`Master criado: ${email}`);
console.log(`Senha inicial (anote AGORA, não será mostrada de novo): ${senha}`);
