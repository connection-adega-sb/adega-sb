-- 0001_test.sql · pgTAP da migration 0001_acesso · rodar nas DUAS bases DEPOIS da 0002 (permissões).
-- psql "$env:SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0001_test.sql
-- Gate: "# Looks like you failed 0 tests" ausente e todas as linhas "ok". Tudo dentro de transação com rollback.
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

begin;
select plan(27);

-- 1-5 · tabelas
select has_table('public', 'tenants', 'tenants existe');
select has_table('public', 'locais', 'locais existe');
select has_table('public', 'profiles', 'profiles existe');
select has_table('public', 'profile_locais', 'profile_locais existe');
select has_table('public', 'audit_log', 'audit_log existe');

-- 6-10 · RLS ligada em todas
select ok((select relrowsecurity from pg_class where oid = 'public.tenants'::regclass), 'RLS em tenants');
select ok((select relrowsecurity from pg_class where oid = 'public.locais'::regclass), 'RLS em locais');
select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'RLS em profiles');
select ok((select relrowsecurity from pg_class where oid = 'public.profile_locais'::regclass), 'RLS em profile_locais');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass), 'RLS em audit_log');

-- 11-13 · só as policies previstas (deny-all no resto)
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'profiles'), 1, 'profiles: 1 policy (lê o próprio)');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'profile_locais'), 1, 'profile_locais: 1 policy (lê os próprios)');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('tenants', 'locais', 'audit_log')), 0, 'tenants/locais/audit_log: nenhuma policy');

-- 14-15 · dados-base
select is((select count(*)::int from public.tenants where cnpj = '43.466.024/0001-43'), 1, 'tenant ADEGA SB criado');
select is((select count(*)::int from public.locais l join public.tenants t on t.id = l.tenant_id
           where t.cnpj = '43.466.024/0001-43' and l.codigo in ('loja', 'bar', 'deposito')), 3, '3 locais: loja, bar, depósito');

-- 16-17 · CHECKs de domínio
select throws_ok($$insert into public.locais (tenant_id, codigo, nome, tipo)
                   select id, 'x', 'X', 'cozinha' from public.tenants limit 1$$, '23514', null, 'tipo de local fora da lista é recusado');
select throws_ok($$insert into public.tenants (nome, cnpj) values ('T', '123')$$, '23514', null, 'CNPJ em formato inválido é recusado');

-- usuários de teste (auth.users) e perfis
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'teste-master@adegasb.invalid'),
  ('00000000-0000-4000-8000-0000000000a2', 'teste-caixa@adegasb.invalid');

-- 18-19 · perfil válido entra; papel inválido não
select lives_ok($$insert into public.profiles (id, tenant_id, nome, role)
                  select '00000000-0000-4000-8000-0000000000a1', id, 'Master Teste', 'master'
                  from public.tenants where cnpj = '43.466.024/0001-43'$$, 'perfil master é criado');
select throws_ok($$insert into public.profiles (id, tenant_id, nome, role)
                   select '00000000-0000-4000-8000-0000000000a2', id, 'X', 'dono'
                   from public.tenants where cnpj = '43.466.024/0001-43'$$, '23514', null, 'papel fora da lista é recusado');

insert into public.profiles (id, tenant_id, nome, role)
select '00000000-0000-4000-8000-0000000000a2', id, 'Caixa Teste', 'caixa' from public.tenants where cnpj = '43.466.024/0001-43';
insert into public.profile_locais (profile_id, local_id, tenant_id)
select '00000000-0000-4000-8000-0000000000a2', l.id, l.tenant_id from public.locais l
join public.tenants t on t.id = l.tenant_id where t.cnpj = '43.466.024/0001-43' and l.codigo = 'loja';

-- 20-22 · auditoria append-only
select ok((select count(*) from public.audit_log where tabela = 'profiles' and acao = 'insert') >= 2, 'insert em profiles gera audit_log');
update public.profiles set nome = 'Caixa Teste 2' where id = '00000000-0000-4000-8000-0000000000a2';
select ok((select count(*) from public.audit_log where tabela = 'profiles' and acao = 'update'
           and antes ->> 'nome' = 'Caixa Teste' and depois ->> 'nome' = 'Caixa Teste 2') = 1, 'update guarda antes/depois');
select throws_ok($$delete from public.audit_log$$, '42501', null, 'audit_log não aceita delete');

-- 23-26 · RLS na prática
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select is((select count(*)::int from public.profiles), 1, 'autenticado vê só o próprio perfil');
select is((select count(*)::int from public.profile_locais), 1, 'autenticado vê só os próprios locais');
select throws_ok('select count(*) from public.tenants', '42501', null, 'autenticado não lê tenants (sem GRANT, 0002)');
reset role;
set local role anon;
select throws_ok('select count(*) from public.profiles', '42501', null, 'anônimo não lê perfis (sem GRANT, 0002)');
reset role;

-- 27 · cascade: apagar o usuário apaga perfil e vínculos
delete from auth.users where id = '00000000-0000-4000-8000-0000000000a2';
select is((select count(*)::int from public.profiles where id = '00000000-0000-4000-8000-0000000000a2'), 0, 'apagar auth.users apaga o perfil (cascade)');

select * from finish();
rollback;
