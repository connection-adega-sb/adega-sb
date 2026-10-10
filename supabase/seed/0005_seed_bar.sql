-- 0005_seed_bar.sql · copões do bar (idempotente). Roda em staging e em produção DEPOIS da 0005.
-- Por quê: o seed 0003 criou os 3 SKUs de copão como 'revenda', SEM embalagem (conteudo) e com
-- estoque só na LOJA — a aba "Fichas do copão" ficava vazia e nenhum copão era vendável no bar.
-- Aqui: (1) insumos ganham conteudo/conteudo_unidade/custo_medio de DEMONSTRAÇÃO;
--       (2) estoque dos insumos entra no BAR (o copão se faz lá); (3) copões viram 'preparado'
--       e perdem o saldo parado na loja; (4) fichas técnicas via ficha_salvar (idempotente).
-- Custos são de demonstração (70% do preço de venda) enquanto o catálogo real não entrar —
-- trocar quando importar o custo real (ver cabeçalho do 0003_seed_catalogo_exemplo.sql).
set search_path = public;

do $$
declare
  v_tenant uuid;
  v_bar    uuid;
  v_loja   uuid;
  v_cod    text;
  v_p      uuid;
  v_ficha  uuid;
begin
  select id into v_tenant from tenants order by criado_em limit 1;
  if v_tenant is null then raise exception 'seed bar: nenhum tenant (rode a 0001)'; end if;
  select id into v_bar  from locais where tenant_id = v_tenant and codigo = 'bar';
  select id into v_loja from locais where tenant_id = v_tenant and codigo = 'loja';
  if v_bar is null then raise exception 'seed bar: local bar nao encontrado'; end if;

  -- ---------------------------------------------------------------- 1. insumos ganham embalagem
  -- unidade de estoque continua 'un' (saldo do 0003 intacto); conteudo/conteudo_unidade alimentam
  -- a conversão dose → fração da garrafa em ficha_consumir e a validação da ficha_salvar.
  update produtos set conteudo = 1000, conteudo_unidade = 'ml', custo_medio = 85.00
   where tenant_id = v_tenant and codigo_barras = '5000117';  -- Whisky 8 Anos 1 L (R$ 129,90)
  update produtos set conteudo = 473,  conteudo_unidade = 'ml', custo_medio = 5.50
   where tenant_id = v_tenant and codigo_barras = '7898116';  -- Energético Lata 473 ml (R$ 9,99)
  update produtos set conteudo = 1000, conteudo_unidade = 'ml', custo_medio = 45.00
   where tenant_id = v_tenant and codigo_barras = '7898118';  -- Vodka Premium 1 L (R$ 69,90)
  update produtos set conteudo = 750,  conteudo_unidade = 'ml', custo_medio = 52.00
   where tenant_id = v_tenant and codigo_barras = '7898115';  -- Gin Nacional 750 ml (R$ 79,90)
  update produtos set conteudo = 500,  conteudo_unidade = 'ml', custo_medio = 2.20
   where tenant_id = v_tenant and codigo_barras = '7898114';  -- Água Mineral com Gás 500 ml (R$ 3,99)

  -- ---------------------------------------------------------------- 2. estoque dos insumos no BAR
  -- só entra se o bar estiver sem saldo (idempotente; audita o movimento como todo o resto).
  foreach v_cod in array array[
      '5000117',  -- whisky   → 10 garrafas
      '7898116',  -- energético → 20 latas
      '7898118',  -- vodka    →  6 garrafas
      '7898115',  -- gin      →  6 garrafas
      '7898114'   -- água com gás → 30 garrafas
    ]
  loop
    select id into v_p from produtos where tenant_id = v_tenant and codigo_barras = v_cod;
    if v_p is null then
      raise notice 'seed bar: insumo % nao existe no catalogo, pulando', v_cod;
      continue;
    end if;
    if coalesce((select quantidade from estoque_saldos
                  where produto_id = v_p and local_id = v_bar), 0) <= 0 then
      perform estoque_movimentar(v_p, v_bar, 'entrada',
        case v_cod
          when '5000117' then 10
          when '7898116' then 20
          when '7898118' then 6
          when '7898115' then 6
          when '7898114' then 30
        end,
        'carga inicial dos insumos do bar (seed 0005)');
    end if;
  end loop;

  -- ---------------------------------------------------------------- 3. copões viram 'preparado'
  -- E perdem o saldo parado na loja: produto preparado não guarda saldo próprio (o estoque é do insumo).
  foreach v_cod in array array['2000125', '2000126', '2000127'] loop
    select id into v_p from produtos where tenant_id = v_tenant and codigo_barras = v_cod;
    if v_p is null then
      raise notice 'seed bar: copao % nao existe no catalogo, pulando', v_cod;
      continue;
    end if;
    update produtos set tipo = 'preparado', unidade = 'un', conteudo = null,
                        conteudo_unidade = null, custo_medio = null
     where id = v_p;

    if coalesce((select quantidade from estoque_saldos
                  where produto_id = v_p and local_id = v_loja), 0) > 0 then
      perform estoque_movimentar(v_p, v_loja, 'ajuste',
        -(select quantidade from estoque_saldos where produto_id = v_p and local_id = v_loja),
        'ajuste: copao e preparado, nao guarda saldo proprio (seed 0005)');
    end if;
  end loop;

  -- ---------------------------------------------------------------- 4. fichas técnicas
  -- markup 2.5 (mesmo valor do teste 0004). NÃO chamamos ficha_aplicar_preco: os preços dos copões
  -- já estão fixados pelo seed 0003 (R$ 35 / 25 / 30) e não devem ser sobrescritos na demo.
  -- doses: 50 ml de destilado + 200 ml de mixer por copão de 700 ml (o resto é gelo).
  select id into v_p from produtos where tenant_id = v_tenant and codigo_barras = '2000125';
  if v_p is not null then
    perform ficha_salvar(v_p, 2.5, jsonb_build_array(
      jsonb_build_object('produto_id', (select id from produtos where tenant_id=v_tenant and codigo_barras='5000117'), 'quantidade', 50,  'unidade', 'ml'),
      jsonb_build_object('produto_id', (select id from produtos where tenant_id=v_tenant and codigo_barras='7898116'), 'quantidade', 200, 'unidade', 'ml')));
  end if;

  select id into v_p from produtos where tenant_id = v_tenant and codigo_barras = '2000126';
  if v_p is not null then
    perform ficha_salvar(v_p, 2.5, jsonb_build_array(
      jsonb_build_object('produto_id', (select id from produtos where tenant_id=v_tenant and codigo_barras='7898118'), 'quantidade', 50,  'unidade', 'ml'),
      jsonb_build_object('produto_id', (select id from produtos where tenant_id=v_tenant and codigo_barras='7898116'), 'quantidade', 200, 'unidade', 'ml')));
  end if;

  select id into v_p from produtos where tenant_id = v_tenant and codigo_barras = '2000127';
  if v_p is not null then
    perform ficha_salvar(v_p, 2.5, jsonb_build_array(
      jsonb_build_object('produto_id', (select id from produtos where tenant_id=v_tenant and codigo_barras='7898115'), 'quantidade', 50,  'unidade', 'ml'),
      jsonb_build_object('produto_id', (select id from produtos where tenant_id=v_tenant and codigo_barras='7898114'), 'quantidade', 200, 'unidade', 'ml')));
  end if;

  -- ---------------------------------------------------------------- 5. caixa do bar
  -- copao_vender recusa sessão de outro local (sessao.local_id <> p_local), então o bar
  -- precisa do próprio caixa; senão só dá para fechar comanda no caixa da loja.
  insert into public.caixas (tenant_id, local_id, nome, ativo)
  select v_tenant, v_bar, 'Caixa #02 · Bar', true
   where not exists (
    select 1 from public.caixas c
     where c.tenant_id = v_tenant and c.local_id = v_bar and c.nome = 'Caixa #02 · Bar');

  -- ---------------------------------------------------------------- 6. mesas do bar
  -- sem mesas a tela /bar fica vazia. 10 mesas de 4 lugares, idempotente pelo código da mesa.
  insert into public.mesas (tenant_id, local_id, codigo, capacidade)
  select v_tenant, v_bar, 'M' || lpad(n::text, 2, '0'), 4
  from generate_series(1, 10) as n
  where not exists (
    select 1 from public.mesas m
     where m.tenant_id = v_tenant and m.local_id = v_bar
       and m.codigo = 'M' || lpad(n::text, 2, '0'));

  raise notice 'seed bar: % preparados, % fichas, % saldos no bar, % mesas',
    (select count(*) from produtos where tenant_id = v_tenant and tipo = 'preparado'),
    (select count(*) from fichas_tecnicas where tenant_id = v_tenant),
    (select count(*) from estoque_saldos where local_id = v_bar),
    (select count(*) from mesas where tenant_id = v_tenant and local_id = v_bar);
end $$;

select 'seed bar OK' as resultado,
       (select count(*) from produtos where tipo = 'preparado')    as preparados,
       (select count(*) from fichas_tecnicas)                      as fichas,
       (select count(*) from estoque_saldos s join locais l on l.id = s.local_id
         where l.codigo = 'bar')                                   as saldos_bar,
       (select count(*) from caixas)                               as caixas,
       (select count(*) from mesas)                                as mesas,
       (select coalesce(sum(disponiveis), 0) from copoes_disponiveis(
         (select id from locais where codigo = 'bar')))            as copoes_vendaveis;
