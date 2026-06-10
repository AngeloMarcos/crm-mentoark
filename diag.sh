#!/bin/bash
EVO_KEY="mentoark2025evolutionkey"

echo "=== INSTANCIAS ==="
curl -s -H "apikey: $EVO_KEY" https://disparo.mentoark.com.br/instance/fetchInstances \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
lst = d if isinstance(d,list) else []
for x in lst:
    n=x.get('instance',{}).get('instanceName','?')
    s=x.get('instance',{}).get('connectionStatus','?')
    print(n,'->',s)
"

echo ""
echo "=== WEBHOOK crm_5319f0ed61b3 ==="
curl -s -H "apikey: $EVO_KEY" "https://disparo.mentoark.com.br/webhook/find/crm_5319f0ed61b3"

echo ""
echo "=== WEBHOOK crm_435ee4720fc3 ==="
curl -s -H "apikey: $EVO_KEY" "https://disparo.mentoark.com.br/webhook/find/crm_435ee4720fc3"

echo ""
echo "=== MSGS NO BANCO ==="
docker exec postgres psql -U mentoark -d crm -c "SELECT COUNT(*) as total FROM whatsapp_messages; SELECT remote_jid, content, created_at FROM whatsapp_messages ORDER BY created_at DESC LIMIT 3;"

echo ""
echo "=== TOKEN DO USER ==="
TOKEN=$(docker exec postgres psql -U mentoark -d crm -t -c "SELECT access_token FROM users LIMIT 1;" 2>/dev/null | tr -d ' \n')
echo "Token: ${TOKEN:0:30}..."
echo "$TOKEN" > /tmp/jwt.txt

echo ""
echo "=== ROTA CONVERSAS ==="
curl -s -H "Authorization: Bearer $TOKEN" https://api.mentoark.com.br/api/whatsapp/conversas | head -c 500

echo ""
echo "=== DEBUG AGENTE ==="
curl -s -H "Authorization: Bearer $TOKEN" https://api.mentoark.com.br/api/whatsapp/debug-agente

echo ""
echo "=== TESTE WEBHOOK MENSAGEM ==="
TS=$(date +%s)
RESP=$(curl -s -X POST https://api.mentoark.com.br/webhook/evolution \
  -H "Content-Type: application/json" \
  -d "{\"event\":\"MESSAGES_UPSERT\",\"instance\":\"crm_5319f0ed61b3\",\"data\":{\"key\":{\"remoteJid\":\"5511999999999@s.whatsapp.net\",\"fromMe\":false,\"id\":\"TESTID_DIAG_$TS\"},\"message\":{\"conversation\":\"teste de diagnostico $TS\"},\"pushName\":\"Teste Diag\",\"messageTimestamp\":$TS}}")
echo "Resposta webhook: $RESP"

echo ""
echo "=== MENSAGEM SALVA? ==="
sleep 1
docker exec postgres psql -U mentoark -d crm -c "SELECT id, remote_jid, content, created_at FROM whatsapp_messages ORDER BY created_at DESC LIMIT 3;"
