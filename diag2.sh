#!/bin/bash
echo "=== API KEY EVOLUTION ==="
docker inspect evolution 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
env = d[0].get('Config',{}).get('Env',[]) if d else []
for e in env:
    if 'API_KEY' in e or 'AUTHENTICATION' in e or 'KEY' in e:
        print(e[:120])
"

echo ""
echo "=== COMPOSE EVOLUTION (api key) ==="
grep -i "api_key\|apikey\|authentication" /opt/evolution/docker-compose.yml 2>/dev/null | head -10

echo ""
echo "=== LOGIN PARA TOKEN ==="
RESP=$(curl -s -X POST https://api.mentoark.com.br/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"angelobispofilho@gmail.com","password":"Mentoark@2025"}')
echo "Login resp: $RESP" | head -c 200
TOKEN=$(echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null)
echo "Token: ${TOKEN:0:40}..."

echo ""
echo "=== CONVERSAS (com token login) ==="
if [ -n "$TOKEN" ]; then
  curl -s -H "Authorization: Bearer $TOKEN" https://api.mentoark.com.br/api/whatsapp/conversas | head -c 400
  echo ""
  echo "=== DEBUG AGENTE ==="
  curl -s -H "Authorization: Bearer $TOKEN" https://api.mentoark.com.br/api/whatsapp/debug-agente
fi

echo ""
echo "=== TENTA WEBHOOK SET crm_435ee4720fc3 com diferente apikey ==="
# Testa com token de instância
curl -s -X POST https://disparo.mentoark.com.br/webhook/set/crm_435ee4720fc3 \
  -H "Content-Type: application/json" \
  -H "apikey: mentoark2025evolutionkey" \
  -d '{"webhook":{"enabled":true,"url":"https://api.mentoark.com.br/webhook/evolution","webhookByEvents":false,"webhookBase64":false,"events":["MESSAGES_UPSERT","MESSAGES_UPDATE","CONNECTION_UPDATE","QRCODE_UPDATED"]}}'
echo ""

echo "=== TENTA WEBHOOK SET crm_5319f0ed61b3 com token de instância ==="
curl -s -X POST https://disparo.mentoark.com.br/webhook/set/crm_5319f0ed61b3 \
  -H "Content-Type: application/json" \
  -H "apikey: 41A038D1-4DA2-479D-87C3-B681D84176E9" \
  -d '{"webhook":{"enabled":true,"url":"https://api.mentoark.com.br/webhook/evolution","webhookByEvents":false,"webhookBase64":false,"events":["MESSAGES_UPSERT","MESSAGES_UPDATE","CONNECTION_UPDATE","QRCODE_UPDATED"]}}'
echo ""

echo "=== CONFIG EVOLUTION ==="
cat /opt/evolution/.env 2>/dev/null | grep -i "api_key\|authentication" | head -5
cat /opt/evolution/docker-compose.yml 2>/dev/null | grep -A2 -i "api_key\|authentication" | head -10
