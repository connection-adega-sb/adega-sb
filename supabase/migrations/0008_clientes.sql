-- 0008_clientes.sql · ADEGA SB · cadastro de cliente + cliente na venda do PDV
-- 2026-10-10 · pedido do cliente: "cadastrar cliente" para fechar o ciclo de atendimento na adega.
-- Escopo (PRD-clientes.md): cadastro (nome, telefone, CPF, e-mail, observação), busca, histórico de
-- compras e vínculo OPCIONAL do cliente na venda do PDV. Fiado/conta corrente fica para a 0009.
-- Regras todas no servidor: tenant vem do perfil do usuário (nunca do navegador), telefone e CPF
-- normalizados (só dígitos) e únicos por tenant, CPF com dígito verificador conferido.
-- finalizar_venda_pdv (0004) NÃO muda de assinatura: a nova função a chama dentro da mesma transação.

-- ================================================================ cpf_valido
create or replace function public.cpf_valido(p_cpf text) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  d   text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  s   int;
  dv1 int;
  dv2 int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0;
  for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
  dv1 := (s * 10) % 11; if dv1 = 10 then dv1 := 0; end if;
  s := 0;
  for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
  dv2 := (s * 10) % 11; if dv2 = 10 then dv2 := 0; end if;
  return dv1 = substr(d, 10, 1)::int and dv2 = substr(d, 11, 1)::int;
end $$;

-- ================================================================ clientes
create table public.clientes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  nome          text not null check (length(trim(nome)) between 1 and 120),
  telefone      text check (telefone ~ '^\d{10,11}$'),
  cpf           text check (cpf ~ '^\d{11}$'),
  email         text,
  observacao    text check (observacao is null or length(observacao) <= 500),
  ativo         boolean not null default true,
  criado_por    uuid references public.profiles(id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index clientes_tenant_idx on public.clientes (tenant_id);
create index clientes_nome_idx on public.clientes (tenant_id, lower(nome));
create unique index clientes_telefone_uk on public.clientes (tenant_id, telefone) where telefone is not null;
create unique index clientes_cpf_uk on public.clientes (tenant_id, cpf) where cpf is not null;

create trigger clientes_audit after insert or update or delete on public.clientes
  for each row execute function public.audit_registrar();

-- ================================================================ vendas.cliente_id
alter table public.vendas
  add column cliente_id uuid references public.clientes(id);
create index vendas_cliente_idx on public.vendas (cliente_id) where cliente_id is not null;

-- ================================================================ cliente_salvar (criar ou editar)
create or replace function public.cliente_salvar(
  p_usuario    uuid,
  p_nome       text,
  p_telefone   text default null,
  p_cpf        text default null,
  p_email      text default null,
  p_observacao text default null,
  p_id         uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_nome   text;
  v_fone   text;
  v_cpf    text;
  v_email  text;
  v_obs    text;
  v_outro  text;
  v_id     uuid;
begin
  -- 1) quem cadastra precisa ter perfil ativo; o tenant vem DELE
  select tenant_id into v_tenant from public.profiles where id = p_usuario and ativo;
  if v_tenant is null then raise exception 'usuário sem perfil ativo'; end if;

  -- 2) normalização + validação (mensagens amigáveis; os CHECKs da tabela são a última barreira)
  v_nome := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  if length(v_nome) = 0 then raise exception 'nome do cliente é obrigatório'; end if;
  if length(v_nome) > 120 then raise exception 'nome do cliente muito longo'; end if;

  v_fone := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
  if v_fone is not null and v_fone !~ '^\d{10,11}$' then
    raise exception 'telefone inválido: use DDD + número';
  end if;

  v_cpf := nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '');
  if v_cpf is not null and not public.cpf_valido(v_cpf) then raise exception 'CPF inválido'; end if;

  v_email := nullif(lower(trim(coalesce(p_email, ''))), '');
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail inválido'; end if;

  v_obs := nullif(trim(coalesce(p_observacao, '')), '');
  if v_obs is not null and length(v_obs) > 500 then raise exception 'observação muito longa'; end if;

  -- 3) duplicidade (antes do índice único, para dizer QUEM já usa o dado)
  if v_fone is not null then
    select nome into v_outro from public.clientes
     where tenant_id = v_tenant and telefone = v_fone and id is distinct from p_id;
    if found then raise exception 'telefone já cadastrado para %', v_outro; end if;
  end if;
  if v_cpf is not null then
    select nome into v_outro from public.clientes
     where tenant_id = v_tenant and cpf = v_cpf and id is distinct from p_id;
    if found then raise exception 'CPF já cadastrado para %', v_outro; end if;
  end if;

  -- 4) grava (audit_log pelo trigger)
  if p_id is null then
    insert into public.clientes (tenant_id, nome, telefone, cpf, email, observacao, criado_por)
    values (v_tenant, v_nome, v_fone, v_cpf, v_email, v_obs, p_usuario)
    returning id into v_id;
  else
    update public.clientes
       set nome = v_nome, telefone = v_fone, cpf = v_cpf, email = v_email, observacao = v_obs,
           atualizado_em = now()
     where id = p_id and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then raise exception 'cliente não encontrado'; end if;
  end if;
  return v_id;
end $$;

-- ================================================================ cliente_definir_ativo
create or replace function public.cliente_definir_ativo(p_usuario uuid, p_id uuid, p_ativo boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.profiles where id = p_usuario and ativo;
  if v_tenant is null then raise exception 'usuário sem perfil ativo'; end if;
  update public.clientes set ativo = coalesce(p_ativo, true), atualizado_em = now()
   where id = p_id and tenant_id = v_tenant;
  if not found then raise exception 'cliente não encontrado'; end if;
end $$;

-- ================================================================ finalizar_venda_pdv_cliente
-- Mesma venda da 0004 + cliente opcional, numa transação só (função chamando função).
-- Com cliente: precisa ser ATIVO e do MESMO tenant da sessão de caixa; o CPF do cadastro
-- vai para vendas.cpf (base da NFC-e "CPF na nota" — F10).
create or replace function public.finalizar_venda_pdv_cliente(
  p_caixa_sessao_id  uuid,
  p_forma_pagamento  text,
  p_produtos         uuid[],
  p_quantidades      numeric[],
  p_desconto         numeric default 0,
  p_maior18          boolean default false,
  p_cliente          uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_cpf    text;
  v_venda  uuid;
begin
  if p_cliente is not null then
    select tenant_id into v_tenant from public.caixa_sessoes where id = p_caixa_sessao_id;
    select cpf into v_cpf from public.clientes
     where id = p_cliente and tenant_id = v_tenant and ativo;
    if not found then raise exception 'cliente não encontrado'; end if;
  end if;

  v_venda := public.finalizar_venda_pdv(
    p_caixa_sessao_id, p_forma_pagamento, p_produtos, p_quantidades,
    coalesce(p_desconto, 0), v_cpf, coalesce(p_maior18, false));

  if p_cliente is not null then
    update public.vendas set cliente_id = p_cliente where id = v_venda;
  end if;
  return v_venda;
end $$;

-- ================================================================ RLS (deny-all: só service_role, pelo servidor)
alter table public.clientes enable row level security;

-- ================================================================ GRANTS (explícitos — pegadinha 0002)
revoke all on public.clientes from anon, authenticated;
revoke references, trigger, truncate on public.clientes from anon, authenticated, service_role;
grant select, insert, update on public.clientes to service_role;   -- sem delete: desativar via cliente_definir_ativo

grant execute on function public.cpf_valido(text) to service_role;
grant execute on function public.cliente_salvar(uuid, text, text, text, text, text, uuid) to service_role;
grant execute on function public.cliente_definir_ativo(uuid, uuid, boolean) to service_role;
grant execute on function public.finalizar_venda_pdv_cliente(uuid, text, uuid[], numeric[], numeric, boolean, uuid) to service_role;

revoke execute on function public.cpf_valido(text) from public, anon, authenticated;
revoke execute on function public.cliente_salvar(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.cliente_definir_ativo(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.finalizar_venda_pdv_cliente(uuid, text, uuid[], numeric[], numeric, boolean, uuid) from public, anon, authenticated;
