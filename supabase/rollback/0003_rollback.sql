-- 0003_rollback.sql - volta ao estado sem PDV/catalogo (0001 e 0002 permanecem).
-- Ordem: primeiro as funcoes e triggers, depois as tabelas (FK reversa).
-- Nao mexe em tenants/locais/profiles/audit_log (0001) nem nos grants deles (0002).

drop trigger if exists vendas_audit on public.vendas;
drop trigger if exists produtos_audit on public.produtos;
drop trigger if exists produtos_atualizado_em on public.produtos;
drop trigger if exists estoque_movimentos_sem_update on public.estoque_movimentos;

drop function if exists public.finalizar_venda_pdv(uuid, text, uuid[], numeric[], numeric, text, boolean);
drop function if exists public.estoque_movimentar(uuid, uuid, text, numeric, text, text, uuid, numeric);
drop function if exists public.produtos_tocar_atualizado_em();
drop function if exists public.estoque_movimento_imutavel();

drop table if exists public.venda_itens;
drop table if exists public.vendas;
drop table if exists public.caixa_movimentos;
drop table if exists public.caixa_sessoes;
drop table if exists public.caixas;
drop table if exists public.estoque_movimentos;
drop table if exists public.estoque_saldos;
drop table if exists public.produtos;
drop table if exists public.categorias;

select 'rollback 0003 OK' as resultado;
