-- 0005_preflight.sql · roda ANTES da 0005. Saída esperada: "preflight 0005 OK".
-- Confere o que a 0005 precisa: tabelas/funções da 0001 (audit_registrar, tenants, locais),
-- o catálogo/estoque da 0003 (produtos, estoque_saldos, estoque_movimentar, vendas, venda_itens)
-- e as fichas da 0004 (fichas_tecnicas, ficha_consumir).
do $$
begin
  if to_regclass('public.tenants') is null then
    raise exception 'preflight 0005: a 0001 nao foi aplicada (public.tenants nao existe)';
  end if;
  if to_regclass('public.locais') is null then
    raise exception 'preflight 0005: a 0001 nao foi aplicada (public.locais nao existe)';
  end if;
  if to_regprocedure('public.audit_registrar()') is null then
    raise exception 'preflight 0005: funcao audit_registrar() da 0001 nao existe';
  end if;
  if to_regclass('public.produtos') is null then
    raise exception 'preflight 0005: a 0003 nao foi aplicada (public.produtos nao existe)';
  end if;
  if to_regclass('public.estoque_saldos') is null then
    raise exception 'preflight 0005: a 0003 nao foi aplicada (public.estoque_saldos nao existe)';
  end if;
  if to_regprocedure('public.estoque_movimentar(uuid,uuid,text,numeric,text,text,uuid,numeric)') is null then
    raise exception 'preflight 0005: funcao estoque_movimentar() da 0003 nao existe';
  end if;
  if to_regclass('public.vendas') is null then
    raise exception 'preflight 0005: a 0003 nao foi aplicada (public.vendas nao existe)';
  end if;
  if to_regclass('public.venda_itens') is null then
    raise exception 'preflight 0005: a 0003 nao foi aplicada (public.venda_itens nao existe)';
  end if;
  if to_regclass('public.fichas_tecnicas') is null then
    raise exception 'preflight 0005: a 0004 nao foi aplicada (public.fichas_tecnicas nao existe)';
  end if;
  if to_regprocedure('public.ficha_consumir(uuid,uuid,numeric,text,uuid)') is null then
    raise exception 'preflight 0005: funcao ficha_consumir() da 0004 nao existe';
  end if;
  if not has_table_privilege('service_role', 'public.produtos', 'SELECT') then
    raise exception 'preflight 0005: a 0002 nao foi aplicada (service_role nao le produtos)';
  end if;
  -- ja aplicada antes? entao avisa (db push deve rodar uma unica vez por migration)
  if to_regclass('public.mesas') is not null then
    raise exception 'preflight 0005: public.mesas ja existe - migration 0005 ja aplicada';
  end if;
end $$;
select 'preflight 0005 OK' as resultado;
