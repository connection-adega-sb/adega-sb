-- smoke 0003 · lógica de negócio no container local (não é pgTAP; é validação de execução real)
set search_path = public;
-- dados-base já vêm da 0001 (tenant + locais). Achar tenant e local 'loja'.
do $$
declare
  v_tenant uuid;
  v_loja   uuid;
  v_dep    uuid;
  v_prod   uuid;
  v_fum    uuid;
  v_caixa  uuid;
  v_sessao uuid;
  v_venda  uuid;
  v_saldo  numeric;
begin
  select id into v_tenant from tenants limit 1;
  select id into v_loja from locais where codigo='loja';
  select id into v_dep  from locais where codigo='deposito';

  -- operador de teste (no Supabase vem do auth.users real; aqui faço o shim)
  insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111') on conflict do nothing;
  insert into profiles (id, tenant_id, nome, role, deve_trocar_senha)
    values ('11111111-1111-1111-1111-111111111111', v_tenant, 'Operador Teste', 'caixa', false)
    on conflict (id) do nothing;

  -- 1. categoria + produto revenda
  insert into categorias (tenant_id, nome) values (v_tenant, 'Cervejas') returning id into v_prod; -- placeholder
  insert into produtos (tenant_id, categoria_id, codigo_barras, nome, preco_varejo, adulto)
    values (v_tenant, (select id from categorias where nome='Cervejas'), '7898107', 'Cerveja Pilsen Lata 350 ml', 4.49, true)
    returning id into v_prod;
  raise notice 'PASS produto revenda criado';

  -- 2. fumígeno que não é adulto deve FALHAR (CHECK)
  begin
    insert into produtos (tenant_id, codigo_barras, nome, preco_varejo, fumigeno, adulto, vende_fracionado)
      values (v_tenant, '999', 'Fum errado', 10, true, false, false);
    raise exception 'FALHOU: fumigeno sem adulto aceito';
  exception when check_violation then raise notice 'PASS CHECK fumigeno exige adulto';
  end;

  -- 3. entrada de estoque no depósito e na loja
  perform estoque_movimentar(v_prod, v_dep, 'entrada', 100, 'compra inicial');
  perform estoque_movimentar(v_prod, v_loja, 'entrada', 10, 'abastecimento');
  select quantidade into v_saldo from estoque_saldos where produto_id=v_prod and local_id=v_loja;
  if v_saldo <> 10 then raise exception 'FALHOU saldo loja = % (esperado 10)', v_saldo; end if;
  raise notice 'PASS entrada movimenta saldo por local (loja=10)';

  -- 4. saldo negativo recusado (loja tem 10; tirar 11 → erro)
  begin
    perform estoque_movimentar(v_prod, v_loja, 'saida_venda', -11, 'tenta vender sem saldo');
    raise exception 'FALHOU: saldo negativo aceito';
  exception when others then
    if SQLERRM like '%saldo insuficiente%' then raise notice 'PASS saldo negativo recusado';
    else raise; end if;
  end;

  -- 5. movimento é append-only
  begin
    update estoque_movimentos set quantidade = 999 where ctid = (select ctid from estoque_movimentos limit 1);
    raise exception 'FALHOU: update em movimento aceito';
  exception when others then
    if SQLERRM like '%append-only%' then raise notice 'PASS estoque_movimentos append-only';
    else raise; end if;
  end;

  -- 6. criar caixa e abrir sessão
  insert into caixas (tenant_id, local_id, nome) values (v_tenant, v_loja, 'Caixa #01') returning id into v_caixa;
  begin
    insert into caixa_sessoes (tenant_id, caixa_id, local_id, operador_id, valor_abertura)
      values (v_tenant, v_caixa, v_loja, '11111111-1111-1111-1111-111111111111', 200.00) returning id into v_sessao;
    raise notice 'PASS sessão de caixa aberta (abertura R$200)';

    -- 7. finalizar venda: 2 latas + 1 vinho adulto com maior18
    insert into produtos (tenant_id, codigo_barras, nome, preco_varejo, adulto) values (v_tenant,'7898101','Vinho',39.90,true) returning id into v_fum;
    perform estoque_movimentar(v_fum, v_loja, 'entrada', 5, 'abastecimento');
    v_venda := finalizar_venda_pdv(v_sessao, 'pix', array[v_prod, v_fum], array[2::numeric, 1::numeric], 0, null, true);
    select quantidade into v_saldo from estoque_saldos where produto_id=v_prod and local_id=v_loja;
    if v_saldo <> 8 then raise exception 'FALHOU baixa estoque loja = % (esperado 8)', v_saldo; end if;
    raise notice 'PASS finalizar_venda_pdv: venda % gravada, estoque loja 10→8', v_venda;

    -- 8. item adulto SEM maior18 → deve falhar
    begin
      perform finalizar_venda_pdv(v_sessao, 'pix', array[v_prod], array[1::numeric], 0, null, false);
      raise exception 'FALHOU: venda adulto sem maior18 aceita';
    exception when others then
      if SQLERRM like '%18%' then raise notice 'PASS item +18 exige confirmação de idade';
      else raise; end if;
    end;
  end;
end $$;
select 'SMOKE 0003 CONCLUIDO' as resultado;
