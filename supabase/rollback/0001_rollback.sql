-- 0001_rollback.sql · reversível enquanto não houver usuários reais em public.profiles.
-- ATENÇÃO: apaga tenants, locais, perfis, vínculos e trilha de auditoria.
do $$
begin
  if (select count(*) from public.profiles) > 0 then
    raise exception 'rollback 0001 recusado: há % perfis cadastrados', (select count(*) from public.profiles);
  end if;
end $$;
drop table if exists public.audit_log cascade;
drop table if exists public.profile_locais cascade;
drop table if exists public.profiles cascade;
drop table if exists public.locais cascade;
drop table if exists public.tenants cascade;
drop function if exists public.audit_registrar() cascade;
drop function if exists public.audit_log_imutavel() cascade;
drop function if exists public.tocar_atualizado_em() cascade;
select 'rollback 0001 OK' as resultado;
