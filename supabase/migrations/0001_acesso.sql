-- 0001_acesso.sql · ADEGA SB · Fase 1 (acesso e identidade)
-- 2026-10-08 · parecer-acesso-enterprise.md §2 · AGENTS.md "Regras de modelagem de dados"
-- Tabelas: tenants, locais, profiles, profile_locais, audit_log. RLS deny-all; únicas policies:
-- o usuário lê o PRÓPRIO perfil e os PRÓPRIOS vínculos de local (o middleware precisa). Escrita: service_role.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tenants
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(trim(nome)) > 0),
  razao       text,
  cnpj        text check (cnpj is null or cnpj ~ '^\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$'),
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------- locais (loja · bar · depósito)
create table public.locais (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  codigo      text not null check (codigo ~ '^[a-z][a-z0-9_]*$'),
  nome        text not null,
  tipo        text not null check (tipo in ('loja', 'bar', 'deposito')),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  unique (tenant_id, codigo)
);
create index locais_tenant_idx on public.locais (tenant_id);

-- ---------------------------------------------------------------- profiles (1:1 com auth.users)
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  nome               text not null check (length(trim(nome)) > 0),
  role               text not null check (role in ('master', 'gerente', 'caixa', 'bartender', 'estoquista',
                                                   'vendedor_b2b', 'entregador', 'motorista', 'financeiro', 'contador')),
  ativo              boolean not null default true,
  deve_trocar_senha  boolean not null default true,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
create index profiles_tenant_idx on public.profiles (tenant_id);

-- ---------------------------------------------------------------- profile_locais (papel vale por local)
create table public.profile_locais (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  local_id    uuid not null references public.locais(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  criado_em   timestamptz not null default now(),
  primary key (profile_id, local_id)
);
create index profile_locais_local_idx on public.profile_locais (local_id);

-- ---------------------------------------------------------------- audit_log (append-only)
-- antes/depois em jsonb: é trilha de auditoria (snapshot), não dado consultável de negócio.
create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid,
  tabela       text not null,
  registro_id  text,
  acao         text not null check (acao in ('insert', 'update', 'delete')),
  antes        jsonb,
  depois       jsonb,
  usuario_id   uuid,
  em           timestamptz not null default now()
);
create index audit_log_tabela_idx on public.audit_log (tabela, em desc);

-- ---------------------------------------------------------------- funções e triggers
create or replace function public.tocar_atualizado_em() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

create trigger profiles_atualizado_em before update on public.profiles
  for each row execute function public.tocar_atualizado_em();

create or replace function public.audit_registrar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_antes  jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_depois jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_reg    jsonb := coalesce(v_depois, v_antes);
  v_uid    uuid;
begin
  begin
    v_uid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
  exception when others then
    v_uid := null;
  end;
  insert into public.audit_log (tenant_id, tabela, registro_id, acao, antes, depois, usuario_id)
  values ((v_reg ->> 'tenant_id')::uuid, tg_table_name,
          coalesce(v_reg ->> 'id', v_reg ->> 'profile_id'), lower(tg_op), v_antes, v_depois, v_uid);
  return coalesce(new, old);
end $$;

create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.audit_registrar();
create trigger profile_locais_audit after insert or update or delete on public.profile_locais
  for each row execute function public.audit_registrar();
create trigger locais_audit after insert or update or delete on public.locais
  for each row execute function public.audit_registrar();

create or replace function public.audit_log_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log é append-only (% recusado)', tg_op using errcode = '42501';
end $$;

create trigger audit_log_sem_update before update or delete on public.audit_log
  for each row execute function public.audit_log_imutavel();

-- ---------------------------------------------------------------- RLS (deny-all por padrão)
alter table public.tenants        enable row level security;
alter table public.locais         enable row level security;
alter table public.profiles       enable row level security;
alter table public.profile_locais enable row level security;
alter table public.audit_log      enable row level security;

create policy profiles_le_proprio on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profile_locais_le_proprios on public.profile_locais
  for select to authenticated using (profile_id = (select auth.uid()));

revoke all on public.audit_log from anon, authenticated;

-- ---------------------------------------------------------------- dados-base (tenant e 3 locais)
with t as (
  insert into public.tenants (nome, razao, cnpj)
  values ('ADEGA SB', 'SIMONE ALVES NASCIMENTO 16167027889', '43.466.024/0001-43')
  returning id
)
insert into public.locais (tenant_id, codigo, nome, tipo)
select t.id, v.codigo, v.nome, v.tipo
from t, (values ('loja', 'Loja · balcão', 'loja'), ('bar', 'Bar', 'bar'), ('deposito', 'Depósito', 'deposito')) as v(codigo, nome, tipo);
