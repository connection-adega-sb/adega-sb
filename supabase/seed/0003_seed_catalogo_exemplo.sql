-- 0003_seed_catalogo_exemplo.sql · catálogo de DEMONSTRAÇÃO (28 produtos, idempotente).
-- Roda em staging e em produção ENQUANTO não existe catálogo real (ambientes privados, sem venda real).
-- Quando o catálogo real entrar (fase 2), substituir: apagar os produtos de exemplo (carga inicial
-- marcada com o motivo 'carga inicial do catalogo de exemplo' em estoque_movimentos) e importar o real.
-- Fonte: referencia/prototipos/index.html SAMPLE_PRODUCTS. Estoque inicial entra na LOJA via
-- estoque_movimentar (audita o movimento).
set search_path = public;

do $$
declare
  v_tenant uuid;
  v_loja   uuid;
  v_cat    uuid;
  p        record;
  v_prod   uuid;
  v_cod    text;
begin
  select id into v_tenant from tenants order by criado_em limit 1;
  if v_tenant is null then raise exception 'seed: nenhum tenant (rode a 0001)'; end if;
  select id into v_loja from locais where tenant_id = v_tenant and codigo = 'loja';
  if v_loja is null then raise exception 'seed: local loja nao encontrado'; end if;

  for p in
    select * from (values
      ('Vinhos',        '7898101','Vinho Tinto Cabernet Sauvignon Nacional 750 ml',      39.90, 34, true,  false),
      ('Vinhos',        '7898102','Vinho Tinto Suave Nacional 750 ml',                   24.90, 18, true,  false),
      ('Vinhos',        '7790103','Vinho Tinto Malbec Argentino 750 ml',                 69.90, 22, true,  false),
      ('Vinhos',        '7898104','Vinho Rosé Nacional 750 ml',                          44.90,  4, true,  false),
      ('Cervejas',      '7898105','Cerveja Pilsen Long Neck 355 ml',                      5.99,240, true,  false),
      ('Cervejas',      '7898106','Cerveja Artesanal IPA 500 ml',                        19.90,  9, true,  false),
      ('Cervejas',      '7898107','Cerveja Pilsen Lata 350 ml',                           4.49,480, true,  false),
      ('Espumantes',    '7898108','Espumante Brut Nacional 750 ml',                      54.90, 27, true,  false),
      ('Espumantes',    '7898109','Espumante Moscatel 750 ml',                           49.90, 15, true,  false),
      ('Vinhos',        '7898110','Vinho Branco Sauvignon Blanc Nacional 750 ml',        42.90, 12, true,  false),
      ('Vinhos',        '7804111','Vinho Tinto Carménère Reserva Chileno 750 ml',        89.90,  3, true,  false),
      ('Destilados',    '7898112','Cachaça Artesanal Envelhecida 700 ml',                59.90, 26, true,  false),
      ('Sem álcool',    '7898113','Refrigerante Cola 2 L',                               10.99, 64, false, false),
      ('Sem álcool',    '7898114','Água Mineral com Gás 500 ml',                          3.99, 40, false, false),
      ('Destilados',    '7898115','Gin Nacional 750 ml',                                 79.90,  7, true,  false),
      ('Sem álcool',    '7898116','Energético Lata 473 ml',                               9.99, 31, false, false),
      ('Destilados',    '5000117','Whisky 8 Anos 1 L',                                  129.90, 20, true,  false),
      ('Destilados',    '7898118','Vodka Premium 1 L',                                   69.90,  5, true,  false),
      ('Destilados',    '8410119','Licor de Chocolate 700 ml',                           54.90, 14, true,  false),
      ('Acessórios',    '7898120','Par de Taças de Cristal para Vinho',                  59.90, 45, false, false),
      ('Acessórios',    '7898121','Saca-Rolhas Profissional',                            29.90, 23, false, false),
      ('Vinhos',        '5601122','Vinho Verde Português 750 ml',                        64.90, 38, true,  false),
      ('Vinhos',        '7804123','Vinho Tinto Reservado Chileno 750 ml',                49.90, 11, true,  false),
      ('Conveniência',  '7898124','Gelo em Cubos 5 kg',                                  14.90, 70, false, false),
      ('Copão',         '2000125','Copão Whisky + Energético 700 ml',                    35.00, 60, true,  false),
      ('Copão',         '2000126','Copão Vodka + Energético 700 ml',                     25.00, 60, true,  false),
      ('Copão',         '2000127','Copão Gin + Tônica 700 ml',                           30.00, 60, true,  false),
      ('Tabacaria',     '7898128','Cigarro Maço 20 un. (embalagem lacrada)',             12.00, 50, true,  true)
    ) as t(cat, cod, nome, preco, estoque, adulto, fumigeno)
  loop
    -- categoria (idempotente)
    select id into v_cat from categorias where tenant_id = v_tenant and nome = p.cat;
    if v_cat is null then
      insert into categorias (tenant_id, nome) values (v_tenant, p.cat) returning id into v_cat;
    end if;

    -- produto (idempotente por codigo_barras)
    select id into v_prod from produtos where tenant_id = v_tenant and codigo_barras = p.cod;
    if v_prod is null then
      insert into produtos (tenant_id, categoria_id, codigo_barras, nome, preco_varejo, adulto, fumigeno)
      values (v_tenant, v_cat, p.cod, p.nome, p.preco, p.adulto, p.fumigeno)
      returning id into v_prod;
      -- estoque inicial na loja, via função que audita o movimento
      perform estoque_movimentar(v_prod, v_loja, 'entrada', p.estoque, 'carga inicial do catalogo de exemplo');
    end if;
  end loop;

  -- caixa de balcão (idempotente)
  if not exists (select 1 from caixas where tenant_id = v_tenant and nome = 'Caixa #01') then
    insert into caixas (tenant_id, local_id, nome) values (v_tenant, v_loja, 'Caixa #01');
  end if;

  raise notice 'seed: % produtos, % categorias na loja',
    (select count(*) from produtos where tenant_id = v_tenant),
    (select count(*) from categorias where tenant_id = v_tenant);
end $$;

select 'seed catalogo OK' as resultado,
       (select count(*) from produtos) as produtos,
       (select count(*) from categorias) as categorias,
       (select count(*) from estoque_saldos) as saldos,
       (select count(*) from caixas) as caixas;
