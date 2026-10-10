-- 0007_rollback.sql · desfaz a 0007 (produto_criar + produtos.criado_por). RODAR MANUALMENTE só em emergência.
-- CUIDADO: apaga a coluna de autoria dos produtos cadastrados depois da 0007. Os produtos, os saldos
-- e os movimentos de estoque (append-only) continuam existindo — só se perde quem os cadastrou.

drop function if exists public.produto_criar(text, numeric, uuid, text, uuid, text, text, numeric, text, boolean, boolean, numeric, uuid, numeric);
alter table public.produtos drop column if exists criado_por;
