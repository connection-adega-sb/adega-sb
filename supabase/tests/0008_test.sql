-- 0008_test.sql · pgTAP de clientes + cliente na venda do PDV. Rodar DEPOIS da 0008, nas três bases.
-- Roda inteira numa transação com rollback: dados de teste não sobrevivem.
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
begin;
select plan(30);

-- ================================================================ estrutura e permissões (7)
select ok(to_regclass('public.clientes') is not null, 'tabela clientes criada');
select ok(exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'vendas' and column_name = 'cliente_id'),
          'vendas ganhou a coluna cliente_id');
select ok((select relrowsecurity from pg_class where oid = 'public.clientes'::regclass), 'RLS ligada em clientes');
select ok(not has_table_privilege('authenticated', 'public.clientes', 'SELECT'), 'logado NAO le clientes direto');
select ok(has_function_privilege('service_role', 'public.cliente_salvar(uuid,text,text,text,text,text,uuid)', 'EXECUTE'),
          'service_role executa cliente_salvar');
select ok(not has_function_privilege('authenticated', 'public.cliente_salvar(uuid,text,text,text,text,text,uuid)', 'EXECUTE'),
          'logado NAO executa cliente_salvar direto');
select ok(not has_function_privilege('authenticated', 'public.finalizar_venda_pdv_cliente(uuid,text,uuid[],numeric[],numeric,boolean,uuid)', 'EXECUTE'),
          'logado NAO executa finalizar_venda_pdv_cliente direto');

-- ================================================================ CPF (3)
select ok(public.cpf_valido('529.982.247-25'), 'CPF válido com máscara é aceito');
select ok(not public.cpf_valido('529.982.247-24'), 'CPF com dígito verificador errado é recusado');
select ok(not public.cpf_valido('111.111.111-11'), 'CPF de dígitos repetidos é recusado');

-- ================================================================ base de teste (sem asserts)
do $$
declare
  v_tenant uuid;
  v_loja   uuid;
  v_op     uuid := gen_random_uuid();
  v_c1     uuid;
  v_c2     uuid;
  v_prod   uuid;
  v_sessao uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_loja   from public.locais where tenant_id = v_tenant and codigo = 'loja';
  if v_tenant is null or v_loja is null then raise exception 'base de teste 0008 sem tenant/local'; end if;

  insert into auth.users (id, email) values (v_op, 'operador0008-' || v_op::text || '@adegasb.invalid');
  insert into public.profiles (id, tenant_id, nome, role) values (v_op, v_tenant, 'Operador 0008', 'caixa');

  -- c1: dados "sujos" de propósito (espaços, máscara) → a função normaliza
  v_c1 := public.cliente_salvar(v_op, '  Maria   Teste 0008 ', '(11) 98888-0008', '529.982.247-25',
                                'Maria0008@Email.com', 'prefere cerveja gelada');
  -- c2: só o nome (telefone e CPF são opcionais)
  v_c2 := public.cliente_salvar(v_op, 'José Teste 0008');
  -- edição de c2 pelo mesmo caminho (p_id)
  perform public.cliente_salvar(v_op, 'José Teste 0008 Editado', '11 3333-0008', null, null, null, v_c2);

  -- venda: produto com saldo na loja + caixa aberto
  insert into public.produtos (tenant_id, nome, tipo, unidade, preco_varejo)
  values (v_tenant, 'Produto Teste 0008', 'revenda', 'un', 10) returning id into v_prod;
  perform public.estoque_movimentar(v_prod, v_loja, 'entrada', 10, 'carga teste 0008');
  insert into public.caixas (tenant_id, local_id, nome) values (v_tenant, v_loja, 'Caixa Teste 0008 ' || v_op::text);
  insert into public.caixa_sessoes (tenant_id, caixa_id, local_id, operador_id, valor_abertura)
  select v_tenant, c.id, v_loja, v_op, 50 from public.caixas c where c.nome = 'Caixa Teste 0008 ' || v_op::text
  returning id into v_sessao;

  perform set_config('adega.t8_op', v_op::text, false);
  perform set_config('adega.t8_tenant', v_tenant::text, false);
  perform set_config('adega.t8_c1', v_c1::text, false);
  perform set_config('adega.t8_c2', v_c2::text, false);
  perform set_config('adega.t8_prod', v_prod::text, false);
  perform set_config('adega.t8_sessao', v_sessao::text, false);
  perform set_config('adega.t8_v1', public.finalizar_venda_pdv_cliente(
    v_sessao, 'pix', array[v_prod], array[1]::numeric[], 0, false, v_c1)::text, false);
  perform set_config('adega.t8_v2', public.finalizar_venda_pdv_cliente(
    v_sessao, 'dinheiro', array[v_prod], array[1]::numeric[], 0, false, null)::text, false);
end $$;

-- ================================================================ cadastro (7)
select is((select nome from public.clientes where id = current_setting('adega.t8_c1')::uuid),
          'Maria Teste 0008', 'nome normalizado (trim + espaços únicos)');
select is((select telefone from public.clientes where id = current_setting('adega.t8_c1')::uuid),
          '11988880008', 'telefone gravado só com dígitos');
select is((select cpf from public.clientes where id = current_setting('adega.t8_c1')::uuid),
          '52998224725', 'CPF gravado só com dígitos');
select is((select tenant_id from public.clientes where id = current_setting('adega.t8_c1')::uuid),
          current_setting('adega.t8_tenant')::uuid, 'tenant vem do perfil, não do navegador');
select is((select criado_por from public.clientes where id = current_setting('adega.t8_c1')::uuid),
          current_setting('adega.t8_op')::uuid, 'criado_por = usuário que cadastrou');
select is((select nome || '|' || telefone from public.clientes where id = current_setting('adega.t8_c2')::uuid),
          'José Teste 0008 Editado|1133330008', 'edição por p_id atualiza nome e telefone');
select is((select count(*)::int from public.audit_log
            where tabela = 'clientes' and registro_id = current_setting('adega.t8_c1') and acao = 'insert'), 1,
          'cadastro grava audit_log');

-- ================================================================ recusas (8)
select throws_ok($$select public.cliente_salvar((select id from public.profiles where nome = 'Operador 0008'), '   ')$$,
  'P0001', null, 'nome vazio é recusado');
select throws_ok($$select public.cliente_salvar((select id from public.profiles where nome = 'Operador 0008'), 'Teste Fone', '1234')$$,
  'P0001', null, 'telefone sem DDD é recusado');
select throws_ok($$select public.cliente_salvar((select id from public.profiles where nome = 'Operador 0008'), 'Teste CPF', null, '529.982.247-24')$$,
  'P0001', null, 'CPF inválido é recusado');
select throws_ok($$select public.cliente_salvar((select id from public.profiles where nome = 'Operador 0008'), 'Teste Email', null, null, 'sem-arroba')$$,
  'P0001', null, 'e-mail inválido é recusado');
select throws_ok($$select public.cliente_salvar((select id from public.profiles where nome = 'Operador 0008'), 'Outra Pessoa', '11988880008')$$,
  'P0001', null, 'telefone já cadastrado é recusado');
select throws_ok($$select public.cliente_salvar((select id from public.profiles where nome = 'Operador 0008'), 'Outra Pessoa', null, '52998224725')$$,
  'P0001', null, 'CPF já cadastrado é recusado');
select throws_ok(format($$select public.cliente_salvar(%L, 'Sem Perfil')$$, gen_random_uuid()),
  'P0001', null, 'usuário sem perfil ativo é recusado');
select throws_ok(format($$select public.cliente_salvar((select id from public.profiles where nome = 'Operador 0008'), 'Fantasma', null, null, null, null, %L)$$,
  gen_random_uuid()),
  'P0001', null, 'editar cliente inexistente é recusado');

-- ================================================================ venda com cliente (5)
select is((select cliente_id from public.vendas where id = current_setting('adega.t8_v1')::uuid),
          current_setting('adega.t8_c1')::uuid, 'venda com cliente grava vendas.cliente_id');
select is((select cpf from public.vendas where id = current_setting('adega.t8_v1')::uuid),
          '52998224725', 'CPF do cadastro vai para vendas.cpf (CPF na nota)');
select ok((select cliente_id is null from public.vendas where id = current_setting('adega.t8_v2')::uuid),
          'venda sem cliente segue funcionando (cliente_id nulo)');

do $$ begin
  perform public.cliente_definir_ativo(current_setting('adega.t8_op')::uuid, current_setting('adega.t8_c1')::uuid, false);
end $$;
select throws_ok(format($$select public.finalizar_venda_pdv_cliente(%L, 'pix', array[%L]::uuid[], array[1]::numeric[], 0, false, %L)$$,
  current_setting('adega.t8_sessao'), current_setting('adega.t8_prod'), current_setting('adega.t8_c1')),
  'P0001', null, 'cliente desativado não entra em venda nova');
select throws_ok(format($$select public.finalizar_venda_pdv_cliente(%L, 'pix', array[%L]::uuid[], array[1]::numeric[], 0, false, %L)$$,
  current_setting('adega.t8_sessao'), current_setting('adega.t8_prod'), gen_random_uuid()),
  'P0001', null, 'cliente inexistente é recusado na venda');

select * from finish();
rollback;
