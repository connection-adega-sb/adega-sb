-- 0011_test.sql · pgTAP da "Conta de cliente" no PDV. Rodar DEPOIS da 0011, nas três bases.
-- Roda inteira numa transação com rollback: dados de teste não sobrevivem.
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
begin;
select plan(24);

-- ================================================================ estrutura e permissões (5)
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'comandas' and column_name = 'nome'),
          'comandas ganhou nome');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'comandas' and column_name = 'origem'),
          'comandas ganhou origem (bar | pdv)');
select ok(not has_function_privilege('authenticated', 'public.conta_pagar_parte(uuid,uuid,text,uuid[],numeric[],boolean,uuid,text)', 'EXECUTE'),
          'logado NAO executa conta_pagar_parte direto');
select ok(not has_function_privilege('anon', 'public.conta_abrir(uuid,uuid,text,uuid)', 'EXECUTE'), 'anônimo NAO executa conta_abrir');
select ok(has_function_privilege('service_role', 'public.conta_ajustar_item(uuid,numeric)', 'EXECUTE'), 'servidor executa conta_ajustar_item');

-- ================================================================ base de teste (sem asserts)
-- Grupo do Carlos: 10 cervejas (R$ 5), 3 caipirinhas (R$ 15), 5 doses de whisky (R$ 18) = R$ 185
do $$
declare
  v_tenant uuid; v_loja uuid; v_op uuid := gen_random_uuid(); v_caixa uuid; v_sess uuid;
  v_cerv uuid; v_caip uuid; v_whis uuid; v_conta uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_loja from public.locais where tenant_id = v_tenant and codigo = 'loja';
  if v_tenant is null or v_loja is null then raise exception 'base de teste 0011 sem tenant/local'; end if;
  insert into auth.users (id, email) values (v_op, 'caixa0011-' || v_op::text || '@adegasb.invalid');
  insert into public.profiles (id, tenant_id, nome, role) values (v_op, v_tenant, 'Caixa 0011', 'caixa');
  insert into public.produtos (tenant_id, nome, preco_varejo, codigo_barras, adulto) values
    (v_tenant, 'Cerveja 0011', 5, '9999000001101', true) returning id into v_cerv;
  insert into public.produtos (tenant_id, nome, preco_varejo, codigo_barras, adulto) values
    (v_tenant, 'Caipirinha 0011', 15, '9999000001102', true) returning id into v_caip;
  insert into public.produtos (tenant_id, nome, preco_varejo, codigo_barras, adulto) values
    (v_tenant, 'Whisky dose 0011', 18, '9999000001103', true) returning id into v_whis;
  perform public.estoque_movimentar(v_cerv, v_loja, 'entrada', 100, 'carga teste 0011');
  perform public.estoque_movimentar(v_caip, v_loja, 'entrada', 100, 'carga teste 0011');
  perform public.estoque_movimentar(v_whis, v_loja, 'entrada', 100, 'carga teste 0011');
  insert into public.caixas (tenant_id, local_id, nome) values (v_tenant, v_loja, 'Caixa Teste 0011 ' || v_op::text) returning id into v_caixa;
  insert into public.caixa_sessoes (tenant_id, caixa_id, local_id, operador_id, valor_abertura)
  values (v_tenant, v_caixa, v_loja, v_op, 50) returning id into v_sess;

  v_conta := public.conta_abrir(v_sess, v_op, '  Grupo   do Carlos ');
  perform public.comanda_adicionar(v_conta, v_cerv, 10, 'revenda', true);
  perform public.comanda_adicionar(v_conta, v_caip, 3, 'revenda', true);
  perform public.comanda_adicionar(v_conta, v_whis, 5, 'revenda', true);

  perform set_config('adega.t11_op', v_op::text, false);
  perform set_config('adega.t11_sess', v_sess::text, false);
  perform set_config('adega.t11_conta', v_conta::text, false);
  perform set_config('adega.t11_loja', v_loja::text, false);
  perform set_config('adega.t11_cerv', v_cerv::text, false);
  perform set_config('adega.t11_i_cerv', (select id::text from public.comanda_itens where comanda_id = v_conta and produto_id = v_cerv), false);
  perform set_config('adega.t11_i_caip', (select id::text from public.comanda_itens where comanda_id = v_conta and produto_id = v_caip), false);
  perform set_config('adega.t11_i_whis', (select id::text from public.comanda_itens where comanda_id = v_conta and produto_id = v_whis), false);
end $$;

-- ================================================================ abrir (4)
select is((select nome || '|' || origem from public.comandas where id = current_setting('adega.t11_conta')::uuid),
          'Grupo do Carlos|pdv', 'conta aberta com o nome limpo e origem pdv');
select is((select total from public.comandas where id = current_setting('adega.t11_conta')::uuid), 185.00::numeric(12,2),
          'conta soma R$ 185,00 (10×5 + 3×15 + 5×18)');
select throws_ok(format($$select public.conta_abrir(%L, %L, 'grupo do carlos')$$, current_setting('adega.t11_sess'), current_setting('adega.t11_op')),
  'P0001', 'já existe uma conta aberta com o nome grupo do carlos', 'nome repetido (sem diferença de maiúscula) é recusado');
select throws_ok(format($$select public.conta_abrir(%L, %L, '   ')$$, current_setting('adega.t11_sess'), current_setting('adega.t11_op')),
  'P0001', 'informe o nome da conta', 'conta sem nome é recusada');

-- ================================================================ dividir por itens (11)
-- Carlos: 5 cervejas + 1 caipirinha + 3 whiskys = 94
select set_config('adega.t11_v1', public.conta_pagar_parte(
  current_setting('adega.t11_conta')::uuid, current_setting('adega.t11_sess')::uuid, 'pix',
  array[current_setting('adega.t11_i_cerv'), current_setting('adega.t11_i_caip'), current_setting('adega.t11_i_whis')]::uuid[],
  array[5, 1, 3]::numeric[], true, null, '381.604.927-31')::text, false);
select is((select total from public.vendas where id = current_setting('adega.t11_v1')::uuid), 94.00::numeric(12,2), 'Carlos paga R$ 94,00 no PIX');
select is((select cpf from public.vendas where id = current_setting('adega.t11_v1')::uuid), '38160492731', 'CPF na nota gravado na venda do Carlos');
select is((select total from public.comandas where id = current_setting('adega.t11_conta')::uuid), 91.00::numeric(12,2), 'conta fica com R$ 91,00');
select is((select quantidade from public.comanda_itens where id = current_setting('adega.t11_i_cerv')::uuid), 5.000::numeric(12,3), 'sobram 5 cervejas na conta');
select throws_ok(format($$select public.conta_pagar_parte(%L, %L, 'pix', array[%L]::uuid[], array[6]::numeric[], true)$$,
  current_setting('adega.t11_conta'), current_setting('adega.t11_sess'), current_setting('adega.t11_i_cerv')),
  'P0001', null, 'pagar mais cerveja do que tem na conta é recusado');
select throws_ok(format($$select public.conta_pagar_parte(%L, %L, 'credito', array[%L]::uuid[], array[1]::numeric[], true)$$,
  current_setting('adega.t11_conta'), current_setting('adega.t11_sess'), current_setting('adega.t11_i_cerv')),
  'P0001', 'venda no crédito exige cliente identificado', 'crédito sem cliente é recusado na conta também');
select throws_ok(format($$select public.conta_pagar_parte(%L, %L, 'pix', array[%L]::uuid[], array[1]::numeric[], false)$$,
  current_setting('adega.t11_conta'), current_setting('adega.t11_sess'), current_setting('adega.t11_i_cerv')),
  'P0001', 'item +18: confirme que o cliente é maior de 18 anos', '+18 sem confirmação é recusado');
-- João: 3 cervejas + 2 caipirinhas + 2 whiskys = 81 (cartão)
select set_config('adega.t11_v2', public.conta_pagar_parte(
  current_setting('adega.t11_conta')::uuid, current_setting('adega.t11_sess')::uuid, 'cartao',
  array[current_setting('adega.t11_i_cerv'), current_setting('adega.t11_i_caip'), current_setting('adega.t11_i_whis')]::uuid[],
  array[3, 2, 2]::numeric[], true)::text, false);
select is((select total || '|' || forma_pagamento from public.vendas where id = current_setting('adega.t11_v2')::uuid), '81.00|cartao', 'João paga R$ 81,00 no cartão');
-- Pedro: 2 cervejas = 10 (dinheiro) → a conta fecha sozinha
select set_config('adega.t11_v3', public.conta_pagar_parte(
  current_setting('adega.t11_conta')::uuid, current_setting('adega.t11_sess')::uuid, 'dinheiro',
  array[current_setting('adega.t11_i_cerv')]::uuid[], array[2]::numeric[], true)::text, false);
select is((select total from public.vendas where id = current_setting('adega.t11_v3')::uuid), 10.00::numeric(12,2), 'Pedro paga R$ 10,00 em dinheiro');
select is((select status from public.comandas where id = current_setting('adega.t11_conta')::uuid), 'fechada', 'sem item sobrando, a conta fecha sozinha');
select is((select quantidade from public.estoque_saldos where produto_id = current_setting('adega.t11_cerv')::uuid
            and local_id = current_setting('adega.t11_loja')::uuid), 90.000::numeric(12,3), 'estoque da cerveja baixou 10 (100 → 90)');

-- ================================================================ dividir igual + ajustar (4)
do $$
declare v_c uuid;
begin
  v_c := public.conta_abrir(current_setting('adega.t11_sess')::uuid, current_setting('adega.t11_op')::uuid, 'Seu Zé');
  perform public.comanda_adicionar(v_c, current_setting('adega.t11_cerv')::uuid, 4, 'revenda', true);
  perform set_config('adega.t11_c2', v_c::text, false);
  perform set_config('adega.t11_c2i', (select id::text from public.comanda_itens where comanda_id = v_c), false);
end $$;
select is(public.conta_ajustar_item(current_setting('adega.t11_c2i')::uuid, 3), 15.00::numeric, 'ajustar de 4 para 3 cervejas → R$ 15,00');
-- 3 cervejas ÷ 2 pessoas = 1,5 cada
select lives_ok(format($$select public.conta_pagar_parte(%L, %L, 'pix', array[%L]::uuid[], array[1.5]::numeric[], true)$$,
  current_setting('adega.t11_c2'), current_setting('adega.t11_sess'), current_setting('adega.t11_c2i')), 'dividir igual: 1ª pessoa paga 1,5 cerveja');
select lives_ok(format($$select public.conta_pagar_parte(%L, %L, 'pix', array[%L]::uuid[], array[1.5]::numeric[], true)$$,
  current_setting('adega.t11_c2'), current_setting('adega.t11_sess'), current_setting('adega.t11_c2i')), 'dividir igual: 2ª pessoa paga 1,5 cerveja');
select is((select status from public.comandas where id = current_setting('adega.t11_c2')::uuid), 'fechada', 'dividir igual fecha a conta');

select * from finish();
rollback;
