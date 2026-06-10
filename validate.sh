#!/bin/bash
echo "=== LOGIN ==="
RESP=$(curl -s -X POST https://api.mentoark.com.br/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"angelobispofilho@gmail.com","password":"Mentoark@2025"}')
TOKEN=$(echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token','FALHOU'))" 2>/dev/null)
echo "Token: ${TOKEN:0:40}..."

echo ""
echo "=== CONVERSAS (is_pinned/is_archived presentes?) ==="
curl -s -H "Authorization: Bearer $TOKEN" https://api.mentoark.com.br/api/whatsapp/conversas | python3 -c "
import sys,json
d=json.load(sys.stdin)
if isinstance(d,list) and len(d)>0:
    row=d[0]
    print('is_pinned:', row.get('is_pinned','AUSENTE'))
    print('is_archived:', row.get('is_archived','AUSENTE'))
    print('muted_until:', row.get('muted_until','AUSENTE'))
    print('total conversas:', len(d))
else:
    print('Resposta:', str(d)[:200])
"

echo ""
echo "=== MENSAGENS is_read presente? ==="
curl -s -H "Authorization: Bearer $TOKEN" "https://api.mentoark.com.br/api/whatsapp/conversas/5511940161702" | python3 -c "
import sys,json
d=json.load(sys.stdin)
msgs = d if isinstance(d,list) else d.get('mensagens',d.get('messages',[]))
if msgs:
    m=msgs[0]
    print('is_read:', m.get('is_read','AUSENTE'))
    print('total msgs:', len(msgs))
else:
    print('Sem mensagens:', str(d)[:200])
"

echo ""
echo "=== CONTAINERS RODANDO ==="
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E "crm|crm-api"

echo ""
echo "=== WEBHOOK status crm_5319f0ed61b3 ==="
curl -s -H "apikey: mentoark2025evolutionkey" "https://disparo.mentoark.com.br/webhook/find/crm_5319f0ed61b3"
echo ""
echo "=== WEBHOOK status crm_435ee4720fc3 ==="
curl -s -H "apikey: mentoark2025evolutionkey" "https://disparo.mentoark.com.br/webhook/find/crm_435ee4720fc3"
