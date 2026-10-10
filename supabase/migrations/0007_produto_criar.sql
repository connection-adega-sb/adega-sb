-- 0007_produto_criar.sql · ADEGA SB · cadastro de produto a partir de qualquer módulo de venda
-- 2026-10-10 · pedido do cliente: no meio de uma venda aparece um produto que ainda não está no
-- catálogo e o operador precisa cadastrá-lo NA HORA e voltar para a venda.
-- Até aqui não existia NENHUM caminho de cadastro de produto no app (o catálogo vinha só do seed).
-- Regras todas no servidor: tenant derivado do usuário cadastrante (nunca vem do navegador),
-- validação dos dados, saldo inicial gravado como movimento 'entrada' auditado
-- (estoque_movimentos é append-only) e `criado_por` em produtos para rastrear quem cadastrou.
-- O trigger de audit_log da 0003 (produtos_audit) grava a linha junto.

-- ================================================================ coluna de autoria
alter table public.produtos
  add column criado_por uuid references public.profiles(id);

-- ================================================================ produto_criar
create or replace function public.produto_criar(
  p_nome               text,
  p_preco_varejo       numeric,
  p_usuario            uuid,
  p_codigo_barras      text default null,
  p_categoria_id       uuid default null,
  p_tipo               text default null,
  p_unidade            text default null,
  p_conteudo           numeric default null,
  p_conteudo_unidade   text default null,
  p_adulto             boolean default null,
  p_fumigeno           boolean default null,
  p_custo_medio        numeric default null,
  p_local              uuid default null,
  p_quantidade_inicial numeric default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant  uuid;
  v_nome    text;
  v_tipo    text;
  v_unidade text;
  v_ean     text;
  v_qtd     numeric;
  v_id      uuid;
begin
  -- 1) quem cadastra precisa ter perfil ativo; o tenant vem DELE (nunca do navegador)
  select tenant_id into v_tenant from public.profiles where id = p_usuario and ativo;
  if v_tenant is null then raise exception 'usuário sem perfil ativo'; end if;

  -- 2) dados obrigatórios e vocabulário (mesmos CHECKs da tabela, com mensagem amigável)
  v_nome := trim(coalesce(p_nome, ''));
  if length(v_nome) = 0 then raise exception 'nome do produto é obrigatório'; end if;

  if p_preco_varejo is null or p_preco_varejo < 0 then
    raise exception 'preço de venda inválido';
  end if;

  v_tipo := coalesce(nullif(trim(p_tipo), ''), 'revenda');
  if v_tipo not in ('revenda', 'preparado', 'insumo') then raise exception 'tipo de produto inválido'; end if;

  v_unidade := coalesce(nullif(trim(p_unidade), ''), 'un');
  if v_unidade not in ('un', 'kg', 'l') then raise exception 'unidade de venda inválida'; end if;

  if p_conteudo_unidade is not null then
    if p_conteudo_unidade not in ('ml', 'g', 'un') then raise exception 'unidade de conteúdo inválida'; end if;
    if p_conteudo is null or p_conteudo <= 0 then raise exception 'informe o conteúdo da embalagem'; end if;
  end if;

  -- 3) regra herdada PR-07: fumígeno ⇒ +18 e nunca fracionado (o CHECK da tabela exige os dois;
  --    vende_fracionado fica sempre false aqui — quem fraciona é a ficha/ficha de dose)
  if coalesce(p_fumigeno, false) and not coalesce(p_adulto, false) then
    raise exception 'produto fumígeno exige classificação +18';
  end if;

  -- 4) referências do tenant
  if p_categoria_id is not null and not exists (
       select 1 from public.categorias where id = p_categoria_id and tenant_id = v_tenant
     ) then
    raise exception 'categoria não encontrada para este tenant';
  end if;

  v_ean := nullif(trim(coalesce(p_codigo_barras, '')), '');
  if v_ean is not null and exists (
       select 1 from public.produtos where tenant_id = v_tenant and codigo_barras = v_ean
     ) then
    raise exception 'código de barras já cadastrado';
  end if;

  -- 5) criação (audit_log grava a linha pelo trigger da 0003)
  insert into public.produtos
    (tenant_id, categoria_id, codigo_barras, nome, tipo, unidade, conteudo, conteudo_unidade,
     adulto, fumigeno, preco_varejo, custo_medio, criado_por)
  values
    (v_tenant, p_categoria_id, v_ean, v_nome, v_tipo, v_unidade,
     case when p_conteudo is not null then p_conteudo end,
     case when p_conteudo_unidade is not null then p_conteudo_unidade end,
     coalesce(p_adulto, false), coalesce(p_fumigeno, false), p_preco_varejo, p_custo_medio, p_usuario)
  returning id into v_id;

  -- 6) saldo inicial: único caminho é estoque_movimentar (mesma trilha de qualquer entrada).
  --    Uma falha aqui (ex.: local de outro tenant) derruba a transação inteira — o produto não fica órfão.
  v_qtd := coalesce(p_quantidade_inicial, 0);
  if v_qtd <> 0 then
    if p_local is null then raise exception 'informe o local do saldo inicial'; end if;
    perform public.estoque_movimentar(
      v_id, p_local, 'entrada', v_qtd,
      'saldo inicial do cadastro rápido', 'cadastro', null, p_custo_medio);
  elsif v_qtd < 0 then
    raise exception 'saldo inicial não pode ser negativo';
  end if;

  return v_id;
end $$;

-- ================================================================ AUDIT
-- produtos_audit (0003) cobre a linha nova; estoque_movimentos já é append-only e gravado acima.

-- ================================================================ RLS (já deny-all na 0003)

-- ================================================================ GRANTS (explícitos — pegadinha 0002)

grant execute on function public.produto_criar(text, numeric, uuid, text, uuid, text, text, numeric, text, boolean, boolean, numeric, uuid, numeric) to service_role;
revoke execute on function public.produto_criar(text, numeric, uuid, text, uuid, text, text, numeric, text, boolean, boolean, numeric, uuid, numeric) from public, anon, authenticated;
