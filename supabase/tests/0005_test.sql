-- 0005_test.sql · pgTAP de mesas, comandas e copão (F4.1). Rodar DEPOIS da 0005, nas duas bases.
-- Aceite F4: comanda com 2 copões baixa 200 ml de destilado no local bar.
-- Roda inteira numa transação com rollback: dados de teste não sobrevivem.
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
begin;
select plan(40);

-- ================================================================ estrutura (11)
select ok(to_regclass('public.mesas') is not null,           'mesas criada');
select ok(to_regclass('public.mesas_status_log') is not null,'mesas_status_log criada');
select ok(to_regclass('public.comandas') is not null,        'comandas criada');
select ok(to_regclass('public.comanda_itens') is not null,   'comanda_itens criada');

select is((select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname in ('mesas','mesas_status_log','comandas','comanda_itens')
           and c.relrowsecurity), 4, 'RLS habilitado nas 4 tabelas da 0005');

select ok(has_table_privilege('service_role','public.mesas','SELECT'),        'service_role le mesas');
select ok(has_table_privilege('service_role','public.comandas','INSERT'),     'service_role cria comandas');
select ok(not has_table_privilege('authenticated','public.comandas','SELECT'),'logado NAO le comandas direto');
select ok(not has_table_privilege('service_role','public.mesas_status_log','DELETE'),
          'log de status append-only: service_role NAO deleta');

select is((select count(*)::int from (values
  ('public.mesa_abrir(uuid,uuid)'),
  ('public.mesa_transferir(uuid,uuid)'),
  ('public.mesa_dividir(uuid,uuid,uuid[])'),
  ('public.mesa_fechar(uuid)'),
  ('public.comanda_abrir(uuid,uuid)'),
  ('public.comanda_adicionar(uuid,uuid,numeric,text,boolean)'),
  ('public.comanda_fechar(uuid,uuid,text)'),
  ('public.copao_vender(uuid,uuid,numeric,uuid,text)')
) as t(sig) where to_regprocedure(t.sig) is not null), 8, '8 funções da 0005 criadas');

select is((select count(*)::int from pg_constraint
           where conname in ('mesas_comanda_fk','comandas_aberta_por_fk')
           and conrelid in ('public.mesas'::regclass, 'public.comandas'::regclass)), 2,
          'FKs mesas.comanda_id e comandas.aberta_por');

-- ================================================================ base de teste (sem asserts)
insert into public.categorias (tenant_id, nome)
select id, 'Categoria Teste 0005' from public.tenants order by criado_em limit 1;

do $$
declare
  v_tenant uuid;
  v_cat    uuid;
  v_bar    uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_cat from public.categorias where tenant_id = v_tenant and nome = 'Categoria Teste 0005';
  select id into v_bar from public.locais where tenant_id = v_tenant and codigo = 'bar';

  insert into public.produtos (tenant_id, categoria_id, sku, codigo_barras, nome, tipo, unidade,
                               conteudo, conteudo_unidade, adulto, preco_varejo, custo_medio) values
    (v_tenant, v_cat, 'T0005-W', '9999000000101', 'Whisky Teste 0005 1 L',     'revenda',   'l', 1000, 'ml', true,  100, 90),
    (v_tenant, v_cat, 'T0005-E', '9999000000102', 'Energético Teste 0005 2 L', 'revenda',   'l', 2000, 'ml', false, 15,  15),
    (v_tenant, v_cat, 'T0005-C', '9999000000103', 'Copo Teste 0005',           'revenda',   'un', null, 'un', false, 25,  25),
    (v_tenant, v_cat, 'T0005-G', '9999000000104', 'Água Teste 0005 500 ml',    'revenda',   'un', null, 'un', false, 5,   5),
    (v_tenant, v_cat, 'T0005-P', '9999000000105', 'Copão Teste 0005 700 ml',   'preparado', 'un', null, 'un', true,  30,  null);

  -- estoque no bar: whisky 5 L, energético 4 L, copo 30 un, água 20 un
  perform public.estoque_movimentar((select id from produtos where tenant_id=v_tenant and sku='T0005-W'), v_bar, 'entrada',  5, 'carga teste 0005');
  perform public.estoque_movimentar((select id from produtos where tenant_id=v_tenant and sku='T0005-E'), v_bar, 'entrada',  4, 'carga teste 0005');
  perform public.estoque_movimentar((select id from produtos where tenant_id=v_tenant and sku='T0005-C'), v_bar, 'entrada', 30, 'carga teste 0005');
  perform public.estoque_movimentar((select id from produtos where tenant_id=v_tenant and sku='T0005-G'), v_bar, 'entrada', 20, 'carga teste 0005');

  -- ficha do copão: 100 ml whisky + 200 ml energético + 1 copo por copão
  perform public.ficha_salvar(
    (select id from produtos where tenant_id=v_tenant and sku='T0005-P'), 2.5,
    jsonb_build_array(
      jsonb_build_object('produto_id', (select id from produtos where tenant_id=v_tenant and sku='T0005-W'), 'quantidade', 100, 'unidade', 'ml'),
      jsonb_build_object('produto_id', (select id from produtos where tenant_id=v_tenant and sku='T0005-E'), 'quantidade', 200, 'unidade', 'ml'),
      jsonb_build_object('produto_id', (select id from produtos where tenant_id=v_tenant and sku='T0005-C'), 'quantidade', 1,   'unidade', 'un')));

  -- 3 mesas no bar
  insert into public.mesas (tenant_id, local_id, codigo, capacidade)
  values (v_tenant, v_bar, 'M1-0005', 4),
         (v_tenant, v_bar, 'M2-0005', 4),
         (v_tenant, v_bar, 'M3-0005', 4);
end $$;

-- operador + caixa + sessão aberta no bar (uuid em runtime p/ re-executável)
do $$
declare
  v_op      uuid := gen_random_uuid();
  v_sessao  uuid;
begin
  insert into auth.users (id, email) values (v_op, 'operador0005-' || v_op::text || '@adegasb.invalid');
  insert into public.profiles (id, tenant_id, nome, role)
  select v_op, id, 'Operador 0005', 'caixa' from public.tenants order by criado_em limit 1;
  insert into public.caixas (tenant_id, local_id, nome)
  select t.id, l.id, 'Caixa Teste 0005 ' || v_op::text from public.tenants t
  join public.locais l on l.tenant_id = t.id and l.codigo = 'bar'
  order by t.criado_em limit 1;
  insert into public.caixa_sessoes (tenant_id, caixa_id, local_id, operador_id, valor_abertura)
  select c.tenant_id, c.id, c.local_id, v_op, 100
  from public.caixas c where c.nome = 'Caixa Teste 0005 ' || v_op::text;
  select id into v_sessao from public.caixa_sessoes where operador_id = v_op and status = 'aberta';
  perform set_config('adega.teste0005_sessao', v_sessao::text, false);
end $$;

-- ================================================================ abrir mesa (5)
do $$
declare
  v_tenant uuid;
  v_mesa   uuid;
  v_op     uuid;
  v_com    uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_mesa from public.mesas where tenant_id = v_tenant and codigo = 'M1-0005';
  select id into v_op from public.profiles where tenant_id = v_tenant and nome = 'Operador 0005';
  v_com := public.mesa_abrir(v_mesa, v_op);
  perform set_config('adega.teste0005_m1',   v_mesa::text, false);
  perform set_config('adega.teste0005_com1', v_com::text,  false);
end $$;

select ok((current_setting('adega.teste0005_com1'))::uuid is not null, 'mesa_abrir cria a comanda');
select is((select status from public.mesas where id = (current_setting('adega.teste0005_m1'))::uuid),
          'ocupada', 'mesa vira ocupada');
select is((select status from public.comandas where id = (current_setting('adega.teste0005_com1'))::uuid),
          'aberta', 'comanda nasce aberta');
select is((select count(*)::int from public.mesas_status_log
           where mesa_id = (current_setting('adega.teste0005_m1'))::uuid
             and antes = 'livre' and depois = 'ocupada'), 1, 'abrir registra log livre → ocupada');
select throws_ok($$select public.mesa_abrir(
  (select id from public.mesas where codigo = 'M1-0005'),
  (select id from public.profiles where nome = 'Operador 0005'))$$,
  'P0001', null, 'abrir mesa já ocupada é recusado');

-- ================================================================ adicionar itens (3)
do $$
declare
  v_tenant uuid;
  v_p      uuid;
  v_g      uuid;
  v_item   uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_p from public.produtos where tenant_id = v_tenant and sku = 'T0005-P';
  select id into v_g from public.produtos where tenant_id = v_tenant and sku = 'T0005-G';
  -- item A: 2 copões (+18 confirmado)
  v_item := public.comanda_adicionar((current_setting('adega.teste0005_com1'))::uuid, v_p, 2, 'copao', true);
  perform set_config('adega.teste0005_itemA', v_item::text, false);
  -- item B: 1 água (será movida na divisão)
  v_item := public.comanda_adicionar((current_setting('adega.teste0005_com1'))::uuid, v_g, 1, 'revenda', false);
  perform set_config('adega.teste0005_itemB', v_item::text, false);
end $$;

select is((select subtotal from public.comanda_itens
           where id = (current_setting('adega.teste0005_itemA'))::uuid), 60::numeric,
          'item A: 2 copões × R$ 30 = R$ 60 (preço vem do banco)');
select is((select total from public.comandas
           where id = (current_setting('adega.teste0005_com1'))::uuid), 65::numeric,
          'total da comanda = 60 + 5 (R$ 65)');
select throws_ok(format($$select public.comanda_adicionar(%L, %L, 1, 'copao', false)$$,
  (current_setting('adega.teste0005_com1'))::uuid,
  (select p.id from public.produtos p join public.tenants t on t.id=p.tenant_id
    where t.id=(select id from public.tenants order by criado_em limit 1) and p.sku='T0005-P')),
  'P0001', null, 'item +18 sem confirmação de idade é recusado');

-- ================================================================ mesa com comanda aberta (1)
select throws_ok(format($$select public.mesa_fechar(%L)$$,
  (current_setting('adega.teste0005_m1'))::uuid),
  'P0001', null, 'não libera a mesa com comanda aberta');

-- ================================================================ transferir (3)
do $$
declare
  v_m2 uuid;
begin
  select id into v_m2 from public.mesas where codigo = 'M2-0005';
  perform public.mesa_transferir((current_setting('adega.teste0005_m1'))::uuid, v_m2);
  perform set_config('adega.teste0005_m2', v_m2::text, false);
end $$;
select is((select mesa_id from public.comandas
           where id = (current_setting('adega.teste0005_com1'))::uuid),
          (current_setting('adega.teste0005_m2'))::uuid,
          'transferir move a comanda para a mesa destino');
select is((select count(*)::int from public.mesas
           where (id = (current_setting('adega.teste0005_m1'))::uuid and status = 'livre')
              or (id = (current_setting('adega.teste0005_m2'))::uuid and status = 'ocupada')),
          2, 'origem fica livre e destino ocupada');
-- M1 está livre depois da transferência acima → origem não ocupada é recusada
select throws_ok(format($$select public.mesa_transferir(%L, %L)$$,
  (current_setting('adega.teste0005_m1'))::uuid,
  (select id from public.mesas where codigo = 'M3-0005')),
  'P0001', null, 'transferir de mesa livre é recusado');

-- ================================================================ dividir (4)
do $$
declare
  v_m3 uuid;
  v_nova uuid;
begin
  select id into v_m3 from public.mesas where codigo = 'M3-0005';
  v_nova := public.mesa_dividir(
    (current_setting('adega.teste0005_com1'))::uuid, v_m3,
    array[(current_setting('adega.teste0005_itemB'))::uuid]);
  perform set_config('adega.teste0005_m3',   v_m3::text,  false);
  perform set_config('adega.teste0005_com2', v_nova::text, false);
end $$;
select ok((current_setting('adega.teste0005_com2'))::uuid is not null, 'dividir cria a 2ª comanda');
select is((select count(*)::int from public.comanda_itens
           where comanda_id = (current_setting('adega.teste0005_com1'))::uuid), 1,
          'dividir: comanda de origem fica com 1 item');
select is((select count(*)::int from public.comanda_itens
           where comanda_id = (current_setting('adega.teste0005_com2'))::uuid), 1,
          'dividir: comanda nova recebe 1 item');
-- com1 tem 1 item só; movê-lo inteiro deixaria a origem vazia → M1 está livre
select throws_ok(format($$select public.mesa_dividir(%L, %L, array[%L]::uuid[])$$,
  (current_setting('adega.teste0005_com1'))::uuid,
  (select id from public.mesas where codigo = 'M1-0005'),
  (current_setting('adega.teste0005_itemA'))::uuid),
  'P0001', null, 'dividir deixando a origem vazia é recusado');

-- ================================================================ fechar comanda + ACEITE F4 (6)
do $$
declare
  v_venda uuid;
begin
  v_venda := public.comanda_fechar(
    (current_setting('adega.teste0005_com1'))::uuid,
    (current_setting('adega.teste0005_sessao'))::uuid, 'pix');
  perform set_config('adega.teste0005_venda1', v_venda::text, false);
  -- comanda fechada → agora a mesa pode ser liberada
  perform public.mesa_fechar((current_setting('adega.teste0005_m2'))::uuid);
end $$;
select ok((current_setting('adega.teste0005_venda1'))::uuid is not null, 'comanda_fechar gera a venda');
select is((select canal from public.vendas
           where id = (current_setting('adega.teste0005_venda1'))::uuid), 'bar',
          'venda nasce com canal bar');
select is((select coalesce(quantidade,0) from public.estoque_saldos s
           join public.produtos p on p.id = s.produto_id
           join public.locais  l on l.id = s.local_id and l.codigo = 'bar'
           where p.sku = 'T0005-W'), 4.8,
          'ACEITE F4: 2 copões baixaram 200 ml de whisky no bar (5 → 4,8)');
select is((select count(*)::int from public.estoque_movimentos m
           join public.produtos p on p.id = m.produto_id
           where p.sku = 'T0005-W' and m.tipo = 'consumo_ficha' and m.origem_tipo = 'venda'
             and m.origem_id = (current_setting('adega.teste0005_venda1'))::uuid), 1,
          'baixa fica auditada como consumo_ficha ligada à venda');
select is((select status from public.comandas
           where id = (current_setting('adega.teste0005_com1'))::uuid), 'fechada',
          'comanda fica fechada');
select is((select status from public.mesas
           where id = (current_setting('adega.teste0005_m2'))::uuid), 'livre',
          'mesa liberada depois de fechar a comanda');

-- ================================================================ 2ª comanda (3)
do $$
declare
  v_venda uuid;
begin
  v_venda := public.comanda_fechar(
    (current_setting('adega.teste0005_com2'))::uuid,
    (current_setting('adega.teste0005_sessao'))::uuid, 'dinheiro');
  perform set_config('adega.teste0005_venda2', v_venda::text, false);
  perform public.mesa_fechar((current_setting('adega.teste0005_m3'))::uuid);
end $$;
select ok((current_setting('adega.teste0005_venda2'))::uuid is not null, '2ª comanda também fecha');
select is((select status from public.comandas
           where id = (current_setting('adega.teste0005_com2'))::uuid), 'fechada',
          '2ª comanda fica fechada');
select is((select status from public.mesas
           where id = (current_setting('adega.teste0005_m3'))::uuid), 'livre',
          'mesa M3 liberada');

-- ================================================================ copao_vender direto (3)
do $$
declare
  v_venda uuid;
begin
  v_venda := public.copao_vender(
    (select p.id from public.produtos p join public.tenants t on t.id=p.tenant_id
      where t.id=(select id from public.tenants order by criado_em limit 1) and p.sku='T0005-P'),
    (select l.id from public.locais l join public.tenants t on t.id=l.tenant_id
      where t.id=(select id from public.tenants order by criado_em limit 1) and l.codigo='bar'),
    1, (current_setting('adega.teste0005_sessao'))::uuid, 'cartao');
  perform set_config('adega.teste0005_venda3', v_venda::text, false);
end $$;
select ok((current_setting('adega.teste0005_venda3'))::uuid is not null, 'copao_vender direto gera a venda');
select is((select coalesce(quantidade,0) from public.estoque_saldos s
           join public.produtos p on p.id = s.produto_id
           join public.locais  l on l.id = s.local_id and l.codigo = 'bar'
           where p.sku = 'T0005-W'), 4.7,
          '1 copão extra baixa mais 100 ml (4,8 → 4,7)');
select throws_ok(format($$select public.copao_vender(%L, %L, 1, %L, 'pix')$$,
  (select p.id from public.produtos p join public.tenants t on t.id=p.tenant_id
    where t.id=(select id from public.tenants order by criado_em limit 1) and p.sku='T0005-W'),
  (select l.id from public.locais l join public.tenants t on t.id=l.tenant_id
    where t.id=(select id from public.tenants order by criado_em limit 1) and l.codigo='bar'),
  (current_setting('adega.teste0005_sessao'))::uuid),
  'P0001', null, 'copao_vender recusa produto que não é preparado');

-- ================================================================ comanda fechada (1)
select throws_ok(format($$select public.comanda_adicionar(%L, %L, 1, 'revenda', false)$$,
  (current_setting('adega.teste0005_com1'))::uuid,
  (select p.id from public.produtos p join public.tenants t on t.id=p.tenant_id
    where t.id=(select id from public.tenants order by criado_em limit 1) and p.sku='T0005-G')),
  'P0001', null, 'adicionar item em comanda fechada é recusado');

select * from finish();
rollback;
