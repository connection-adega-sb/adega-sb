-- 0009_preflight.sql · roda ANTES da 0009. Saída esperada: "preflight 0009 OK".
-- Confere o que a 0009 precisa: clientes + finalizar_venda_pdv_cliente (0008), caixa e vendas (0003),
-- produtos/categorias (0003) e a constraint de forma de pagamento que a 0009 recria.
do $$
begin
  if to_regclass('public.clientes') is null then
    raise exception 'preflight 0009: a 0008 nao foi aplicada (public.clientes nao existe)';
  end if;
  if to_regprocedure('public.finalizar_venda_pdv_cliente(uuid,text,uuid[],numeric[],numeric,boolean,uuid)') is null then
    raise exception 'preflight 0009: finalizar_venda_pdv_cliente da 0008 nao existe';
  end if;
  if to_regprocedure('public.finalizar_venda_pdv(uuid,text,uuid[],numeric[],numeric,text,boolean)') is null then
    raise exception 'preflight 0009: finalizar_venda_pdv(uuid,text,uuid[],numeric[],numeric,text,boolean) nao existe';
  end if;
  if to_regprocedure('public.ficha_consumir(uuid,uuid,numeric,text,uuid)') is null then
    raise exception 'preflight 0009: ficha_consumir da 0004 nao existe (finalizar_venda_pdv depende dela)';
  end if;
  if to_regclass('public.caixa_movimentos') is null or to_regclass('public.produtos') is null then
    raise exception 'preflight 0009: a 0003 nao foi aplicada (caixa_movimentos/produtos)';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendas_forma_pagamento_check'
                  and conrelid = 'public.vendas'::regclass) then
    raise exception 'preflight 0009: constraint vendas_forma_pagamento_check nao encontrada (nome diferente?)';
  end if;
  -- guardião de idempotência
  if to_regclass('public.credito_pagamentos') is not null then
    raise exception 'preflight 0009: public.credito_pagamentos ja existe - migration 0009 ja aplicada';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'clientes' and column_name = 'limite_credito') then
    raise exception 'preflight 0009: clientes.limite_credito ja existe - migration 0009 ja aplicada';
  end if;
end $$;

select 'preflight 0009 OK' as resultado;
