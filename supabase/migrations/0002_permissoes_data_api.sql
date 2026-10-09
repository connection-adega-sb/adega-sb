-- 0002_permissoes_data_api.sql - ADEGA SB - 2026-10-08
-- O projeto Supabase NAO concede SELECT/INSERT/UPDATE/DELETE automaticamente em tabelas novas
-- (verificado no staging: anon/authenticated/service_role so tinham REFERENCES, TRIGGER, TRUNCATE).
-- Regra a partir daqui: toda migration concede permissoes explicitas, com o minimo necessario.

-- 1. Limpa privilegios que ninguem deve ter (TRUNCATE ignora RLS)
revoke references, trigger, truncate on public.tenants, public.locais, public.profiles, public.profile_locais, public.audit_log
  from anon, authenticated, service_role;

-- 2. Servidor (service_role, usado so nas server actions e scripts)
grant select, insert, update, delete on public.tenants, public.locais, public.profiles, public.profile_locais to service_role;
grant select on public.audit_log to service_role;

-- 3. Usuario logado: so leitura do proprio perfil e dos proprios locais (RLS da 0001 filtra as linhas)
grant select on public.profiles, public.profile_locais to authenticated;

-- 4. Anonimo: nada (deny-all)
