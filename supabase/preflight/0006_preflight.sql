-- 0006_preflight.sql · roda ANTES da 0006. Saída esperada: "preflight 0006 OK".
-- Confere o que a 0006 precisa: catálogo/estoque da 0003 (produtos), as fichas da 0004
-- (fichas_tecnicas) e as tabelas/funções da 0005 (comandas, comanda_itens, comanda_adicionar).
do $$
begin
  if to_regclass('public.tenants') is null then
    raise exception 'preflight 0006: a 0001 nao foi aplicada (public.tenants nao existe)';
  end if;
  if to_regclass('public.produtos') is null then
    raise exception 'preflight 0006: a 0003 nao foi aplicada (public.produtos nao existe)';
  end if;
  if to_regclass('public.estoque_saldos') is null then
    raise exception 'preflight 0006: a 0003 nao foi aplicada (public.estoque_saldos nao existe)';
  end if;
  if to_regprocedure('public.estoque_movimentar(uuid,uuid,text,numeric,text,text,uuid,numeric)') is null then
    raise exception 'preflight 0006: funcao estoque_movimentar(uuid,uuid,text,numeric,text,text,uuid,numeric) da 0003 nao existe';
  end if;
  if to_regclass('public.fichas_tecnicas') is null then
    raise exception 'preflight 0006: a 0004 nao foi aplicada (public.fichas_tecnicas nao existe)';
  end if;
  if to_regclass('public.venda_itens') is null then
    raise exception 'preflight 0006: a 0003 nao foi aplicada (public.venda_itens nao existe)';
  end if;
  if to_regclass('public.comandas') is null then
    raise exception 'preflight 0006: a 0005 nao foi aplicada (public.comandas nao existe)';
  end if;
  if to_regclass('public.comanda_itens') is null then
    raise exception 'preflight 0006: a 0005 nao foi aplicada (public.comanda_itens nao existe)';
  end if;
  if to_regprocedure('public.comanda_adicionar(uuid,uuid,numeric,text,boolean)') is null then
    raise exception 'preflight 0006: funcao comanda_adicionar(uuid,uuid,numeric,text,boolean) da 0005 nao existe';
  end if;
  if to_regprocedure('public.comanda_fechar(uuid,uuid,text)') is null then
    raise exception 'preflight 0006: funcao comanda_fechar(uuid,uuid,text) da 0005 nao existe';
  end if;
  if not has_table_privilege('service_role', 'public.produtos', 'SELECT') then
    raise exception 'preflight 0006: service_role nao le public.produtos (grant da 0002 ausente?)';
  end if;
  -- guardião de idempotência: se já existe, é sinal de que a 0006 já foi aplicada
  if to_regprocedure('public.comanda_remover_item(uuid)') is not null then
    raise exception 'preflight 0006: comanda_remover_item(uuid) ja existe - migration 0006 ja aplicada';
  end if;
end $$;

select 'preflight 0006 OK' as resultado;
