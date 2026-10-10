-- 0005_bar.sql · ADEGA SB · mesas, comandas e copão (F4.1 do roadmap-enterprise.md)
-- 2026-10-10 · segue a 0004 (fichas_tecnicas, estoque_saldos, estoque_movimentar, copoes_disponiveis já existem).
-- Tabelas novas: mesas, mesas_status_log, comandas, comanda_itens.
-- Funções security definer: mesa_abrir/mesa_transferir/mesa_dividir/mesa_fechar ·
--   comanda_abrir/comanda_adicionar/comanda_fechar · copao_vender (aceite F4: 2 copões baixam 200 ml no bar).
-- RLS deny-all nas 4 novas; mesas_status_log append-only via grant. Grants explícitos no fim (pegadinha 0002).

-- ================================================================ mesas (do bar)

create table public.mesas (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  local_id       uuid not null references public.locais(id),
  codigo         text not null check (length(trim(codigo)) > 0),
  capacidade     int  not null default 4 check (capacidade > 0),
  status         text not null default 'livre' check (status in ('livre','ocupada')),
  comanda_id     uuid,  -- FK para comandas adicionada após criar public.comandas
  atualizado_em  timestamptz not null default now(),
  unique (tenant_id, local_id, codigo)
);
create index mesas_tenant_idx on public.mesas (tenant_id, status);

-- log append-only de mudança de status (auditoria)
create table public.mesas_status_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  mesa_id     uuid not null references public.mesas(id) on delete cascade,
  antes       text,
  depois      text,
  usuario_id  uuid,
  criado_em   timestamptz not null default now()
);
create index mesas_status_log_mesa_idx on public.mesas_status_log (mesa_id);

-- ================================================================ comandas

create table public.comandas (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  local_id       uuid not null references public.locais(id),
  mesa_id        uuid references public.mesas(id),
  status         text not null default 'aberta' check (status in ('aberta','fechada')),
  aberta_por     uuid,
  aberta_em      timestamptz not null default now(),
  fechada_em     timestamptz,
  total          numeric(12,2) not null default 0 check (total >= 0),
  venda_id       uuid references public.vendas(id)
);

-- ================================================================ comanda_itens

create table public.comanda_itens (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  comanda_id    uuid not null references public.comandas(id) on delete cascade,
  produto_id    uuid not null references public.produtos(id),
  quantidade    numeric(12,3) not null check (quantidade > 0),
  preco_unit    numeric(12,2) not null check (preco_unit >= 0),
  subtotal      numeric(12,2) not null check (subtotal >= 0),
  tipo_item     text not null default 'copao' check (tipo_item in ('copao','revenda','consumo_interno')),
  criado_em     timestamptz not null default now()
);
create index comanda_itens_comanda_idx on public.comanda_itens (comanda_id);

-- FK de mesas.comanda_id → comandas.id (agora que comandas existe)
alter table public.mesas
  add constraint mesas_comanda_fk
  foreign key (comanda_id) references public.comandas(id);

-- aberta_por é profile real (integridade de quem abriu a comanda)
alter table public.comandas
  add constraint comandas_aberta_por_fk
  foreign key (aberta_por) references public.profiles(id);

-- ================================================================ índices

create index comandas_tenant_idx on public.comandas (tenant_id, status);

-- ================================================================ funções de mesa

-- Abre uma mesa (livre → ocupada) e cria a comanda. Retorna comanda_id.
create or replace function public.mesa_abrir(p_mesa uuid, p_aberto_por uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m public.mesas%rowtype;
  v_comanda uuid;
begin
  select * into m from public.mesas where id = p_mesa for update;
  if m.id is null then raise exception 'mesa não encontrada'; end if;
  if m.status <> 'livre' then raise exception 'mesa já está ocupada'; end if;

  insert into public.comandas (tenant_id, local_id, mesa_id, aberta_por)
  values (m.tenant_id, m.local_id, m.id, p_aberto_por)
  returning id into v_comanda;

  update public.mesas set status = 'ocupada', comanda_id = v_comanda, atualizado_em = now() where id = p_mesa;

  insert into public.mesas_status_log (tenant_id, mesa_id, antes, depois, usuario_id)
  values (m.tenant_id, p_mesa, 'livre', 'ocupada', p_aberto_por);

  return v_comanda;
end $$;

-- Transfere a comanda de uma mesa para outra (mesa A fica livre, B ocupada).
create or replace function public.mesa_transferir(p_mesa_origem uuid, p_mesa_destino uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.mesas%rowtype;
  b public.mesas%rowtype;
begin
  select * into a from public.mesas where id = p_mesa_origem for update;
  select * into b from public.mesas where id = p_mesa_destino for update;
  if a.id is null or b.id is null then raise exception 'mesa não encontrada'; end if;
  if a.status <> 'ocupada' then raise exception 'mesa de origem não está ocupada'; end if;
  if b.status <> 'livre' then raise exception 'mesa de destino está ocupada'; end if;

  -- move a comanda junto: senão comandas.mesa_id ficaria apontando para a mesa antiga
  if a.comanda_id is not null then
    update public.comandas set mesa_id = b.id where id = a.comanda_id;
  end if;

  update public.mesas set comanda_id = a.comanda_id, status = 'ocupada', atualizado_em = now() where id = b.id;
  update public.mesas set comanda_id = null, status = 'livre', atualizado_em = now() where id = a.id;

  insert into public.mesas_status_log (tenant_id, mesa_id, antes, depois, usuario_id)
  values (a.tenant_id, p_mesa_origem, 'ocupada', 'livre', null);
  insert into public.mesas_status_log (tenant_id, mesa_id, antes, depois, usuario_id)
  values (b.tenant_id, p_mesa_destino, 'livre', 'ocupada', null);
end $$;

-- Dividir comanda: cria uma nova comanda na mesa de destino e move os itens de p_itens
-- para ela. Exige que AMBAS as comandas fiquem com ≥1 item (senão comanda_fechar recusaria
-- a origem por estar vazia). Retorna a nova comanda.
create or replace function public.mesa_dividir(
  p_comanda_origem uuid, p_mesa_destino uuid, p_itens uuid[]
) returns uuid  -- nova comanda
language plpgsql security definer set search_path = public as $$
declare
  c    public.comandas%rowtype;
  b    public.mesas%rowtype;
  v_nova uuid;
  v_move int;
  v_fica int;
begin
  if coalesce(array_length(p_itens, 1), 0) = 0 then
    raise exception 'escolha ao menos um item para mover';
  end if;
  select * into c from public.comandas where id = p_comanda_origem for update;
  if c.id is null then raise exception 'comanda não encontrada'; end if;
  if c.status <> 'aberta' then raise exception 'só comanda aberta pode ser dividida'; end if;

  select * into b from public.mesas where id = p_mesa_destino for update;
  if b.id is null then raise exception 'mesa de destino não encontrada'; end if;
  if b.status <> 'livre' then raise exception 'mesa de destino está ocupada'; end if;
  if b.local_id <> c.local_id then raise exception 'mesas de locais diferentes'; end if;

  -- só move itens que pertencem à comanda de origem
  select count(*) into v_move
    from public.comanda_itens
   where comanda_id = p_comanda_origem and id = any (p_itens);
  if v_move <> array_length(p_itens, 1) then
    raise exception 'item fora desta comanda';
  end if;

  select count(*) into v_fica
    from public.comanda_itens
   where comanda_id = p_comanda_origem and not (id = any (p_itens));
  if v_fica = 0 then
    raise exception 'a comanda de origem ficaria vazia: transfira a mesa em vez de dividir';
  end if;

  insert into public.comandas (tenant_id, local_id, mesa_id, aberta_por)
  values (c.tenant_id, c.local_id, p_mesa_destino, c.aberta_por)
  returning id into v_nova;

  update public.comanda_itens set comanda_id = v_nova
   where comanda_id = p_comanda_origem and id = any (p_itens);

  update public.mesas set status = 'ocupada', comanda_id = v_nova, atualizado_em = now()
   where id = p_mesa_destino;

  -- recalcula totais das duas
  update public.comandas tgt
     set total = coalesce((select sum(subtotal) from public.comanda_itens i where i.comanda_id = tgt.id), 0)
   where tgt.id in (p_comanda_origem, v_nova);

  insert into public.mesas_status_log (tenant_id, mesa_id, antes, depois, usuario_id)
  values (b.tenant_id, p_mesa_destino, 'livre', 'ocupada', null);

  return v_nova;
end $$;

-- Fecha a mesa (ocupada → livre) — a comanda deve estar fechada.
create or replace function public.mesa_fechar(p_mesa uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.mesas%rowtype;
begin
  select * into m from public.mesas where id = p_mesa for update;
  if m.id is null then raise exception 'mesa não encontrada'; end if;
  if m.status <> 'ocupada' then raise exception 'mesa não está ocupada'; end if;
  if m.comanda_id is not null then
    if exists (select 1 from public.comandas where id = m.comanda_id and status = 'aberta') then
      raise exception 'feche a comanda antes de liberar a mesa';
    end if;
  end if;

  update public.mesas set status = 'livre', comanda_id = null, atualizado_em = now() where id = p_mesa;
  insert into public.mesas_status_log (tenant_id, mesa_id, antes, depois, usuario_id)
  values (m.tenant_id, p_mesa, 'ocupada', 'livre', null);
end $$;

-- ================================================================ funções de comanda

-- Abre uma comanda avulsa (sem mesa) — fallback quando não há mesa.
create or replace function public.comanda_abrir(p_local uuid, p_aberto_por uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_comanda uuid;
begin
  insert into public.comandas (tenant_id, local_id, aberta_por)
  values ((select tenant_id from public.locais where id = p_local), p_local, p_aberto_por)
  returning id into v_comanda;
  return v_comanda;
end $$;

-- Adiciona item à comanda (preço lido do banco). 'copao' consome insumos no fechar.
-- p_maior18: o operador confirma a idade para itens com produtos.adulto (regra PR-07 da 0003).
create or replace function public.comanda_adicionar(
  p_comanda uuid, p_produto uuid, p_quantidade numeric,
  p_tipo_item text default 'copao', p_maior18 boolean default false
) returns uuid  -- id do item
language plpgsql security definer set search_path = public as $$
declare
  c public.comandas%rowtype;
  p public.produtos%rowtype;
  v_preco numeric(12,2);
  v_sub  numeric(12,2);
  v_item uuid;
begin
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'quantidade deve ser maior que zero'; end if;
  select * into c from public.comandas where id = p_comanda for update;
  if c.id is null then raise exception 'comanda não encontrada'; end if;
  if c.status <> 'aberta' then raise exception 'comanda está fechada'; end if;

  select * into p from public.produtos where id = p_produto and tenant_id = c.tenant_id and ativo;
  if p.id is null then raise exception 'produto indisponível'; end if;
  if p.adulto and not coalesce(p_maior18, false) then
    raise exception 'item +18: confirme que o cliente é maior de 18 anos';
  end if;

  v_preco := p.preco_varejo;
  v_sub := round(v_preco * p_quantidade, 2);

  insert into public.comanda_itens (tenant_id, comanda_id, produto_id, quantidade, preco_unit, subtotal, tipo_item)
  values (c.tenant_id, p_comanda, p_produto, p_quantidade, v_preco, v_sub, p_tipo_item)
  returning id into v_item;

  update public.comandas set total = total + v_sub where id = p_comanda;

  return v_item;
end $$;

-- Fecha a comanda: gera a venda (canal 'bar') e baixa estoque (copão consome insumos via ficha).
-- Lê o operador da caixa_sessoes (coluna NOT NULL) e valida que a sessão está aberta — mesmo
-- padrão da finalizar_venda_pdv (0003/0004). origem = 'pdv' porque o CHECK de vendas não aceita 'bar'.
create or replace function public.comanda_fechar(
  p_comanda uuid, p_caixa_sessao uuid, p_forma_pagamento text
) returns uuid  -- venda_id
language plpgsql security definer set search_path = public as $$
declare
  c        public.comandas%rowtype;
  sessao   public.caixa_sessoes%rowtype;
  v_venda  uuid;
  r        record;
  v_sub    numeric(12,2) := 0;
begin
  if p_forma_pagamento not in ('pix', 'cartao', 'dinheiro', 'boleto') then
    raise exception 'forma de pagamento inválida';
  end if;
  select * into c from public.comandas where id = p_comanda for update;
  if c.id is null then raise exception 'comanda não encontrada'; end if;
  if c.status <> 'aberta' then raise exception 'comanda já está fechada'; end if;

  select * into sessao from public.caixa_sessoes where id = p_caixa_sessao for update;
  if sessao.id is null then raise exception 'sessão de caixa não encontrada'; end if;
  if sessao.status <> 'aberta' then raise exception 'caixa fechado: abra o caixa para faturar'; end if;
  if sessao.tenant_id <> c.tenant_id then raise exception 'caixa de outro tenant'; end if;

  select coalesce(sum(subtotal), 0) into v_sub from public.comanda_itens where comanda_id = p_comanda;
  if v_sub <= 0 then raise exception 'comanda está vazia'; end if;

  insert into public.vendas
    (tenant_id, local_id, caixa_sessao_id, canal, origem, forma_pagamento,
     subtotal, desconto, total, operador_id)
  values
    (c.tenant_id, c.local_id, p_caixa_sessao, 'bar', 'pdv', p_forma_pagamento,
     v_sub, 0, v_sub, sessao.operador_id)
  returning id into v_venda;

  -- grava itens da venda e baixa estoque
  for r in select * from public.comanda_itens where comanda_id = p_comanda loop
    insert into public.venda_itens (tenant_id, venda_id, produto_id, quantidade, preco_unit, subtotal)
    values (c.tenant_id, v_venda, r.produto_id, r.quantidade, r.preco_unit, r.subtotal);

    if r.tipo_item = 'copao' and exists (select 1 from public.fichas_tecnicas where produto_id = r.produto_id) then
      perform public.ficha_consumir(r.produto_id, c.local_id, r.quantidade, 'venda', v_venda);
    else
      perform public.estoque_movimentar(r.produto_id, c.local_id, 'saida_venda', -r.quantidade,
                                        'venda bar (comanda)', 'venda', v_venda, null);
    end if;
  end loop;

  update public.comandas
     set status = 'fechada', total = v_sub, venda_id = v_venda, fechada_em = now()
   where id = p_comanda;

  return v_venda;
end $$;

-- ================================================================ copao_vender (aceite F4)
-- Vende N copões de um produto preparado no local (bar). Consome insumos via ficha.
-- Operador lido da caixa_sessoes (NOT NULL); origem = 'pdv' (CHECK de vendas não aceita 'bar').
create or replace function public.copao_vender(
  p_produto uuid, p_local uuid, p_quantidade numeric, p_caixa_sessao uuid, p_forma_pagamento text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  sessao public.caixa_sessoes%rowtype;
  p      public.produtos%rowtype;
  v_venda uuid;
  v_sub  numeric(12,2);
begin
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'quantidade deve ser maior que zero'; end if;
  if p_forma_pagamento not in ('pix', 'cartao', 'dinheiro', 'boleto') then
    raise exception 'forma de pagamento inválida';
  end if;

  select * into sessao from public.caixa_sessoes where id = p_caixa_sessao for update;
  if sessao.id is null then raise exception 'sessão de caixa não encontrada'; end if;
  if sessao.status <> 'aberta' then raise exception 'caixa fechado: abra o caixa para vender'; end if;
  if sessao.local_id <> p_local then raise exception 'caixa não pertence a este local'; end if;

  select * into p from public.produtos where id = p_produto and tenant_id = sessao.tenant_id and ativo;
  if p.id is null then raise exception 'produto indisponível'; end if;
  if p.tipo <> 'preparado' then raise exception 'produto não é preparado (copão)'; end if;
  if not exists (select 1 from public.fichas_tecnicas where produto_id = p_produto) then
    raise exception 'produto sem ficha técnica';
  end if;

  v_sub := round(p.preco_varejo * p_quantidade, 2);

  insert into public.vendas
    (tenant_id, local_id, caixa_sessao_id, canal, origem, forma_pagamento,
     subtotal, desconto, total, operador_id)
  values
    (sessao.tenant_id, p_local, p_caixa_sessao, 'bar', 'pdv', p_forma_pagamento,
     v_sub, 0, v_sub, sessao.operador_id)
  returning id into v_venda;

  insert into public.venda_itens (tenant_id, venda_id, produto_id, quantidade, preco_unit, subtotal)
  values (sessao.tenant_id, v_venda, p_produto, p_quantidade, p.preco_varejo, v_sub);

  perform public.ficha_consumir(p_produto, p_local, p_quantidade, 'venda', v_venda);

  return v_venda;
end $$;

-- ================================================================ AUDIT

create trigger mesas_audit after insert or update or delete on public.mesas
  for each row execute function public.audit_registrar();
create trigger comandas_audit after insert or update or delete on public.comandas
  for each row execute function public.audit_registrar();

-- ================================================================ RLS (deny-all por padrão)

alter table public.mesas             enable row level security;
alter table public.mesas_status_log  enable row level security;
alter table public.comandas          enable row level security;
alter table public.comanda_itens     enable row level security;
-- sem policies: authenticated e anon não leem nada direto. Tudo via service_role nas server actions.

-- ================================================================ GRANTS (explícitos — pegadinha 0002)

revoke all on public.mesas, public.mesas_status_log, public.comandas, public.comanda_itens
  from anon, authenticated;
revoke references, trigger, truncate on public.mesas, public.mesas_status_log, public.comandas, public.comanda_itens
  from anon, authenticated, service_role;

grant select, insert, update, delete on public.mesas, public.comandas, public.comanda_itens to service_role;
grant select on public.mesas_status_log to service_role;  -- append-only: log só via função

grant execute on function public.mesa_abrir(uuid,uuid) to service_role;
grant execute on function public.mesa_transferir(uuid,uuid) to service_role;
grant execute on function public.mesa_dividir(uuid,uuid,uuid[]) to service_role;
grant execute on function public.mesa_fechar(uuid) to service_role;
grant execute on function public.comanda_abrir(uuid,uuid) to service_role;
grant execute on function public.comanda_adicionar(uuid,uuid,numeric,text,boolean) to service_role;
grant execute on function public.comanda_fechar(uuid,uuid,text) to service_role;
grant execute on function public.copao_vender(uuid,uuid,numeric,uuid,text) to service_role;

revoke execute on function public.mesa_abrir(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.mesa_transferir(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.mesa_dividir(uuid,uuid,uuid[]) from public, anon, authenticated;
revoke execute on function public.mesa_fechar(uuid) from public, anon, authenticated;
revoke execute on function public.comanda_abrir(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.comanda_adicionar(uuid,uuid,numeric,text,boolean) from public, anon, authenticated;
revoke execute on function public.comanda_fechar(uuid,uuid,text) from public, anon, authenticated;
revoke execute on function public.copao_vender(uuid,uuid,numeric,uuid,text) from public, anon, authenticated;
