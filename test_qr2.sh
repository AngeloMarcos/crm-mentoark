#!/bin/bash
EVO_KEY="mentoark2025evolutionkey"
EVO_URL="https://disparo.mentoark.com.br"
INST="crm_435ee4720fc3"

echo "=== 1. Logout para limpar sessão ==="
curl -s -X DELETE "$EVO_URL/instance/logout/$INST" -H "apikey: $EVO_KEY"
echo ""
sleep 3

echo "=== 2. Estado após logout ==="
curl -s "$EVO_URL/instance/connectionState/$INST" -H "apikey: $EVO_KEY"
echo ""

echo "=== 3. Connect (tenta gerar QR) ==="
curl -s "$EVO_URL/instance/connect/$INST" -H "apikey: $EVO_KEY"
echo ""
sleep 2

echo "=== 4. Connect novamente ==="
curl -s "$EVO_URL/instance/connect/$INST" -H "apikey: $EVO_KEY" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('keys:', list(d.keys()))
b64 = d.get('base64') or d.get('qrcode',{}).get('base64','') if isinstance(d.get('qrcode'),dict) else d.get('code','')
print('base64 presente:', bool(b64))
print('pairingCode:', d.get('pairingCode',''))
if not b64:
    print('raw:', json.dumps(d)[:200])
" 2>/dev/null
echo ""

echo "=== 5. Testa endpoint /qrcode ==="
curl -s "$EVO_URL/instance/qrcode/$INST" -H "apikey: $EVO_KEY"
echo ""

echo "=== 6. Testa fetchInstances para ver formato ==="
curl -s "$EVO_URL/instance/fetchInstances" -H "apikey: $EVO_KEY" | python3 -c "
import json,sys
data=json.load(sys.stdin)
items=data if isinstance(data,list) else [data]
for it in items:
    name=it.get('instance',{}).get('instanceName','?')
    state=it.get('instance',{}).get('connectionStatus','?')
    qr=it.get('qrcode','no-qr')
    print(name, '|', state, '| qr:', str(qr)[:80])
" 2>/dev/null
echo ""
