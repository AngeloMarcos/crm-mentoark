#!/bin/bash
# Script de deploy — rode na VPS após restaurar acesso SSH
# Atualiza: OpenClaw endpoint, roteamento N8N, integração agentEngine

set -e
VPS="root@147.93.9.172"

echo "=== Deploy backend com OpenClaw + N8N routing ==="

# 1. Copiar arquivos modificados
scp backend/src/routes/openclaw.ts        $VPS:/opt/crm/backend/src/routes/openclaw.ts
scp backend/src/routes/webhook.ts         $VPS:/opt/crm/backend/src/routes/webhook.ts
scp backend/src/services/agentEngine.ts   $VPS:/opt/crm/backend/src/services/agentEngine.ts
scp backend/src/index.ts                  $VPS:/opt/crm/backend/src/index.ts

# 2. Rebuildar e reiniciar container
ssh $VPS 'cd /opt/crm/backend && docker compose build --no-cache && docker compose up -d'

# 3. Aguardar e checar saúde
sleep 5
ssh $VPS 'docker ps --filter name=crm-api && curl -s http://localhost:3000/health || echo "health check falhou"'

# 4. SQL para N8N routing de Cris (ajuste o n8n_webhook_url abaixo)
# N8N_URL="https://n8n.mentoark.com.br/webhook/SEU_WEBHOOK_ID"
# ssh $VPS "docker exec postgres psql -U mentoark -d crm -c \"
#   INSERT INTO agentes (user_id, nome, evolution_instancia, n8n_webhook_url, ativo)
#   VALUES ('d7b74de0-f523-432c-8294-e0950658ff8a', 'Cris', 'crm_5319f0ed61b3', '$N8N_URL', true)
#   ON CONFLICT (id) DO UPDATE SET n8n_webhook_url = '$N8N_URL';
# \""

echo "=== Deploy concluído ==="
echo ""
echo "Para testar OpenClaw via API:"
echo "  curl -X POST https://api.mentoark.com.br/api/openclaw/chat \\"
echo "    -H 'Authorization: Bearer <token>' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"message\": \"docker ps\", \"sessionKey\": \"admin\"}'"
echo ""
echo "Para ativar OpenClaw como motor de um agente:"
echo "  UPDATE agentes SET motor_ia = 'openclaw' WHERE id = '<agente_id>';"
