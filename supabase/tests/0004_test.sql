-- 0004_test.sql · pgTAP do catálogo + estoque profundo. Rodar DEPOIS da 0004, nas duas bases.
-- Nota: has_table() do pgTAP é um TESTE (não boolean). Aqui usamos to_regclass p/ envolver em ok().
-- Roda inteira numa transação com rollback: dados de teste não sobrevivem.
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
begin;
select plan(40);

-- Tabelas existem (7)
select ok(to_regclass('public.transferencias') is not null,          'transferencias criada');
select ok(to_regclass('public.transferencia_itens') is not null,     'transferencia_itens criada');
select ok(to_regclass('public.inventarios') is not null,             'inventarios criada');
select ok(to_regclass('public.inventario_itens') is not null,        'inventario_itens criada');
select ok(to_regclass('public.fichas_tecnicas') is not null,         'fichas_tecnicas criada');
select ok(to_regclass('public.fichas_tecnicas_insumos') is not null, 'fichas_tecnicas_insumos criada');
select ok(to_regclass('public.fichas_tecnicas_historico') is not null,'fichas_tecnicas_historico criada');

-- RLS ligado deny-all nas 7 novas (1)
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname in ('transferencias','transferencia_itens','inventarios',
           'inventario_itens','fichas_tecnicas','fichas_tecnicas_insumos','fichas_tecnicas_historico')
           and c.relrowsecurity), 7, 'RLS habilitado nas 7 tabelas da 0004');

-- Grants mínimos (4)
select ok(has_table_privilege('service_role','public.transferencias','SELECT'),        'service_role le transferencias');
select ok(has_table_privilege('service_role','public.inventarios','INSERT'),           'service_role cria inventarios');
select ok(not has_table_privilege('authenticated','public.fichas_tecnicas','SELECT'),  'logado NAO le fichas direto');
select ok(not has_table_privilege('service_role','public.fichas_tecnicas_historico','DELETE'),
          'historico append-only: service_role NAO deleta');

-- Funções existem (1): as 13 da 0004
select is((select count(*)::int from (values
  ('public.transferencia_criar(uuid,uuid,uuid[],numeric[],text)'),
  ('public.transferencia_enviar(uuid)'),
  ('public.transferencia_receber(uuid,uuid[],numeric[])'),
  ('public.transferencia_cancelar(uuid,text)'),
  ('public.inventario_abrir(uuid,uuid)'),
  ('public.inventario_fechar(uuid)'),
  ('public.inventario_aprovar(uuid)'),
  ('public.inventario_cancelar(uuid,text)'),
  ('public.ficha_salvar(uuid,numeric,jsonb)'),
  ('public.ficha_cmv(uuid)'),
  ('public.ficha_aplicar_preco(uuid)'),
  ('public.ficha_consumir(uuid,uuid,numeric,text,uuid)'),
  ('public.copoes_disponiveis(uuid)')
) as t(sig) where to_regprocedure(t.sig) is not null), 13, '13 funções da 0004 criadas');

-- CHECKs e colunas novos (3)
select is((select count(*)::int from pg_constraint
           where conname in ('produtos_fumigeno_revenda','produtos_conteudo_positivo')
           and conrelid='public.produtos'::regclass), 2, 'CHECKs fumigeno_revenda e conteudo_positivo em produtos');
select is((select count(*)::int from pg_constraint
           where conname='estoque_saldos_minimo_ok' and conrelid='public.estoque_saldos'::regclass), 1,
          'CHECK minimo >= 0 em estoque_saldos');

-- ================================================================ base de teste (rollback no fim)
insert into public.categorias (tenant_id, nome)
select id, 'Categoria Teste 0004' from public.tenants order by criado_em limit 1;
-- (categoria acima garante filtro de inventário; produtos de teste abaixo)
do $$
declare
  v_tenant uuid;
  v_cat    uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_cat from public.categorias where tenant_id = v_tenant and nome = 'Categoria Teste 0004';
  insert into public.produtos (tenant_id, categoria_id, sku, codigo_barras, nome, tipo, unidade, conteudo, conteudo_unidade,
                               adulto, preco_varejo, custo_medio) values
    (v_tenant, v_cat, 'T0004-W', '9999000000001', 'Whisky Teste 1 L',      'revenda', 'l', 1000, 'ml', true,  100, 90),
    (v_tenant, v_cat, 'T0004-E', '9999000000002', 'Energético Teste 2 L',  'revenda', 'l', 2000, 'ml', false,  15,  15),
    (v_tenant, v_cat, 'T0004-C', '9999000000003', 'Copo Teste 50 un',       'revenda', 'un',  50, 'un', false,  25,  25),
    (v_tenant, v_cat, 'T0004-P', '9999000000004', 'Copão Teste 700 ml',     'preparado','un', null, null, true,  30, null),
    (v_tenant, v_cat, 'T0004-I', '9999000000005', 'Produto Inventário Teste','revenda','un', null, null, false,  10, null),
    (v_tenant, v_cat, 'T0004-F', '9999000000006', 'Cigarro Teste',          'revenda', 'un', null, null, true,   12, null);
  update public.produtos set fumigeno = true where tenant_id = v_tenant and sku = 'T0004-F';
end $$;

-- estoque de teste: whisky/energético/copo no depósito (transferência) e no bar (fichas);
-- produto de inventário na loja com 7 un.
do $$
declare
  v_tenant uuid;
  v_dep    uuid;
  v_bar    uuid;
  v_loja   uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_dep  from public.locais where tenant_id = v_tenant and codigo = 'deposito';
  select id into v_bar  from public.locais where tenant_id = v_tenant and codigo = 'bar';
  select id into v_loja from public.locais where tenant_id = v_tenant and codigo = 'loja';
  perform public.estoque_movimentar((select id from produtos where tenant_id=v_tenant and sku='T0004-W'), v_dep, 'entrada', 10, 'carga teste 0004');
  perform public.estoque_movimentar((select id from produtos where tenant_id=v_tenant and sku='T0004-E'), v_dep, 'entrada',  4, 'carga teste 0004');
  perform public.estoque_movimentar((select id from produtos where tenant_id=v_tenant and sku='T0004-W'), v_bar, 'entrada',  5, 'carga teste 0004');
  perform public.estoque_movimentar((select id from produtos where tenant_id=v_tenant and sku='T0004-E'), v_bar, 'entrada',  2, 'carga teste 0004');
  perform public.estoque_movimentar((select id from produtos where tenant_id=v_tenant and sku='T0004-C'), v_bar, 'entrada', 30, 'carga teste 0004');
  perform public.estoque_movimentar((select id from produtos where tenant_id=v_tenant and sku='T0004-I'), v_loja,'entrada',  7, 'carga teste 0004');
end $$;

-- ================================================================ transferência (7)
do $$
declare
  v_tenant uuid;
  v_dep    uuid;
  v_loja   uuid;
  v_w      uuid;
  v_trans  uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_dep  from public.locais where tenant_id = v_tenant and codigo = 'deposito';
  select id into v_loja from public.locais where tenant_id = v_tenant and codigo = 'loja';
  select id into v_w    from public.produtos where tenant_id = v_tenant and sku = 'T0004-W';
  v_trans := public.transferencia_criar(v_dep, v_loja, array[v_w], array[10]::numeric[], 'envio teste');
  perform set_config('adega.teste0004_trans', v_trans::text, false);
end $$;

select ok((select id is not null from public.transferencias
           where id = (current_setting('adega.teste0004_trans'))::uuid), 'transferência criada em rascunho');
select is((select status from public.transferencias where id = (current_setting('adega.teste0004_trans'))::uuid),
          'rascunho', 'status inicial é rascunho');

select public.transferencia_enviar((current_setting('adega.teste0004_trans'))::uuid);
select is((select coalesce(s.quantidade,0) from public.estoque_saldos s
           join public.produtos p on p.id = s.produto_id
           where p.sku = 'T0004-W' and s.local_id = (select l.id from public.locais l join public.tenants t on t.id=l.tenant_id
             where t.id = p.tenant_id and l.codigo = 'deposito')), 0::numeric, 'enviar baixa o saldo na origem');
select is((select status from public.transferencias where id = (current_setting('adega.teste0004_trans'))::uuid),
          'enviada', 'status vira enviada');

-- receber com divergência: 10 enviados, 8 contados → perda de 2 auditada, destino fica com 8
select public.transferencia_receber((current_setting('adega.teste0004_trans'))::uuid,
  array[(select p.id from public.produtos p join public.tenants t on t.id=p.tenant_id
         where t.id=(select id from public.tenants order by criado_em limit 1) and p.sku='T0004-W')],
  array[8]::numeric[]);
select is((select count(*)::int from public.estoque_movimentos m
           join public.produtos p on p.id = m.produto_id
           where p.sku = 'T0004-W' and m.tipo = 'perda' and m.quantidade = -2), 1,
          'divergência no recebimento vira perda auditada (-2)');
select is((select coalesce(quantidade,0) from public.estoque_saldos s
           join public.produtos p on p.id = s.produto_id
           join public.locais l on l.id = s.local_id and l.codigo = 'loja'
           where p.sku = 'T0004-W'), 8::numeric, 'destino fica com o contado (8)');
select is((select status from public.transferencias where id = (current_setting('adega.teste0004_trans'))::uuid),
          'recebida', 'status vira recebida');

-- 2ª transferência: receber mais do que foi enviado é recusado
do $$
declare
  v_tenant uuid; v_dep uuid; v_loja uuid; v_w uuid; v_trans uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_dep  from public.locais where tenant_id = v_tenant and codigo = 'deposito';
  select id into v_loja from public.locais where tenant_id = v_tenant and codigo = 'loja';
  select id into v_w    from public.produtos where tenant_id = v_tenant and sku = 'T0004-E';
  v_trans := public.transferencia_criar(v_dep, v_loja, array[v_w], array[4]::numeric[], 'envio teste 2');
  perform public.transferencia_enviar(v_trans);
  perform set_config('adega.teste0004_trans2', v_trans::text, false);
end $$;
select throws_ok($$select public.transferencia_receber(
  (current_setting('adega.teste0004_trans2'))::uuid,
  array[(select p.id from public.produtos p join public.tenants t on t.id=p.tenant_id
         where t.id=(select id from public.tenants order by criado_em limit 1) and p.sku='T0004-E')],
  array[99]::numeric[])$$, 'P0001', null, 'receber mais que enviado é recusado');

-- ================================================================ inventário cego (5)
do $$
declare
  v_tenant uuid; v_loja uuid; v_inv uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_loja from public.locais where tenant_id = v_tenant and codigo = 'loja';
  v_inv := public.inventario_abrir(v_loja, null);
  perform set_config('adega.teste0004_inv', v_inv::text, false);
end $$;
select is((select count(*)::int from public.inventario_itens
           where inventario_id = (current_setting('adega.teste0004_inv'))::uuid
           and produto_id = (select p.id from public.produtos p join public.tenants t on t.id=p.tenant_id
             where t.id=(select id from public.tenants order by criado_em limit 1) and p.sku='T0004-I')), 1,
          'abrir inventário inclui o produto com saldo no local');
select is((select contado from public.inventario_itens
           where inventario_id = (current_setting('adega.teste0004_inv'))::uuid
           and produto_id = (select p.id from public.produtos p join public.tenants t on t.id=p.tenant_id
             where t.id=(select id from public.tenants order by criado_em limit 1) and p.sku='T0004-I')),
          null, 'cego: contado começa null (a UI nunca mostra saldo)');

update public.inventario_itens set contado = 5
  where inventario_id = (current_setting('adega.teste0004_inv'))::uuid
  and produto_id = (select p.id from public.produtos p join public.tenants t on t.id=p.tenant_id
    where t.id=(select id from public.tenants order by criado_em limit 1) and p.sku='T0004-I');
select public.inventario_fechar((current_setting('adega.teste0004_inv'))::uuid);
select is((select saldo_no_fechamento from public.inventario_itens
           where inventario_id = (current_setting('adega.teste0004_inv'))::uuid
           and produto_id = (select p.id from public.produtos p join public.tenants t on t.id=p.tenant_id
             where t.id=(select id from public.tenants order by criado_em limit 1) and p.sku='T0004-I')),
          7::numeric, 'fechar congela o saldo_no_fechamento (7)');

select public.inventario_aprovar((current_setting('adega.teste0004_inv'))::uuid);
select is((select coalesce(quantidade,0) from public.estoque_saldos s
           join public.produtos p on p.id = s.produto_id
           where p.sku = 'T0004-I' and s.local_id = (select l.id from public.locais l join public.tenants t on t.id=l.tenant_id
             where t.id = p.tenant_id and l.codigo = 'loja')), 5::numeric, 'aprovar ajusta o saldo para o contado (5)');
select is((select status from public.inventarios where id = (current_setting('adega.teste0004_inv'))::uuid),
          'aprovado', 'status vira aprovado');

-- ================================================================ fichas do copão (8)
do $$
declare
  v_tenant uuid; v_p uuid; v_w uuid; v_e uuid; v_c uuid; v_f uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_p from public.produtos where tenant_id = v_tenant and sku = 'T0004-P';
  select id into v_w from public.produtos where tenant_id = v_tenant and sku = 'T0004-W';
  select id into v_e from public.produtos where tenant_id = v_tenant and sku = 'T0004-E';
  select id into v_c from public.produtos where tenant_id = v_tenant and sku = 'T0004-C';
  v_f := public.ficha_salvar(v_p, 2.5, jsonb_build_array(
    jsonb_build_object('produto_id', v_w, 'quantidade', 100, 'unidade', 'ml'),
    jsonb_build_object('produto_id', v_e, 'quantidade', 400, 'unidade', 'ml'),
    jsonb_build_object('produto_id', v_c, 'quantidade', 1,   'unidade', 'un')));
  perform set_config('adega.teste0004_ficha', v_f::text, false);
  perform set_config('adega.teste0004_prod', v_p::text, false);
end $$;
select ok((current_setting('adega.teste0004_ficha'))::uuid is not null, 'ficha salva (3 insumos: 100 ml + 400 ml + 1 un)');

-- PR-01: CMV = 90/1000*100 + 15/2000*400 + 25/50*1 = 9 + 3 + 0,50 = 12,50
select is(public.ficha_cmv((current_setting('adega.teste0004_prod'))::uuid), 12.50, 'CMV do copo = R$ 12,50 (PR-01)');

-- PR-02/PR-03: aplicar no PDV → preço = CMV × markup arredondado no múltiplo de 5 e custo = CMV
select is(public.ficha_aplicar_preco((current_setting('adega.teste0004_prod'))::uuid), 30::numeric,
          'preço aplicado = R$ 30,00 (12,50 × 2,5 = 31,25 → múltiplo de 5 mais próximo)');
select is((select preco_varejo from public.produtos where id = (current_setting('adega.teste0004_prod'))::uuid), 30::numeric,
          'preço de venda gravado no produto');
select is((select custo_medio from public.produtos where id = (current_setting('adega.teste0004_prod'))::uuid), 12.50,
          'custo (CMV) gravado no produto');
select is((select count(*)::int from public.fichas_tecnicas_historico
           where ficha_id = (current_setting('adega.teste0004_ficha'))::uuid), 2,
          'ficha salva + aplicar preço = 2 linhas de histórico (PR-03)');

-- PR-07: fumígeno nunca entra em ficha (nem como preparado)
select throws_ok($$select public.ficha_salvar(
  (select p.id from public.produtos p join public.tenants t on t.id=p.tenant_id
    where t.id=(select id from public.tenants order by criado_em limit 1) and p.sku='T0004-F'), 2.5,
  jsonb_build_array(jsonb_build_object('produto_id',
    (select p.id from public.produtos p join public.tenants t on t.id=p.tenant_id
      where t.id=(select id from public.tenants order by criado_em limit 1) and p.sku='T0004-C'),
    'quantidade', 1, 'unidade', 'un')))$$, 'P0001', null, 'fumígeno não vira ficha');

-- copões disponíveis no bar: min(5÷0,1 ; 2÷0,2 ; 30÷1) = min(50;10;30) = 10
select is((select disponiveis from public.copoes_disponiveis(
             (select l.id from public.locais l join public.tenants t on t.id=l.tenant_id
              where t.id=(select id from public.tenants order by criado_em limit 1) and l.codigo='bar'))
           where sku = 'T0004-P'), 10, 'copões disponíveis no bar = 10 (limitado pelo energético)');

-- consumir 1 copo no bar: whisky 5 → 4,9 (0,1 L = 100 ml)
select public.ficha_consumir((current_setting('adega.teste0004_prod'))::uuid,
  (select l.id from public.locais l join public.tenants t on t.id=l.tenant_id
   where t.id=(select id from public.tenants order by criado_em limit 1) and l.codigo='bar'),
  1, 'teste', null);
select is((select coalesce(quantidade,0) from public.estoque_saldos s
           join public.produtos p on p.id = s.produto_id
           join public.locais l on l.id = s.local_id and l.codigo = 'bar'
           where p.sku = 'T0004-W'), 4.9, 'ficha_consumir baixa o insumo no local (5 → 4,9)');

-- ================================================================ venda PDV de preparado consome insumos, não o produto (3)
-- (uuid de operador gerado em runtime: teste precisa ser re-executável)
do $$
declare
  v_op uuid := gen_random_uuid();
  v_sessao uuid;
  v_p      uuid;
  v_venda  uuid;
begin
  insert into auth.users (id, email) values (v_op, 'operador0004-' || v_op::text || '@adegasb.invalid');
  insert into public.profiles (id, tenant_id, nome, role)
  select v_op, id, 'Operador 0004', 'caixa' from public.tenants order by criado_em limit 1;
  insert into public.caixas (tenant_id, local_id, nome)
  select t.id, l.id, 'Caixa Teste 0004 ' || v_op::text from public.tenants t
  join public.locais l on l.tenant_id = t.id and l.codigo = 'bar'
  order by t.criado_em limit 1;
  insert into public.caixa_sessoes (tenant_id, caixa_id, local_id, operador_id, valor_abertura)
  select c.tenant_id, c.id, c.local_id, v_op, 100
  from public.caixas c where c.nome = 'Caixa Teste 0004 ' || v_op::text;

  select id into v_sessao from public.caixa_sessoes where operador_id = v_op and status = 'aberta';
  select id into v_p from public.produtos where sku = 'T0004-P';
  v_venda := public.finalizar_venda_pdv(v_sessao, 'pix', array[v_p], array[2]::numeric[], 0, null, true);
  perform set_config('adega.teste0004_venda', v_venda::text, false);
end $$;
select ok((current_setting('adega.teste0004_venda'))::uuid is not null, 'venda de 2 copões finalizada (caixa aberto)');
select is((select coalesce(sum(quantidade),0) from public.estoque_saldos
           where produto_id = (current_setting('adega.teste0004_prod'))::uuid), 0::numeric,
          'preparado sem estoque próprio: saldo do produto segue 0 (baixa é nos insumos)');
select is((select coalesce(quantidade,0) from public.estoque_saldos s
           join public.produtos p on p.id = s.produto_id
           join public.locais l on l.id = s.local_id and l.codigo = 'bar'
           where p.sku = 'T0004-W'), 4.7, 'venda de 2 copões baixou 0,2 L de whisky no bar (4,9 → 4,7)');

select * from finish();
rollback;
