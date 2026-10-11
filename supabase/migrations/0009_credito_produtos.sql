-- 0009_credito_produtos.sql · ADEGA SB · venda no CRÉDITO (conta do cliente) + cadastro/edição de produtos fora da venda
-- 2026-10-11 · pedidos do cliente:
--   (a) "adicionar na forma de pagamento o card CRÉDITO, para não colocar o nome fiado — vincular OBRIGATORIAMENTE o cliente";
--   (b) "tela de cadastro de produtos para o operacional cadastrar independente da venda, em outro terminal".
-- Decisões (registradas em PRD-credito-produtos.md):
--   1. Crédito só com cliente identificado — garantido no BANCO (constraint trigger adiada na tabela vendas),
--      não só na tela.
--   2. Limite por cliente OPCIONAL (clientes.limite_credito; vazio = sem limite). Só master/gerente define.
--   3. Venda no crédito NÃO entra na gaveta (não é dinheiro). Recebimento depois, em PIX, cartão ou dinheiro;
--      em dinheiro exige o caixa do operador ABERTO e entra como suprimento "recebimento de crédito" — a gaveta fecha certo.
--   4. Pagamento nunca maior que o saldo em aberto. Pagamentos são append-only (estorno = decisão futura).
--   5. Edição de produto (nome, código, categoria, preço, +18, fumígeno, ativo) só master/gerente/estoquista;
--      cadastro segue aberto a quem vende (0007).
-- finalizar_venda_pdv e finalizar_venda_pdv_cliente mantêm a MESMA assinatura (pgTAP antigo intacto).

-- ================================================================ 1. forma de pagamento 'credito'
alter table public.vendas drop constraint vendas_forma_pagamento_check;
alter table public.vendas add constraint vendas_forma_pagamento_check
  check (forma_pagamento in ('pix', 'cartao', 'dinheiro', 'boleto', 'credito'));

-- crédito sem cliente é recusado no COMMIT (adiado: a venda nasce e recebe o cliente na mesma transação)
-- Atenção: num trigger ADIADO o NEW é a foto do momento do INSERT (ainda sem cliente). Por isso o teste relê
-- a linha como está no commit — senão toda venda no crédito (insert → update do cliente) seria recusada.
create or replace function public.vendas_credito_exige_cliente() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.forma_pagamento = 'credito' and exists (
       select 1 from public.vendas v
        where v.id = new.id and v.forma_pagamento = 'credito' and v.cliente_id is null) then
    raise exception 'venda no crédito exige cliente identificado';
  end if;
  return null;
end $$;

create constraint trigger vendas_credito_cliente
  after insert or update on public.vendas
  deferrable initially deferred
  for each row execute function public.vendas_credito_exige_cliente();

-- ================================================================ 2. limite de crédito por cliente (opcional)
alter table public.clientes
  add column limite_credito numeric(12,2) check (limite_credito is null or limite_credito >= 0);

-- ================================================================ 3. pagamentos do crédito (append-only)
create table public.credito_pagamentos (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  cliente_id          uuid not null references public.clientes(id),
  valor               numeric(12,2) not null check (valor > 0),
  forma               text not null check (forma in ('pix', 'cartao', 'dinheiro')),
  caixa_sessao_id     uuid references public.caixa_sessoes(id),
  caixa_movimento_id  uuid references public.caixa_movimentos(id),
  observacao          text check (observacao is null or length(observacao) <= 300),
  criado_por          uuid not null references public.profiles(id),
  criado_em           timestamptz not null default now(),
  check (forma <> 'dinheiro' or caixa_movimento_id is not null)
);
create index credito_pagamentos_cliente_idx on public.credito_pagamentos (cliente_id);
create index credito_pagamentos_tenant_idx on public.credito_pagamentos (tenant_id);

create trigger credito_pagamentos_audit after insert or update or delete on public.credito_pagamentos
  for each row execute function public.audit_registrar();

create or replace function public.credito_pagamentos_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'credito_pagamentos é append-only (% recusado)', tg_op using errcode = '42501';
end $$;
create trigger credito_pagamentos_sem_update before update or delete on public.credito_pagamentos
  for each row execute function public.credito_pagamentos_imutavel();

-- ================================================================ 4. saldo em aberto
create or replace function public.cliente_saldo_credito(p_cliente uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select round(
           coalesce((select sum(total) from public.vendas
                      where cliente_id = p_cliente and forma_pagamento = 'credito'), 0)
         - coalesce((select sum(valor) from public.credito_pagamentos where cliente_id = p_cliente), 0)
         , 2)
$$;

-- ================================================================ 5. limite (só master/gerente)
create or replace function public.cliente_definir_limite(p_usuario uuid, p_id uuid, p_limite numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_papel  text;
begin
  select tenant_id, role into v_tenant, v_papel from public.profiles where id = p_usuario and ativo;
  if v_tenant is null then raise exception 'usuário sem perfil ativo'; end if;
  if v_papel not in ('master', 'gerente') then raise exception 'só master ou gerente define limite de crédito'; end if;
  if p_limite is not null and p_limite < 0 then raise exception 'limite de crédito inválido'; end if;
  update public.clientes set limite_credito = round(p_limite, 2), atualizado_em = now()
   where id = p_id and tenant_id = v_tenant;
  if not found then raise exception 'cliente não encontrado'; end if;
end $$;

-- ================================================================ 6. finalizar_venda_pdv (MESMA assinatura; único delta: aceita 'credito')
-- A regra "crédito exige cliente" vem do trigger adiado acima: chamada direta com 'credito' e sem cliente
-- é desfeita no commit.
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
  if p_forma_pagamento not in ('pix', 'cartao', 'dinheiro', 'boleto', 'credito') then raise exception 'forma de pagamento inválida'; end if;
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

-- ================================================================ 7. finalizar_venda_pdv_cliente (MESMA assinatura da 0008)
-- Delta: crédito exige cliente ATIVO; com limite definido, saldo em aberto depois da venda não pode passar do limite.
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
  v_limite numeric;
  v_venda  uuid;
begin
  if p_forma_pagamento = 'credito' and p_cliente is null then
    raise exception 'venda no crédito exige cliente identificado';
  end if;

  if p_cliente is not null then
    select tenant_id into v_tenant from public.caixa_sessoes where id = p_caixa_sessao_id;
    select cpf, limite_credito into v_cpf, v_limite from public.clientes
     where id = p_cliente and tenant_id = v_tenant and ativo;
    if not found then raise exception 'cliente não encontrado'; end if;
  end if;

  v_venda := public.finalizar_venda_pdv(
    p_caixa_sessao_id, p_forma_pagamento, p_produtos, p_quantidades,
    coalesce(p_desconto, 0), v_cpf, coalesce(p_maior18, false));

  if p_cliente is not null then
    update public.vendas set cliente_id = p_cliente where id = v_venda;
  end if;

  if p_forma_pagamento = 'credito' and v_limite is not null
     and public.cliente_saldo_credito(p_cliente) > v_limite then
    raise exception 'limite de crédito excedido: limite R$ %, em aberto ficaria R$ %',
      replace(to_char(v_limite, 'FM9999990.00'), '.', ','), replace(to_char(public.cliente_saldo_credito(p_cliente), 'FM9999990.00'), '.', ',');
  end if;
  return v_venda;
end $$;

-- ================================================================ 8. credito_receber
create or replace function public.credito_receber(
  p_usuario    uuid,
  p_cliente    uuid,
  p_valor      numeric,
  p_forma      text,
  p_observacao text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant  uuid;
  v_nome    text;
  v_saldo   numeric;
  v_valor   numeric(12,2);
  v_sessao  uuid;
  v_mov     uuid;
  v_id      uuid;
begin
  select tenant_id into v_tenant from public.profiles where id = p_usuario and ativo;
  if v_tenant is null then raise exception 'usuário sem perfil ativo'; end if;

  select nome into v_nome from public.clientes where id = p_cliente and tenant_id = v_tenant;
  if v_nome is null then raise exception 'cliente não encontrado'; end if;

  if p_forma not in ('pix', 'cartao', 'dinheiro') then raise exception 'forma de recebimento inválida'; end if;
  v_valor := round(coalesce(p_valor, 0), 2);
  if v_valor <= 0 then raise exception 'valor do recebimento deve ser maior que zero'; end if;

  v_saldo := public.cliente_saldo_credito(p_cliente);
  if v_valor > v_saldo then raise exception 'valor maior que o saldo em aberto (R$ %)', replace(to_char(v_saldo, 'FM9999990.00'), '.', ','); end if;

  -- dinheiro entra na gaveta: precisa do caixa do PRÓPRIO operador aberto (vira suprimento na sessão)
  if p_forma = 'dinheiro' then
    select id into v_sessao from public.caixa_sessoes
     where tenant_id = v_tenant and operador_id = p_usuario and status = 'aberta'
     order by aberta_em desc limit 1;
    if v_sessao is null then raise exception 'abra o seu caixa para receber em dinheiro'; end if;
    insert into public.caixa_movimentos (tenant_id, sessao_id, tipo, valor, motivo, criado_por)
    values (v_tenant, v_sessao, 'suprimento', v_valor, 'recebimento de crédito · ' || v_nome, p_usuario)
    returning id into v_mov;
  end if;

  insert into public.credito_pagamentos
    (tenant_id, cliente_id, valor, forma, caixa_sessao_id, caixa_movimento_id, observacao, criado_por)
  values
    (v_tenant, p_cliente, v_valor, p_forma, v_sessao, v_mov, nullif(trim(coalesce(p_observacao, '')), ''), p_usuario)
  returning id into v_id;
  return v_id;
end $$;

-- ================================================================ 9. produto_atualizar (tela /produtos)
create or replace function public.produto_atualizar(
  p_usuario        uuid,
  p_id             uuid,
  p_nome           text,
  p_preco_varejo   numeric,
  p_codigo_barras  text default null,
  p_categoria_id   uuid default null,
  p_adulto         boolean default false,
  p_fumigeno       boolean default false,
  p_ativo          boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_papel  text;
  v_nome   text;
  v_ean    text;
  v_tipo   text;
begin
  select tenant_id, role into v_tenant, v_papel from public.profiles where id = p_usuario and ativo;
  if v_tenant is null then raise exception 'usuário sem perfil ativo'; end if;
  if v_papel not in ('master', 'gerente', 'estoquista') then raise exception 'sem permissão para editar produto'; end if;

  select tipo into v_tipo from public.produtos where id = p_id and tenant_id = v_tenant;
  if v_tipo is null then raise exception 'produto não encontrado'; end if;

  v_nome := trim(coalesce(p_nome, ''));
  if length(v_nome) = 0 then raise exception 'nome do produto é obrigatório'; end if;
  if p_preco_varejo is null or p_preco_varejo < 0 then raise exception 'preço de venda inválido'; end if;
  if coalesce(p_fumigeno, false) and not coalesce(p_adulto, false) then
    raise exception 'produto fumígeno exige classificação +18';
  end if;
  if coalesce(p_fumigeno, false) and v_tipo <> 'revenda' then
    raise exception 'fumígeno só pode ser produto de revenda';
  end if;

  if p_categoria_id is not null and not exists (
       select 1 from public.categorias where id = p_categoria_id and tenant_id = v_tenant) then
    raise exception 'categoria não encontrada para este tenant';
  end if;

  v_ean := nullif(trim(coalesce(p_codigo_barras, '')), '');
  if v_ean is not null and exists (
       select 1 from public.produtos where tenant_id = v_tenant and codigo_barras = v_ean and id <> p_id) then
    raise exception 'código de barras já cadastrado';
  end if;

  update public.produtos
     set nome = v_nome, preco_varejo = round(p_preco_varejo, 2), codigo_barras = v_ean,
         categoria_id = p_categoria_id, adulto = coalesce(p_adulto, false),
         fumigeno = coalesce(p_fumigeno, false), ativo = coalesce(p_ativo, true), atualizado_em = now()
   where id = p_id and tenant_id = v_tenant;
end $$;

-- ================================================================ RLS (deny-all: só service_role, pelo servidor)
alter table public.credito_pagamentos enable row level security;

-- ================================================================ GRANTS (explícitos — pegadinha 0002)
revoke all on public.credito_pagamentos from anon, authenticated;
revoke references, trigger, truncate on public.credito_pagamentos from anon, authenticated, service_role;
grant select, insert on public.credito_pagamentos to service_role;   -- append-only

grant execute on function public.cliente_saldo_credito(uuid) to service_role;
grant execute on function public.cliente_definir_limite(uuid, uuid, numeric) to service_role;
grant execute on function public.credito_receber(uuid, uuid, numeric, text, text) to service_role;
grant execute on function public.produto_atualizar(uuid, uuid, text, numeric, text, uuid, boolean, boolean, boolean) to service_role;
grant execute on function public.finalizar_venda_pdv(uuid, text, uuid[], numeric[], numeric, text, boolean) to service_role;
grant execute on function public.finalizar_venda_pdv_cliente(uuid, text, uuid[], numeric[], numeric, boolean, uuid) to service_role;

revoke execute on function public.cliente_saldo_credito(uuid) from public, anon, authenticated;
revoke execute on function public.cliente_definir_limite(uuid, uuid, numeric) from public, anon, authenticated;
revoke execute on function public.credito_receber(uuid, uuid, numeric, text, text) from public, anon, authenticated;
revoke execute on function public.produto_atualizar(uuid, uuid, text, numeric, text, uuid, boolean, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.finalizar_venda_pdv(uuid, text, uuid[], numeric[], numeric, text, boolean) from public, anon, authenticated;
revoke execute on function public.finalizar_venda_pdv_cliente(uuid, text, uuid[], numeric[], numeric, boolean, uuid) from public, anon, authenticated;
