-- 0001_preflight.sql · roda ANTES da 0001, nas duas bases. Para se algo inesperado já existir.
-- Saída esperada: uma linha "preflight 0001 OK".
do $$
declare v_tab text;
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'auth') then
    raise exception 'preflight 0001: schema auth não existe (não é um projeto Supabase?)';
  end if;
  foreach v_tab in array array['tenants', 'locais', 'profiles', 'profile_locais', 'audit_log'] loop
    if to_regclass('public.' || v_tab) is not null then
      raise exception 'preflight 0001: public.% já existe — conferir antes de aplicar', v_tab;
    end if;
  end loop;
  if not exists (select 1 from pg_available_extensions where name = 'pgtap') then
    raise warning 'preflight 0001: extensão pgtap indisponível — os testes não vão rodar';
  end if;
end $$;
select 'preflight 0001 OK' as resultado;
