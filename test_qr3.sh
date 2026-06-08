#!/bin/bash
EVO_KEY="mentoark2025evolutionkey"
EVO_URL="https://disparo.mentoark.com.br"
INST="crm_435ee4720fc3"

echo "=== VERSÃO ==="
curl -s "$EVO_URL/" -H "apikey: $EVO_KEY" | python3 -m json.tool 2>/dev/null | head -10
echo ""

echo "=== Estado atual (após logout) ==="
curl -s "$EVO_URL/instance/connectionState/$INST" -H "apikey: $EVO_KEY"
echo ""

echo "=== Aguarda 5s e connect ==="
sleep 5
RESP=$(curl -s "$EVO_URL/instance/connect/$INST" -H "apikey: $EVO_KEY")
echo "connect resp: $RESP"
echo ""

echo "=== Tenta DELETE + create (recriar do zero) ==="
# Deleta instância
curl -s -X DELETE "$EVO_URL/instance/delete/$INST" -H "apikey: $EVO_KEY"
echo ""
sleep 2

# Recria com qrcode
curl -s -X POST "$EVO_URL/instance/create" \
  -H "apikey: $EVO_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"instanceName\":\"$INST\",\"token\":\"$EVO_KEY\",\"qrcode\":true,\"integration\":\"WHATSAPP-BAILEYS\",\"groupsIgnore\":true,\"alwaysOnline\":true,\"readMessages\":true}" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('keys:', list(d.keys())[:10])
qr=d.get('qrcode',{})
if isinstance(qr,dict):
    b64=qr.get('base64','')
    print('QR base64:', b64[:50] if b64 else 'VAZIO')
    print('pairingCode:', qr.get('pairingCode',''))
else:
    print('qrcode field:', str(qr)[:100])
print('state:', d.get('instance',{}).get('connectionStatus','?'))
" 2>/dev/null || echo "PARSE FAIL"
echo ""

echo "=== Connect após create ==="
sleep 3
curl -s "$EVO_URL/instance/connect/$INST" -H "apikey: $EVO_KEY"
echo ""
