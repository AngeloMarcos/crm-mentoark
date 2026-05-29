-- Desligar n8n no agente Cris Corretora, ativar motor nativo
UPDATE agentes
SET n8n_webhook_url = NULL,
    ativo_motor = true
WHERE evolution_instancia ILIKE '%cris%' OR nome ILIKE '%cris%';

-- Verificar resultado
SELECT id, nome, evolution_instancia, n8n_webhook_url, ativo_motor, ativo
FROM agentes
ORDER BY created_at DESC
LIMIT 10;
