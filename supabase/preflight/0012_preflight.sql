-- 0012_preflight.sql · roda ANTES da 0012. Saída esperada: "preflight 0012 OK".
do $$
begin
  if to_regprocedure('public.estoque_movimentar(uuid,uuid,text,numeric,text,text,uuid,numeric)') is null then
    raise exception 'preflight 0012: estoque_movimentar da 0003 nao existe';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenants' and column_name = 'config') then
    raise exception 'preflight 0012: tenants.config da 0010 nao existe';
  end if;
  if to_regclass('public.comandas') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'comandas' and column_name = 'origem') then
    raise exception 'preflight 0012: a 0011 nao foi aplicada';
  end if;
  if position('permitir_negativo' in pg_get_functiondef('public.estoque_movimentar(uuid,uuid,text,numeric,text,text,uuid,numeric)'::regprocedure)) > 0 then
    raise exception 'preflight 0012: estoque_movimentar ja permite negativo - migration 0012 ja aplicada';
  end if;
end $$;

select 'preflight 0012 OK' as resultado;
