-- 0009_rollback.sql · desfaz a 0009 (crédito + produto_atualizar). RODAR MANUALMENTE só em emergência.
-- CUIDADO: se já houver venda no crédito, o passo 1 FALHA de propósito (a constraint antiga não aceita
-- 'credito'): decidir antes o que fazer com essas vendas. Pagamentos de crédito são apagados com a tabela
-- (o histórico fica no audit_log). As funções voltam para a versão da 0008 rodando a 0004 + 0008 de novo
-- (finalizar_venda_pdv e finalizar_venda_pdv_cliente).

alter table public.vendas drop constraint vendas_forma_pagamento_check;
alter table public.vendas add constraint vendas_forma_pagamento_check
  check (forma_pagamento in ('pix', 'cartao', 'dinheiro', 'boleto'));
drop trigger if exists vendas_credito_cliente on public.vendas;
drop function if exists public.vendas_credito_exige_cliente();
drop function if exists public.produto_atualizar(uuid, uuid, text, numeric, text, uuid, boolean, boolean, boolean);
drop function if exists public.credito_receber(uuid, uuid, numeric, text, text);
drop function if exists public.cliente_definir_limite(uuid, uuid, numeric);
drop table if exists public.credito_pagamentos;
drop function if exists public.credito_pagamentos_imutavel();
drop function if exists public.cliente_saldo_credito(uuid);
alter table public.clientes drop column if exists limite_credito;
