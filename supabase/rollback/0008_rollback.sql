-- 0008_rollback.sql · desfaz a 0008 (clientes + vendas.cliente_id). RODAR MANUALMENTE só em emergência.
-- CUIDADO: apaga o cadastro de clientes e o vínculo cliente↔venda. As vendas continuam existindo
-- (o CPF gravado em vendas.cpf também); o histórico fica no audit_log.

drop function if exists public.finalizar_venda_pdv_cliente(uuid, text, uuid[], numeric[], numeric, boolean, uuid);
drop function if exists public.cliente_definir_ativo(uuid, uuid, boolean);
drop function if exists public.cliente_salvar(uuid, text, text, text, text, text, uuid);
alter table public.vendas drop column if exists cliente_id;
drop table if exists public.clientes;
drop function if exists public.cpf_valido(text);
