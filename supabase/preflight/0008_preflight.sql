-- 0008_preflight.sql · roda ANTES da 0008. Saída esperada: "preflight 0008 OK".
-- Confere o que a 0008 precisa: tenants/profiles/audit (0001), vendas (0003) e
-- finalizar_venda_pdv com a assinatura da 0004 (a nova função a chama).
do $$
begin
  if to_regclass('public.tenants') is null or to_regclass('public.profiles') is null then
    raise exception 'preflight 0008: a 0001 nao foi aplicada (tenants/profiles)';
  end if;
  if to_regprocedure('public.audit_registrar()') is null then
    raise exception 'preflight 0008: audit_registrar() da 0001 nao existe';
  end if;
  if to_regclass('public.vendas') is null or to_regclass('public.caixa_sessoes') is null then
    raise exception 'preflight 0008: a 0003 nao foi aplicada (vendas/caixa_sessoes)';
  end if;
  if to_regprocedure('public.finalizar_venda_pdv(uuid,text,uuid[],numeric[],numeric,text,boolean)') is null then
    raise exception 'preflight 0008: finalizar_venda_pdv(uuid,text,uuid[],numeric[],numeric,text,boolean) nao existe';
  end if;
  if to_regprocedure('public.produto_criar(text,numeric,uuid,text,uuid,text,text,numeric,text,boolean,boolean,numeric,uuid,numeric)') is null then
    raise exception 'preflight 0008: a 0007 nao foi aplicada (produto_criar)';
  end if;
  -- guardião de idempotência
  if to_regclass('public.clientes') is not null then
    raise exception 'preflight 0008: public.clientes ja existe - migration 0008 ja aplicada';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'vendas' and column_name = 'cliente_id') then
    raise exception 'preflight 0008: vendas.cliente_id ja existe - migration 0008 ja aplicada';
  end if;
end $$;

select 'preflight 0008 OK' as resultado;
