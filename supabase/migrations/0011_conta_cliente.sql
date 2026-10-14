-- 0011_conta_cliente.sql · ADEGA SB · "Conta de cliente" no PDV (consumo no local, como mesa de bar, mas com NOME)
-- 2026-10-14 · pedido do cliente: na adega o pessoal se reúne e consome como num bar, mas o dono não quer chamar de
-- "mesa". Botão no PDV abre uma conta com o NOME do cliente, os pedidos entram nela, e no fechamento: pagar tudo,
-- dividir igual ou DIVIDIR POR ITENS (cada pessoa escolhe quantas unidades de cada item paga).
-- Decisões (adega-sb-docs\PRD-conta-cliente.md):
--   1. Reaproveita `comandas` / `comanda_itens` do bar (0005). A conta do PDV é uma comanda com `nome` e origem 'pdv'.
--   2. Cada pessoa que paga vira UMA VENDA própria (forma, comprovante, CPF), via finalizar_venda_pdv_cliente
--      (mesmas regras do balcão: +18, estoque, crédito com cliente e limite). O estoque baixa NESSE momento.
--   3. O que foi pago sai da conta; a conta fecha sozinha quando não sobra item.
--   4. Dividir igual = cada pessoa paga a fração (quantidade ÷ pessoas) de cada item; a tela manda as frações.
--   5. Fechar o caixa com conta aberta é barrado na tela (server action fecharCaixa).
-- Nenhuma função antiga muda de assinatura.

-- ================================================================ 1. comanda ganha nome, cliente e origem
alter table public.comandas
  add column nome       text check (nome is null or length(trim(nome)) between 1 and 60),
  add column cliente_id uuid references public.clientes(id),
  add column origem     text not null default 'bar' check (origem in ('bar', 'pdv')),
  add constraint comandas_conta_pdv_tem_nome check (origem <> 'pdv' or nome is not null);
create index comandas_contas_abertas_idx on public.comandas (tenant_id, local_id) where status = 'aberta' and origem = 'pdv';

-- ================================================================ 2. conta_abrir
create or replace function public.conta_abrir(p_sessao uuid, p_usuario uuid, p_nome text, p_cliente uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s      public.caixa_sessoes%rowtype;
  v_nome text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  v_id   uuid;
begin
  select * into s from public.caixa_sessoes where id = p_sessao;
  if s.id is null then raise exception 'sessão de caixa não encontrada'; end if;
  if s.status <> 'aberta' then raise exception 'caixa fechado: abra o caixa para abrir uma conta'; end if;
  if not exists (select 1 from public.profiles where id = p_usuario and tenant_id = s.tenant_id and ativo) then
    raise exception 'usuário sem perfil ativo';
  end if;
  if length(v_nome) = 0 then raise exception 'informe o nome da conta'; end if;
  if length(v_nome) > 60 then raise exception 'nome da conta muito longo (até 60 letras)'; end if;
  if p_cliente is not null and not exists (
       select 1 from public.clientes where id = p_cliente and tenant_id = s.tenant_id and ativo) then
    raise exception 'cliente não encontrado';
  end if;
  if exists (select 1 from public.comandas where tenant_id = s.tenant_id and local_id = s.local_id
              and status = 'aberta' and origem = 'pdv' and lower(nome) = lower(v_nome)) then
    raise exception 'já existe uma conta aberta com o nome %', v_nome;
  end if;

  insert into public.comandas (tenant_id, local_id, aberta_por, nome, cliente_id, origem)
  values (s.tenant_id, s.local_id, p_usuario, v_nome, p_cliente, 'pdv')
  returning id into v_id;
  return v_id;
end $$;

-- ================================================================ 3. conta_ajustar_item (− / + na conta; 0 remove)
create or replace function public.conta_ajustar_item(p_item uuid, p_quantidade numeric)
returns numeric   -- novo total da conta
language plpgsql security definer set search_path = public as $$
declare
  i public.comanda_itens%rowtype;
  c public.comandas%rowtype;
  v_total numeric(12,2);
begin
  if p_quantidade is null or p_quantidade < 0 then raise exception 'quantidade inválida'; end if;
  select * into i from public.comanda_itens where id = p_item for update;
  if i.id is null then raise exception 'item não encontrado'; end if;
  select * into c from public.comandas where id = i.comanda_id for update;
  if c.status <> 'aberta' then raise exception 'conta está fechada'; end if;

  if p_quantidade = 0 then
    delete from public.comanda_itens where id = p_item;
  else
    update public.comanda_itens
       set quantidade = p_quantidade, subtotal = round(preco_unit * p_quantidade, 2)
     where id = p_item;
  end if;
  select coalesce(sum(subtotal), 0) into v_total from public.comanda_itens where comanda_id = c.id;
  update public.comandas set total = v_total where id = c.id;
  return v_total;
end $$;

-- ================================================================ 4. conta_pagar_parte (pagar tudo / uma pessoa)
-- p_itens + p_qtds: quanto desta pessoa paga de cada linha da conta (pode ser fração, no "dividir igual").
create or replace function public.conta_pagar_parte(
  p_comanda uuid, p_caixa_sessao uuid, p_forma text,
  p_itens uuid[], p_qtds numeric[],
  p_maior18 boolean default false, p_cliente uuid default null, p_cpf text default null
) returns uuid   -- venda_id desta pessoa
language plpgsql security definer set search_path = public as $$
declare
  c        public.comandas%rowtype;
  s        public.caixa_sessoes%rowtype;
  it       public.comanda_itens%rowtype;
  r        record;
  v_prod   uuid[] := '{}';
  v_qtd    numeric[] := '{}';
  v_venda  uuid;
  v_rest   numeric;
  v_total  numeric(12,2);
  v_cpf    text := nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '');
begin
  if coalesce(array_length(p_itens, 1), 0) = 0 then raise exception 'selecione ao menos um item para pagar'; end if;
  if array_length(p_itens, 1) <> array_length(p_qtds, 1) then raise exception 'itens e quantidades não batem'; end if;
  if v_cpf is not null and not public.cpf_valido(v_cpf) then raise exception 'CPF inválido'; end if;

  select * into c from public.comandas where id = p_comanda for update;
  if c.id is null or c.origem <> 'pdv' then raise exception 'conta não encontrada'; end if;
  if c.status <> 'aberta' then raise exception 'conta já está fechada'; end if;

  select * into s from public.caixa_sessoes where id = p_caixa_sessao;
  if s.id is null then raise exception 'sessão de caixa não encontrada'; end if;
  if s.tenant_id <> c.tenant_id or s.local_id <> c.local_id then raise exception 'conta de outro local'; end if;

  -- junta o pedido por linha (a mesma linha pode vir 2x) e confere contra a conta
  for r in select x.item, sum(x.q) as q from unnest(p_itens, p_qtds) as x(item, q) group by x.item loop
    if r.q is null or r.q <= 0 then raise exception 'quantidade deve ser maior que zero'; end if;
    select * into it from public.comanda_itens where id = r.item and comanda_id = p_comanda for update;
    if it.id is null then raise exception 'item não pertence a esta conta'; end if;
    if r.q > it.quantidade + 0.0005 then raise exception 'quantidade maior que a que está na conta (%)', it.quantidade; end if;
    v_prod := v_prod || it.produto_id;
    v_qtd  := v_qtd || least(r.q, it.quantidade);
  end loop;

  -- a venda desta pessoa: mesmas regras do balcão (+18, estoque, crédito com cliente e limite)
  v_venda := public.finalizar_venda_pdv_cliente(p_caixa_sessao, p_forma, v_prod, v_qtd, 0, coalesce(p_maior18, false), p_cliente);
  if v_cpf is not null then update public.vendas set cpf = v_cpf where id = v_venda; end if;

  -- tira da conta o que foi pago
  for r in select x.item, sum(x.q) as q from unnest(p_itens, p_qtds) as x(item, q) group by x.item loop
    select quantidade - r.q into v_rest from public.comanda_itens where id = r.item;
    if v_rest <= 0.0005 then
      delete from public.comanda_itens where id = r.item;
    else
      update public.comanda_itens set quantidade = v_rest, subtotal = round(preco_unit * v_rest, 2) where id = r.item;
    end if;
  end loop;

  select coalesce(sum(subtotal), 0) into v_total from public.comanda_itens where comanda_id = p_comanda;
  if exists (select 1 from public.comanda_itens where comanda_id = p_comanda) then
    update public.comandas set total = v_total where id = p_comanda;
  else
    update public.comandas set total = 0, status = 'fechada', fechada_em = now(), venda_id = v_venda where id = p_comanda;
  end if;
  return v_venda;
end $$;

-- ================================================================ GRANTS (explícitos — pegadinha 0002)
grant execute on function public.conta_abrir(uuid, uuid, text, uuid) to service_role;
grant execute on function public.conta_ajustar_item(uuid, numeric) to service_role;
grant execute on function public.conta_pagar_parte(uuid, uuid, text, uuid[], numeric[], boolean, uuid, text) to service_role;
revoke execute on function public.conta_abrir(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.conta_ajustar_item(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.conta_pagar_parte(uuid, uuid, text, uuid[], numeric[], boolean, uuid, text) from public, anon, authenticated;
