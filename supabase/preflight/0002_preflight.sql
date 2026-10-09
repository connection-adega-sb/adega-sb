-- 0002_preflight.sql - roda ANTES da 0002. Saida esperada: "preflight 0002 OK".
do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'preflight 0002: a 0001 nao foi aplicada (public.profiles nao existe)';
  end if;
end $$;
select 'preflight 0002 OK' as resultado;
