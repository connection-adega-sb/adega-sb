-- 0006_comanda_remover_item.sql · ADEGA SB · correção de item na comanda do bar
-- 2026-10-10 · segue a 0005 (comandas/comanda_itens já existem, comandas.total é incrementado
-- por comanda_adicionar). Sem ela a UI do bar não tem como desfazer um item lançado errado —
-- e a única saída seria transferir/dividir, que não zera a comanda.
-- Regra: só comanda ABERTA; remove o item e recalcula o total (não confia em valor do cliente).

-- ================================================================ comanda_remover_item
create or replace function public.comanda_remover_item(p_item uuid)
returns numeric  -- novo total da comanda
language plpgsql security definer set search_path = public as $$
declare
  i          public.comanda_itens%rowtype;
  c          public.comandas%rowtype;
  v_total    numeric(12,2);
begin
  select * into i from public.comanda_itens where id = p_item for update;
  if i.id is null then raise exception 'item não encontrado'; end if;

  select * into c from public.comandas where id = i.comanda_id for update;
  if c.id is null then raise exception 'comanda não encontrada'; end if;
  if c.status <> 'aberta' then raise exception 'comanda está fechada: item não pode ser removido'; end if;

  delete from public.comanda_itens where id = p_item;

  -- recalcula a partir do banco (mesma fórmula de mesa_dividir): nunca soma/desubtrai no cliente
  select coalesce(sum(subtotal), 0) into v_total
    from public.comanda_itens where comanda_id = c.id;

  update public.comandas set total = v_total where id = c.id;

  return v_total;
end $$;

-- ================================================================ AUDIT
-- (mesas/comandas já têm trigger na 0005; comanda_itens é alterada só por função security definer,
--  o audit_log da 0001 acompanha a mudança de total via o trigger de comandas.)

-- ================================================================ RLS (já deny-all na 0005)

-- ================================================================ GRANTS (explícitos — pegadinha 0002)

grant execute on function public.comanda_remover_item(uuid) to service_role;
revoke execute on function public.comanda_remover_item(uuid) from public, anon, authenticated;
