-- 0012_rollback.sql · volta a RECUSAR venda sem estoque, sem reverter a função:
-- liga a trava em todas as empresas pela configuração (os saldos negativos já gravados continuam como estão).
update public.tenants
   set config = jsonb_set(config, '{estoque}', coalesce(config -> 'estoque', '{}'::jsonb) || '{"permitir_negativo": false}'::jsonb);
