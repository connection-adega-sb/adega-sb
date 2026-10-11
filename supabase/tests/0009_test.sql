-- 0009_test.sql · pgTAP de crédito (conta do cliente) + produto_atualizar. Rodar DEPOIS da 0009, nas três bases.
-- Roda inteira numa transação com rollback: dados de teste não sobrevivem.
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
begin;
select plan(32);

-- ================================================================ estrutura e permissões (8)
select ok(to_regclass('public.credito_pagamentos') is not null, 'tabela credito_pagamentos criada');
select ok(exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'clientes' and column_name = 'limite_credito'),
          'clientes ganhou limite_credito');
select ok((select relrowsecurity from pg_class where oid = 'public.credito_pagamentos'::regclass), 'RLS ligada em credito_pagamentos');
select ok(not has_table_privilege('authenticated', 'public.credito_pagamentos', 'SELECT'), 'logado NAO le credito_pagamentos direto');
select ok(not has_table_privilege('service_role', 'public.credito_pagamentos', 'UPDATE'), 'pagamentos são append-only (sem UPDATE nem para o servidor)');
select ok(not has_function_privilege('authenticated', 'public.credito_receber(uuid,uuid,numeric,text,text)', 'EXECUTE'),
          'logado NAO executa credito_receber direto');
select ok(not has_function_privilege('authenticated', 'public.produto_atualizar(uuid,uuid,text,numeric,text,uuid,boolean,boolean,boolean)', 'EXECUTE'),
          'logado NAO executa produto_atualizar direto');
select ok(exists (select 1 from pg_trigger where tgname = 'vendas_credito_cliente' and tgdeferrable and tginitdeferred),
          'trigger adiado "crédito exige cliente" existe em vendas');

-- ================================================================ base de teste (sem asserts)
do $$
declare
  v_tenant uuid;
  v_loja   uuid;
  v_op     uuid := gen_random_uuid();   -- caixa com sessão aberta
  v_ger    uuid := gen_random_uuid();   -- gerente sem caixa aberto
  v_est    uuid := gen_random_uuid();   -- estoquista
  v_c1     uuid;
  v_c2     uuid;
  v_prod   uuid;
  v_prod2  uuid;
  v_sessao uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_loja   from public.locais where tenant_id = v_tenant and codigo = 'loja';
  if v_tenant is null or v_loja is null then raise exception 'base de teste 0009 sem tenant/local'; end if;

  insert into auth.users (id, email) values
    (v_op,  'caixa0009-'  || v_op::text  || '@adegasb.invalid'),
    (v_ger, 'gerente0009-' || v_ger::text || '@adegasb.invalid'),
    (v_est, 'estoque0009-' || v_est::text || '@adegasb.invalid');
  insert into public.profiles (id, tenant_id, nome, role) values
    (v_op,  v_tenant, 'Caixa 0009', 'caixa'),
    (v_ger, v_tenant, 'Gerente 0009', 'gerente'),
    (v_est, v_tenant, 'Estoquista 0009', 'estoquista');

  v_c1 := public.cliente_salvar(v_op, 'Cliente Credito 0009 Sem Limite');
  v_c2 := public.cliente_salvar(v_op, 'Cliente Credito 0009 Com Limite');
  perform public.cliente_definir_limite(v_ger, v_c2, 15);

  insert into public.produtos (tenant_id, nome, tipo, unidade, preco_varejo, codigo_barras)
  values (v_tenant, 'Produto Teste 0009', 'revenda', 'un', 10, '9999000000901') returning id into v_prod;
  insert into public.produtos (tenant_id, nome, tipo, unidade, preco_varejo, codigo_barras)
  values (v_tenant, 'Produto Teste 0009 B', 'revenda', 'un', 5, '9999000000902') returning id into v_prod2;
  perform public.estoque_movimentar(v_prod, v_loja, 'entrada', 50, 'carga teste 0009');

  insert into public.caixas (tenant_id, local_id, nome) values (v_tenant, v_loja, 'Caixa Teste 0009 ' || v_op::text);
  insert into public.caixa_sessoes (tenant_id, caixa_id, local_id, operador_id, valor_abertura)
  select v_tenant, c.id, v_loja, v_op, 50 from public.caixas c where c.nome = 'Caixa Teste 0009 ' || v_op::text
  returning id into v_sessao;

  perform set_config('adega.t9_op', v_op::text, false);
  perform set_config('adega.t9_ger', v_ger::text, false);
  perform set_config('adega.t9_est', v_est::text, false);
  perform set_config('adega.t9_c1', v_c1::text, false);
  perform set_config('adega.t9_c2', v_c2::text, false);
  perform set_config('adega.t9_prod', v_prod::text, false);
  perform set_config('adega.t9_prod2', v_prod2::text, false);
  perform set_config('adega.t9_sessao', v_sessao::text, false);
  -- venda no crédito do c1: 2 × R$ 10 = R$ 20 em aberto
  perform set_config('adega.t9_v1', public.finalizar_venda_pdv_cliente(
    v_sessao, 'credito', array[v_prod], array[2]::numeric[], 0, false, v_c1)::text, false);
  -- venda no crédito do c2 dentro do limite (10 ≤ 15)
  perform public.finalizar_venda_pdv_cliente(v_sessao, 'credito', array[v_prod], array[1]::numeric[], 0, false, v_c2);
  -- venda comum em dinheiro segue igual
  perform set_config('adega.t9_v3', public.finalizar_venda_pdv_cliente(
    v_sessao, 'dinheiro', array[v_prod], array[1]::numeric[], 0, false, null)::text, false);
end $$;

-- ================================================================ venda no crédito (7)
select is((select forma_pagamento || '|' || cliente_id::text from public.vendas where id = current_setting('adega.t9_v1')::uuid),
          'credito|' || current_setting('adega.t9_c1'), 'venda no crédito gravada com forma credito e o cliente');
select is(public.cliente_saldo_credito(current_setting('adega.t9_c1')::uuid), 20.00::numeric, 'saldo em aberto do cliente = R$ 20');
select is((select forma_pagamento || '|' || coalesce(cliente_id::text, 'sem') from public.vendas where id = current_setting('adega.t9_v3')::uuid),
          'dinheiro|sem', 'venda comum em dinheiro sem cliente segue funcionando');
select throws_ok(format($$select public.finalizar_venda_pdv_cliente(%L, 'credito', array[%L]::uuid[], array[1]::numeric[], 0, false, null)$$,
  current_setting('adega.t9_sessao'), current_setting('adega.t9_prod')),
  'P0001', null, 'crédito sem cliente é recusado');
set constraints vendas_credito_cliente immediate;
select throws_ok(format($$select public.finalizar_venda_pdv(%L, 'credito', array[%L]::uuid[], array[1]::numeric[])$$,
  current_setting('adega.t9_sessao'), current_setting('adega.t9_prod')),
  'P0001', null, 'mesmo chamando a função base direto, crédito sem cliente é barrado no banco');
set constraints vendas_credito_cliente deferred;
select throws_ok(format($$select public.finalizar_venda_pdv_cliente(%L, 'credito', array[%L]::uuid[], array[1]::numeric[], 0, false, %L)$$,
  current_setting('adega.t9_sessao'), current_setting('adega.t9_prod'), current_setting('adega.t9_c2')),
  'P0001', null, 'venda que passa do limite de crédito (10 + 10 > 15) é recusada');
select is(public.cliente_saldo_credito(current_setting('adega.t9_c2')::uuid), 10.00::numeric,
          'venda recusada por limite não deixa rastro no saldo');

-- ================================================================ limite (3)
select is((select limite_credito from public.clientes where id = current_setting('adega.t9_c2')::uuid), 15.00::numeric,
          'gerente define limite de R$ 15');
select throws_ok(format($$select public.cliente_definir_limite(%L, %L, 100)$$,
  current_setting('adega.t9_op'), current_setting('adega.t9_c2')),
  'P0001', null, 'caixa NAO define limite de crédito');
select throws_ok(format($$select public.cliente_definir_limite(%L, %L, -1)$$,
  current_setting('adega.t9_ger'), current_setting('adega.t9_c2')),
  'P0001', null, 'limite negativo é recusado');

-- ================================================================ recebimento (9)
do $$ begin
  perform public.credito_receber(current_setting('adega.t9_op')::uuid, current_setting('adega.t9_c1')::uuid, 4, 'pix', 'adiantou');
  perform set_config('adega.t9_pg_din', public.credito_receber(current_setting('adega.t9_op')::uuid,
    current_setting('adega.t9_c1')::uuid, 6, 'dinheiro')::text, false);
end $$;
select is(public.cliente_saldo_credito(current_setting('adega.t9_c1')::uuid), 10.00::numeric,
          'PIX R$ 4 + dinheiro R$ 6 baixam o saldo de 20 para 10');
select ok((select caixa_movimento_id is not null and caixa_sessao_id = current_setting('adega.t9_sessao')::uuid
             from public.credito_pagamentos where id = current_setting('adega.t9_pg_din')::uuid),
          'recebimento em dinheiro fica ligado à sessão de caixa do operador');
select is((select m.tipo || '|' || m.valor::text || '|' || m.motivo from public.caixa_movimentos m
             join public.credito_pagamentos p on p.caixa_movimento_id = m.id
            where p.id = current_setting('adega.t9_pg_din')::uuid),
          'suprimento|6.00|recebimento de crédito · Cliente Credito 0009 Sem Limite',
          'dinheiro recebido entra na gaveta como suprimento "recebimento de crédito"');
select throws_ok(format($$select public.credito_receber(%L, %L, 50, 'pix')$$,
  current_setting('adega.t9_op'), current_setting('adega.t9_c1')),
  'P0001', null, 'receber mais que o saldo em aberto é recusado');
select throws_ok(format($$select public.credito_receber(%L, %L, 0, 'pix')$$,
  current_setting('adega.t9_op'), current_setting('adega.t9_c1')),
  'P0001', null, 'receber zero é recusado');
select throws_ok(format($$select public.credito_receber(%L, %L, 1, 'dinheiro')$$,
  current_setting('adega.t9_ger'), current_setting('adega.t9_c1')),
  'P0001', null, 'dinheiro sem o caixa do operador aberto é recusado');
select throws_ok(format($$select public.credito_receber(%L, %L, 1, 'boleto')$$,
  current_setting('adega.t9_op'), current_setting('adega.t9_c1')),
  'P0001', null, 'forma de recebimento fora de PIX/cartão/dinheiro é recusada');
select throws_ok(format($$select public.credito_receber(%L, %L, 1, 'pix')$$,
  current_setting('adega.t9_op'), gen_random_uuid()),
  'P0001', null, 'cliente inexistente é recusado no recebimento');
select throws_ok($$update public.credito_pagamentos set valor = 1$$,
  '42501', null, 'pagamento registrado não pode ser alterado (append-only)');

-- ================================================================ auditoria (1)
select ok((select count(*) from public.audit_log
            where tabela = 'credito_pagamentos' and registro_id = current_setting('adega.t9_pg_din') and acao = 'insert') = 1,
          'recebimento grava audit_log');

-- ================================================================ produto_atualizar (4)
do $$ begin
  perform public.produto_atualizar(current_setting('adega.t9_est')::uuid, current_setting('adega.t9_prod2')::uuid,
    '  Produto Teste 0009 B Editado ', 6.5, '9999000000903', null, true, false, false);
end $$;
select is((select nome || '|' || preco_varejo::text || '|' || codigo_barras || '|' || adulto::text || '|' || ativo::text
             from public.produtos where id = current_setting('adega.t9_prod2')::uuid),
          'Produto Teste 0009 B Editado|6.50|9999000000903|true|false',
          'estoquista edita nome, preço, código, +18 e desativa o produto');
select throws_ok(format($$select public.produto_atualizar(%L, %L, 'X', 1)$$,
  current_setting('adega.t9_op'), current_setting('adega.t9_prod2')),
  'P0001', null, 'caixa NAO edita produto (só cadastra)');
select throws_ok(format($$select public.produto_atualizar(%L, %L, 'Produto Teste 0009 B', 5, '9999000000901')$$,
  current_setting('adega.t9_est'), current_setting('adega.t9_prod2')),
  'P0001', null, 'código de barras de outro produto é recusado');
select throws_ok(format($$select public.produto_atualizar(%L, %L, 'Produto Teste 0009 B', 5, null, null, false, true)$$,
  current_setting('adega.t9_est'), current_setting('adega.t9_prod2')),
  'P0001', null, 'fumígeno sem +18 é recusado na edição');

select * from finish();
rollback;
