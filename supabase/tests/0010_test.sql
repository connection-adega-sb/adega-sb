-- 0010_test.sql · pgTAP dos cadastros completos (produto, pessoa, empresa). Rodar DEPOIS da 0010, nas três bases.
-- Roda inteira numa transação com rollback: dados de teste não sobrevivem.
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
begin;
select plan(30);

-- ================================================================ estrutura e permissões (8)
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'produtos' and column_name = 'csosn'),
          'produtos ganhou csosn');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clientes' and column_name = 'cartao_final'),
          'clientes ganhou cartao_final');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clientes'
                       and column_name in ('cartao_numero', 'cartao_validade', 'numero_cartao')),
          'clientes NAO guarda número nem validade de cartão');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenants' and column_name = 'segmento'),
          'tenants ganhou segmento (ramo deste sistema)');
select ok(not has_function_privilege('authenticated', 'public.produto_salvar_ficha(uuid,uuid,jsonb)', 'EXECUTE'), 'logado NAO executa produto_salvar_ficha direto');
select ok(not has_function_privilege('authenticated', 'public.cliente_salvar_ficha(uuid,uuid,jsonb)', 'EXECUTE'), 'logado NAO executa cliente_salvar_ficha direto');
select ok(not has_function_privilege('anon', 'public.empresa_salvar(uuid,jsonb)', 'EXECUTE'), 'anônimo NAO executa empresa_salvar');
select ok(has_function_privilege('service_role', 'public.produto_salvar_ficha(uuid,uuid,jsonb)', 'EXECUTE'), 'servidor executa produto_salvar_ficha');

-- ================================================================ validador de CNPJ (3)
select ok(public.cnpj_valido('43.466.024/0001-43'), 'CNPJ da ADEGA SB é válido');
select ok(not public.cnpj_valido('43.466.024/0001-44'), 'CNPJ com dígito errado é recusado');
select ok(not public.cnpj_valido('11111111111111'), 'CNPJ repetido é recusado');

-- ================================================================ base de teste (sem asserts)
do $$
declare
  v_tenant uuid;
  v_cx  uuid := gen_random_uuid();
  v_ger uuid := gen_random_uuid();
  v_mst uuid := gen_random_uuid();
begin
  select id into v_tenant from public.tenants order by criado_em limit 1;
  if v_tenant is null then raise exception 'base de teste 0010 sem tenant'; end if;
  insert into auth.users (id, email) values
    (v_cx,  'caixa0010-'   || v_cx::text  || '@adegasb.invalid'),
    (v_ger, 'gerente0010-' || v_ger::text || '@adegasb.invalid'),
    (v_mst, 'master0010-'  || v_mst::text || '@adegasb.invalid');
  insert into public.profiles (id, tenant_id, nome, role) values
    (v_cx, v_tenant, 'Caixa 0010', 'caixa'), (v_ger, v_tenant, 'Gerente 0010', 'gerente'), (v_mst, v_tenant, 'Master 0010', 'master');
  perform set_config('adega.t10_cx', v_cx::text, false);
  perform set_config('adega.t10_ger', v_ger::text, false);
  perform set_config('adega.t10_mst', v_mst::text, false);
  perform set_config('adega.t10_tenant', v_tenant::text, false);
  perform set_config('adega.t10_p1', public.produto_salvar_ficha(v_cx, null,
    '{"nome":"Vinho Teste 0010 750 ml","preco_varejo":"39,90","codigo_barras":"9999000001001","codigo":"000148",
      "sku":"VIN-0148","fabricante":"Vinicola X","unidade_comercial":"cx","preco_custo":"25,5","estoque_minimo":"5",
      "ncm":"2204.21.00","csosn":"500","icms_aliquota":"18","icms_base":"100","cst_pis":"49","cst_cofins":"49",
      "adulto":true,"ultimo_reajuste":"2026-08-20","observacao":"teste"}'::jsonb)::text, false);
end $$;

-- ================================================================ produto_salvar_ficha (9)
select is((select nome from public.produtos where id = current_setting('adega.t10_p1')::uuid), 'Vinho Teste 0010 750 ml', 'caixa cria produto pela ficha');
select is((select preco_varejo from public.produtos where id = current_setting('adega.t10_p1')::uuid), 39.90::numeric(12,2), 'preço "39,90" vira 39.90');
select is((select ncm from public.produtos where id = current_setting('adega.t10_p1')::uuid), '22042100', 'NCM gravado só com dígitos');
select is((select unidade_comercial from public.produtos where id = current_setting('adega.t10_p1')::uuid), 'CX', 'unidade comercial normalizada em maiúsculas');
select is((select csosn || '/' || icms_aliquota::text from public.produtos where id = current_setting('adega.t10_p1')::uuid), '500/18.00', 'CSOSN e ICMS gravados');
select is((select count(*)::int from public.estoque_saldos where produto_id = current_setting('adega.t10_p1')::uuid and quantidade <> 0), 0,
          'ficha NAO mexe em estoque');
select throws_ok(format($$select public.produto_salvar_ficha(%L, %L, '{"nome":"X","preco_varejo":"1"}'::jsonb)$$,
  current_setting('adega.t10_cx'), current_setting('adega.t10_p1')), 'P0001', 'sem permissão para editar produto', 'caixa NAO edita produto existente');
select throws_ok(format($$select public.produto_salvar_ficha(%L, null, '{"nome":"Outro","preco_varejo":"2","codigo_barras":"9999000001001"}'::jsonb)$$,
  current_setting('adega.t10_ger')), 'P0001', 'código de barras já cadastrado', 'código de barras repetido é recusado');
select throws_ok(format($$select public.produto_salvar_ficha(%L, null, '{"nome":"NCM curto","preco_varejo":"2","ncm":"2204"}'::jsonb)$$,
  current_setting('adega.t10_ger')), 'P0001', 'NCM deve ter 8 dígitos', 'NCM incompleto é recusado');

-- ================================================================ cliente_salvar_ficha (6)
select lives_ok(format($$select set_config('adega.t10_c1', public.cliente_salvar_ficha(%L, null,
  '{"nome":"Carla Teste 0010","tipo_pessoa":"F","documento":"381.604.927-31","telefone":"(11) 98877-2244",
    "cep":"09750-310","logradouro":"Rua das Camélias","numero":"412","cidade":"São Bernardo do Campo","uf":"sp",
    "nascimento":"1988-04-12","cartao_bandeira":"visa","cartao_final":"4411"}'::jsonb)::text, false)$$,
  current_setting('adega.t10_cx')), 'caixa cadastra pessoa física completa');
select is((select cpf || '|' || uf || '|' || cartao_final from public.clientes where id = current_setting('adega.t10_c1')::uuid),
          '38160492731|SP|4411', 'CPF, UF e final do cartão normalizados');
select lives_ok(format($$select public.cliente_salvar_ficha(%L, null,
  '{"nome":"Empresa Teste 0010 Ltda","tipo_pessoa":"J","documento":"43.466.024/0001-43","tipo_cliente":"revenda"}'::jsonb)$$,
  current_setting('adega.t10_cx')), 'pessoa jurídica com CNPJ válido');
select throws_ok(format($$select public.cliente_salvar_ficha(%L, null, '{"nome":"Dup","tipo_pessoa":"J","documento":"43466024000143"}'::jsonb)$$,
  current_setting('adega.t10_cx')), 'P0001', 'CNPJ já cadastrado para Empresa Teste 0010 Ltda', 'CNPJ repetido é recusado com o nome de quem usa');
select throws_ok(format($$select public.cliente_salvar_ficha(%L, null, '{"nome":"Cartao","cartao_final":"4111111111111111"}'::jsonb)$$,
  current_setting('adega.t10_cx')), 'P0001', 'do cartão guarde só os 4 últimos dígitos', 'número inteiro de cartão é recusado');
select throws_ok(format($$select public.cliente_salvar_ficha(%L, null, '{"nome":"CPF ruim","documento":"123.456.789-10"}'::jsonb)$$,
  current_setting('adega.t10_cx')), 'P0001', 'CPF inválido', 'CPF inválido é recusado');

-- ================================================================ empresa_salvar (4)
select throws_ok(format($$select public.empresa_salvar(%L, '{"fantasia":"X"}'::jsonb)$$, current_setting('adega.t10_ger')),
  'P0001', 'só o master altera os dados da empresa', 'gerente NAO altera a empresa');
select lives_ok(format($$select public.empresa_salvar(%L,
  '{"cnpj":"43466024000143","ie":"ISENTO","regime":"simples","fantasia":"ADEGA SB","cep":"09791-290","uf":"sp",
    "config":{"venda":{"pagamento_misto":true},"danfe":{"largura_bobina":80}}}'::jsonb)$$, current_setting('adega.t10_mst')),
  'master salva os dados da empresa');
select is((select cnpj || '|' || uf || '|' || (config #>> '{danfe,largura_bobina}') from public.tenants where id = current_setting('adega.t10_tenant')::uuid),
          '43.466.024/0001-43|SP|80', 'CNPJ mascarado, UF e configuração gravados');
select throws_ok(format($$select public.empresa_salvar(%L, '{"cnpj":"43466024000144"}'::jsonb)$$, current_setting('adega.t10_mst')),
  'P0001', 'CNPJ inválido', 'CNPJ inválido da empresa é recusado');

select * from finish();
rollback;
