-- 0005_rollback.sql · desfaz a 0005 (bar: mesas/comandas). RODAR MANUALMENTE só em emergência.
-- Ordem inversa da criação: triggers → funções → tabelas (filhas primeiro por causa das FKs).
-- Não remove vendas/venda_itens/estoque_movimentos já gerados (histórico é preservado);

-- ---------------------------------------------------------------- triggers
drop trigger if exists comandas_audit  on public.comandas;
drop trigger if exists mesas_audit     on public.mesas;

-- ---------------------------------------------------------------- funções (8)
drop function if exists public.copao_vender(uuid,uuid,numeric,uuid,text);
drop function if exists public.comanda_fechar(uuid,uuid,text);
drop function if exists public.comanda_adicionar(uuid,uuid,numeric,text,boolean);
drop function if exists public.comanda_abrir(uuid,uuid);
drop function if exists public.mesa_fechar(uuid);
drop function if exists public.mesa_dividir(uuid,uuid,uuid[]);
drop function if exists public.mesa_transferir(uuid,uuid);
drop function if exists public.mesa_abrir(uuid,uuid);

-- ---------------------------------------------------------------- tabelas (4, filhas primeiro)
-- comanda_itens referencia comandas; mesas referencia comandas (FK adicionada via ALTER);
-- mesas_status_log referencia mesas. Ordem: comanda_itens → comandas → mesas_status_log → mesas.
drop table if exists public.comanda_itens    cascade;
drop table if exists public.comandas         cascade;
drop table if exists public.mesas_status_log cascade;
drop table if exists public.mesas            cascade;
