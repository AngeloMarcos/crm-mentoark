CREATE OR REPLACE VIEW public.dashboard_resumo
WITH (security_invoker = true) AS
SELECT
  c.user_id,
  COUNT(*)::int AS total_leads,
  COUNT(*) FILTER (WHERE c.created_at >= date_trunc('day', now()))::int AS novos_hoje,
  COUNT(*) FILTER (WHERE c.status = 'fechado')::int AS convertidos,
  COUNT(*) FILTER (WHERE c.status NOT IN ('fechado','perdido'))::int AS em_atendimento
FROM public.contatos c
GROUP BY c.user_id;