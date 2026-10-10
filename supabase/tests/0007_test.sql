-- 0007_test.sql · pgTAP de produto_criar. Rodar DEPOIS da 0007, nas três bases.
-- Roda inteira numa transação com rollback: dados de teste não sobrevivem.
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
begin;
select plan(22);

-- ================================================================ estrutura (4)
select ok(to_regprocedure('public.produto_criar(text,numeric,uuid,text,uuid,text,text,numeric,text,boolean,boolean,numeric,uuid,numeric)') is not null,
          'produto_criar(...) criada');
select ok(has_function_privilege('service_role','public.produto_criar(text,numeric,uuid,text,uuid,text,text,numeric,text,boolean,boolean,numeric,uuid,numeric)','EXECUTE'),
          'service_role executa produto_criar');
select ok(not has_function_privilege('authenticated','public.produto_criar(text,numeric,uuid,text,uuid,text,text,numeric,text,boolean,boolean,numeric,uuid,numeric)','EXECUTE'),
          'logado NAO executa produto_criar direto');
select ok(exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'produtos' and column_name = 'criado_por'),
          'produtos ganhou a coluna criado_por');

-- ================================================================ base de teste (sem asserts)
do $$
declare
  v_tenant uuid;
  v_loja   uuid;
  v_op     uuid := gen_random_uuid();
  v_cat    uuid;
  v_p1     uuid;
  v_p2     uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_loja   from public.locais where tenant_id = v_tenant and codigo = 'loja';
  if v_tenant is null or v_loja is null then raise exception 'base de teste 0007 sem tenant/local'; end if;

  insert into auth.users (id, email) values (v_op, 'operador0007-' || v_op::text || '@adegasb.invalid');
  insert into public.profiles (id, tenant_id, nome, role)
  values (v_op, v_tenant, 'Operador 0007', 'caixa');

  insert into public.categorias (tenant_id, nome) values (v_tenant, 'Categoria Teste 0007');
  select id into v_cat from public.categorias where tenant_id = v_tenant and nome = 'Categoria Teste 0007';

  -- produto já existente: é a base do teste de código de barras duplicado
  insert into public.produtos (tenant_id, categoria_id, codigo_barras, nome, tipo, unidade, preco_varejo, criado_por)
  values (v_tenant, v_cat, '9999000000701', 'Produto 0007 Já Cadastrado', 'revenda', 'un', 9.90, v_op);

  -- p1: sem saldo inicial (produto novo "no meio da venda")
  v_p1 := public.produto_criar('Produto 0007 Sem Saldo', 12.50, v_op,
                               '9999000000711', v_cat, 'revenda', 'un', null, null,
                               false, false, null, null, null);
  -- p2: com saldo inicial na loja (entra como movimento 'entrada' auditado)
  v_p2 := public.produto_criar('Produto 0007 Com Saldo', 25.00, v_op,
                               null, v_cat, 'revenda', 'un', 350, 'ml', true, false,
                               18.00, v_loja, 5);

  perform set_config('adega.teste0007_op',  v_op::text, false);
  perform set_config('adega.teste0007_tenant', v_tenant::text, false);
  perform set_config('adega.teste0007_p1', v_p1::text, false);
  perform set_config('adega.teste0007_p2', v_p2::text, false);
end $$;

-- ================================================================ comportamento (7)
-- o id vem do RETORNO de produto_criar: se a função devolvesse um id que não é a linha gravada,
-- estes selects não achavam nada e os asserts quebravam
select is((select count(*)::int from public.produtos
            where id = (current_setting('adega.teste0007_p1'))::uuid), 1,
          'produto_criar devolve o id da linha criada');
select is((select criado_por from public.produtos where id = (current_setting('adega.teste0007_p1'))::uuid),
          (current_setting('adega.teste0007_op'))::uuid, 'criado_por = usuário que cadastrou');
select is((select tenant_id from public.produtos where id = (current_setting('adega.teste0007_p1'))::uuid),
          (current_setting('adega.teste0007_tenant'))::uuid, 'tenant vem do perfil, não do cliente');
select is((select count(*)::int from public.estoque_saldos
            where produto_id = (current_setting('adega.teste0007_p1'))::uuid), 0,
          'sem saldo inicial → nenhum saldo criado');
select is((select quantidade from public.estoque_saldos
            where produto_id = (current_setting('adega.teste0007_p2'))::uuid
              and local_id = (select id from public.locais where codigo = 'loja'
                               and tenant_id = (current_setting('adega.teste0007_tenant'))::uuid)),
          5::numeric, 'saldo inicial de 5 gravado no local informado');
select is((select count(*)::int from public.estoque_movimentos
            where produto_id = (current_setting('adega.teste0007_p2'))::uuid
              and tipo = 'entrada' and quantidade = 5
              and motivo = 'saldo inicial do cadastro rápido'), 1,
          'saldo inicial entra como movimento de ENTRADA com motivo');
select is((select count(*)::int from public.estoque_movimentos
            where produto_id = (current_setting('adega.teste0007_p2'))::uuid
              and origem_tipo = 'cadastro'), 1,
          'movimento carrega origem_tipo = cadastro (rastreabilidade)');

-- ================================================================ validações (11)
select throws_ok($$select public.produto_criar('   ', 10.00, (select id from public.profiles where nome = 'Operador 0007'))$$,
  'P0001', null, 'nome vazio é recusado');

select throws_ok($$select public.produto_criar('Produto 0007 Preço Errado', -1, (select id from public.profiles where nome = 'Operador 0007'))$$,
  'P0001', null, 'preço negativo é recusado');

select throws_ok($$select public.produto_criar('Produto 0007 Tipo Errado', 10.00, (select id from public.profiles where nome = 'Operador 0007'), null, null, 'servico')$$,
  'P0001', null, 'tipo fora de (revenda, preparado, insumo) é recusado');

select throws_ok($$select public.produto_criar('Produto 0007 Unidade Errada', 10.00, (select id from public.profiles where nome = 'Operador 0007'), null, null, 'revenda', 'unidade')$$,
  'P0001', null, 'unidade fora de (un, kg, l) é recusado');

select throws_ok($$select public.produto_criar('Produto 0007 Conteúdo Errado', 10.00, (select id from public.profiles where nome = 'Operador 0007'), null, null, 'revenda', 'un', 350, 'litro')$$,
  'P0001', null, 'unidade de conteúdo fora de (ml, g, un) é recusada');

select throws_ok($$select public.produto_criar('Produto 0007 Fumígeno', 10.00, (select id from public.profiles where nome = 'Operador 0007'), null, null, 'revenda', 'un', null, null, false, true)$$,
  'P0001', null, 'fumígeno sem classificação +18 é recusado (PR-07)');

select throws_ok(format($$select public.produto_criar('Produto 0007 EAN Duplicado', 10.00, (select id from public.profiles where nome = 'Operador 0007'), %L)$$,
  '9999000000701'),
  'P0001', null, 'código de barras já cadastrado no tenant é recusado');

select throws_ok(format($$select public.produto_criar('Produto 0007 Categoria Errada', 10.00, (select id from public.profiles where nome = 'Operador 0007'), null, %L)$$,
  gen_random_uuid()),
  'P0001', null, 'categoria de fora do tenant é recusada');

select throws_ok($$select public.produto_criar('Produto 0007 Saldo Sem Local', 10.00, (select id from public.profiles where nome = 'Operador 0007'), null, null, 'revenda', 'un', null, null, false, false, null, null, 3)$$,
  'P0001', null, 'saldo inicial sem local é recusado');

select throws_ok(format($$select public.produto_criar('Produto 0007 Local Errado', 10.00, (select id from public.profiles where nome = 'Operador 0007'), null, null, 'revenda', 'un', null, null, false, false, null, %L, 3)$$,
  gen_random_uuid()),
  'P0001', null, 'local de fora do tenant é recusado');

select throws_ok(format($$select public.produto_criar('Produto 0007 Usuário Errado', 10.00, %L)$$,
  gen_random_uuid()),
  'P0001', null, 'usuário sem perfil ativo é recusado');

select * from finish();
rollback;
