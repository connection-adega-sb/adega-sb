-- 0012_estoque_negativo.sql · ADEGA SB · venda com estoque negativo
-- 2026-10-14 · pedido do cliente: a planilha entrou com estoque ZERADO (combinado) e a venda travava em
-- "Estoque insuficiente". Regra nova: VENDA (saida_venda) e CONSUMO DE FICHA (consumo_ficha) podem deixar o
-- saldo negativo; o saldo negativo aparece no PDV/Estoque e o inventário/entrada acerta depois.
-- Continua recusado: transferência, perda e inventário sem saldo (são movimentos físicos de mercadoria).
-- Liga/desliga por empresa: tenants.config -> estoque -> permitir_negativo (sem a chave = PERMITIDO).
--   desligar: update tenants set config = jsonb_set(config, '{estoque}', coalesce(config->'estoque','{}') || '{"permitir_negativo":false}')
-- Assinatura de estoque_movimentar NAO muda (todas as funções de venda continuam iguais).

create or replace function public.estoque_movimentar(
  p_produto_id  uuid,
  p_local_id    uuid,
  p_tipo        text,
  p_quantidade  numeric,
  p_motivo      text default null,
  p_origem_tipo text default null,
  p_origem_id   uuid default null,
  p_custo_unit  numeric default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant  uuid;
  v_saldo   numeric;
  v_id      uuid;
  v_permite boolean;
begin
  if p_quantidade = 0 then raise exception 'quantidade do movimento não pode ser zero'; end if;

  select tenant_id into v_tenant from public.produtos where id = p_produto_id;
  if v_tenant is null then raise exception 'produto não encontrado'; end if;
  if not exists (select 1 from public.locais where id = p_local_id and tenant_id = v_tenant) then
    raise exception 'local não encontrado para este tenant';
  end if;

  select coalesce((select quantidade from public.estoque_saldos
                   where produto_id = p_produto_id and local_id = p_local_id), 0) into v_saldo;

  if (v_saldo + p_quantidade) < 0 and p_tipo <> 'ajuste' then
    select coalesce(config #>> '{estoque,permitir_negativo}', 'true') <> 'false' into v_permite
      from public.tenants where id = v_tenant;
    if not (coalesce(v_permite, true) and p_tipo in ('saida_venda', 'consumo_ficha')) then
      raise exception 'saldo insuficiente no local (saldo atual: %)', v_saldo;
    end if;
  end if;

  insert into public.estoque_movimentos
    (tenant_id, produto_id, local_id, tipo, quantidade, custo_unit, motivo, origem_tipo, origem_id, usuario_id)
  values
    (v_tenant, p_produto_id, p_local_id, p_tipo, p_quantidade, p_custo_unit, p_motivo, p_origem_tipo, p_origem_id,
     nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid)
  returning id into v_id;

  insert into public.estoque_saldos (tenant_id, produto_id, local_id, quantidade)
  values (v_tenant, p_produto_id, p_local_id, p_quantidade)
  on conflict (produto_id, local_id)
  do update set quantidade = public.estoque_saldos.quantidade + excluded.quantidade;

  return v_id;
end $$;

-- grants iguais aos da 0003 (create or replace mantém, mas deixamos explícito — pegadinha 0002)
revoke execute on function public.estoque_movimentar(uuid, uuid, text, numeric, text, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.estoque_movimentar(uuid, uuid, text, numeric, text, text, uuid, numeric) to service_role;
