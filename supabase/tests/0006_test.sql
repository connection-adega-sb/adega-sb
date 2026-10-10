-- 0006_test.sql · pgTAP de comanda_remover_item. Rodar DEPOIS da 0006, nas duas bases.
-- Roda inteira numa transação com rollback: dados de teste não sobrevivem.
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
begin;
select plan(12);

-- ================================================================ estrutura (2)
select ok(to_regprocedure('public.comanda_remover_item(uuid)') is not null, 'comanda_remover_item(uuid) criada');
select ok(has_function_privilege('service_role','public.comanda_remover_item(uuid)','EXECUTE'),
          'service_role executa comanda_remover_item');
select ok(not has_function_privilege('authenticated','public.comanda_remover_item(uuid)','EXECUTE'),
          'logado NAO executa comanda_remover_item direto');

-- ================================================================ base de teste (sem asserts)
do $$
declare
  v_tenant uuid;
  v_loja   uuid;
  v_p      uuid;
  v_mesa   uuid;
  v_op     uuid := gen_random_uuid();
  v_com    uuid;
  v_item1  uuid;
  v_item2  uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_loja from public.locais where tenant_id = v_tenant and codigo = 'loja';

  insert into public.categorias (tenant_id, nome)
  values (v_tenant, 'Categoria Teste 0006');
  insert into public.produtos (tenant_id, categoria_id, sku, codigo_barras, nome, tipo, unidade,
                               adulto, preco_varejo)
  select v_tenant, id, 'T0006-A', '9999000000201', 'Item A Teste 0006', 'revenda', 'un', false, 10.00
    from public.categorias where tenant_id = v_tenant and nome = 'Categoria Teste 0006';
  insert into public.produtos (tenant_id, categoria_id, sku, codigo_barras, nome, tipo, unidade,
                               adulto, preco_varejo)
  select v_tenant, id, 'T0006-B', '9999000000202', 'Item B Teste 0006', 'revenda', 'un', false, 25.00
    from public.categorias where tenant_id = v_tenant and nome = 'Categoria Teste 0006';
  select id into v_p from public.produtos where tenant_id = v_tenant and sku = 'T0006-A';
  -- estoque na loja: o comanda_fechar baixa o item revenda via estoque_movimentar (recusa negativo)
  perform public.estoque_movimentar(v_p, v_loja, 'entrada', 10, 'carga teste 0006');

  insert into public.mesas (tenant_id, local_id, codigo, capacidade)
  values (v_tenant, v_loja, 'M1-0006', 4) returning id into v_mesa;

  insert into auth.users (id, email) values (v_op, 'operador0006-' || v_op::text || '@adegasb.invalid');
  insert into public.profiles (id, tenant_id, nome, role)
  values (v_op, v_tenant, 'Operador 0006', 'caixa');
  insert into public.caixas (tenant_id, local_id, nome)
  values (v_tenant, v_loja, 'Caixa Teste 0006 ' || v_op::text);
  insert into public.caixa_sessoes (tenant_id, caixa_id, local_id, operador_id, valor_abertura)
  select c.tenant_id, c.id, c.local_id, v_op, 100
    from public.caixas c where c.nome = 'Caixa Teste 0006 ' || v_op::text;

  v_com := public.mesa_abrir(v_mesa, v_op);
  perform set_config('adega.teste0006_comanda', v_com::text, false);
  perform set_config('adega.teste0006_loja',     v_loja::text, false);

  -- 2 itens: A 10,00 × 1 = 10,00 · B 25,00 × 2 = 50,00 → total 60,00
  v_item1 := public.comanda_adicionar(v_com, (select id from public.produtos where tenant_id = v_tenant and sku = 'T0006-A'), 1, 'revenda', false);
  v_item2 := public.comanda_adicionar(v_com, (select id from public.produtos where tenant_id = v_tenant and sku = 'T0006-B'), 2, 'revenda', false);
  perform set_config('adega.teste0006_itemA', v_item1::text, false);
  perform set_config('adega.teste0006_itemB', v_item2::text, false);
end $$;

-- ================================================================ comportamento (6)
select is((select total from public.comandas where id = (current_setting('adega.teste0006_comanda'))::uuid),
          60::numeric, 'baseline: total da comanda = 10 + 50 = 60');
select is((select count(*)::int from public.comanda_itens
           where comanda_id = (current_setting('adega.teste0006_comanda'))::uuid), 2,
          'baseline: 2 itens na comanda');

select is(public.comanda_remover_item((current_setting('adega.teste0006_itemB'))::uuid), 10::numeric,
          'remover item B devolve o novo total (60 → 10)');
select is((select count(*)::int from public.comanda_itens
           where comanda_id = (current_setting('adega.teste0006_comanda'))::uuid), 1,
          'item B sai da comanda');
select is((select total from public.comandas where id = (current_setting('adega.teste0006_comanda'))::uuid),
          10::numeric, 'comandas.total fica 10 (não só o retorno)');

-- remover o último item zera a comanda (estado válido: comanda aberta vazia não fatura)
select is(public.comanda_remover_item((current_setting('adega.teste0006_itemA'))::uuid), 0::numeric,
          'remover o último item zera o total');

select throws_ok(format($$select public.comanda_remover_item(%L)$$,
  (current_setting('adega.teste0006_itemA'))::uuid),
  'P0001', null, 'remover item já removido é recusado');

select throws_ok($$select public.comanda_remover_item('00000000-0000-0000-0000-000000000000')$$,
  'P0001', null, 'item inexistente é recusado');

-- ================================================================ comanda fechada (1)
do $$
declare
  v_sessao uuid;
begin
  -- recoloca um item e fecha a comanda para provar o bloqueio de pós-fechamento
  perform public.comanda_adicionar(
    (current_setting('adega.teste0006_comanda'))::uuid,
    (select p.id from public.produtos p where p.sku = 'T0006-A'), 1, 'revenda', false);
  select id into v_sessao from public.caixa_sessoes where status = 'aberta'
    and operador_id = (select id from public.profiles where nome = 'Operador 0006');
  perform public.comanda_fechar((current_setting('adega.teste0006_comanda'))::uuid, v_sessao, 'dinheiro');
  -- guarda o item criado para o assert de bloqueio
  perform set_config('adega.teste0006_itemFechado',
    (select id from public.comanda_itens
      where comanda_id = (current_setting('adega.teste0006_comanda'))::uuid limit 1)::text, false);
end $$;

select throws_ok(format($$select public.comanda_remover_item(%L)$$,
  (current_setting('adega.teste0006_itemFechado'))::uuid),
  'P0001', null, 'remover item de comanda fechada é recusado');

select * from finish();
rollback;
