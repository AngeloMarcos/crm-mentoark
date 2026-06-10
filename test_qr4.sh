#!/bin/bash
EVO_KEY="mentoark2025evolutionkey"
EVO_URL="https://disparo.mentoark.com.br"
INST="crm_435ee4720fc3"

echo "=== CREATE response completa ==="
curl -s -X POST "$EVO_URL/instance/create" \
  -H "apikey: $EVO_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"instanceName\":\"$INST\",\"token\":\"$EVO_KEY\",\"qrcode\":true,\"integration\":\"WHATSAPP-BAILEYS\",\"groupsIgnore\":true,\"alwaysOnline\":true,\"readMessages\":true}" \
  | python3 -m json.tool 2>/dev/null | head -40
echo ""

echo "=== Aguarda Baileys iniciar (6s) ==="
sleep 6

echo "=== Connect após aguardar ==="
curl -s "$EVO_URL/instance/connect/$INST" -H "apikey: $EVO_KEY" | python3 -m json.tool 2>/dev/null
echo ""

echo "=== Estado após connect ==="
curl -s "$EVO_URL/instance/connectionState/$INST" -H "apikey: $EVO_KEY"
echo ""
