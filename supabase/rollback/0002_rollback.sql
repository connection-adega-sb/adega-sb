-- 0002_rollback.sql - volta ao estado sem permissoes de dados (o app para de funcionar).
revoke select, insert, update, delete on public.tenants, public.locais, public.profiles, public.profile_locais from service_role;
revoke select on public.audit_log from service_role;
revoke select on public.profiles, public.profile_locais from authenticated;
select 'rollback 0002 OK' as resultado;
