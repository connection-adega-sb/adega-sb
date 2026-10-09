-- 0004_catalogo_estoque.sql · ADEGA SB · catálogo + estoque profundo (PRD-catalogo-estoque-multilocal.md §5)
-- 2026-10-09 · segue a 0003 (categorias, produtos, estoque_saldos, estoque_movimentos e
-- estoque_movimentar já existem; as colunas unidade/conteudo/custo_medio/ncm/cest/origem também).
-- Tabelas novas: transferencias, transferencia_itens, inventarios, inventario_itens,
--                fichas_tecnicas, fichas_tecnicas_insumos, fichas_tecnicas_historico.
-- ALTERs: estoque_saldos.estoque_minimo · CHECKs em produtos (fumigeno => revenda; conteudo > 0).
-- Funções security definer: transferencia_criar/enviar/receber/cancelar · inventario_abrir/fechar/aprovar/cancelar ·
--                ficha_salvar/ficha_consumir/ficha_cmv/ficha_aplicar_preco · copoes_disponiveis.
-- finalizar_venda_pdv re-escrita (MESMA assinatura): produto 'preparado' com ficha consome insumos via
-- ficha_consumir numa transação única (PRD §5.4 / modulo-pdv.md §5.5 PR-04); sem ficha, baixa o próprio produto.
-- RLS deny-all nas 7 novas; fichas_tecnicas_historico append-only via grant. Grants explícitos no fim (pegadinha 0002).

-- ================================================================ ALTERs (o que a 0003 NÃO criou)
-- estoque_saldos.minimo já existe desde a 0003; só reforçamos com CHECK (valor negativo não faz sentido).
alter table public.estoque_saldos add constraint estoque_saldos_minimo_ok check (minimo >= 0);

-- PR-07 (modulo-pdv.md §5.5): fumígeno nunca é preparado (só revenda). Linhas existentes: só o cigarro (revenda) ✓.
alter table public.produtos add constraint produtos_fumigeno_revenda check (not fumigeno or tipo = 'revenda');
alter table public.produtos add constraint produtos_conteudo_positivo check (conteudo is null or conteudo > 0);

-- ================================================================ transferências (depósito → loja/bar)

create table public.transferencias (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id),
  origem_local_id  uuid not null references public.locais(id),
  destino_local_id uuid not null references public.locais(id),
  status           text not null default 'rascunho'
                   check (status in ('rascunho','enviada','recebida','cancelada')),
  motivo           text,
  criado_por       uuid,
  criado_em        timestamptz not null default now(),
  enviado_em       timestamptz,
  recebido_em      timestamptz,
  cancelado_em     timestamptz,
  constraint transferencias_locais_diferentes check (origem_local_id <> destino_local_id)
);

create table public.transferencia_itens (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id),
  transferencia_id uuid not null references public.transferencias(id) on delete cascade,
  produto_id       uuid not null references public.produtos(id),
  quantidade       numeric(12,3) not null check (quantidade > 0),
  recebida         numeric(12,3) check (recebida is null or recebida >= 0),  -- contagem no recebimento
  constraint transferencia_itens_unicos unique (transferencia_id, produto_id)
);

-- ================================================================ inventário cego

create table public.inventarios (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id),
  local_id           uuid not null references public.locais(id),
  categoria_id       uuid references public.categorias(id),
  status             text not null default 'aberto'
                     check (status in ('aberto','em_revisao','aprovado','cancelado')),
  aberto_por         uuid,
  aberto_em          timestamptz not null default now(),
  fechado_em         timestamptz,
  aprovado_por       uuid,
  aprovado_em        timestamptz,
  cancelado_em       timestamptz,
  motivo_cancelamento text
);

create table public.inventario_itens (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id),
  inventario_id       uuid not null references public.inventarios(id) on delete cascade,
  produto_id          uuid not null references public.produtos(id),
  contado             numeric(12,3) check (contado is null or contado >= 0),  -- null = não contado (fica de fora)
  saldo_no_fechamento numeric(12,3) not null default 0,  -- congelado no fechar; a UI do contador nunca mostra
  constraint inventario_itens_unicos unique (inventario_id, produto_id)
);

-- ================================================================ fichas técnicas do copão (PR-01…PR-08)

create table public.fichas_tecnicas (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  produto_id    uuid not null references public.produtos(id),   -- produto PREPARADO (copão)
  markup        numeric(6,2) not null default 2.5 check (markup > 0),
  criado_por    uuid,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint ficha_produto_unico unique (produto_id)
);

create table public.fichas_tecnicas_insumos (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id),
  ficha_id          uuid not null references public.fichas_tecnicas(id) on delete cascade,
  insumo_produto_id uuid not null references public.produtos(id),
  quantidade        numeric(12,4) not null check (quantidade > 0),  -- dose por copo
  unidade           text not null check (unidade in ('ml','g','un')),
  constraint insumo_unico unique (ficha_id, insumo_produto_id)
);

create table public.fichas_tecnicas_historico (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id),
  ficha_id   uuid not null references public.fichas_tecnicas(id) on delete cascade,
  antes      jsonb,
  depois     jsonb,
  usuario_id uuid,
  criado_em  timestamptz not null default now()
);

-- ================================================================ índices

create index transferencias_tenant_idx     on public.transferencias (tenant_id, status);
create index trans_itens_produto_idx       on public.transferencia_itens (produto_id);
create index inventarios_tenant_idx        on public.inventarios (tenant_id, status);
create index inv_itens_produto_idx         on public.inventario_itens (produto_id);
create index fichas_insumos_produto_idx    on public.fichas_tecnicas_insumos (insumo_produto_id);  -- PR-04: recálculo por insumo
-- (estoque_saldos_local_idx já existe desde a 0003)

-- ================================================================ transferências (funções)

-- Cria em rascunho. Origem e destino no mesmo tenant; produto ativo; quantidade > 0.
create or replace function public.transferencia_criar(
  p_origem      uuid,
  p_destino     uuid,
  p_produtos    uuid[],
  p_quantidades numeric[],
  p_motivo      text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_id     uuid;
  i        int;
begin
  if p_origem = p_destino then raise exception 'origem e destino são o mesmo local'; end if;
  if coalesce(array_length(p_produtos, 1), 0) = 0 then raise exception 'a transferência está vazia'; end if;
  if array_length(p_produtos, 1) <> array_length(p_quantidades, 1) then raise exception 'itens e quantidades não batem'; end if;

  select tenant_id into v_tenant from public.locais where id = p_origem;
  if v_tenant is null then raise exception 'local de origem não encontrado'; end if;
  if not exists (select 1 from public.locais where id = p_destino and tenant_id = v_tenant) then
    raise exception 'local de destino não encontrado para este tenant';
  end if;

  insert into public.transferencias (tenant_id, origem_local_id, destino_local_id, motivo, criado_por)
  values (v_tenant, p_origem, p_destino, nullif(trim(coalesce(p_motivo, '')), ''),
          nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid)
  returning id into v_id;

  for i in 1 .. array_length(p_produtos, 1) loop
    if p_quantidades[i] is null or p_quantidades[i] <= 0 then raise exception 'quantidade deve ser maior que zero'; end if;
    if not exists (select 1 from public.produtos where id = p_produtos[i] and tenant_id = v_tenant and ativo) then
      raise exception 'produto indisponível para transferência';
    end if;
    begin
      insert into public.transferencia_itens (tenant_id, transferencia_id, produto_id, quantidade)
      values (v_tenant, v_id, p_produtos[i], p_quantidades[i]);
    exception when unique_violation then
      raise exception 'produto repetido na transferência';
    end;
  end loop;
  return v_id;
end $$;

-- Envia: baixa tudo na origem (estoque_movimentar recusa saldo negativo — FV-03 style).
create or replace function public.transferencia_enviar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t  public.transferencias%rowtype;
  it record;
  v_motivo text;
begin
  select * into t from public.transferencias where id = p_id for update;
  if t.id is null then raise exception 'transferência não encontrada'; end if;
  if t.status <> 'rascunho' then raise exception 'só transferência em rascunho pode ser enviada'; end if;

  v_motivo := coalesce(nullif(trim(coalesce(t.motivo, '')), ''), 'transferência para outro local');
  for it in select produto_id, quantidade from public.transferencia_itens where transferencia_id = p_id loop
    perform public.estoque_movimentar(it.produto_id, t.origem_local_id, 'transferencia_saida', -it.quantidade,
                                      v_motivo, 'transferencia', p_id, null);
  end loop;
  update public.transferencias set status = 'enviada', enviado_em = now() where id = p_id;
end $$;

-- Recebe: credita o total ENVIADO no destino e registra a divergência contada como 'perda'
-- na mesma transação (PRD §5.2). recebida > enviada recusa; produto precisa ser item da transferência.
create or replace function public.transferencia_receber(
  p_id        uuid,
  p_produtos  uuid[],
  p_recebidas numeric[]
) returns void
language plpgsql security definer set search_path = public as $$
declare
  t     public.transferencias%rowtype;
  it    record;
  i     int;
  v_rec numeric;
  v_custo numeric;
begin
  select * into t from public.transferencias where id = p_id for update;
  if t.id is null then raise exception 'transferência não encontrada'; end if;
  if t.status <> 'enviada' then raise exception 'só transferência enviada pode ser recebida'; end if;
  if coalesce(array_length(p_produtos, 1), 0) = 0 then raise exception 'informe a contagem dos itens'; end if;
  if array_length(p_produtos, 1) <> array_length(p_recebidas, 1) then raise exception 'itens e contagens não batem'; end if;
  if (select count(*) from (select unnest(p_produtos) x) s)
     <> (select count(distinct x) from (select unnest(p_produtos) x) s) then
    raise exception 'produto repetido no recebimento';
  end if;
  if (select count(*) from public.transferencia_itens where transferencia_id = p_id)
     <> array_length(p_produtos, 1) then
    raise exception 'informe todos os itens do recebimento';
  end if;

  for i in 1 .. array_length(p_produtos, 1) loop
    select * into it from public.transferencia_itens
      where transferencia_id = p_id and produto_id = p_produtos[i] for update;
    if it.id is null then raise exception 'produto não é item desta transferência'; end if;
    v_rec := p_recebidas[i];
    if v_rec is null or v_rec < 0 then raise exception 'contagem inválida'; end if;
    if v_rec > it.quantidade then raise exception 'recebido maior que enviado'; end if;

    select custo_medio into v_custo from public.produtos where id = it.produto_id;
    perform public.estoque_movimentar(it.produto_id, t.destino_local_id, 'transferencia_entrada', it.quantidade,
                                      'recebimento de transferência', 'transferencia', p_id, v_custo);
    if v_rec < it.quantidade then
      perform public.estoque_movimentar(it.produto_id, t.destino_local_id, 'perda', -(it.quantidade - v_rec),
        'divergência no recebimento da transferência', 'transferencia', p_id, v_custo);
    end if;
    update public.transferencia_itens set recebida = v_rec where id = it.id;
  end loop;
  update public.transferencias set status = 'recebida', recebido_em = now() where id = p_id;
end $$;

-- Cancela rascunho (nada mudou) ou enviada (devolve para a origem, auditado).
create or replace function public.transferencia_cancelar(p_id uuid, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  t  public.transferencias%rowtype;
  it record;
  v_custo numeric;
begin
  select * into t from public.transferencias where id = p_id for update;
  if t.id is null then raise exception 'transferência não encontrada'; end if;
  if t.status not in ('rascunho', 'enviada') then raise exception 'só rascunho ou enviada pode ser cancelada'; end if;

  if t.status = 'enviada' then
    for it in select produto_id, quantidade from public.transferencia_itens where transferencia_id = p_id loop
      select custo_medio into v_custo from public.produtos where id = it.produto_id;
      perform public.estoque_movimentar(it.produto_id, t.origem_local_id, 'transferencia_entrada', it.quantidade,
        coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'transferência cancelada'), 'transferencia', p_id, v_custo);
    end loop;
  end if;
  update public.transferencias
    set status = 'cancelada', cancelado_em = now(), motivo = coalesce(nullif(trim(coalesce(p_motivo, '')), ''), motivo)
    where id = p_id;
end $$;

-- ================================================================ inventário (cego)

-- Abre e congela a folha de contagem: produtos ativos com saldo ≠ 0 no local (filtro de categoria opcional).
create or replace function public.inventario_abrir(p_local uuid, p_categoria uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_id     uuid;
  r        record;
begin
  select tenant_id into v_tenant from public.locais where id = p_local;
  if v_tenant is null then raise exception 'local não encontrado'; end if;
  if p_categoria is not null and not exists (select 1 from public.categorias where id = p_categoria and tenant_id = v_tenant) then
    raise exception 'categoria não encontrada para este tenant';
  end if;

  insert into public.inventarios (tenant_id, local_id, categoria_id, aberto_por)
  values (v_tenant, p_local, p_categoria,
          nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid)
  returning id into v_id;

  for r in
    select s.produto_id from public.estoque_saldos s join public.produtos p on p.id = s.produto_id
    where s.local_id = p_local and s.quantidade <> 0 and p.ativo and p.tenant_id = v_tenant
      and (p_categoria is null or p.categoria_id = p_categoria)
  loop
    insert into public.inventario_itens (tenant_id, inventario_id, produto_id)
    values (v_tenant, v_id, r.produto_id);
  end loop;
  return v_id;
end $$;

-- Fecha para revisão: congela o saldo atual em saldo_no_fechamento (o contador já contou às cegas).
create or replace function public.inventario_fechar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv public.inventarios%rowtype;
  r   record;
begin
  select * into inv from public.inventarios where id = p_id for update;
  if inv.id is null then raise exception 'inventário não encontrado'; end if;
  if inv.status <> 'aberto' then raise exception 'só inventário aberto pode ser fechado'; end if;

  for r in select id, produto_id from public.inventario_itens where inventario_id = p_id loop
    update public.inventario_itens
      set saldo_no_fechamento = coalesce(
        (select quantidade from public.estoque_saldos where produto_id = r.produto_id and local_id = inv.local_id), 0)
      where id = r.id;
  end loop;
  update public.inventarios set status = 'em_revisao', fechado_em = now() where id = p_id;
end $$;

-- Aprova: gera movimentos 'inventario' pela diferença (contado − saldo atual). Itens não contados ficam de fora.
-- Dif negativa nunca fica < 0 no saldo (contado >= 0 ⇒ saldo_final = contado). Aprovação é de gerente/master: checada na server action.
create or replace function public.inventario_aprovar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv     public.inventarios%rowtype;
  r       record;
  v_atual numeric;
  v_diff  numeric;
begin
  select * into inv from public.inventarios where id = p_id for update;
  if inv.id is null then raise exception 'inventário não encontrado'; end if;
  if inv.status <> 'em_revisao' then raise exception 'inventário não está em revisão (feche antes de aprovar)'; end if;

  for r in select produto_id, contado from public.inventario_itens where inventario_id = p_id and contado is not null loop
    select coalesce(quantidade, 0) into v_atual
      from public.estoque_saldos where produto_id = r.produto_id and local_id = inv.local_id;
    v_diff := r.contado - v_atual;
    if v_diff <> 0 then
      perform public.estoque_movimentar(r.produto_id, inv.local_id, 'inventario', v_diff,
        'inventário aprovado', 'inventario', p_id, null);
    end if;
  end loop;
  update public.inventarios
    set status = 'aprovado', aprovado_em = now(),
        aprovado_por = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
    where id = p_id;
end $$;

create or replace function public.inventario_cancelar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv public.inventarios%rowtype;
begin
  select * into inv from public.inventarios where id = p_id for update;
  if inv.id is null then raise exception 'inventário não encontrado'; end if;
  if inv.status not in ('aberto', 'em_revisao') then raise exception 'só aberto ou em revisão pode ser cancelado'; end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'informe o motivo do cancelamento'; end if;
  update public.inventarios
    set status = 'cancelado', cancelado_em = now(), motivo_cancelamento = trim(p_motivo)
    where id = p_id;
end $$;

-- ================================================================ fichas técnicas (PR-01…PR-08)

-- Salva ficha + insumos e grava o histórico (PR-03). Valida: fumígeno nunca entra (PR-07);
-- dose ml/g exige insumo com conteúdo compatível; dose 'un' divide pelo conteúdo da embalagem (PR-01).
-- p_insumos: jsonb array [{"produto_id":"…","quantidade":100,"unidade":"ml"}, …]
create or replace function public.ficha_salvar(
  p_produto uuid,
  p_markup  numeric,
  p_insumos jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant   uuid;
  v_ficha    uuid;
  v_antes    jsonb;
  r          record;
  v_pid      uuid;
  v_qtd      numeric;
  v_unid     text;
  v_nome     text;
  v_fumig    boolean;
  v_conteudo numeric;
  v_cunid    text;
  v_n        int := 0;
begin
  if p_markup is null or p_markup <= 0 then raise exception 'markup deve ser maior que zero'; end if;

  select tenant_id, fumigeno into v_tenant, v_fumig from public.produtos where id = p_produto and ativo;
  if v_tenant is null then raise exception 'produto não encontrado'; end if;
  if v_fumig then raise exception 'fumígeno não entra em ficha técnica'; end if;

  select id into v_ficha from public.fichas_tecnicas where produto_id = p_produto for update;
  v_antes := (
    select jsonb_build_object(
             'markup', f.markup,
             'insumos', coalesce((
               select jsonb_agg(jsonb_build_object('produto_id', i.insumo_produto_id, 'quantidade', i.quantidade, 'unidade', i.unidade))
               from public.fichas_tecnicas_insumos i where i.ficha_id = f.id), '[]'::jsonb))
    from public.fichas_tecnicas f where f.id = v_ficha);

  if v_ficha is null then
    insert into public.fichas_tecnicas (tenant_id, produto_id, markup, criado_por)
    values (v_tenant, p_produto, p_markup,
            nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid)
    returning id into v_ficha;
  else
    update public.fichas_tecnicas set markup = p_markup, atualizado_em = now() where id = v_ficha;
    delete from public.fichas_tecnicas_insumos where ficha_id = v_ficha;
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_insumos, '[]'::jsonb)) loop
    v_n := v_n + 1;
    begin
      v_pid  := (r.value ->> 'produto_id')::uuid;
      v_qtd  := (r.value ->> 'quantidade')::numeric;
      v_unid := r.value ->> 'unidade';
    exception when others then raise exception 'insumo com formato inválido'; end;
    if v_pid = p_produto then raise exception 'ficha não pode usar o próprio produto como insumo'; end if;
    if v_qtd is null or v_qtd <= 0 then raise exception 'dose do insumo deve ser maior que zero'; end if;
    if v_unid not in ('ml', 'g', 'un') then raise exception 'unidade da dose inválida'; end if;

    select p.nome, p.fumigeno, p.conteudo, p.conteudo_unidade into v_nome, v_fumig, v_conteudo, v_cunid
      from public.produtos p where p.id = v_pid and p.tenant_id = v_tenant and p.ativo;
    if v_nome is null then raise exception 'insumo indisponível'; end if;
    if v_fumig then raise exception 'fumígeno não entra em ficha técnica'; end if;
    if v_unid in ('ml', 'g') then
      if v_conteudo is null or v_conteudo <= 0 then raise exception 'insumo sem conteúdo: %', v_nome; end if;
      if v_cunid <> v_unid then raise exception 'dose em % não bate com o conteúdo do insumo (%)', v_unid, v_nome; end if;
    end if;

    insert into public.fichas_tecnicas_insumos (tenant_id, ficha_id, insumo_produto_id, quantidade, unidade)
    values (v_tenant, v_ficha, v_pid, v_qtd, v_unid);
  end loop;
  if v_n = 0 then raise exception 'a ficha precisa de pelo menos 1 insumo'; end if;

  insert into public.fichas_tecnicas_historico (tenant_id, ficha_id, antes, depois, usuario_id)
  values (v_tenant, v_ficha, v_antes,
          jsonb_build_object('markup', p_markup, 'insumos', p_insumos),
          nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid);
  return v_ficha;
end $$;

-- CMV do copo (PR-01): soma custo_medio ÷ conteúdo × dose. 'un' usa o conteúdo da embalagem (ou 1).
create or replace function public.ficha_cmv(p_produto uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  r       record;
  v_cmv   numeric := 0;
  v_div   numeric;
  v_ficha uuid;
begin
  select id into v_ficha from public.fichas_tecnicas where produto_id = p_produto;
  if v_ficha is null then raise exception 'produto sem ficha técnica'; end if;

  for r in
    select i.quantidade dose, i.unidade, p.nome, p.custo_medio, p.conteudo
    from public.fichas_tecnicas_insumos i join public.produtos p on p.id = i.insumo_produto_id
    where i.ficha_id = v_ficha
  loop
    if r.custo_medio is null then raise exception 'informe o custo médio de: %', r.nome; end if;
    if r.unidade = 'un' then
      v_div := coalesce(nullif(r.conteudo, 0), 1);
    else
      if r.conteudo is null or r.conteudo <= 0 then raise exception 'informe o conteúdo de: %', r.nome; end if;
      v_div := r.conteudo;
    end if;
    v_cmv := v_cmv + r.custo_medio / v_div * r.dose;
  end loop;
  return round(v_cmv, 2);
end $$;

-- Aplicar no PDV (PR-03): grava custo_medio = CMV e preco_varejo = CMV × markup arredondado ao
-- múltiplo de R$ 5 (PR-02, mínimo R$ 5) e registra tudo no histórico.
create or replace function public.ficha_aplicar_preco(p_produto uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_ficha  uuid;
  v_markup numeric;
  v_cmv    numeric;
  v_preco  numeric;
begin
  select id, markup into v_ficha, v_markup from public.fichas_tecnicas where produto_id = p_produto for update;
  if v_ficha is null then raise exception 'produto sem ficha técnica'; end if;

  v_cmv   := public.ficha_cmv(p_produto);
  v_preco := greatest(round(v_cmv * v_markup / 5) * 5, 5);

  insert into public.fichas_tecnicas_historico (tenant_id, ficha_id, antes, depois, usuario_id)
  select tenant_id, v_ficha,
         jsonb_build_object('preco_varejo', preco_varejo, 'custo_medio', custo_medio),
         jsonb_build_object('preco_varejo', v_preco, 'custo_medio', v_cmv),
         nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  from public.produtos where id = p_produto;

  update public.produtos set preco_varejo = v_preco, custo_medio = v_cmv, atualizado_em = now() where id = p_produto;
  return v_preco;
end $$;

-- Consome os insumos da ficha no local (uma transação: saldo insuficiente derruba a venda inteira).
-- Chamada pela finalizar_venda_pdv (produto 'preparado') e pela ação de copão do bar (F4).
create or replace function public.ficha_consumir(
  p_produto_id uuid,
  p_local_id   uuid,
  p_quantidade numeric,
  p_origem_tipo text,
  p_origem_id  uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ficha   uuid;
  r         record;
  v_consumo numeric;
begin
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'quantidade deve ser maior que zero'; end if;
  select id into v_ficha from public.fichas_tecnicas where produto_id = p_produto_id;
  if v_ficha is null then raise exception 'produto sem ficha técnica'; end if;

  for r in
    select i.quantidade dose, i.unidade, p.id pid, p.nome, p.conteudo
    from public.fichas_tecnicas_insumos i join public.produtos p on p.id = i.insumo_produto_id
    where i.ficha_id = v_ficha
  loop
    if r.unidade = 'un' then
      v_consumo := r.dose * p_quantidade / coalesce(nullif(r.conteudo, 0), 1);
    else
      v_consumo := r.dose * p_quantidade / r.conteudo;   -- conteúdo validado não nulo no salvar
    end if;
    perform public.estoque_movimentar(r.pid, p_local_id, 'consumo_ficha', -v_consumo,
      'consumo da ficha do copão', p_origem_tipo, p_origem_id, null);
  end loop;
end $$;

-- Quais copões estão vendáveis em um local (PRD §5.4): mínimo inteiro entre insumos de
-- floor(saldo ÷ consumo_por_copo). Lista todos; a UI filtra disponiveis > 0.
create or replace function public.copoes_disponiveis(p_local uuid)
returns table (produto_id uuid, sku text, nome text, preco_varejo numeric, disponiveis int)
language plpgsql security definer set search_path = public as $$
declare
  v_tenant  uuid;
  f         record;
  r         record;
  v_min     int;
  v_consumo numeric;
  v_saldo   numeric;
begin
  select tenant_id into v_tenant from public.locais where id = p_local;
  if v_tenant is null then raise exception 'local não encontrado'; end if;

  for f in
    select ft.id fid, p.id pid, p.sku psku, p.nome pnome, p.preco_varejo preco
    from public.fichas_tecnicas ft join public.produtos p on p.id = ft.produto_id
    where ft.tenant_id = v_tenant and p.ativo
  loop
    v_min := null;
    for r in
      select i.quantidade dose, i.unidade, pr.conteudo, pr.id ipid
      from public.fichas_tecnicas_insumos i join public.produtos pr on pr.id = i.insumo_produto_id
      where i.ficha_id = f.fid
    loop
      if r.unidade = 'un' then
        v_consumo := r.dose / coalesce(nullif(r.conteudo, 0), 1);
      else
        v_consumo := r.dose / nullif(r.conteudo, 0);
      end if;
      if v_consumo is null or v_consumo <= 0 then
        v_min := 0;
        continue;
      end if;
      select coalesce(s.quantidade, 0) into v_saldo
        from public.estoque_saldos s where s.produto_id = r.ipid and s.local_id = p_local;
      v_min := coalesce(least(v_min, floor(v_saldo / v_consumo)::int), floor(v_saldo / v_consumo)::int);
    end loop;

    produto_id   := f.pid;
    sku          := f.psku;
    nome         := f.pnome;
    preco_varejo := f.preco;
    disponiveis  := greatest(coalesce(v_min, 0), 0);
    return next;
  end loop;
end $$;

-- ================================================================ finalizar_venda_pdv (re-escrita, MESMA assinatura da 0003)
-- Único delta: produto 'preparado' com ficha técnica consome os insumos no local da venda
-- (PRD §5.4) em vez de baixar o próprio produto; 'preparado' sem ficha e comum segue o fluxo da 0003.
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
  v_tipo      text;
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

  -- 2º laço: grava itens e baixa estoque (preparado com ficha consome insumos — PRD §5.4)
  for i in 1 .. array_length(p_produtos, 1) loop
    v_pid := p_produtos[i];
    v_qtd := p_quantidades[i];
    select preco_varejo, tipo into v_preco, v_tipo from public.produtos where id = v_pid and tenant_id = v_tenant;
    insert into public.venda_itens (tenant_id, venda_id, produto_id, quantidade, preco_unit, subtotal)
    values (v_tenant, v_venda_id, v_pid, v_qtd, v_preco, round(v_preco * v_qtd, 2));
    if v_tipo = 'preparado' and exists (select 1 from public.fichas_tecnicas where produto_id = v_pid) then
      perform public.ficha_consumir(v_pid, v_sessao.local_id, v_qtd, 'venda', v_venda_id);
    else
      perform public.estoque_movimentar(v_pid, v_sessao.local_id, 'saida_venda', -v_qtd,
                                        'venda PDV', 'venda', v_venda_id, null);
    end if;
  end loop;

  return v_venda_id;
end $$;

-- ================================================================ AUDIT (transferências, inventários, fichas)

create trigger transferencias_audit after insert or update or delete on public.transferencias
  for each row execute function public.audit_registrar();
create trigger inventarios_audit after insert or update or delete on public.inventarios
  for each row execute function public.audit_registrar();
create trigger fichas_audit after insert or update or delete on public.fichas_tecnicas
  for each row execute function public.audit_registrar();

-- ================================================================ RLS (deny-all por padrão)

alter table public.transferencias             enable row level security;
alter table public.transferencia_itens        enable row level security;
alter table public.inventarios                enable row level security;
alter table public.inventario_itens           enable row level security;
alter table public.fichas_tecnicas            enable row level security;
alter table public.fichas_tecnicas_insumos    enable row level security;
alter table public.fichas_tecnicas_historico  enable row level security;
-- sem policies: authenticated e anon não leem nada direto. Tudo via service_role nas server actions.

-- ================================================================ GRANTS (explícitos — pegadinha 0002)

revoke all on public.transferencias, public.transferencia_itens, public.inventarios, public.inventario_itens,
  public.fichas_tecnicas, public.fichas_tecnicas_insumos, public.fichas_tecnicas_historico
  from anon, authenticated;
revoke references, trigger, truncate on public.transferencias, public.transferencia_itens, public.inventarios,
  public.inventario_itens, public.fichas_tecnicas, public.fichas_tecnicas_insumos, public.fichas_tecnicas_historico
  from anon, authenticated, service_role;

grant select, insert, update, delete on public.transferencias, public.transferencia_itens, public.inventarios,
  public.inventario_itens, public.fichas_tecnicas, public.fichas_tecnicas_insumos to service_role;
grant select on public.fichas_tecnicas_historico to service_role;  -- append-only: historico só via função

grant execute on function public.transferencia_criar(uuid,uuid,uuid[],numeric[],text) to service_role;
grant execute on function public.transferencia_enviar(uuid) to service_role;
grant execute on function public.transferencia_receber(uuid,uuid[],numeric[]) to service_role;
grant execute on function public.transferencia_cancelar(uuid,text) to service_role;
grant execute on function public.inventario_abrir(uuid,uuid) to service_role;
grant execute on function public.inventario_fechar(uuid) to service_role;
grant execute on function public.inventario_aprovar(uuid) to service_role;
grant execute on function public.inventario_cancelar(uuid,text) to service_role;
grant execute on function public.ficha_salvar(uuid,numeric,jsonb) to service_role;
grant execute on function public.ficha_cmv(uuid) to service_role;
grant execute on function public.ficha_aplicar_preco(uuid) to service_role;
grant execute on function public.ficha_consumir(uuid,uuid,numeric,text,uuid) to service_role;
grant execute on function public.copoes_disponiveis(uuid) to service_role;

revoke execute on function public.transferencia_criar(uuid,uuid,uuid[],numeric[],text) from public, anon, authenticated;
revoke execute on function public.transferencia_enviar(uuid) from public, anon, authenticated;
revoke execute on function public.transferencia_receber(uuid,uuid[],numeric[]) from public, anon, authenticated;
revoke execute on function public.transferencia_cancelar(uuid,text) from public, anon, authenticated;
revoke execute on function public.inventario_abrir(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.inventario_fechar(uuid) from public, anon, authenticated;
revoke execute on function public.inventario_aprovar(uuid) from public, anon, authenticated;
revoke execute on function public.inventario_cancelar(uuid,text) from public, anon, authenticated;
revoke execute on function public.ficha_salvar(uuid,numeric,jsonb) from public, anon, authenticated;
revoke execute on function public.ficha_cmv(uuid) from public, anon, authenticated;
revoke execute on function public.ficha_aplicar_preco(uuid) from public, anon, authenticated;
revoke execute on function public.ficha_consumir(uuid,uuid,numeric,text,uuid) from public, anon, authenticated;
revoke execute on function public.copoes_disponiveis(uuid) from public, anon, authenticated;
