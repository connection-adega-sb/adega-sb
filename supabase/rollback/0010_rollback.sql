-- 0010_rollback.sql · desfaz a 0010 (cadastros completos). RODAR MANUALMENTE só em emergência.
-- CUIDADO: apaga os dados novos (fiscais, endereço, empresa). O histórico fica no audit_log.
drop trigger if exists tenants_audit on public.tenants;
drop function if exists public.empresa_salvar(uuid, jsonb);
drop function if exists public.cliente_salvar_ficha(uuid, uuid, jsonb);
drop function if exists public.produto_salvar_ficha(uuid, uuid, jsonb);
drop function if exists public._j_num(jsonb, text);
drop function if exists public._j_dig(jsonb, text);
drop function if exists public._j_txt(jsonb, text);
drop index if exists public.clientes_cnpj_uk;
drop index if exists public.produtos_codigo_legado_idx;
alter table public.clientes drop constraint if exists clientes_doc_por_tipo;
alter table public.clientes
  drop column if exists tipo_pessoa, drop column if exists cnpj, drop column if exists rg_ie, drop column if exists profissao,
  drop column if exists nascimento, drop column if exists filiacao, drop column if exists cep, drop column if exists logradouro,
  drop column if exists numero, drop column if exists complemento, drop column if exists bairro, drop column if exists cidade,
  drop column if exists uf, drop column if exists telefone_fixo, drop column if exists vendedor_id, drop column if exists tipo_cliente,
  drop column if exists bloqueado, drop column if exists site, drop column if exists email_alt, drop column if exists atividade,
  drop column if exists ref_bancarias, drop column if exists ref_comerciais, drop column if exists cartao_bandeira,
  drop column if exists cartao_final, drop column if exists foto_path;
alter table public.produtos
  drop column if exists codigo, drop column if exists fabricante, drop column if exists fornecedor, drop column if exists unidade_comercial,
  drop column if exists preco_custo, drop column if exists estoque_minimo, drop column if exists ultimo_reajuste, drop column if exists oculto_tabela,
  drop column if exists csosn, drop column if exists icms_aliquota, drop column if exists icms_base, drop column if exists ipi_aliquota,
  drop column if exists cst_pis, drop column if exists cst_cofins, drop column if exists peso_bruto, drop column if exists peso_liquido,
  drop column if exists cst_ibs_cbs, drop column if exists cclass_trib, drop column if exists gtin_tributavel, drop column if exists previsao_chegada,
  drop column if exists codigo_anp, drop column if exists fabricacao_propria, drop column if exists observacao, drop column if exists foto_path,
  drop column if exists origem_dados, drop column if exists revisar;
alter table public.tenants
  drop column if exists segmento, drop column if exists fantasia, drop column if exists ie, drop column if exists regime,
  drop column if exists email, drop column if exists telefone, drop column if exists cep, drop column if exists logradouro,
  drop column if exists numero, drop column if exists complemento, drop column if exists bairro, drop column if exists municipio,
  drop column if exists uf, drop column if exists site, drop column if exists ambiente_nfce, drop column if exists config,
  drop column if exists atualizado_em;
drop function if exists public.cnpj_valido(text);
