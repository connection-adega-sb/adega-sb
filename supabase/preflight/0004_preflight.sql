-- 0004_preflight.sql · roda ANTES da 0004. Saída esperada: "preflight 0004 OK".
-- Confere o que a 0004 precisa: tabelas/funções da 0001 (audit_registrar, tenants, locais),
-- o catálogo/estoque da 0003 (produtos, estoque_saldos, estoque_movimentar, finalizar_venda_pdv)
-- e as permissões da 0002 (service_role).
do $$
begin
  if to_regclass('public.tenants') is null then
    raise exception 'preflight 0004: a 0001 nao foi aplicada (public.tenants nao existe)';
  end if;
  if to_regclass('public.locais') is null then
    raise exception 'preflight 0004: a 0001 nao foi aplicada (public.locais nao existe)';
  end if;
  if to_regprocedure('public.audit_registrar()') is null then
    raise exception 'preflight 0004: funcao audit_registrar() da 0001 nao existe';
  end if;
  if to_regclass('public.produtos') is null then
    raise exception 'preflight 0004: a 0003 nao foi aplicada (public.produtos nao existe)';
  end if;
  if to_regclass('public.estoque_saldos') is null then
    raise exception 'preflight 0004: a 0003 nao foi aplicada (public.estoque_saldos nao existe)';
  end if;
  if to_regprocedure('public.estoque_movimentar(uuid,uuid,text,numeric,text,text,uuid,numeric)') is null then
    raise exception 'preflight 0004: funcao estoque_movimentar() da 0003 nao existe';
  end if;
  if to_regprocedure('public.finalizar_venda_pdv(uuid,text,uuid[],numeric[],numeric,text,boolean)') is null then
    raise exception 'preflight 0004: funcao finalizar_venda_pdv() da 0003 nao existe';
  end if;
  if not has_table_privilege('service_role', 'public.produtos', 'SELECT') then
    raise exception 'preflight 0004: a 0002 nao foi aplicada (service_role nao le produtos)';
  end if;
  -- ja aplicada antes? entao avisa (db push deve rodar uma unica vez por migration)
  if to_regclass('public.transferencias') is not null then
    raise exception 'preflight 0004: public.transferencias ja existe - migration 0004 ja aplicada';
  end if;
end $$;
select 'preflight 0004 OK' as resultado;
