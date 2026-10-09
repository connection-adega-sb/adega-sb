-- 0003_preflight.sql - roda ANTES da 0003. Saida esperada: "preflight 0003 OK".
-- Confere o que a 0003 precisa: tabelas/funções da 0001 (audit_registrar, tenants, locais, profiles)
-- e as permissoes da 0002 (service_role le profiles).
do $$
begin
  if to_regclass('public.tenants') is null then
    raise exception 'preflight 0003: a 0001 nao foi aplicada (public.tenants nao existe)';
  end if;
  if to_regclass('public.locais') is null then
    raise exception 'preflight 0003: a 0001 nao foi aplicada (public.locais nao existe)';
  end if;
  if to_regclass('public.profiles') is null then
    raise exception 'preflight 0003: a 0001 nao foi aplicada (public.profiles nao existe)';
  end if;
  if to_regprocedure('public.audit_registrar()') is null then
    raise exception 'preflight 0003: funcao audit_registrar() da 0001 nao existe';
  end if;
  if not has_table_privilege('service_role', 'public.profiles', 'SELECT') then
    raise exception 'preflight 0003: a 0002 nao foi aplicada (service_role nao le profiles)';
  end if;
  -- ja aplicada antes? entao avisa (db push deve rodar uma unica vez por migration)
  if to_regclass('public.produtos') is not null then
    raise exception 'preflight 0003: public.produtos ja existe - migration 0003 ja aplicada';
  end if;
end $$;
select 'preflight 0003 OK' as resultado;
