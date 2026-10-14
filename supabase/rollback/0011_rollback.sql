-- 0011_rollback.sql · desfaz a 0011 (conta de cliente). RODAR MANUALMENTE só em emergência.
-- CUIDADO: contas abertas no PDV viram comandas sem nome (as vendas já pagas continuam intactas).
drop function if exists public.conta_pagar_parte(uuid, uuid, text, uuid[], numeric[], boolean, uuid, text);
drop function if exists public.conta_ajustar_item(uuid, numeric);
drop function if exists public.conta_abrir(uuid, uuid, text, uuid);
drop index if exists public.comandas_contas_abertas_idx;
alter table public.comandas drop constraint if exists comandas_conta_pdv_tem_nome;
alter table public.comandas drop column if exists origem, drop column if exists cliente_id, drop column if exists nome;
