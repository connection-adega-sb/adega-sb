-- 0012_test.sql · pgTAP da venda com estoque negativo. Rodar DEPOIS da 0012, nas três bases.
-- Roda inteira numa transação com rollback: dados de teste não sobrevivem.
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
begin;
select plan(8);

do $$
declare v_tenant uuid; v_loja uuid; v_p uuid;
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  select id into v_loja from public.locais where tenant_id = v_tenant and codigo = 'loja';
  if v_tenant is null or v_loja is null then raise exception 'base de teste 0012 sem tenant/local'; end if;
  -- começa do padrão: sem a chave = permitido
  update public.tenants set config = config #- '{estoque,permitir_negativo}' where id = v_tenant;
  insert into public.produtos (tenant_id, nome, preco_varejo, codigo_barras) values
    (v_tenant, 'Agua 0012', 3, '9999000001201') returning id into v_p;
  perform set_config('adega.t12_tenant', v_tenant::text, false);
  perform set_config('adega.t12_loja', v_loja::text, false);
  perform set_config('adega.t12_p', v_p::text, false);
end $$;

-- padrão (sem configuração): venda passa e o saldo fica negativo
select lives_ok(format($$select public.estoque_movimentar(%L, %L, 'saida_venda', -2, 'teste 0012')$$,
  current_setting('adega.t12_p'), current_setting('adega.t12_loja')), 'venda com saldo zero passa (padrão)');
select is((select quantidade from public.estoque_saldos where produto_id = current_setting('adega.t12_p')::uuid
            and local_id = current_setting('adega.t12_loja')::uuid), -2.000::numeric(12,3), 'saldo fica -2');
select lives_ok(format($$select public.estoque_movimentar(%L, %L, 'consumo_ficha', -1, 'teste 0012')$$,
  current_setting('adega.t12_p'), current_setting('adega.t12_loja')), 'consumo de ficha também pode negativar');
-- movimentos físicos continuam travados
select throws_ok(format($$select public.estoque_movimentar(%L, %L, 'transferencia_saida', -1, 'teste 0012')$$,
  current_setting('adega.t12_p'), current_setting('adega.t12_loja')), 'P0001', null, 'transferência sem saldo continua recusada');
select throws_ok(format($$select public.estoque_movimentar(%L, %L, 'perda', -1, 'teste 0012')$$,
  current_setting('adega.t12_p'), current_setting('adega.t12_loja')), 'P0001', null, 'perda sem saldo continua recusada');
-- entrada acerta o negativo
select lives_ok(format($$select public.estoque_movimentar(%L, %L, 'entrada', 10, 'teste 0012')$$,
  current_setting('adega.t12_p'), current_setting('adega.t12_loja')), 'entrada depois do negativo');
select is((select quantidade from public.estoque_saldos where produto_id = current_setting('adega.t12_p')::uuid
            and local_id = current_setting('adega.t12_loja')::uuid), 7.000::numeric(12,3), 'saldo -3 + 10 = 7');
-- empresa que desligou: volta a recusar
update public.tenants set config = jsonb_set(config, '{estoque}', coalesce(config -> 'estoque', '{}'::jsonb) || '{"permitir_negativo": false}'::jsonb)
 where id = current_setting('adega.t12_tenant')::uuid;
select throws_ok(format($$select public.estoque_movimentar(%L, %L, 'saida_venda', -8, 'teste 0012')$$,
  current_setting('adega.t12_p'), current_setting('adega.t12_loja')), 'P0001', 'saldo insuficiente no local (saldo atual: 7.000)',
  'com permitir_negativo=false a venda sem saldo é recusada');

select * from finish();
rollback;
