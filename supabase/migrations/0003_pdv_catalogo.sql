-- 0003_pdv_catalogo.sql · ADEGA SB · funde Catálogo/Estoque (mínimo auditável, multilocal pronto) + PDV de balcão
-- 2026-10-09 · decisão do cliente: "fundir PDV + catálogo numa etapa" (PRD-catalogo-estoque-multilocal.md §7 + modulo-pdv.md §4)
-- Tabelas novas: categorias, produtos, estoque_saldos, estoque_movimentos (catálogo) ·
--                caixas, caixa_sessoes, caixa_movimentos, vendas, venda_itens (PDV).
-- Funções security definer: estoque_movimentar (saldo por local, recusa negativo) e finalizar_venda_pdv (FV-03: transação única).
-- RLS deny-all em todas; escrita/leitura via server actions (service_role). Grants explícitos no fim (pegadinha 0002).
-- Fora de escopo nesta etapa (fica p/ catálogo+estoque profundo): inventário cego, transferências, fichas técnicas com custo real.

create extension if not exists pg_trgm;

-- ================================================================ CATÁLOGO

-- ---------------------------------------------------------------- categorias
create table public.categorias (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  nome       text not null check (length(trim(nome)) > 0),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  unique (tenant_id, nome)
);
create index categorias_tenant_idx on public.categorias (tenant_id);

-- ---------------------------------------------------------------- produtos
-- Colunas já no formato do catálogo multilocal (F2): tipo, unidade, conteúdo para converter dose em fração.
-- Regra PR-07 (herdada): fumígeno ⇒ adulto E não fracionado (CHECK no banco).
create table public.produtos (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  categoria_id      uuid references public.categorias(id),
  sku               text,
  codigo_barras     text,
  nome              text not null check (length(trim(nome)) > 0),
  tipo              text not null default 'revenda' check (tipo in ('revenda', 'preparado', 'insumo')),
  unidade           text not null default 'un' check (unidade in ('un', 'kg', 'l')),
  conteudo          numeric(12,3),
  conteudo_unidade  text check (conteudo_unidade is null or conteudo_unidade in ('ml', 'g', 'un')),
  adulto            boolean not null default false,
  fumigeno          boolean not null default false,
  vende_fracionado  boolean not null default false,
  preco_varejo      numeric(12,2) not null check (preco_varejo >= 0),
  preco_atacado     numeric(12,2) check (preco_atacado is null or preco_atacado >= 0),
  custo_medio       numeric(12,4),
  ncm               text,
  cest              text,
  origem            smallint not null default 0,
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  unique (tenant_id, codigo_barras),
  check (not fumigeno or (adulto and not vende_fracionado))
);
create index produtos_tenant_idx on public.produtos (tenant_id);
create index produtos_nome_trgm on public.produtos using gin (nome gin_trgm_ops);
create index produtos_codigo_idx on public.produtos (tenant_id, codigo_barras);

create or replace function public.produtos_tocar_atualizado_em() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  return new;
end $$;
create trigger produtos_atualizado_em before update on public.produtos
  for each row execute function public.produtos_tocar_atualizado_em();

-- ---------------------------------------------------------------- estoque_saldos (por local)
create table public.estoque_saldos (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  produto_id  uuid not null references public.produtos(id) on delete cascade,
  local_id    uuid not null references public.locais(id) on delete cascade,
  quantidade  numeric(12,3) not null default 0,
  minimo      numeric(12,3) not null default 0,
  primary key (produto_id, local_id)
);
create index estoque_saldos_local_idx on public.estoque_saldos (local_id);

-- ---------------------------------------------------------------- estoque_movimentos (append-only)
create table public.estoque_movimentos (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  produto_id   uuid not null references public.produtos(id),
  local_id     uuid not null references public.locais(id),
  tipo         text not null check (tipo in ('entrada', 'saida_venda', 'consumo_ficha', 'ajuste',
                                             'perda', 'transferencia_saida', 'transferencia_entrada', 'inventario')),
  quantidade   numeric(12,3) not null check (quantidade <> 0),   -- negativo = saída
  custo_unit   numeric(12,4),
  motivo       text,
  origem_tipo  text,
  origem_id    uuid,
  usuario_id   uuid,
  criado_em    timestamptz not null default now()
);
create index estoque_movimentos_produto_idx on public.estoque_movimentos (produto_id, criado_em desc);

create or replace function public.estoque_movimento_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'estoque_movimentos é append-only (% recusado)', tg_op using errcode = '42501';
end $$;
create trigger estoque_movimentos_sem_update before update or delete on public.estoque_movimentos
  for each row execute function public.estoque_movimento_imutavel();

-- ================================================================ PDV

-- ---------------------------------------------------------------- caixas (ligado a um local: a venda baixa o estoque daquele local)
create table public.caixas (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  local_id   uuid not null references public.locais(id),
  nome       text not null check (length(trim(nome)) > 0),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  unique (tenant_id, nome)
);
create index caixas_tenant_idx on public.caixas (tenant_id);

-- ---------------------------------------------------------------- caixa_sessoes
create table public.caixa_sessoes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  caixa_id        uuid not null references public.caixas(id),
  local_id        uuid not null references public.locais(id),
  operador_id     uuid not null references public.profiles(id),
  status          text not null default 'aberta' check (status in ('aberta', 'fechada')),
  aberta_em       timestamptz not null default now(),
  valor_abertura  numeric(12,2) not null check (valor_abertura >= 0),
  fechada_em      timestamptz,
  valor_esperado  numeric(12,2),
  valor_contado   numeric(12,2),
  diferenca       numeric(12,2)
);
-- só uma sessão aberta por caixa (CX: unicidade)
create unique index caixa_uma_sessao_aberta on public.caixa_sessoes (caixa_id) where status = 'aberta';
create index caixa_sessoes_tenant_idx on public.caixa_sessoes (tenant_id);

-- ---------------------------------------------------------------- caixa_movimentos (sangria/suprimento)
create table public.caixa_movimentos (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  sessao_id   uuid not null references public.caixa_sessoes(id),
  tipo        text not null check (tipo in ('sangria', 'suprimento')),
  valor       numeric(12,2) not null check (valor > 0),
  motivo      text not null check (length(trim(motivo)) > 0),
  criado_em   timestamptz not null default now(),
  criado_por  uuid not null references public.profiles(id)
);
create index caixa_movimentos_sessao_idx on public.caixa_movimentos (sessao_id);

-- ---------------------------------------------------------------- vendas (a venda do PDV; canais futuros reusam)
create table public.vendas (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  local_id         uuid not null references public.locais(id),
  caixa_sessao_id  uuid references public.caixa_sessoes(id),
  canal            text not null default 'varejo' check (canal in ('varejo', 'delivery', 'app', 'b2b', 'bar')),
  origem           text not null default 'erp' check (origem in ('erp', 'pdv', 'loja')),
  forma_pagamento  text not null check (forma_pagamento in ('pix', 'cartao', 'dinheiro', 'boleto')),
  subtotal         numeric(12,2) not null default 0 check (subtotal >= 0),
  desconto         numeric(12,2) not null default 0 check (desconto >= 0),
  total            numeric(12,2) not null check (total >= 0),
  cpf              text,
  maior18          boolean not null default false,
  operador_id      uuid not null references public.profiles(id),
  criado_em        timestamptz not null default now()
);
create index vendas_tenant_idx on public.vendas (tenant_id);
create index vendas_sessao_idx on public.vendas (caixa_sessao_id);

-- ---------------------------------------------------------------- venda_itens
create table public.venda_itens (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  venda_id     uuid not null references public.vendas(id) on delete cascade,
  produto_id   uuid not null references public.produtos(id),
  quantidade   numeric(12,3) not null check (quantidade > 0),
  preco_unit   numeric(12,2) not null check (preco_unit >= 0),
  subtotal     numeric(12,2) not null,
  criado_em    timestamptz not null default now()
);
create index venda_itens_venda_idx on public.venda_itens (venda_id);

-- ================================================================ FUNÇÕES

-- ---------------------------------------------------------------- estoque_movimentar
-- Único caminho para mudar saldo. p_quantidade com sinal (negativo = saída).
-- Recusa saldo negativo, exceto para 'ajuste' (gerente). Grava a linha em estoque_movimentos.
create or replace function public.estoque_movimentar(
  p_produto_id  uuid,
  p_local_id    uuid,
  p_tipo        text,
  p_quantidade  numeric,
  p_motivo      text default null,
  p_origem_tipo text default null,
  p_origem_id   uuid default null,
  p_custo_unit  numeric default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_saldo  numeric;
  v_id     uuid;
begin
  if p_quantidade = 0 then raise exception 'quantidade do movimento não pode ser zero'; end if;

  select tenant_id into v_tenant from public.produtos where id = p_produto_id;
  if v_tenant is null then raise exception 'produto não encontrado'; end if;
  if not exists (select 1 from public.locais where id = p_local_id and tenant_id = v_tenant) then
    raise exception 'local não encontrado para este tenant';
  end if;

  select coalesce((select quantidade from public.estoque_saldos
                   where produto_id = p_produto_id and local_id = p_local_id), 0) into v_saldo;

  if (v_saldo + p_quantidade) < 0 and p_tipo <> 'ajuste' then
    raise exception 'saldo insuficiente no local (saldo atual: %)', v_saldo;
  end if;

  insert into public.estoque_movimentos
    (tenant_id, produto_id, local_id, tipo, quantidade, custo_unit, motivo, origem_tipo, origem_id, usuario_id)
  values
    (v_tenant, p_produto_id, p_local_id, p_tipo, p_quantidade, p_custo_unit, p_motivo, p_origem_tipo, p_origem_id,
     nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid)
  returning id into v_id;

  insert into public.estoque_saldos (tenant_id, produto_id, local_id, quantidade)
  values (v_tenant, p_produto_id, p_local_id, p_quantidade)
  on conflict (produto_id, local_id)
  do update set quantidade = public.estoque_saldos.quantidade + excluded.quantidade;

  return v_id;
end $$;

-- ---------------------------------------------------------------- finalizar_venda_pdv (FV-03, transação única)
-- Preço vem do banco (nunca do navegador). Item adulto exige p_maior18 (DL-12).
-- Uma falha no meio (ex.: estoque insuficiente) desfaz tudo (a function roda numa transação).
create or replace function public.finalizar_venda_pdv(
  p_caixa_sessao_id  uuid,
  p_forma_pagamento  text,
  p_produtos         uuid[],
  p_quantidades      numeric[],
  p_desconto         numeric default 0,
  p_cpf              text default null,
  p_maior18          boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_sessao    public.caixa_sessoes%rowtype;
  v_tenant    uuid;
  v_operador  uuid;
  v_venda_id  uuid;
  v_subtotal  numeric(12,2) := 0;
  i           int;
  v_pid       uuid;
  v_qtd       numeric;
  v_preco     numeric(12,2);
  v_adulto    boolean;
begin
  if p_desconto < 0 then raise exception 'desconto não pode ser negativo'; end if;
  if p_forma_pagamento not in ('pix', 'cartao', 'dinheiro', 'boleto') then raise exception 'forma de pagamento inválida'; end if;
  if coalesce(array_length(p_produtos, 1), 0) = 0 then raise exception 'a comanda está vazia'; end if;
  if array_length(p_produtos, 1) <> array_length(p_quantidades, 1) then raise exception 'itens e quantidades não batem'; end if;

  select * into v_sessao from public.caixa_sessoes where id = p_caixa_sessao_id for update;
  if v_sessao.id is null then raise exception 'sessão de caixa não encontrada'; end if;
  if v_sessao.status <> 'aberta' then raise exception 'caixa fechado: abra o caixa para vender'; end if;

  v_tenant   := v_sessao.tenant_id;
  v_operador := v_sessao.operador_id;

  -- 1º laço: valida tudo e acumula o subtotal (preço lido do banco)
  for i in 1 .. array_length(p_produtos, 1) loop
    v_pid := p_produtos[i];
    v_qtd := p_quantidades[i];
    if v_qtd is null or v_qtd <= 0 then raise exception 'quantidade deve ser maior que zero'; end if;
    select preco_varejo, adulto into v_preco, v_adulto
      from public.produtos where id = v_pid and tenant_id = v_tenant and ativo;
    if v_preco is null then raise exception 'produto indisponível na comanda'; end if;
    if v_adulto and not coalesce(p_maior18, false) then
      raise exception 'item +18: confirme que o cliente é maior de 18 anos';
    end if;
    v_subtotal := v_subtotal + round(v_preco * v_qtd, 2);
  end loop;

  if p_desconto > v_subtotal then raise exception 'desconto maior que o subtotal'; end if;

  insert into public.vendas
    (tenant_id, local_id, caixa_sessao_id, canal, origem, forma_pagamento,
     subtotal, desconto, total, cpf, maior18, operador_id)
  values
    (v_tenant, v_sessao.local_id, p_caixa_sessao_id, 'varejo', 'pdv', p_forma_pagamento,
     v_subtotal, p_desconto, greatest(0, v_subtotal - p_desconto), p_cpf, coalesce(p_maior18, false), v_operador)
  returning id into v_venda_id;

  -- 2º laço: grava itens e baixa estoque (movimento append-only + saldo por local)
  for i in 1 .. array_length(p_produtos, 1) loop
    v_pid := p_produtos[i];
    v_qtd := p_quantidades[i];
    select preco_varejo into v_preco from public.produtos where id = v_pid and tenant_id = v_tenant;
    insert into public.venda_itens (tenant_id, venda_id, produto_id, quantidade, preco_unit, subtotal)
    values (v_tenant, v_venda_id, v_pid, v_qtd, v_preco, round(v_preco * v_qtd, 2));
    perform public.estoque_movimentar(v_pid, v_sessao.local_id, 'saida_venda', -v_qtd,
                                      'venda PDV', 'venda', v_venda_id, null);
  end loop;

  return v_venda_id;
end $$;

-- ================================================================ AUDIT (produtos e vendas)
create trigger produtos_audit after insert or update or delete on public.produtos
  for each row execute function public.audit_registrar();
create trigger vendas_audit after insert or update or delete on public.vendas
  for each row execute function public.audit_registrar();

-- ================================================================ RLS (deny-all por padrão)
alter table public.categorias        enable row level security;
alter table public.produtos          enable row level security;
alter table public.estoque_saldos    enable row level security;
alter table public.estoque_movimentos enable row level security;
alter table public.caixas            enable row level security;
alter table public.caixa_sessoes     enable row level security;
alter table public.caixa_movimentos  enable row level security;
alter table public.vendas            enable row level security;
alter table public.venda_itens       enable row level security;
-- sem policies: authenticated e anon não leem nada direto. Tudo via service_role nas server actions.

-- ================================================================ GRANTS (explícitos — pegadinha 0002)
revoke all on public.categorias, public.produtos, public.estoque_saldos, public.estoque_movimentos,
  public.caixas, public.caixa_sessoes, public.caixa_movimentos, public.vendas, public.venda_itens
  from anon, authenticated;
revoke references, trigger, truncate on public.categorias, public.produtos, public.estoque_saldos, public.estoque_movimentos,
  public.caixas, public.caixa_sessoes, public.caixa_movimentos, public.vendas, public.venda_itens
  from anon, authenticated, service_role;

grant select, insert, update, delete on public.categorias, public.produtos, public.estoque_saldos,
  public.caixas, public.caixa_sessoes, public.caixa_movimentos, public.vendas, public.venda_itens to service_role;
grant select on public.estoque_movimentos to service_role;   -- append-only: sem insert/update/delete via grant (função insere)
grant execute on function public.estoque_movimentar(uuid, uuid, text, numeric, text, text, uuid, numeric) to service_role;
grant execute on function public.finalizar_venda_pdv(uuid, text, uuid[], numeric[], numeric, text, boolean) to service_role;
revoke execute on function public.estoque_movimentar(uuid, uuid, text, numeric, text, text, uuid, numeric) from public, anon, authenticated;
revoke execute on function public.finalizar_venda_pdv(uuid, text, uuid[], numeric[], numeric, text, boolean) from public, anon, authenticated;
