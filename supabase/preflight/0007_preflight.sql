-- 0007_preflight.sql · roda ANTES da 0007. Saída esperada: "preflight 0007 OK".
-- Confere o que a 0007 precisa: catálogo/estoque da 0003 (produtos, categorias,
-- estoque_movimentar, estoque_saldos) e o perfil de usuário da 0001 (profiles).
do $$
begin
  if to_regclass('public.tenants') is null then
    raise exception 'preflight 0007: a 0001 nao foi aplicada (public.tenants nao existe)';
  end if;
  if to_regclass('public.profiles') is null then
    raise exception 'preflight 0007: a 0001 nao foi aplicada (public.profiles nao existe)';
  end if;
  if to_regclass('public.produtos') is null then
    raise exception 'preflight 0007: a 0003 nao foi aplicada (public.produtos nao existe)';
  end if;
  if to_regclass('public.categorias') is null then
    raise exception 'preflight 0007: a 0003 nao foi aplicada (public.categorias nao existe)';
  end if;
  if to_regclass('public.estoque_saldos') is null then
    raise exception 'preflight 0007: a 0003 nao foi aplicada (public.estoque_saldos nao existe)';
  end if;
  if to_regprocedure('public.estoque_movimentar(uuid,uuid,text,numeric,text,text,uuid,numeric)') is null then
    raise exception 'preflight 0007: funcao estoque_movimentar(uuid,uuid,text,numeric,text,text,uuid,numeric) da 0003 nao existe';
  end if;
  if not has_table_privilege('service_role', 'public.produtos', 'SELECT') then
    raise exception 'preflight 0007: service_role nao le public.produtos (grant da 0002 ausente?)';
  end if;
  -- guardião de idempotência: se a coluna ou a função já existe, a 0007 já foi aplicada
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'produtos' and column_name = 'criado_por') then
    raise exception 'preflight 0007: produtos.criado_por ja existe - migration 0007 ja aplicada';
  end if;
  if to_regprocedure('public.produto_criar(text,numeric,uuid,text,uuid,text,text,numeric,text,boolean,boolean,numeric,uuid,numeric)') is not null then
    raise exception 'preflight 0007: produto_criar(...) ja existe - migration 0007 ja aplicada';
  end if;
end $$;

select 'preflight 0007 OK' as resultado;
