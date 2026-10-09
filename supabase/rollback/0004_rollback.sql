-- 0004_rollback.sql · volta ao estado sem estoque profundo (0001, 0002 e 0003 permanecem).
-- Ordem: primeiro funções e triggers, depois tabelas (FK reversa).
-- NÃO mexe em tenants/locais/profiles/audit_log (0001), nem em categorias/produtos/estoque_* (0003).
-- Atenção: apaga transferências, inventários e fichas técnicas gravados.

drop trigger if exists transferencias_audit on public.transferencias;
drop trigger if exists inventarios_audit on public.inventarios;
drop trigger if exists fichas_audit on public.fichas_tecnicas;

-- finalizar_venda_pdv: restaura a versão da 0003 (sem ficha/consumo_ficha)
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

drop function if exists public.transferencia_criar(uuid, uuid, uuid[], numeric[], text);
drop function if exists public.transferencia_enviar(uuid);
drop function if exists public.transferencia_receber(uuid, uuid[], numeric[]);
drop function if exists public.transferencia_cancelar(uuid, text);
drop function if exists public.inventario_abrir(uuid, uuid);
drop function if exists public.inventario_fechar(uuid);
drop function if exists public.inventario_aprovar(uuid);
drop function if exists public.inventario_cancelar(uuid, text);
drop function if exists public.ficha_salvar(uuid, numeric, jsonb);
drop function if exists public.ficha_cmv(uuid);
drop function if exists public.ficha_aplicar_preco(uuid);
drop function if exists public.ficha_consumir(uuid, uuid, numeric, text, uuid);
drop function if exists public.copoes_disponiveis(uuid);

drop table if exists public.fichas_tecnicas_historico;
drop table if exists public.fichas_tecnicas_insumos;
drop table if exists public.fichas_tecnicas;
drop table if exists public.inventario_itens;
drop table if exists public.inventarios;
drop table if exists public.transferencia_itens;
drop table if exists public.transferencias;

-- desfaz os ALTERs em tabelas da 0003 (colunas/minimo continuam como a 0003 deixou)
alter table public.estoque_saldos drop constraint if exists estoque_saldos_minimo_ok;
alter table public.produtos drop constraint if exists produtos_fumigeno_revenda;
alter table public.produtos drop constraint if exists produtos_conteudo_positivo;

select 'rollback 0004 OK' as resultado;
