-- 0011_preflight.sql · roda ANTES da 0011. Saída esperada: "preflight 0011 OK".
-- Confere o que a 0011 precisa (0005 comandas, 0009 finalizar_venda_pdv_cliente, 0008 cpf_valido) e barra reaplicação.
do $$
begin
  if to_regclass('public.comandas') is null or to_regclass('public.comanda_itens') is null then
    raise exception 'preflight 0011: a 0005 nao foi aplicada (comandas)';
  end if;
  if to_regprocedure('public.comanda_adicionar(uuid,uuid,numeric,text,boolean)') is null then
    raise exception 'preflight 0011: comanda_adicionar da 0005 nao existe';
  end if;
  if to_regprocedure('public.finalizar_venda_pdv_cliente(uuid,text,uuid[],numeric[],numeric,boolean,uuid)') is null then
    raise exception 'preflight 0011: finalizar_venda_pdv_cliente da 0009 nao existe';
  end if;
  if to_regprocedure('public.cpf_valido(text)') is null then
    raise exception 'preflight 0011: cpf_valido da 0008 nao existe';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'comandas' and column_name = 'origem') then
    raise exception 'preflight 0011: comandas.origem ja existe - migration 0011 ja aplicada';
  end if;
end $$;

select 'preflight 0011 OK' as resultado;
