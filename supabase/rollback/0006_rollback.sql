-- 0006_rollback.sql · desfaz a 0006 (comanda_remover_item). RODAR MANUALMENTE só em emergência.
-- Não mexe em itens já removidos: comanda_itens é cascade por comanda, e o histórico de vendas
-- (vendas/venda_itens/estoque_movimentos) é preservado.

drop function if exists public.comanda_remover_item(uuid);
