-- 0010_cadastros_completos.sql · ADEGA SB · base dos 3 cadastros do NOVO LAYOUT (produto, pessoa, empresa emitente)
-- 2026-10-14 · pedido do cliente: "aplicar o novo layout com a mesma estrutura da base de dados" (Planilha1.xlsx do
-- sistema antigo, a mesma dos 10 novos clientes). Decisões em adega-sb-docs\PRD-novo-layout-e-importacao.md:
--   D2 (corrigida 14/10 13:49) = cada cliente tem o PRÓPRIO sistema (site + banco separados), todos feitos a partir
--   desta mesma base. `tenants.segmento` só diz qual é o ramo DESTE sistema (adega, moda, doceria…), para a base
--   ligar/desligar recursos do ramo (ex.: +18/fumígeno só na adega). Nenhum dado de outro cliente entra aqui.
--   D5 = cartão do cliente: só bandeira + 4 últimos dígitos (nunca o número inteiro — PCI/LGPD).
--   Certificado A1 e CSC NÃO entram aqui (fase fiscal F10, criptografados no Vault).
-- Só ADICIONA colunas (todas opcionais) e 3 funções novas. Nenhuma função antiga muda de assinatura → o PDV,
-- o cadastro rápido e o pgTAP de 0001–0009 seguem iguais.

-- ================================================================ 0. validador de CNPJ (dígitos verificadores)
create or replace function public.cnpj_valido(p text) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  d   text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  pes int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s   int; r int; i int;
begin
  if length(d) <> 14 or d ~ '^(\d)\1{13}$' then return false; end if;
  s := 0; for i in 1..12 loop s := s + substr(d, i, 1)::int * pes[i + 1]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  if r <> substr(d, 13, 1)::int then return false; end if;
  s := 0; for i in 1..13 loop s := s + substr(d, i, 1)::int * pes[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  return r = substr(d, 14, 1)::int;
end $$;

-- ================================================================ 1. EMPRESA (tenants) — dados cadastrais do emitente
alter table public.tenants
  add column segmento       text not null default 'adega'
                            check (segmento in ('adega', 'bar', 'distribuidora', 'moda', 'mercado', 'restaurante', 'doceria', 'outro')),
  add column fantasia       text,
  add column ie             text check (ie is null or ie ~ '^(ISENTO|\d{2,14})$'),
  add column regime         text check (regime is null or regime in ('mei', 'simples', 'simples_excesso', 'normal')),
  add column email          text,
  add column telefone       text check (telefone is null or telefone ~ '^\d{10,11}$'),
  add column cep            text check (cep is null or cep ~ '^\d{8}$'),
  add column logradouro     text,
  add column numero         text,
  add column complemento    text,
  add column bairro         text,
  add column municipio      text,
  add column uf             text check (uf is null or uf ~ '^[A-Z]{2}$'),
  add column site           text,
  add column ambiente_nfce  text not null default 'homologacao' check (ambiente_nfce in ('homologacao', 'producao')),
  add column config         jsonb not null default '{}'::jsonb,     -- abas DANFE / Venda / TEF / Outras do layout
  add column atualizado_em  timestamptz not null default now();

-- ================================================================ 2. PRODUTO — campos do layout + colunas da planilha legada
-- `unidade` (un/kg/l) continua sendo a unidade de ESTOQUE (fração/dose). A "Unidade" do layout é a COMERCIAL.
alter table public.produtos
  add column codigo             text,                 -- "Código" do sistema antigo (pode repetir: 13 casos na planilha)
  add column fabricante         text,
  add column fornecedor         text,                 -- texto até existir Compras (tabela de fornecedores)
  add column unidade_comercial  text not null default 'UN'
                                check (unidade_comercial in ('UN','CX','PC','PCT','FD','LT','GR','KG','ML','L','FR','GF','DZ','PR','KIT')),
  add column preco_custo        numeric(12,4) check (preco_custo is null or preco_custo >= 0),
  add column estoque_minimo     numeric(12,3) check (estoque_minimo is null or estoque_minimo >= 0),
  add column ultimo_reajuste    date,
  add column oculto_tabela      boolean not null default false,   -- "Não imprimir na tabela de preços"
  add column csosn              text check (csosn is null or csosn ~ '^\d{3}$'),
  add column icms_aliquota      numeric(5,2) check (icms_aliquota is null or icms_aliquota between 0 and 100),
  add column icms_base          numeric(5,2) check (icms_base is null or icms_base between 0 and 100),
  add column ipi_aliquota       numeric(5,2) check (ipi_aliquota is null or ipi_aliquota between 0 and 100),
  add column cst_pis            text check (cst_pis is null or cst_pis ~ '^\d{2}$'),
  add column cst_cofins         text check (cst_cofins is null or cst_cofins ~ '^\d{2}$'),
  add column peso_bruto         numeric(12,3) check (peso_bruto is null or peso_bruto >= 0),
  add column peso_liquido       numeric(12,3) check (peso_liquido is null or peso_liquido >= 0),
  add column cst_ibs_cbs        text check (cst_ibs_cbs is null or cst_ibs_cbs ~ '^\d{3}$'),
  add column cclass_trib        text check (cclass_trib is null or cclass_trib ~ '^\d{6}$'),
  add column gtin_tributavel    text check (gtin_tributavel is null or gtin_tributavel ~ '^\d{8,14}$'),
  add column previsao_chegada   date,
  add column codigo_anp         text check (codigo_anp is null or codigo_anp ~ '^\d{9}$'),
  add column fabricacao_propria boolean not null default false,
  add column observacao         text check (observacao is null or length(observacao) <= 1000),
  add column foto_path          text,                 -- caminho no Storage (upload na fase L2)
  add column origem_dados       text,                 -- ex.: 'planilha:Planilha1.xlsx' (importador L3)
  add column revisar            text check (revisar is null or length(revisar) <= 300);  -- motivo de revisão da importação
create index produtos_codigo_legado_idx on public.produtos (tenant_id, codigo) where codigo is not null;

-- ================================================================ 3. PESSOA (clientes) — campos do layout
-- `telefone` (já existente, único por tenant) segue sendo o CELULAR/WhatsApp usado no PDV (F4).
alter table public.clientes
  add column tipo_pessoa     text not null default 'F' check (tipo_pessoa in ('F', 'J')),
  add column cnpj            text check (cnpj is null or cnpj ~ '^\d{14}$'),
  add column rg_ie           text check (rg_ie is null or length(rg_ie) <= 20),
  add column profissao       text,
  add column nascimento      date check (nascimento is null or nascimento between date '1900-01-01' and current_date),
  add column filiacao        text,
  add column cep             text check (cep is null or cep ~ '^\d{8}$'),
  add column logradouro      text,
  add column numero          text,
  add column complemento     text,
  add column bairro          text,
  add column cidade          text,
  add column uf              text check (uf is null or uf ~ '^[A-Z]{2}$'),
  add column telefone_fixo   text check (telefone_fixo is null or telefone_fixo ~ '^\d{10,11}$'),
  add column vendedor_id     uuid references public.profiles(id),
  add column tipo_cliente    text not null default 'consumidor_final'
                             check (tipo_cliente in ('consumidor_final', 'revenda', 'empresa', 'funcionario')),
  add column bloqueado       boolean not null default false,
  add column site            text,
  add column email_alt       text,
  add column atividade       text,
  add column ref_bancarias   text check (ref_bancarias is null or length(ref_bancarias) <= 300),
  add column ref_comerciais  text check (ref_comerciais is null or length(ref_comerciais) <= 300),
  add column cartao_bandeira text check (cartao_bandeira is null or cartao_bandeira in ('visa','master','elo','amex','hiper','outro')),
  add column cartao_final    text check (cartao_final is null or cartao_final ~ '^\d{4}$'),   -- NUNCA o número inteiro
  add column foto_path       text,
  add constraint clientes_doc_por_tipo check (
    (tipo_pessoa = 'F' and cnpj is null) or (tipo_pessoa = 'J' and cpf is null));
create unique index clientes_cnpj_uk on public.clientes (tenant_id, cnpj) where cnpj is not null;

-- ================================================================ helpers de leitura do jsonb (nulo quando vazio)
create or replace function public._j_txt(p jsonb, k text) returns text
language sql immutable set search_path = public as $$
  select nullif(trim(coalesce(p ->> k, '')), '')
$$;
create or replace function public._j_dig(p jsonb, k text) returns text
language sql immutable set search_path = public as $$
  select nullif(regexp_replace(coalesce(p ->> k, ''), '\D', '', 'g'), '')
$$;
create or replace function public._j_num(p jsonb, k text) returns numeric
language plpgsql immutable set search_path = public as $$
declare v text := nullif(trim(coalesce(p ->> k, '')), '');
begin
  if v is null then return null; end if;
  return replace(v, ',', '.')::numeric;
exception when others then
  raise exception 'valor numérico inválido em %', k;
end $$;

-- ================================================================ 4. produto_salvar_ficha (tela nova de produto)
-- Cria (p_id nulo) ou edita. Quem cria: qualquer perfil ativo (igual 0007). Quem edita: master/gerente/estoquista (igual 0009).
-- Estoque NUNCA entra por aqui (só por movimento auditado: inventário/entrada).
create or replace function public.produto_salvar_ficha(p_usuario uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; v_papel text; v_id uuid; v_tipo text;
  v_nome text := regexp_replace(coalesce(public._j_txt(p_dados, 'nome'), ''), '\s+', ' ', 'g');
  v_ean  text := public._j_dig(p_dados, 'codigo_barras');
  v_cat  uuid := nullif(p_dados ->> 'categoria_id', '')::uuid;
  v_preco numeric := public._j_num(p_dados, 'preco_varejo');
  v_adulto boolean := coalesce((p_dados ->> 'adulto')::boolean, false);
  v_fumi   boolean := coalesce((p_dados ->> 'fumigeno')::boolean, false);
  v_ncm  text := public._j_dig(p_dados, 'ncm');
  v_cest text := public._j_dig(p_dados, 'cest');
begin
  select tenant_id, role into v_tenant, v_papel from public.profiles where id = p_usuario and ativo;
  if v_tenant is null then raise exception 'usuário sem perfil ativo'; end if;
  if p_id is not null and v_papel not in ('master', 'gerente', 'estoquista') then
    raise exception 'sem permissão para editar produto';
  end if;

  if length(v_nome) = 0 then raise exception 'nome do produto é obrigatório'; end if;
  if v_preco is null or v_preco < 0 then raise exception 'preço de venda inválido'; end if;
  if v_ean is not null and length(v_ean) not in (8, 12, 13, 14) then raise exception 'código de barras deve ter 8, 12, 13 ou 14 dígitos'; end if;
  if v_ncm is not null and length(v_ncm) <> 8 then raise exception 'NCM deve ter 8 dígitos'; end if;
  if v_cest is not null and length(v_cest) <> 7 then raise exception 'CEST deve ter 7 dígitos'; end if;
  if v_fumi and not v_adulto then raise exception 'produto fumígeno exige classificação +18'; end if;
  if v_cat is not null and not exists (select 1 from public.categorias where id = v_cat and tenant_id = v_tenant) then
    raise exception 'categoria não encontrada para este tenant';
  end if;
  if v_ean is not null and exists (select 1 from public.produtos
       where tenant_id = v_tenant and codigo_barras = v_ean and id is distinct from p_id) then
    raise exception 'código de barras já cadastrado';
  end if;

  if p_id is null then
    insert into public.produtos (tenant_id, nome, preco_varejo, criado_por)
    values (v_tenant, v_nome, round(v_preco, 2), p_usuario) returning id, tipo into v_id, v_tipo;
  else
    select id, tipo into v_id, v_tipo from public.produtos where id = p_id and tenant_id = v_tenant;
    if v_id is null then raise exception 'produto não encontrado'; end if;
  end if;
  if v_fumi and v_tipo <> 'revenda' then raise exception 'fumígeno só pode ser produto de revenda'; end if;

  update public.produtos set
    nome = v_nome, preco_varejo = round(v_preco, 2), codigo_barras = v_ean, categoria_id = v_cat,
    adulto = v_adulto, fumigeno = v_fumi,
    ativo              = coalesce((p_dados ->> 'ativo')::boolean, true),
    sku                = public._j_txt(p_dados, 'sku'),
    codigo             = public._j_txt(p_dados, 'codigo'),
    fabricante         = public._j_txt(p_dados, 'fabricante'),
    fornecedor         = public._j_txt(p_dados, 'fornecedor'),
    unidade_comercial  = coalesce(upper(public._j_txt(p_dados, 'unidade_comercial')), 'UN'),
    preco_custo        = public._j_num(p_dados, 'preco_custo'),
    estoque_minimo     = public._j_num(p_dados, 'estoque_minimo'),
    ultimo_reajuste    = nullif(p_dados ->> 'ultimo_reajuste', '')::date,
    oculto_tabela      = coalesce((p_dados ->> 'oculto_tabela')::boolean, false),
    ncm = v_ncm, cest = v_cest,
    origem             = coalesce(nullif(p_dados ->> 'origem', '')::smallint, 0),
    csosn              = public._j_dig(p_dados, 'csosn'),
    icms_aliquota      = public._j_num(p_dados, 'icms_aliquota'),
    icms_base          = public._j_num(p_dados, 'icms_base'),
    ipi_aliquota       = public._j_num(p_dados, 'ipi_aliquota'),
    cst_pis            = public._j_dig(p_dados, 'cst_pis'),
    cst_cofins         = public._j_dig(p_dados, 'cst_cofins'),
    peso_bruto         = public._j_num(p_dados, 'peso_bruto'),
    peso_liquido       = public._j_num(p_dados, 'peso_liquido'),
    cst_ibs_cbs        = public._j_dig(p_dados, 'cst_ibs_cbs'),
    cclass_trib        = public._j_dig(p_dados, 'cclass_trib'),
    gtin_tributavel    = public._j_dig(p_dados, 'gtin_tributavel'),
    previsao_chegada   = nullif(p_dados ->> 'previsao_chegada', '')::date,
    codigo_anp         = public._j_dig(p_dados, 'codigo_anp'),
    fabricacao_propria = coalesce((p_dados ->> 'fabricacao_propria')::boolean, false),
    observacao         = public._j_txt(p_dados, 'observacao'),
    revisar            = null,                     -- salvar pela tela = revisado
    atualizado_em      = now()
  where id = v_id;
  return v_id;
end $$;

-- ================================================================ 5. cliente_salvar_ficha (tela nova de pessoa)
-- Mesmas regras do cliente_salvar (0008) + PF/PJ, endereço, documentos e situação comercial.
-- Limite de crédito continua só pelo cliente_definir_limite (master/gerente — 0009).
create or replace function public.cliente_salvar_ficha(p_usuario uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; v_id uuid; v_outro text;
  v_tipo  text := coalesce(upper(public._j_txt(p_dados, 'tipo_pessoa')), 'F');
  v_nome  text := regexp_replace(coalesce(public._j_txt(p_dados, 'nome'), ''), '\s+', ' ', 'g');
  v_fone  text := public._j_dig(p_dados, 'telefone');
  v_fixo  text := public._j_dig(p_dados, 'telefone_fixo');
  v_doc   text := public._j_dig(p_dados, 'documento');   -- CPF (F) ou CNPJ (J)
  v_cpf   text; v_cnpj text;
  v_email text := lower(public._j_txt(p_dados, 'email'));
  v_cep   text := public._j_dig(p_dados, 'cep');
  v_vend  uuid := nullif(p_dados ->> 'vendedor_id', '')::uuid;
begin
  select tenant_id into v_tenant from public.profiles where id = p_usuario and ativo;
  if v_tenant is null then raise exception 'usuário sem perfil ativo'; end if;

  if v_tipo not in ('F', 'J') then raise exception 'tipo de pessoa inválido'; end if;
  if length(v_nome) = 0 then raise exception 'nome do cliente é obrigatório'; end if;
  if length(v_nome) > 120 then raise exception 'nome do cliente muito longo'; end if;
  if v_fone is not null and v_fone !~ '^\d{10,11}$' then raise exception 'celular inválido: use DDD + número'; end if;
  if v_fixo is not null and v_fixo !~ '^\d{10,11}$' then raise exception 'telefone inválido: use DDD + número'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail inválido'; end if;
  if v_cep is not null and length(v_cep) <> 8 then raise exception 'CEP deve ter 8 dígitos'; end if;
  if v_doc is not null then
    if v_tipo = 'F' then
      if not public.cpf_valido(v_doc) then raise exception 'CPF inválido'; end if; v_cpf := v_doc;
    else
      if not public.cnpj_valido(v_doc) then raise exception 'CNPJ inválido'; end if; v_cnpj := v_doc;
    end if;
  end if;
  if v_vend is not null and not exists (select 1 from public.profiles where id = v_vend and tenant_id = v_tenant) then
    raise exception 'vendedor não encontrado';
  end if;
  if public._j_dig(p_dados, 'cartao_final') is not null and length(public._j_dig(p_dados, 'cartao_final')) <> 4 then
    raise exception 'do cartão guarde só os 4 últimos dígitos';
  end if;

  if v_fone is not null then
    select nome into v_outro from public.clientes where tenant_id = v_tenant and telefone = v_fone and id is distinct from p_id;
    if found then raise exception 'telefone já cadastrado para %', v_outro; end if;
  end if;
  if v_cpf is not null then
    select nome into v_outro from public.clientes where tenant_id = v_tenant and cpf = v_cpf and id is distinct from p_id;
    if found then raise exception 'CPF já cadastrado para %', v_outro; end if;
  end if;
  if v_cnpj is not null then
    select nome into v_outro from public.clientes where tenant_id = v_tenant and cnpj = v_cnpj and id is distinct from p_id;
    if found then raise exception 'CNPJ já cadastrado para %', v_outro; end if;
  end if;

  if p_id is null then
    insert into public.clientes (tenant_id, nome, tipo_pessoa, criado_por) values (v_tenant, v_nome, v_tipo, p_usuario)
    returning id into v_id;
  else
    select id into v_id from public.clientes where id = p_id and tenant_id = v_tenant;
    if v_id is null then raise exception 'cliente não encontrado'; end if;
  end if;

  update public.clientes set
    nome = v_nome, tipo_pessoa = v_tipo, cpf = v_cpf, cnpj = v_cnpj, telefone = v_fone, telefone_fixo = v_fixo,
    email = v_email, cep = v_cep, vendedor_id = v_vend,
    rg_ie          = public._j_txt(p_dados, 'rg_ie'),
    profissao      = public._j_txt(p_dados, 'profissao'),
    nascimento     = nullif(p_dados ->> 'nascimento', '')::date,
    filiacao       = public._j_txt(p_dados, 'filiacao'),
    logradouro     = public._j_txt(p_dados, 'logradouro'),
    numero         = public._j_txt(p_dados, 'numero'),
    complemento    = public._j_txt(p_dados, 'complemento'),
    bairro         = public._j_txt(p_dados, 'bairro'),
    cidade         = public._j_txt(p_dados, 'cidade'),
    uf             = upper(public._j_txt(p_dados, 'uf')),
    tipo_cliente   = coalesce(public._j_txt(p_dados, 'tipo_cliente'), 'consumidor_final'),
    bloqueado      = coalesce((p_dados ->> 'bloqueado')::boolean, false),
    site           = public._j_txt(p_dados, 'site'),
    email_alt      = lower(public._j_txt(p_dados, 'email_alt')),
    atividade      = public._j_txt(p_dados, 'atividade'),
    ref_bancarias  = public._j_txt(p_dados, 'ref_bancarias'),
    ref_comerciais = public._j_txt(p_dados, 'ref_comerciais'),
    cartao_bandeira = public._j_txt(p_dados, 'cartao_bandeira'),
    cartao_final   = public._j_dig(p_dados, 'cartao_final'),
    observacao     = public._j_txt(p_dados, 'observacao'),
    atualizado_em  = now()
  where id = v_id;
  return v_id;
end $$;

-- ================================================================ 6. empresa_salvar (tela nova de empresa emitente) — só master
create or replace function public.empresa_salvar(p_usuario uuid, p_dados jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; v_papel text;
  v_cnpj text := public._j_dig(p_dados, 'cnpj');
  v_nome text := public._j_txt(p_dados, 'nome');
  v_ie   text := upper(public._j_txt(p_dados, 'ie'));
  v_cep  text := public._j_dig(p_dados, 'cep');
begin
  select tenant_id, role into v_tenant, v_papel from public.profiles where id = p_usuario and ativo;
  if v_tenant is null then raise exception 'usuário sem perfil ativo'; end if;
  if v_papel <> 'master' then raise exception 'só o master altera os dados da empresa'; end if;
  if v_cnpj is not null and not public.cnpj_valido(v_cnpj) then raise exception 'CNPJ inválido'; end if;
  if v_ie is not null and v_ie <> 'ISENTO' then v_ie := regexp_replace(v_ie, '\D', '', 'g'); end if;
  if v_cep is not null and length(v_cep) <> 8 then raise exception 'CEP deve ter 8 dígitos'; end if;
  if p_dados ? 'config' and jsonb_typeof(p_dados -> 'config') <> 'object' then raise exception 'configuração inválida'; end if;

  update public.tenants set
    nome          = coalesce(v_nome, nome),
    razao         = public._j_txt(p_dados, 'razao'),
    fantasia      = public._j_txt(p_dados, 'fantasia'),
    cnpj          = case when v_cnpj is null then null else
                      substr(v_cnpj,1,2)||'.'||substr(v_cnpj,3,3)||'.'||substr(v_cnpj,6,3)||'/'||substr(v_cnpj,9,4)||'-'||substr(v_cnpj,13,2) end,
    ie            = nullif(v_ie, ''),
    regime        = public._j_txt(p_dados, 'regime'),
    email         = lower(public._j_txt(p_dados, 'email')),
    telefone      = public._j_dig(p_dados, 'telefone'),
    cep = v_cep,
    logradouro    = public._j_txt(p_dados, 'logradouro'),
    numero        = public._j_txt(p_dados, 'numero'),
    complemento   = public._j_txt(p_dados, 'complemento'),
    bairro        = public._j_txt(p_dados, 'bairro'),
    municipio     = public._j_txt(p_dados, 'municipio'),
    uf            = upper(public._j_txt(p_dados, 'uf')),
    site          = public._j_txt(p_dados, 'site'),
    ambiente_nfce = coalesce(public._j_txt(p_dados, 'ambiente_nfce'), ambiente_nfce),
    config        = case when p_dados ? 'config' then p_dados -> 'config' else config end,
    atualizado_em = now()
  where id = v_tenant;
end $$;

-- auditoria da empresa (produtos e clientes já têm trigger de auditoria)
create trigger tenants_audit after update on public.tenants
  for each row execute function public.audit_registrar();

-- ================================================================ GRANTS (explícitos — pegadinha 0002)
grant execute on function public.cnpj_valido(text) to service_role;
grant execute on function public.produto_salvar_ficha(uuid, uuid, jsonb) to service_role;
grant execute on function public.cliente_salvar_ficha(uuid, uuid, jsonb) to service_role;
grant execute on function public.empresa_salvar(uuid, jsonb) to service_role;
revoke execute on function public.cnpj_valido(text) from public, anon, authenticated;
revoke execute on function public._j_txt(jsonb, text) from public, anon, authenticated;
revoke execute on function public._j_dig(jsonb, text) from public, anon, authenticated;
revoke execute on function public._j_num(jsonb, text) from public, anon, authenticated;
revoke execute on function public.produto_salvar_ficha(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.cliente_salvar_ficha(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.empresa_salvar(uuid, jsonb) from public, anon, authenticated;
