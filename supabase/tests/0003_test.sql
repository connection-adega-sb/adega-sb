-- 0003_test.sql - pgTAP do PDV + catálogo. Rodar depois da 0003, nas duas bases.
-- Nota: has_table() do pgTAP é um TESTE (não boolean). Aqui usamos to_regclass p/ envolver em ok().
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
begin;
select plan(18);

-- Tabelas existem (9)
select ok(to_regclass('public.categorias') is not null,        'categorias criada');
select ok(to_regclass('public.produtos') is not null,          'produtos criada');
select ok(to_regclass('public.estoque_saldos') is not null,    'estoque_saldos criada');
select ok(to_regclass('public.estoque_movimentos') is not null,'estoque_movimentos criada');
select ok(to_regclass('public.caixas') is not null,            'caixas criada');
select ok(to_regclass('public.caixa_sessoes') is not null,     'caixa_sessoes criada');
select ok(to_regclass('public.caixa_movimentos') is not null,  'caixa_movimentos criada');
select ok(to_regclass('public.vendas') is not null,            'vendas criada');
select ok(to_regclass('public.venda_itens') is not null,       'venda_itens criada');

-- RLS ligado deny-all em todas as de negócio (1)
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname in ('categorias','produtos','estoque_saldos','estoque_movimentos',
           'caixas','caixa_sessoes','caixa_movimentos','vendas','venda_itens') and c.relrowsecurity), 9,
          'RLS habilitado nas 9 tabelas');

-- Grants mínimos (4)
select ok(has_table_privilege('service_role','public.produtos','SELECT'),   'service_role le produtos');
select ok(has_table_privilege('service_role','public.vendas','INSERT'),     'service_role cria vendas');
select ok(not has_table_privilege('authenticated','public.produtos','SELECT'), 'logado NAO le produtos direto');
select ok(not has_table_privilege('anon','public.vendas','SELECT'),         'anonimo NAO le vendas');

-- Índice de busca por nome (trigram) do PDV (1)
select ok(to_regclass('public.produtos_nome_trgm') is not null, 'indice trigram em produtos.nome');

-- Funções existem (2)
select ok(to_regprocedure('public.estoque_movimentar(uuid,uuid,text,numeric,text,text,uuid,numeric)') is not null,
          'estoque_movimentar criada');
select ok(to_regprocedure('public.finalizar_venda_pdv(uuid,text,uuid[],numeric[],numeric,text,boolean)') is not null,
          'finalizar_venda_pdv criada');

-- CHECK da migration 0003 (fumigeno => adulto e nao fracionado) (1)
select is((select count(*)::int from pg_constraint
           where conname='produtos_check' and conrelid='public.produtos'::regclass), 1,
          'CHECK fumigeno presente em produtos');

select * from finish();
rollback;
