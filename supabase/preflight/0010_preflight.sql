-- 0010_preflight.sql · roda ANTES da 0010. Saída esperada: "preflight 0010 OK".
-- Confere o que a 0010 precisa (0001 tenants/audit, 0003 produtos, 0008 clientes + cpf_valido, 0009 limite)
-- e barra a reaplicação.
do $$
begin
  if to_regclass('public.clientes') is null or to_regclass('public.produtos') is null or to_regclass('public.tenants') is null then
    raise exception 'preflight 0010: falta tabela base (tenants/produtos/clientes)';
  end if;
  if to_regprocedure('public.cpf_valido(text)') is null then
    raise exception 'preflight 0010: cpf_valido da 0008 nao existe';
  end if;
  if to_regprocedure('public.audit_registrar()') is null then
    raise exception 'preflight 0010: audit_registrar da 0001 nao existe';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'clientes' and column_name = 'limite_credito') then
    raise exception 'preflight 0010: a 0009 nao foi aplicada (clientes.limite_credito)';
  end if;
  -- guardião de idempotência
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'produtos' and column_name = 'csosn') then
    raise exception 'preflight 0010: produtos.csosn ja existe - migration 0010 ja aplicada';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tenants' and column_name = 'segmento') then
    raise exception 'preflight 0010: tenants.segmento ja existe - migration 0010 ja aplicada';
  end if;
end $$;

select 'preflight 0010 OK' as resultado;
